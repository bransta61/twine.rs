import {HarloweMarkup} from '../../util/story-format/harlowe-3.3.9/harlowe-parser-vendor.js';
import {HarloweHtmlEmission} from './harlowe-html-emission';
import type {CoreSemanticReferenceOccurrence} from '../bindings/CoreSemanticReferenceOccurrence';

interface Token {
	type: string;
	text: string;
	start: number;
	end: number;
	name?: string;
	passage?: string;
	children: Token[];
	depth?: number;
	align?: string | number;
	column?: string;
}

function candidate(token: Token): CoreSemanticReferenceOccurrence | undefined {
	if (token.type === 'twineLink' && typeof token.passage === 'string') {
		const target = token.passage;
		if (target.includes('\\')) return;
		const body = token.text.slice(2, -2);
		const prefix = body.slice(0, body.length - target.length);
		const start =
			body.endsWith(target) && /(?:->|\|)$/.test(prefix)
				? token.end - 2 - target.length
				: token.start + 2;
		return {start, end: start + target.length, target};
	}
	if (token.type !== 'macro') return;
	const name = token.name?.toLowerCase().replace(/[-_]/g, '');
	if (!name || !['display', 'goto', 'redirect', 'linkgoto'].includes(name))
		return;
	const children = token.children.filter(t => t.type !== 'whitespace');
	if (children[0]?.type !== 'macroName') return;
	const args = children.slice(1);
	const literal = (t: Token | undefined) =>
		t?.type === 'string' &&
		/^(["'])[\s\S]*\1$/.test(t.text) &&
		!t.text.includes('\\');
	let target: Token | undefined;
	if (args.length === 1 && literal(args[0])) target = args[0];
	else if (
		name === 'linkgoto' &&
		args.length === 3 &&
		literal(args[0]) &&
		args[1].type === 'comma' &&
		literal(args[2])
	)
		target = args[2];
	if (target)
		return {
			start: target.start + 1,
			end: target.end - 1,
			target: target.text.slice(1, -1)
		};
}

/** Only the isolated parser helper calls this in production. No code evaluation. */
export function* harloweStaticOccurrences(
	source: string,
	targets: ReadonlySet<string>
): Generator<CoreSemanticReferenceOccurrence> {
	const root = HarloweMarkup.lex(source) as Token;
	type Frame = {
		tokens: Token[];
		index: number;
		end?: number;
		tagBreaks?: boolean[];
		columns?: boolean;
		html?: HarloweHtmlEmission;
		close?: string;
		own?: CoreSemanticReferenceOccurrence;
	};
	const stack: Frame[] = [
		{tokens: root.children, index: 0, html: new HarloweHtmlEmission()}
	];
	const counts = new Map<string, number>();
	while (stack.length) {
		const frame = stack[stack.length - 1];
		const next =
			frame.index < (frame.end ?? frame.tokens.length)
				? frame.tokens[frame.index]
				: undefined;
		if (frame.own && (!next || next.start >= frame.own.start)) {
			const occurrence = frame.own;
			frame.own = undefined;
			if (targets.has(occurrence.target)) {
				const count = (counts.get(occurrence.target) ?? 0) + 1;
				counts.set(occurrence.target, count);
				if (count > 100_000)
					throw new Error('semantic-capacity: too many passage references');
				yield occurrence;
			}
			continue;
		}
		if (!next) {
			if (frame.close) frame.html?.feed(frame.close);
			stack.pop();
			continue;
		}
		frame.index++;
		const token = next;
		if (['comment', 'escapedLine', 'string'].includes(token.type)) continue;
		if (token.type === 'tag' || token.type === 'scriptStyleTag') {
			// renderer.E tracks literal table/SVG tags separately from the browser
			// namespace stack. Its newline gate deliberately tests the whole tag text.
			const tag = token.text.toLowerCase();
			if (
				/^<\/?(?:table|thead|tbody|tr|tfoot|td|th|svg)\b/.test(tag) &&
				!tag.endsWith('/>')
			) {
				const breaks = (frame.tagBreaks ??= []);
				if (tag.startsWith('</')) breaks.pop();
				else breaks.push(/td|th/.test(tag));
			}
			frame.html?.tag(token.text);
			continue;
		}
		if (token.type === 'text') {
			frame.html?.feed(token.text);
			continue;
		}
		if (['verbatim', 'error', 'inlineUrl'].includes(token.type)) {
			const tag =
				token.type === 'verbatim'
					? 'tw-verbatim'
					: token.type === 'error'
						? 'tw-error'
						: 'a';
			frame.html?.feed(`<${tag}>`);
			// Escaped verbatim text cannot open tags, but its emitted line breaks can
			// exit foreign content. Attributes/error messages are escaped by Harlowe.
			if (token.type === 'verbatim' && token.text.includes('\n'))
				frame.html?.feed('<br>');
			frame.html?.feed(`</${tag}>`);
			continue;
		}
		if (
			[
				'macro',
				'variable',
				'tempVariable',
				'twineLink',
				'hook',
				'unclosedHook'
			].includes(token.type)
		) {
			// The renderer stores code and hook bodies out-of-band. Their source
			// cannot close raw text/comments in the containing emitted fragment.
			const active =
				frame.html?.element(
					token.type === 'hook' || token.type === 'unclosedHook'
						? 'tw-hook'
						: 'tw-expression'
				) ?? true;
			if (token.type === 'unclosedHook') {
				if (active)
					stack.push({
						tokens: frame.tokens,
						index: frame.index,
						end: frame.end,
						html: new HarloweHtmlEmission()
					});
				frame.index = frame.tokens.length;
			} else if (active) {
				stack.push({
					tokens: token.children,
					index: 0,
					own: candidate(token),
					// Macro arguments are code, not emitted literal text. Hooks and
					// link labels render independently when their wrapper is active.
					html:
						token.type === 'hook' || token.type === 'twineLink'
							? new HarloweHtmlEmission()
							: undefined
				});
			}
			continue;
		}
		if (token.type === 'align' || token.type === 'column') {
			if (token.align === 'left' || token.column === 'none') continue;
			const limit = frame.end ?? frame.tokens.length;
			if (token.type === 'column' && !frame.columns) {
				let end = frame.index;
				while (
					end < limit &&
					!(
						frame.tokens[end].type === 'column' &&
						frame.tokens[end].column === 'none'
					)
				)
					end++;
				frame.html?.feed('<tw-columns>');
				stack.push({
					tokens: frame.tokens,
					index: frame.index - 1,
					end,
					html: frame.html,
					columns: true,
					close: '</tw-columns>'
				});
				frame.index = end + 1;
			} else {
				const start = frame.index;
				let end = start;
				while (end < limit && frame.tokens[end].type !== token.type) end++;
				const tag = token.type === 'align' ? 'tw-align' : 'tw-column';
				frame.html?.feed(`<${tag}>`);
				// renderer.E starts a new call for each body, with fresh newline state.
				stack.push({
					tokens: frame.tokens,
					index: start,
					end,
					html: frame.html,
					close: `</${tag}>\n`
				});
				frame.index = end;
			}
			continue;
		}
		if (['heading', 'bulleted', 'numbered'].includes(token.type)) {
			// These lexer tokens introduce a sibling run, not token.children. Their
			// real HTML wrappers can exit SVG/MathML before the run is parsed.
			const start = frame.index;
			let end = start;
			const limit = frame.end ?? frame.tokens.length;
			while (end < limit && frame.tokens[end].type !== 'br') end++;
			const tag =
				token.type === 'heading'
					? `h${token.depth}`
					: token.type === 'bulleted'
						? 'ul'
						: 'ol';
			frame.html?.feed(`<${tag}>${token.type === 'heading' ? '' : '<li>'}`);
			stack.push({
				tokens: frame.tokens,
				index: start,
				end,
				html: frame.html,
				close: `${token.type === 'heading' ? '' : '</li>'}</${tag}>`
			});
			frame.index = end + 1;
			continue;
		}
		if (token.type === 'unclosedCollapsed') {
			frame.html?.feed('<tw-collapsed>');
			stack.push({
				tokens: frame.tokens,
				index: frame.index,
				end: frame.end,
				html: frame.html,
				close: '</tw-collapsed>'
			});
			frame.index = frame.tokens.length;
			continue;
		}
		if (token.type === 'br' || token.type === 'hr') {
			const breaks = frame.tagBreaks;
			if (token.type === 'hr' || !breaks?.length || breaks[breaks.length - 1])
				frame.html?.feed(`<${token.type}>`);
		} else if (token.children.length) {
			// Ordinary formatting recursively emits into the same HTML fragment.
			const wrappers: Record<string, string> = {
				sub: 'sub',
				sup: 'sup',
				strong: 'strong',
				em: 'em',
				strike: 's',
				bold: 'b',
				italic: 'i',
				collapsed: 'tw-collapsed'
			};
			const wrapper = wrappers[token.type];
			if (wrapper) frame.html?.feed(`<${wrapper}>`);
			stack.push({
				tokens: token.children,
				index: 0,
				html: frame.html,
				close: wrapper ? `</${wrapper}>` : undefined
			});
		} else frame.html?.feed(token.text);
	}
}
