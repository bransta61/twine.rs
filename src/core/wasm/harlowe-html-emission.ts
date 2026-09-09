import {decodeHTMLAttribute} from 'entities';

/** Streaming state for Harlowe's emitted HTML, never its deferred source/code.
 * Retains open-element context and bounded script lookbehind; no DOM or
 * emitted HTML tree/copy. HTML ancestors can close over a nested foreign root.
 */
const space = (c: string) => /[\t\n\f\r ]/.test(c);
const delimiter = (c: string) => c === '>' || c === '/' || space(c);
const rawNames = new Set([
	'script',
	'style',
	'textarea',
	'title',
	'xmp',
	'iframe',
	'noembed',
	'noframes',
	'noscript',
	'plaintext'
]);

type Namespace = 'html' | 'svg' | 'math';
interface OpenElement {
	name: string;
	namespace: Namespace;
	htmlIntegration: boolean;
	mathIntegration: boolean;
}
const foreignBreakouts = new Set(
	'b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var'.split(
		' '
	)
);
const voidNames = new Set(
	'area base basefont bgsound br col embed frame hr image img input keygen link meta param source track wbr'.split(
		' '
	)
);
const htmlSpecial = new Set(
	'address applet area article aside base basefont bgsound blockquote body br button caption center col colgroup dd details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe img input li link listing main marquee menu meta nav noembed noframes noscript object ol p param plaintext pre script section select source style summary table tbody td template textarea tfoot th thead title tr track ul wbr xmp'.split(
		' '
	)
);

const scopedHtmlEnds = new Set(
	'address applet article aside blockquote button center dd details dialog dir div dl dt fieldset figcaption figure footer header hgroup li listing main marquee menu nav object ol p pre search section summary ul h1 h2 h3 h4 h5 h6'.split(
		' '
	)
);
const paragraphClosers = new Set(
	'address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr listing main menu nav ol p pre search section summary table ul xmp'.split(
		' '
	)
);
const scopeBarriers = new Set(
	'applet caption html table td th marquee object template'.split(' ')
);
const heading = (name: string) => /^h[1-6]$/.test(name);

/** Namespace rules apply to emitted start tags, including generated wrappers.
 * Integration points affect their children, never the namespace of the point.
 */
class ForeignContext {
	private stack: OpenElement[] = [];
	private get current() {
		return this.stack[this.stack.length - 1];
	}
	private childrenUseHtml(name: string) {
		const current = this.current;
		return (
			!current ||
			current.namespace === 'html' ||
			current.htmlIntegration ||
			(current.mathIntegration && name !== 'mglyph' && name !== 'malignmark') ||
			(current.namespace === 'math' &&
				current.name === 'annotation-xml' &&
				name === 'svg')
		);
	}
	get allowsCdata() {
		return (
			!!this.current &&
			this.current.namespace !== 'html' &&
			!this.current.htmlIntegration &&
			!this.current.mathIntegration
		);
	}
	private exitForeign() {
		while (
			this.current &&
			this.current.namespace !== 'html' &&
			!this.current.htmlIntegration &&
			!this.current.mathIntegration
		)
			this.stack.pop();
	}
	private closeInScope(name: string) {
		for (let index = this.stack.length - 1; index >= 0; index--) {
			const node = this.stack[index];
			if (
				node.namespace === 'html' &&
				(node.name === name || (heading(name) && heading(node.name)))
			) {
				this.stack.length = index;
				return;
			}
			if (
				node.namespace === 'html'
					? scopeBarriers.has(node.name) ||
						(name === 'p' && node.name === 'button') ||
						(name === 'li' && ['ol', 'ul'].includes(node.name))
					: node.htmlIntegration ||
						node.mathIntegration ||
						node.name === 'annotation-xml'
			)
				return;
		}
	}
	private impliedStart(name: string) {
		if (paragraphClosers.has(name)) this.closeInScope('p');
		if (name === 'li' || name === 'dd' || name === 'dt') {
			for (let index = this.stack.length - 1; index >= 0; index--) {
				const node = this.stack[index];
				if (
					node.namespace === 'html' &&
					(node.name === name ||
						(name !== 'li' && ['dd', 'dt'].includes(node.name)))
				) {
					this.stack.length = index;
					break;
				}
				if (
					node.namespace !== 'html' ||
					(htmlSpecial.has(node.name) &&
						!['address', 'div', 'p'].includes(node.name))
				)
					break;
			}
			this.closeInScope('p');
		}
		if (
			heading(name) &&
			this.current?.namespace === 'html' &&
			heading(this.current.name)
		)
			this.stack.pop();
		if (name === 'button') this.closeInScope('button');
	}

