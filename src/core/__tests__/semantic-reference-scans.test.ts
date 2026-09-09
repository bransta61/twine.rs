import {
	SemanticReferenceScans,
	type SemanticSession,
	type SemanticScanRequest
} from '../wasm/semantic-reference-scans';
import type {
	ParserRequest,
	ParserResponse
} from '../wasm/harlowe-parser-protocol';
import {HARLOWE_PASSAGE_PROVIDER} from '../navigation-admission';

class Session implements SemanticSession {
	source = 'Target';
	next = false;
	uploaded = 0;
	cancelled: bigint[] = [];
	accepts = 0;
	finished = false;
	begin_semantic_references() {
		this.next = false;
		return {type: 'task', task_id: 1n};
	}
	next_semantic_reference_source() {
		if (this.next) return null;
		this.next = true;
		return {
			sourceId: 'source',
			byteLength: this.source.length,
			targetNames: ['Target']
		};
	}
	read_semantic_reference_source_chunk(
		_task: bigint,
		_source: string,
		offset: number,
		size: number
	) {
		const text = this.source.slice(offset, offset + size);
		this.uploaded += text.length;
		return text;
	}
	accept_semantic_reference_occurrences(
		_task: bigint,
		_source: string,
		records: unknown[]
	) {
		this.accepts++;
		return {
			acceptedOccurrences: records.length,
			validationComplete: records.length === 0
		};
	}
	finish_semantic_reference_source() {}
	finish_semantic_references() {
		this.finished = true;
	}
	cancel_semantic_references(task: bigint) {
		this.cancelled.push(task);
	}
	invalidate_semantic_provider() {}
	query_semantic_references_page(
		_story: string,
		_target: string,
		identity: unknown
	) {
		return {
			coverage: 'harlowe-static-passages',
			navigationIdentity: identity,
			storyId: 'story',
			passageId: 'target',
			references: [],
			totalCount: 0,
			revision: 1,
			nextCursor: null
		};
	}
}
class Parser {
	onmessage?: (event: MessageEvent<ParserResponse>) => void;
	onerror?: (event: ErrorEvent) => void;
	onmessageerror?: () => void;
	terminated = false;
	messages: ParserRequest[] = [];
	outstanding = 0;
	peakOutstanding = 0;
	stalled?: ParserRequest;
	constructor(readonly stall?: ParserRequest['kind']) {}
	terminate() {
		this.terminated = true;
	}
	postMessage(request: ParserRequest) {
		this.messages.push(request);
		this.peakOutstanding = Math.max(this.peakOutstanding, ++this.outstanding);
		if (this.stall === request.kind) {
			this.stalled = request;
			return;
		}
		queueMicrotask(() => this.reply(request));
	}
	reply(request: ParserRequest) {
		this.outstanding--;
		let response: ParserResponse;
		if (request.kind === 'begin')
			response = {kind: 'ready', owner: request.owner};
		else if (request.kind === 'upload')
			response = {kind: 'uploaded', owner: request.owner};
		else
			response = {
				kind: 'batch',
				owner: request.owner,
				done: request.kind === 'credit',
				bytes: new TextEncoder().encode(
					request.kind === 'parse'
						? '[{"start":0,"end":6,"target":"Target"}]'
						: '[]'
				).buffer
			};
		this.onmessage?.({data: response} as MessageEvent<ParserResponse>);
	}
}
const request = (owner = 'first'): SemanticScanRequest => ({
	owner,
	sessionId: 'session',
	storyId: 'story',
	passageId: 'target',
	revision: 1,
	navigation: {provider: HARLOWE_PASSAGE_PROVIDER, providerEpoch: 1},
	options: {cursor: null, limit: 50}
});
const flush = async () => {
	for (let i = 0; i < 15; i++) await Promise.resolve();
};
function setup(stall?: ParserRequest['kind']) {
	const session = new Session();
	let entry:
		| {session: SemanticSession; instanceId: number; revision: number}
		| undefined = {session, instanceId: 1, revision: 1};
	const parsers: Parser[] = [];
	const scans = new SemanticReferenceScans(
		() => entry,
		() => {
			const parser = new Parser(stall);
			parsers.push(parser);
			return parser as unknown as Worker;
		},
		20
	);
	return {
		session,
		parsers,
		scans,
		replace: () => {
			entry = {session: new Session(), instanceId: 2, revision: 1};
		}
	};
}
describe('isolated semantic scan ownership and credits', () => {
	it('uploads a large source in acknowledged 64KiB chunks and terminates on completion', async () => {
		const {scans, session, parsers} = setup();
		session.source = 'Target' + 'x'.repeat(1024 * 1024);
		await expect(scans.query(request())).resolves.toMatchObject({
			totalCount: 0,
			navigationIdentity: {sessionInstanceId: 1, providerEpoch: 1}
		});
		expect(session.uploaded).toBe(session.source.length);
		expect(
			parsers[0].messages
				.filter(m => m.kind === 'upload')
				.every(m => m.kind === 'upload' && m.bytes.byteLength <= 65536)
		).toBe(true);
		expect(parsers[0].peakOutstanding).toBe(1);
		expect(parsers[0].terminated).toBe(true);
		expect(session.finished).toBe(true);
	});
	it.each(['upload', 'parse', 'credit'] as const)(
		'cancels during %s without leaking the helper or staging',
		async kind => {
			const {scans, session, parsers} = setup(kind);
			const pending = scans.query(request());
			await flush();
			scans.cancel('first', 'session');
			await expect(pending).rejects.toThrow('cancelled');
			await flush();
			expect(parsers[0].terminated).toBe(true);
			expect(session.cancelled).toEqual([1n]);
			expect(scans.counts()).toEqual({active: 0, queued: 0});
		}
	);
	it('bounds independent scans and ignores delayed cancellation of a former owner', async () => {
		const {scans, parsers} = setup('parse');
		const first = scans.query(request());
		await flush();
		const second = scans.query(request('second'));
		await expect(scans.query(request('third'))).rejects.toThrow(
			'semantic-busy'
		);
		scans.cancel('first', 'session');
		await expect(first).rejects.toThrow('cancelled');
		await flush();
		scans.cancel('first', 'session');
		expect(parsers[1].terminated).toBe(false);
		scans.cancel('second', 'session');
		await expect(second).rejects.toThrow('cancelled');
	});
	it('rejects same-ID session replacement after an asynchronous boundary', async () => {
		const {scans, parsers, replace} = setup('parse');
		const pending = scans.query(request());
		await flush();
		replace();
		parsers[0].reply(parsers[0].stalled!);
		await expect(pending).rejects.toThrow('semantic-stale');
		expect(parsers[0].terminated).toBe(true);
	});
	it('revokes pending scans on a registration epoch change', async () => {
		const {scans, parsers} = setup('parse');
		const pending = scans.query(request());
		await flush();
		scans.sync('session', 'story', {...request().navigation, providerEpoch: 2});
		await expect(pending).rejects.toThrow('cancelled');
		expect(parsers[0].terminated).toBe(true);
		await expect(scans.query(request())).rejects.toThrow('obsolete');
	});
	it('settles a stalled parser through the per-source watchdog', async () => {
		jest.useFakeTimers();
		try {
			const {scans, parsers} = setup('parse');
			const pending = scans.query(request());
			const failure = expect(pending).rejects.toThrow('semantic-timeout');
			await jest.advanceTimersByTimeAsync(21);
			await failure;
			expect(parsers[0].terminated).toBe(true);
		} finally {
			jest.useRealTimers();
		}
	});
});
