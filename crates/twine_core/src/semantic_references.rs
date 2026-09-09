use crate::{
    CoreError, CoreNavigationIdentity, CoreSemanticReferenceAcceptResult,
    CoreSemanticReferenceOccurrence,
};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use twine_model::{PassageId, StoryId};

pub const PROVIDER_IDENTIFIER: &str = "harlowe-3.3.9-static-passages";
pub const MAX_OCCURRENCES: usize = 100_000;
pub const MAX_BATCH_BYTES: usize = 64 * 1024;
pub const VALIDATION_STEP_BYTES: usize = 16 * 1024;
// Conservative node/key/header allowance, plus one decoded input batch. This
// bounds retained logical allocations; allocator/process overhead is separate.
pub const TASK_OVERHEAD: usize = 5 * MAX_BATCH_BYTES + 8192;

/// Counts the wire representation without first allocating an equally large
/// JSON buffer.  This is deliberately exact for serde_json's compact struct
/// representation of `CoreSemanticReferenceOccurrence`.
pub fn batch_encoded_len(batch: &[CoreSemanticReferenceOccurrence]) -> Option<usize> {
    fn digits(value: usize) -> usize {
        value.to_string().len()
    }
    fn escaped_len(value: &str) -> Option<usize> {
        value.chars().try_fold(0usize, |total, ch| {
            total.checked_add(match ch {
                '"' | '\\' | '\n' | '\r' | '\t' | '\u{08}' | '\u{0C}' => 2,
                ch if ch <= '\u{1F}' => 6,
                _ => ch.len_utf8(),
            })
        })
    }

    batch
        .iter()
        .enumerate()
        .try_fold(2usize, |total, (index, record)| {
            // {"end":<n>,"start":<n>,"target":"<escaped>"}
            total
                .checked_add(usize::from(index != 0))?
                .checked_add(29)?
                .checked_add(digits(record.end))?
                .checked_add(digits(record.start))?
                .checked_add(escaped_len(&record.target)?)
        })
}
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct SemanticKey {
    pub story_id: StoryId,
    pub target_id: PassageId,
    pub identity: CoreNavigationIdentity,
}
impl SemanticKey {
    pub fn bytes(&self) -> usize {
        512 + 4
            * (self.story_id.as_ref().len()
                + self.target_id.as_ref().len()
                + self.identity.provider.provider_identifier.capacity()
                + self
                    .identity
                    .provider
                    .format_name
                    .as_ref()
                    .map_or(0, String::capacity)
                + self
                    .identity
                    .provider
                    .format_version
                    .as_ref()
                    .map_or(0, String::capacity))
    }
}
#[derive(Clone, Copy, Debug)]
pub struct SemanticOccurrence {
    pub source_rank: usize,
    pub start: usize,
    pub end: usize,
}
#[derive(Clone, Debug)]
pub struct SemanticEntry {
    pub revision: u64,
    pub occurrences: Vec<SemanticOccurrence>,
    pub dirty_sources: BTreeSet<usize>,
    pub ambiguous: bool,
}
impl SemanticEntry {
    pub fn bytes(&self) -> usize {
        self.occurrences.capacity() * std::mem::size_of::<SemanticOccurrence>()
            + self.dirty_sources.len() * 64
    }
}
#[derive(Debug)]
pub struct TargetStage {
    pub key: SemanticKey,
    pub name: String,
    pub entry: SemanticEntry,
}
#[derive(Debug)]
pub enum Sources {
    All { count: usize },
    Dirty(BTreeSet<usize>),
}
#[derive(Debug)]
pub struct PendingSpan {
    start: usize,
    end: usize,
    byte_start: usize,
    target: usize,
}
#[derive(Debug)]
pub struct SemanticTask {
    pub key: SemanticKey,
    pub revision: u64,
    pub sources: Sources,
    pub source_cursor: usize,
    pub active_rank: Option<usize>,
    pub read_offset: usize,
    pub validation_byte_offset: usize,
    pub validation_utf16_offset: usize,
    pub pending: Option<PendingSpan>,
    pub targets: Vec<TargetStage>,
    pub last_span: Option<(usize, usize)>,
}
impl SemanticTask {
    pub fn bytes(&self) -> usize {
        TASK_OVERHEAD
            + self.key.bytes()
            + self.targets.capacity() * std::mem::size_of::<TargetStage>()
            + self
                .targets
                .iter()
                .map(|s| s.key.bytes() + s.name.capacity() + s.entry.bytes())
                .sum::<usize>()
            + match &self.sources {
                Sources::All { .. } => 0,
                Sources::Dirty(ids) => ids.len() * 64,
            }
    }
    pub fn complete(&self) -> bool {
        self.active_rank.is_none()
            && match &self.sources {
                Sources::All { count } => self.source_cursor == *count,
                Sources::Dirty(ids) => ids.is_empty(),
            }
    }
    pub fn validate(
        &mut self,
        source: &str,
        batch: &[CoreSemanticReferenceOccurrence],
        mut available: usize,
    ) -> Result<CoreSemanticReferenceAcceptResult, CoreError> {
        let rejected = |text: &str| CoreError::SemanticReferencesRejected(text.into());
        if self.read_offset != source.len() {
            return Err(rejected("source upload is incomplete"));
        }
        if batch_encoded_len(batch).ok_or_else(|| rejected("occurrence batch size overflow"))?
            > MAX_BATCH_BYTES
        {
            return Err(rejected("occurrence batch exceeds 64KiB"));
        }
        if batch
            .windows(2)
            .any(|p| p[0].end > p[1].start || (p[0].start, p[0].end) >= (p[1].start, p[1].end))
        {
            return Err(rejected("occurrences must be ordered and nonoverlapping"));
        }
        if self.pending.is_some() && batch.is_empty() {
            return Err(rejected("pending occurrence omitted"));
        }
        // Reserve every submitted result before it can receive a transport
        // credit. Unconsumed suffixes reuse these capacities on the next turn.
        for target in &mut self.targets {
            let added = batch.iter().filter(|r| r.target == target.name).count();
            let required = target
                .entry
                .occurrences
                .len()
                .checked_add(added)
                .ok_or_else(|| rejected("occurrence capacity overflow"))?;
            if required > MAX_OCCURRENCES {
                return Err(CoreError::PassageReferencesTooLarge(
                    self.key.target_id.as_ref().into(),
                ));
            }
            let growth = required.saturating_sub(target.entry.occurrences.capacity());
            let cost = growth * std::mem::size_of::<SemanticOccurrence>();
            if cost > available {
                return Err(CoreError::PassageReferencesTooLarge(
                    self.key.target_id.as_ref().into(),
                ));
            }
            if growth > 0 {
                target
                    .entry
                    .occurrences
                    .try_reserve_exact(required - target.entry.occurrences.len())
                    .map_err(|_| rejected("occurrence allocation failed"))?;
                available -= cost;
            }
        }
        let limit = self
            .validation_byte_offset
            .saturating_add(VALIDATION_STEP_BYTES);
        let mut accepted = 0;
        loop {
            let occurrence = batch.get(accepted);
            let target = occurrence
                .map(|r| {
                    self.targets
                        .iter()
                        .position(|t| !t.entry.ambiguous && t.name == r.target)
                        .ok_or_else(|| rejected("unknown or ambiguous semantic target"))
                })
                .transpose()?;
            if let Some(r) = occurrence {
                if r.end < r.start
                    || (self.pending.is_none()
                        && (r.start < self.validation_utf16_offset
                            || self.last_span.is_some_and(|last| (r.start, r.end) <= last)))
                {
                    return Err(rejected("invalid UTF-16 range order"));
                }
                if let Some(pending) = &self.pending {
                    if (pending.start, pending.end, Some(pending.target))
                        != (r.start, r.end, target)
                    {
                        return Err(rejected("pending occurrence changed"));
                    }
                } else if r.start == self.validation_utf16_offset {
                    self.pending = Some(PendingSpan {
                        start: r.start,
                        end: r.end,
                        byte_start: self.validation_byte_offset,
                        target: target.unwrap(),
                    });
                }
                if r.end == self.validation_utf16_offset {
                    let pending = self
                        .pending
                        .take()
                        .ok_or_else(|| rejected("missing start boundary"))?;
                    if source.get(pending.byte_start..self.validation_byte_offset)
                        != Some(r.target.as_str())
                    {
                        return Err(rejected("semantic target mismatch"));
                    }
                    self.targets[pending.target]
                        .entry
                        .occurrences
                        .push(SemanticOccurrence {
                            source_rank: self.active_rank.unwrap(),
                            start: r.start,
                            end: r.end,
                        });
                    self.last_span = Some((r.start, r.end));
                    accepted += 1;
                    if accepted == batch.len() {
                        break;
                    }
                    continue;
                }
            } else if !batch.is_empty() {
                break;
            }
            if self.validation_byte_offset == source.len() {
                if occurrence.is_some() {
                    return Err(rejected("UTF-16 range exceeds canonical source"));
                }
                break;
            }
            if self.validation_byte_offset >= limit {
                break;
            }
            let ch = source[self.validation_byte_offset..]
                .chars()
                .next()
                .unwrap();
            let next_utf16 = self.validation_utf16_offset + ch.len_utf16();
            if occurrence.is_some_and(|r| {
                (r.start > self.validation_utf16_offset && r.start < next_utf16)
                    || (r.end > self.validation_utf16_offset && r.end < next_utf16)
            }) {
                return Err(rejected("range splits a surrogate pair"));
            }
            self.validation_byte_offset += ch.len_utf8();
            self.validation_utf16_offset = next_utf16;
        }
        Ok(CoreSemanticReferenceAcceptResult {
            accepted_occurrences: accepted,
            validation_complete: self.validation_byte_offset == source.len(),
        })
    }
}
#[derive(Debug, Default)]
pub struct SemanticReferenceStore {
    pub entries: BTreeMap<SemanticKey, SemanticEntry>,
    pub lru: VecDeque<SemanticKey>,
    pub tasks: BTreeMap<u64, SemanticTask>,
    pub next_task_id: u64,
    pub scan_count: usize,
    pub source_count: usize,
}
impl Clone for SemanticReferenceStore {
    fn clone(&self) -> Self {
        Self {
            entries: self.entries.clone(),
            lru: self.lru.clone(),
            tasks: BTreeMap::new(),
            next_task_id: self.next_task_id,
            scan_count: self.scan_count,
            source_count: self.source_count,
        }
    }
}
impl SemanticReferenceStore {
    pub fn provider_is_admitted(i: &CoreNavigationIdentity) -> bool {
        i.provider.provider_identifier == PROVIDER_IDENTIFIER
            && i.provider.capability_revision == 1
            && i.provider.format_name.as_deref() == Some("Harlowe")
            && i.provider.format_version.as_deref() == Some("3.3.9")
    }
    pub fn touch(&mut self, key: &SemanticKey) {
        self.lru.retain(|item| item != key);
        self.lru.push_back(key.clone());
    }
    pub fn entry_count(&self) -> usize {
        self.entries.len() + self.tasks.values().map(|t| t.targets.len()).sum::<usize>()
    }
    pub fn entry_bytes(&self) -> usize {
        self.lru.capacity() * std::mem::size_of::<SemanticKey>()
            + self
                .entries
                .iter()
                .map(|(k, e)| k.bytes() + e.bytes())
                .sum::<usize>()
            + self.tasks.values().map(SemanticTask::bytes).sum::<usize>()
    }
}