	open(
		name: string,
		encoding: string | undefined,
		fontBreakout: boolean,
		selfClosing: boolean
	) {
		let html = this.childrenUseHtml(name);
		if (
			!html &&
			(foreignBreakouts.has(name) || (name === 'font' && fontBreakout))
		) {
			this.exitForeign();
			html = true;
		}
		const namespace: Namespace = html
			? name === 'svg'
				? 'svg'
				: name === 'math'
					? 'math'
					: 'html'
			: this.current.namespace;
		if (namespace === 'html') this.impliedStart(name);
		if (namespace === 'html' ? !voidNames.has(name) : !selfClosing) {
			this.stack.push({
				name,
				namespace,
				htmlIntegration:
					(namespace === 'svg' &&
						['title', 'desc', 'foreignobject'].includes(name)) ||
					(namespace === 'math' &&
						name === 'annotation-xml' &&
						['text/html', 'application/xhtml+xml'].includes(encoding ?? '')),
				mathIntegration:
					namespace === 'math' &&
					['mi', 'mn', 'mo', 'ms', 'mtext'].includes(name)
			});
		}
		return namespace;
	}
	close(name: string) {
		if (name === 'p' || name === 'br') this.exitForeign();
		let foreign =
			this.current?.namespace !== 'html' && name !== 'p' && name !== 'br';
		for (let index = this.stack.length - 1; index >= 0; index--) {
			const element = this.stack[index];
			if (element.namespace === 'html') foreign = false;
			if (!foreign && scopedHtmlEnds.has(name)) {
				this.closeInScope(name);
				return;
			}
			if (element.name === name) {
				this.stack.length = index;
				return;
			}
			if (element.namespace === 'html') foreign = false;
			// HTML generic end tags cannot escape an integration/special element.
			if (
				!foreign &&
				(element.namespace === 'html'
					? htmlSpecial.has(element.name)
					: element.htmlIntegration ||
						element.mathIntegration ||
						element.name === 'annotation-xml')
			)
				return;
		}
	}
}

type State =
	| 'data'
	| 'less'
	| 'endOpen'
	| 'bang'
	| 'bangDash'
	| 'cdataStart'
	| 'cdata'
	| 'bogus'
	| 'commentStart'
	| 'commentStartDash'
	| 'comment'
	| 'commentDash'
	| 'commentEnd'
	| 'commentBang'
	| 'tagName'
	| 'beforeAttribute'
	| 'attribute'
	| 'afterAttribute'
	| 'beforeValue'
	| 'quotedValue'
	| 'value'
	| 'selfClose'
	| 'raw';

export class HarloweHtmlEmission {
	private state: State = 'data';
	private name = '';
	private context = new ForeignContext();
	private attributeName = '';
	private attributeValue = '';
	private encoding: string | undefined;
	private fontBreakout = false;
	private emittedElement = false;
	private expectedElement = '';
	private closing = false;
	private quote = '';
	private rawName = '';
	private tail = '';
	private cdataPrefix = 0;
	private scriptState: 'data' | 'escaped' | 'double' = 'data';

