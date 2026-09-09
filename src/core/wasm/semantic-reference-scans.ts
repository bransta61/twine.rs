import ParserWorker from './harlowe-parser-worker?worker';
import {
	PARSER_TRANSPORT_BYTES,
	type ParserRequest,
	type ParserResponse
} from './harlowe-parser-protocol';
import type {CoreNavigationIdentity} from '../bindings/CoreNavigationIdentity';
import type {CoreSemanticReferenceBeginResult} from '../bindings/CoreSemanticReferenceBeginResult';
import type {CoreSemanticReferenceSource} from '../bindings/CoreSemanticReferenceSource';
import type {CoreSemanticReferenceAcceptResult} from '../bindings/CoreSemanticReferenceAcceptResult';
import type {CorePassageReferencesPage} from '../bindings/CorePassageReferencesPage';
import type {CorePassageReferencesQuery} from '../bindings/CorePassageReferencesQuery';
import type {NavigationAdmission} from '../navigation-admission';

export interface SemanticSession {
	begin_semantic_references(
		story: string,
		target: string,
		identity: unknown
	): unknown;
	next_semantic_reference_source(task: bigint): unknown;
	read_semantic_reference_source_chunk(
		task: bigint,
		source: string,
		offset: number,
		size: number
	): string;
	accept_semantic_reference_occurrences(
		task: bigint,
		source: string,
		occurrences: unknown
	): unknown;
	finish_semantic_reference_source(task: bigint, source: string): void;
	finish_semantic_references(task: bigint): void;
	cancel_semantic_references(task: bigint): void;
	invalidate_semantic_provider(story: string): void;
	query_semantic_references_page(
		story: string,
		target: string,
		identity: unknown,
		options: unknown
	): unknown;
}
export interface SemanticScanRequest {
	owner: string;
	sessionId: string;
	storyId: string;
	passageId: string;
	revision: number;
	navigation: NavigationAdmission;
	options: CorePassageReferencesQuery;
}
interface Job {
	request: SemanticScanRequest;
	instanceId: number;
	controller: AbortController;
	resolve(page: CorePassageReferencesPage): void;
	reject(reason: unknown): void;
}
const fail = (message: string) => new Error(message);
const turn = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** One scan and one queue slot per core worker. Rust remains the project authority. */
export class SemanticReferenceScans {
	private active?: Job;
	private queued?: Job;
	private authorities = new Map<string, NavigationAdmission>();
	constructor(
		private readonly current: (
			sessionId: string
		) =>
			| {instanceId: number; revision: number; session: SemanticSession}
			| undefined,
		private readonly createParser: () => Worker = () =>
			new ParserWorker({name: 'harlowe-static-parser'}),
		private readonly watchdogMs = 10_000
	) {}
	private key(session: string, story: string) {
		return JSON.stringify([session, story]);
	}
	sync(sessionId: string, storyId: string, navigation: NavigationAdmission) {
		const key = this.key(sessionId, storyId);
		const previous = this.authorities.get(key);
		if (previous && navigation.providerEpoch < previous.providerEpoch)
			throw fail('semantic-stale: navigation registration is obsolete');
		if (!previous || JSON.stringify(previous) !== JSON.stringify(navigation)) {
			this.authorities.set(key, navigation);
			this.cancelWhere(
				job =>
					job.request.sessionId === sessionId && job.request.storyId === storyId
			);
			this.current(sessionId)?.session.invalidate_semantic_provider(storyId);
		}
	}
	private cancelWhere(predicate: (job: Job) => boolean) {
		if (this.queued && predicate(this.queued)) {
			this.queued.controller.abort(
				fail('semantic-cancelled: references cancelled')
			);
			this.queued.reject(fail('semantic-cancelled: references cancelled'));
			this.queued = undefined;
		}
		if (this.active && predicate(this.active))
			this.active.controller.abort(
				fail('semantic-cancelled: references cancelled')
			);
	}
	cancel(owner: string, sessionId: string) {
		this.cancelWhere(
			j => j.request.owner === owner && j.request.sessionId === sessionId
		);
	}
	removeSession(sessionId: string) {
		this.cancelWhere(j => j.request.sessionId === sessionId);
		for (const key of this.authorities.keys())
			if ((JSON.parse(key) as string[])[0] === sessionId)
				this.authorities.delete(key);
	}
	reset() {
		this.cancelWhere(() => true);
		this.authorities.clear();
	}
	counts() {
		return {active: Number(!!this.active), queued: Number(!!this.queued)};
	}
	async query(
		request: SemanticScanRequest
	): Promise<CorePassageReferencesPage> {
		this.sync(request.sessionId, request.storyId, request.navigation);
		const entry = this.current(request.sessionId);
		if (!entry || entry.revision !== request.revision)
			return Promise.reject(fail('semantic-stale: session changed'));
		if (this.active && this.queued)
			return Promise.reject(
				fail('semantic-busy: another references scan is queued. Retry.')
			);
		return new Promise((resolve, reject) => {
			const job: Job = {
				request,
				instanceId: entry.instanceId,
				controller: new AbortController(),
				resolve,
				reject
			};
			if (this.active) this.queued = job;
			else this.start(job);
		});
	}
	private start(job: Job) {
		this.active = job;
		void this.scan(job)
			.then(job.resolve, job.reject)
			.finally(() => {
				if (this.active !== job) return;
				this.active = undefined;
				const next = this.queued;
				this.queued = undefined;
				if (next) this.start(next);
			});
	}
	private session(job: Job) {
		const {request} = job;
		if (job.controller.signal.aborted)
			throw job.controller.signal.reason instanceof Error
				? job.controller.signal.reason
				: fail('semantic-cancelled: references cancelled');
		const entry = this.current(request.sessionId);
		if (
			!entry ||
			entry.instanceId !== job.instanceId ||
			entry.revision !== request.revision ||
			JSON.stringify(
				this.authorities.get(this.key(request.sessionId, request.storyId))
			) !== JSON.stringify(request.navigation)
		)
			throw fail('semantic-stale: references changed. Retry.');
		return entry.session;
	}
	private async scan(job: Job): Promise<CorePassageReferencesPage> {
		const {request} = job;
		const identity: CoreNavigationIdentity = {
			...request.navigation,
			sessionInstanceId: job.instanceId
		};
		let task: bigint | undefined;
		let parser: Worker | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let waiting:
			| {resolve(value: ParserResponse): void; reject(error: unknown): void}
			| undefined;
		const abort = () => {
			parser?.terminate();
			waiting?.reject(
				job.controller.signal.reason instanceof Error
					? job.controller.signal.reason
					: fail('semantic-cancelled: references cancelled')
			);
			waiting = undefined;
		};
		job.controller.signal.addEventListener('abort', abort, {once: true});
		try {
			const begun = this.session(job).begin_semantic_references(
				request.storyId,
				request.passageId,
				identity
			) as CoreSemanticReferenceBeginResult;
			if (begun.type === 'task') {
				task = BigInt(begun.task_id);
				parser = this.createParser();
				parser.onmessage = (event: MessageEvent<ParserResponse>) => {
					if (
						event.data.owner !== request.owner ||
						job.controller.signal.aborted
					)
						return;
					const pending = waiting;
					waiting = undefined;
					if (!pending) {
						job.controller.abort();
						return;
					}
					if (event.data.kind === 'error')
						pending.reject(fail('semantic-parser: ' + event.data.message));
					else pending.resolve(event.data);
				};
				parser.onerror = event => {
					waiting?.reject(fail('semantic-parser: ' + event.message));
					waiting = undefined;
				};
				parser.onmessageerror = () => {
					waiting?.reject(fail('semantic-parser: invalid helper message'));
					waiting = undefined;
				};
				const exchange = (
					message: ParserRequest,
					transfer: Transferable[] = []
				) => {
					this.session(job);
					if (waiting)
						throw fail('semantic-transport: credit already outstanding');
					return new Promise<ParserResponse>((resolve, reject) => {
						waiting = {resolve, reject};
						parser!.postMessage(message, transfer);
					});
				};
				const encoder = new TextEncoder();
				const decoder = new TextDecoder('utf-8', {fatal: true});
				for (;;) {
					const source = this.session(job).next_semantic_reference_source(
						task
					) as CoreSemanticReferenceSource | null;
					if (!source) break;
					// Transport startup/upload also has a watchdog; parsing receives a
					// fresh per-source 10s window and never blocks the core worker.
					const arm = () => {
						clearTimeout(timer);
						timer = setTimeout(() => {
							job.controller.abort(
								fail(
									'semantic-timeout: Harlowe parsing exceeded 10 seconds. Retry.'
								)
							);
						}, this.watchdogMs);
					};
					arm();
					const ready = await exchange({
						kind: 'begin',
						owner: request.owner,
						sourceId: source.sourceId,
						byteLength: source.byteLength,
						targets: source.targetNames
					});
					if (ready.kind !== 'ready')
						throw fail('semantic-transport: expected upload credit');
					let offset = 0;
					while (offset < source.byteLength) {
						const text = this.session(job).read_semantic_reference_source_chunk(
							task,
							source.sourceId,
							offset,
							PARSER_TRANSPORT_BYTES
						);
						const bytes = encoder.encode(text);
						if (!bytes.byteLength || bytes.byteLength > PARSER_TRANSPORT_BYTES)
							throw fail('semantic-transport: invalid canonical chunk');
						offset += bytes.byteLength;
						const uploaded = await exchange(
							{kind: 'upload', owner: request.owner, bytes: bytes.buffer},
							[bytes.buffer]
						);
						if (uploaded.kind !== 'uploaded')
							throw fail('semantic-transport: expected upload acknowledgement');
					}
					arm();
					let reply = await exchange({kind: 'parse', owner: request.owner});
					for (;;) {
						this.session(job);
						if (
							reply.kind !== 'batch' ||
							reply.bytes.byteLength > PARSER_TRANSPORT_BYTES
						)
							throw fail('semantic-transport: invalid result batch');
						let records = JSON.parse(decoder.decode(reply.bytes)) as unknown[];
						let turnStart = performance.now();
						while (records.length) {
							const accepted = this.session(
								job
							).accept_semantic_reference_occurrences(
								task,
								source.sourceId,
								records
							) as CoreSemanticReferenceAcceptResult;
							if (
								accepted.acceptedOccurrences < 0 ||
								accepted.acceptedOccurrences > records.length
							)
								throw fail('semantic-transport: invalid acceptance');
							records = records.slice(accepted.acceptedOccurrences);
							if (
								performance.now() - turnStart >= 5 ||
								accepted.acceptedOccurrences === 0
							) {
								await turn();
								this.session(job);
								turnStart = performance.now();
							}
						}
						if (reply.done) {
							clearTimeout(timer);
							break;
						}
						reply = await exchange({kind: 'credit', owner: request.owner});
					}
					for (;;) {
						const accepted = this.session(
							job
						).accept_semantic_reference_occurrences(
							task,
							source.sourceId,
							[]
						) as CoreSemanticReferenceAcceptResult;
						if (accepted.validationComplete) break;
						await turn();
					}
					this.session(job).finish_semantic_reference_source(
						task,
						source.sourceId
					);
					await turn();
				}
				this.session(job).finish_semantic_references(task);
			}
			const page = this.session(job).query_semantic_references_page(
				request.storyId,
				request.passageId,
				identity,
				request.options
			) as CorePassageReferencesPage;
			if (
				new TextEncoder().encode(JSON.stringify(page)).byteLength >
				256 * 1024
			)
				throw fail('semantic-capacity: response exceeds 256 KiB');
			return page;
		} finally {
			clearTimeout(timer);
			parser?.terminate();
			waiting = undefined;
			job.controller.signal.removeEventListener('abort', abort);
			const entry = this.current(request.sessionId);
			if (task !== undefined && entry?.instanceId === job.instanceId)
				entry.session.cancel_semantic_references(task);
		}
	}
}
