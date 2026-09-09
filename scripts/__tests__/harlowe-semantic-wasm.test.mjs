import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
	initSync,
	TwineWasmProjectSession
} from '../../src/core/wasm/pkg/twine_wasm.js';

initSync({
	module: readFileSync(
		new URL('../../src/core/wasm/pkg/twine_wasm_bg.wasm', import.meta.url)
	)
});
const identity = {
	sessionInstanceId: 1,
	providerEpoch: 1,
	provider: {
		providerIdentifier: 'harlowe-3.3.9-static-passages',
		capabilityRevision: 1,
		formatName: 'Harlowe',
		formatVersion: '3.3.9'
	}
};
function setup(text, name = 'T') {
	const passage = (id, name, text) => ({
		id,
		name,
		text,
		storyId: 'story',
		tags: [],
		layout: null
	});
	const session = new TwineWasmProjectSession({
		dirty: false,
		name: 'test',
		schemaVersion: 1,
		stories: [
			{
				id: 'story',
				ifid: 'test',
				name: 'story',
				passages: [
					passage('source', 'Source', text),
					passage('target', name, '')
				],
				script: '',
				stylesheet: '',
				startPassageId: 'source',
				storyFormat: 'Harlowe',
				storyFormatVersion: '3.3.9',
				tags: [],
				tagColors: {},
				zoom: 1,
				snapToGrid: false
			}
		]
	});
	const task = BigInt(
		session.begin_semantic_references('story', 'target', identity).task_id
	);
	const source = session.next_semantic_reference_source(task);
	let offset = 0;
	while (offset < source.byteLength)
		offset += Buffer.byteLength(
			session.read_semantic_reference_source_chunk(
				task,
				source.sourceId,
				offset,
				65536
			)
		);
	return {session, task, source};
}
function accept(session, task, records) {
	while (records.length) {
		const accepted = session.accept_semantic_reference_occurrences(
			task,
			'source',
			records
		);
		records = records.slice(accepted.acceptedOccurrences);
	}
}
function commit(session, task) {
	while (
		!session.accept_semantic_reference_occurrences(task, 'source', [])
			.validationComplete
	) {
		/* bounded Rust turns */
	}
	session.finish_semantic_reference_source(task, 'source');
	const target = session.next_semantic_reference_source(task);
	assert.equal(target.byteLength, 0);
	session.accept_semantic_reference_occurrences(task, 'target', []);
	session.finish_semantic_reference_source(task, 'target');
	session.finish_semantic_references(task);
}
test('real WASM admits a long valid record without a restrictive escaped-size estimate', () => {
	const target = 'x'.repeat(20_000);
	const {session, task} = setup(`(display:"${target}")`, target);
	try {
		accept(session, task, [{start: 10, end: 10 + target.length, target}]);
		commit(session, task);
		assert.equal(
			session.query_semantic_references_page('story', 'target', identity, {
				limit: 50,
				cursor: null
			}).totalCount,
			1
		);
	} finally {
		session.free();
	}
});
test('malformed and oversized real WASM batches release staging before decoding', () => {
	for (const batch of [
		[{start: 0, end: 1, target: 'x'.repeat(100_000)}],
		Array(2200).fill({start: 0, end: 1, target: 'T'}),
		[{start: 'bad', end: 1, target: 'T'}],
		[{start: 1, end: 2, target: 'T'}]
	]) {
		const {session, task} = setup('😀T');
		try {
			assert.throws(() =>
				session.accept_semantic_reference_occurrences(task, 'source', batch)
			);
			assert.equal(session.performance_diagnostics().semanticReferenceTasks, 0);
			assert.equal(
				session.performance_diagnostics().semanticReferenceEntries,
				0
			);
		} finally {
			session.free();
		}
	}
});
test('throwing occurrence getters cancel the active WASM task', () => {
	const {session, task} = setup('T');
	try {
		const record = {start: 0, end: 1};
		Object.defineProperty(record, 'target', {
			get() {
				throw new Error('getter');
			}
		});
		assert.throws(() =>
			session.accept_semantic_reference_occurrences(task, 'source', [record])
		);
		assert.equal(session.performance_diagnostics().semanticReferenceTasks, 0);
	} finally {
		session.free();
	}
});
test('real WASM preserves the 100000 occurrence ceiling and atomic failure', () => {
	for (const count of [100_000, 100_001]) {
		const {session, task} = setup('[[T]]'.repeat(count));
		try {
			const run = () => {
				for (let base = 0; base < count; base += 1000) {
					accept(
						session,
						task,
						Array.from({length: Math.min(1000, count - base)}, (_, i) => ({
							start: (base + i) * 5 + 2,
							end: (base + i) * 5 + 3,
							target: 'T'
						}))
					);
				}
				commit(session, task);
			};
			if (count === 100_000) {
				run();
				const page = session.query_semantic_references_page(
					'story',
					'target',
					identity,
					{limit: 200, cursor: null}
				);
				assert.equal(page.totalCount, count);
				assert.equal(page.references.length, 200);
			} else {
				assert.throws(run);
				assert.equal(
					session.performance_diagnostics().semanticReferenceEntries,
					0
				);
			}
			assert.equal(session.performance_diagnostics().semanticReferenceTasks, 0);
			assert.ok(
				session.performance_diagnostics().semanticReferenceBytes <=
					4 * 1024 * 1024
			);
		} finally {
			session.free();
		}
	}
});