	element(name: 'tw-expression' | 'tw-hook') {
		this.emittedElement = false;
		this.expectedElement = name;
		this.feed(`<${name}></${name}>`);
		return this.emittedElement;
	}

	private finishAttribute() {
		if (this.attributeName === 'encoding' && this.encoding === undefined)
			this.encoding = decodeHTMLAttribute(this.attributeValue).toLowerCase();
		if (['color', 'face', 'size'].includes(this.attributeName))
			this.fontBreakout = true;
		this.attributeName = '';
		this.attributeValue = '';
	}
	private startAttribute(c: string) {
		this.finishAttribute();
		this.attributeName = c.toLowerCase();
		this.state = 'attribute';
	}
	private finishTag() {
		this.finishAttribute();
		const namespace = this.closing
			? (this.context.close(this.name), undefined)
			: this.context.open(
					this.name,
					this.encoding,
					this.fontBreakout,
					this.state === 'selfClose'
				);
		if (!this.closing && this.name === this.expectedElement)
			this.emittedElement = true;
		this.rawName =
			namespace === 'html' && rawNames.has(this.name) ? this.name : '';
		this.state = this.rawName ? 'raw' : 'data';
		this.tail = '';
		this.scriptState = 'data';
	}

	feed(text: string, start = 0, end = text.length) {
		for (let index = start; index < end; index++) {
			const c = text[index];
			switch (this.state) {
				case 'data': {
					const less = text.indexOf('<', index);
					if (less < 0 || less >= end) return;
					index = less;
					this.state = 'less';
					break;
				}
				case 'less':
					this.name = '';
					this.attributeName = '';
					this.attributeValue = '';
					this.encoding = undefined;
					this.fontBreakout = false;
					this.closing = false;
					if (c === '!') this.state = 'bang';
					else if (c === '/') {
						this.closing = true;
						this.state = 'endOpen';
					} else if (/[a-z]/i.test(c)) {
						this.name = c.toLowerCase();
						this.state = 'tagName';
					} else if (c === '?') this.state = 'bogus';
					else {
						this.state = 'data';
						index--;
					}
					break;
				case 'endOpen':
					if (/[a-z]/i.test(c)) {
						this.name = c.toLowerCase();
						this.state = 'tagName';
					} else this.state = c === '>' ? 'data' : 'bogus';
					break;
				case 'bang':
					if (c === '[' && this.context.allowsCdata) {
						this.state = 'cdataStart';
						this.cdataPrefix = 0;
					} else
						this.state = c === '-' ? 'bangDash' : c === '>' ? 'data' : 'bogus';
					break;
				case 'cdataStart':
					if (c === 'CDATA['[this.cdataPrefix]) {
						if (++this.cdataPrefix === 6) {
							this.state = 'cdata';
							this.tail = '';
						}
					} else {
						this.state = c === '>' ? 'data' : 'bogus';
					}
					break;
				case 'cdata':
					this.tail = (this.tail + c).slice(-3);
					if (this.tail === ']]>') {
						this.state = 'data';
						this.tail = '';
					}
					break;
				case 'bangDash':
					this.state =
						c === '-' ? 'commentStart' : c === '>' ? 'data' : 'bogus';
					break;
				case 'bogus':
					if (c === '>') this.state = 'data';
					break;
				case 'commentStart':
					this.state =
						c === '>' ? 'data' : c === '-' ? 'commentStartDash' : 'comment';
					break;
				case 'commentStartDash':
					this.state =
						c === '>' ? 'data' : c === '-' ? 'commentEnd' : 'comment';
					break;
				case 'comment':
					if (c === '-') this.state = 'commentDash';
					break;
				case 'commentDash':
					this.state = c === '-' ? 'commentEnd' : 'comment';
					break;
				case 'commentEnd':
					this.state =
						c === '>'
							? 'data'
							: c === '!'
								? 'commentBang'
								: c === '-'
									? 'commentEnd'
									: 'comment';
					break;
				case 'commentBang':
					this.state =
						c === '>' ? 'data' : c === '-' ? 'commentDash' : 'comment';
					break;
				case 'tagName':
					if (space(c)) this.state = 'beforeAttribute';
					else if (c === '/') this.state = 'selfClose';
					else if (c === '>') this.finishTag();
					// Exact names also restore namespace through unknown foreign elements.
					else this.name += c.toLowerCase();
					break;
				case 'beforeAttribute':
					if (c === '>') this.finishTag();
					else if (c === '/') this.state = 'selfClose';
					else if (!space(c)) this.startAttribute(c);
					break;
				case 'attribute':
					if (c === '=') this.state = 'beforeValue';
					else if (space(c)) this.state = 'afterAttribute';
					else if (c === '/') this.state = 'selfClose';
					else if (c === '>') this.finishTag();
					else if (this.attributeName.length < 9)
						this.attributeName += c.toLowerCase();
					break;
				case 'afterAttribute':
					if (c === '=') this.state = 'beforeValue';
					else if (c === '>') this.finishTag();
					else if (c === '/') this.state = 'selfClose';
					else if (!space(c)) this.startAttribute(c);
					break;
				case 'beforeValue':
					if (c === '"' || c === "'") {
						this.quote = c;
						this.state = 'quotedValue';
					} else if (c === '>') this.finishTag();
					else if (!space(c)) {
						this.state = 'value';
						if (this.attributeName === 'encoding') this.attributeValue += c;
					}
					break;
				case 'quotedValue':
					if (c === this.quote) {
						this.finishAttribute();
						this.state = 'beforeAttribute';
					} else if (this.attributeName === 'encoding')
						this.attributeValue += c;
					break;
				case 'value':
					if (c === '>') this.finishTag();
					else if (space(c)) {
						this.finishAttribute();
						this.state = 'beforeAttribute';
					} else if (this.attributeName === 'encoding')
						this.attributeValue += c;
					break;
				case 'selfClose':
					if (c === '>') this.finishTag();
					else {
						this.state = 'beforeAttribute';
						index--;
					}
					break;
				case 'raw': {
					if (this.rawName === 'plaintext') return;
					this.tail = (this.tail + c.toLowerCase()).slice(-12);
					if (this.rawName === 'script') {
						if (this.scriptState === 'data' && this.tail.endsWith('<!--'))
							this.scriptState = 'escaped';
						else if (this.scriptState !== 'data' && this.tail.endsWith('-->'))
							this.scriptState = 'data';
						else if (
							delimiter(c) &&
							this.scriptState === 'escaped' &&
							this.tail.endsWith('<script' + c.toLowerCase())
						)
							this.scriptState = 'double';
						else if (
							delimiter(c) &&
							this.scriptState === 'double' &&
							this.tail.endsWith('</script' + c.toLowerCase())
						) {
							this.scriptState = 'escaped';
							break;
						}
					}
					if (
						this.scriptState !== 'double' &&
						delimiter(c) &&
						this.tail.endsWith('</' + this.rawName + c.toLowerCase())
					) {
						this.name = this.rawName;
						this.closing = true;
						this.state = c === '/' ? 'selfClose' : 'beforeAttribute';
						if (c === '>') this.finishTag();
					}
					break;
				}
			}
		}
	}

	/** renderer.E's tag/scriptStyleTag arm adds data-raw and expands />. */
	tag(text: string) {
		if (text.startsWith('</') || !text.endsWith('>')) {
			this.feed(text);
			return;
		}
		const selfClosing = text.endsWith('/>');
		this.feed(text, 0, text.length - (selfClosing ? 2 : 1));
		this.feed(' data-raw>');
		if (selfClosing) {
			this.feed('</');
			this.feed(text.match(/[\w-]+/)?.[0] ?? '');
			this.feed('>');
		}
	}
}
