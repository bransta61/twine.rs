import {harloweStaticOccurrences} from './harlowe-static-parser';
import {
	PARSER_TRANSPORT_BYTES,
	type ParserRequest,
	type ParserResponse
} from './harlowe-parser-protocol';
import type {CoreSemanticReferenceOccurrence} from '../bindings/CoreSemanticReferenceOccurrence';

let owner = '';
let source = '';
let expected = 0;
let received = 0;
let targets = new Set<string>();
let decoder = new TextDecoder('utf-8', {fatal: true});
let iterator: Generator<CoreSemanticReferenceOccurrence> | undefined;
let pending: IteratorResult<CoreSemanticReferenceOccurrence> | undefined;
const encoder = new TextEncoder();
const post = (message: ParserResponse, transfer: Transferable[] = []) =>
	self.postMessage(message, {transfer});

self.onmessage = (event: MessageEvent<ParserRequest>) => {
	const request = event.data;
	try {
		if (request.kind === 'begin') {
			if (iterator) throw new Error('previous source is unfinished');
			owner = request.owner;
			source = '';
			expected = request.byteLength;
			received = 0;
			targets = new Set(request.targets);
			decoder = new TextDecoder('utf-8', {fatal: true});
			pending = undefined;
			post({kind: 'ready', owner});
			return;
		}
		if (request.owner !== owner) return;
		if (request.kind === 'upload') {
			if (
				iterator ||
				request.bytes.byteLength > PARSER_TRANSPORT_BYTES ||
				received + request.bytes.byteLength > expected
			)
				throw new Error('invalid source upload');
			received += request.bytes.byteLength;
			source += decoder.decode(request.bytes, {stream: true});
			post({kind: 'uploaded', owner});
			return;
		}
		if (request.kind === 'parse') {
			if (iterator || received !== expected)
				throw new Error('incomplete source upload');
			source += decoder.decode();
			iterator = harloweStaticOccurrences(source, targets);
		} else if (!iterator) throw new Error('unexpected result credit');
		// Exactly one response consumes each parse/credit request. The producer
		// never emits another result until Rust has accepted this batch.
		const records: string[] = [];
		let size = 2;
		for (;;) {
			pending ??= iterator!.next();
			if (pending.done) break;
			const json = JSON.stringify(pending.value);
			const bytes = encoder.encode(json).byteLength;
			if (bytes + 2 > PARSER_TRANSPORT_BYTES)
				throw new Error(
					'semantic-capacity: one reference exceeds transport capacity'
				);
			if (size + bytes + (records.length ? 1 : 0) > PARSER_TRANSPORT_BYTES)
				break;
			size += bytes + (records.length ? 1 : 0);
			records.push(json);
			pending = undefined;
		}
		const done = pending?.done === true;
		const bytes = encoder.encode('[' + records.join(',') + ']');
		if (done) {
			iterator = undefined;
			pending = undefined;
			source = '';
			targets.clear();
		}
		post({kind: 'batch', owner, bytes: bytes.buffer, done}, [bytes.buffer]);
	} catch (error) {
		iterator = undefined;
		pending = undefined;
		source = '';
		targets.clear();
		post({
			kind: 'error',
			owner: request.owner,
			message: error instanceof Error ? error.message : String(error)
		});
	}
};
