export const PARSER_TRANSPORT_BYTES = 64 * 1024;
export type ParserRequest =
	| {
			kind: 'begin';
			owner: string;
			sourceId: string;
			byteLength: number;
			targets: string[];
	  }
	| {kind: 'upload'; owner: string; bytes: ArrayBuffer}
	| {kind: 'parse'; owner: string}
	| {kind: 'credit'; owner: string};
export type ParserResponse =
	| {kind: 'ready' | 'uploaded'; owner: string}
	| {kind: 'batch'; owner: string; bytes: ArrayBuffer; done: boolean}
	| {kind: 'error'; owner: string; message: string};
