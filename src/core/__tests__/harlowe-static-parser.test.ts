import {harloweReferenceBoundaryCases} from '../../test-util/harlowe-reference-boundary-cases';
import {harloweStaticOccurrences} from '../wasm/harlowe-static-parser';

function occurrences(source: string, target = 'Target') {
	const result = [...harloweStaticOccurrences(source, new Set([target]))];
	for (const occurrence of result)
		expect(source.slice(occurrence.start, occurrence.end)).toBe(
			occurrence.target
		);
	return result;
}

describe('exact Harlowe static passage syntax', () => {
	it.each([
		'[[Target]]',
		'[[label->Target]]',
		'[[Target<-label]]',
		'[[label|Target]]',
		'[[one->two->Target]]',
		'(display:"Target")',
		'(go-to:"Target")',
		"(goto:'Target')",
		'(REDI_RECT: "Target")',
		'(link-goto:"Target")',
		'(LiNk_GoTo:"label", "Target")'
	])('selects the exact target in %s', source => {
		expect(occurrences(source)).toEqual([
			{
				start: source.indexOf('Target'),
				end: source.indexOf('Target') + 6,
				target: 'Target'
			}
		]);
	});
	it.each([
		'<!-- [[Target]]',
		'<!-- (display:"Target")',
		'<script>(display:"Target")',
		'<textarea>[[Target]]',
		'<style>[[Target]]',
		'<!-- [[Target]] (display:"Target") -->',
		'`[[Target]] (display:"Target")`',
		'(print:"[[Target]] (display:\'Target\')")',
		'(display:$target)',
		'(display:"Tar" + "get")',
		'(display:(str:"Target"))',
		'(display:"Target",)',
		'(display:"Target", "Target")',
		'(display:)',
		'(display:"Target"',
		'(link-goto:$label,"Target")',
		'(link-goto:"label","Target", "extra")',
		'(display:"Tar\\get")',
		'[[Tar\\get]]',
		'[[Target][setter]]'
	])('omits unsupported or inert syntax %s', source => {
		expect(occurrences(source)).toEqual([]);
	});
	it('preserves whitespace, case, repeated references, self references, and astral offsets', () => {
		const source = '😀 [[Target]] (display:"Target") [[target]] [[ Target ]]';
		expect(occurrences(source)).toHaveLength(2);
		expect(occurrences(source)[0].start).toBe(5);
		expect(occurrences(source, ' Target ')).toHaveLength(1);
		expect(occurrences('[[😀]] (display:"😀")', '😀')).toHaveLength(2);
	});
	it.each([64 * 1024, 1024 * 1024])(
		'supports a %i byte source without a small-source cutoff',
		bytes => {
			const source = 'x'.repeat(bytes - 20) + '(display:"Target")';
			expect(occurrences(source)).toHaveLength(1);
		}
	);
	it('retains valid references outside completed comments and raw text', () => {
		expect(
			occurrences(
				'[[Target]] <!-- [[Target]] --> [[Target]] <script>[[Target]]</script> [[Target]]'
			)
		).toHaveLength(3);
		expect(occurrences('[[Target]] <!-- [[Target]]')).toHaveLength(1);
	});
	it.each(['script', 'style', 'textarea'])(
		'uses exact %s HTML boundaries',
		name => {
			for (const suffix of ['-widget', '_widget', ':widget', 'widget']) {
				expect(
					occurrences(
						`<${name}${suffix}>[[Target]]</${name}${suffix}> (display:"Target")`
					)
				).toHaveLength(2);
			}
			for (const close of [
				`</${name}>`,
				`</${name} >`,
				`</${name}\t\n\r\f>`,
				`</${name.toUpperCase()} >`,
				`</${name}/>`,
				`</${name} ignored=">">`
			]) {
				const source = `[[Target]] <${name}>[[Target]] (display:"Target") ${close} [[Target]] (display:"Target")`;
				expect(occurrences(source)).toHaveLength(3);
			}
			expect(
				occurrences(
					`[[Target]] <${name.toUpperCase()} data-value=">">[[Target]] </${name}-widget> [[Target]]`
				)
			).toHaveLength(1);
			expect(occurrences(`[[Target]] <${name}/>[[Target]]`)).toHaveLength(2);
			// The shipped lexer deliberately remains authoritative: this malformed
			// prefix/closer pair is one raw leaf, also rendered literally at runtime.
			expect(
				occurrences(`<${name}-widget>[[Target]]</${name}> [[Target]]`)
			).toHaveLength(1);
		}
	);
	it('ignores raw-content syntax that straddles the closing tag', () => {
		const source =
			'<script>(if:true)[ [[Target]] </script > [[Target]] ] [[Target]]';
		expect(occurrences(source)).toHaveLength(0);
	});
	it.each(harloweReferenceBoundaryCases)(
		'matches emitted runtime boundary: $name',
		({source, count}) => {
			expect(occurrences(source, 'Next')).toHaveLength(count);
		}
	);
	it('retains namespace context through deeply nested foreign elements', () => {
		const source =
			'<svg>' +
			'<g>'.repeat(1024) +
			'<foreignObject><title>[[Target]]</title></foreignObject><title>[[Target]]</title>' +
			'</g>'.repeat(1024) +
			'</svg><title>[[Target]]</title> [[Target]]';
		expect(occurrences(source)).toHaveLength(2);
	});
	it('streams dense results in source order', () => {
		const source = '[[Target]] (display:"Target") '.repeat(1000);
		const results = occurrences(source);
		expect(results).toHaveLength(2000);
		expect(
			results.every(
				(result, i) => i === 0 || results[i - 1].end <= result.start
			)
		).toBe(true);
	});
});
