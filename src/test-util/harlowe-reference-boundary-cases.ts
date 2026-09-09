/** Controlled fixtures compared against the actual bundled Harlowe renderer. */
export const harloweReferenceBoundaryCases = [
	...[
		[
			'alignment body has independent newline state',
			'<svg>\n==>\n\n<title>[[Next]]</title></svg> [[Next]]',
			1
		],
		[
			'column body has independent newline state',
			'<svg>\n|==\n\n<title>[[Next]]</title></svg> [[Next]]',
			1
		],
		[
			'alignment closure restores HTML',
			'==>\n<svg>\n<==\n<title>[[Next]]</title></svg> [[Next]]',
			1
		],

		[
			'MathML encoding whitespace is not trimmed',
			'<math><annotation-xml encoding=" text/html "><title>[[Next]]</title></annotation-xml></math> [[Next]]',
			2
		],
		[
			'MathML duplicate HTML encoding first wins',
			'<math><annotation-xml encoding="text/html" encoding="text/plain"><title>[[Next]]</title></annotation-xml></math> [[Next]]',
			1
		],
		[
			'font attribute prefix does not exit foreign content',
			'<svg><font color-widget="red"><title>[[Next]]</title></font></svg> [[Next]]',
			2
		],

		[
			'heading wrapper exits foreign content',
			'<svg>\\\n# <title>[[Next]]</title></svg> [[Next]]',
			1
		],
		[
			'list wrapper exits foreign content',
			'<svg>\\\n* <title>[[Next]]</title></svg> [[Next]]',
			1
		],

		[
			'implied paragraph end restores SVG',
			'<svg><foreignObject><div><p></div></foreignObject><title>[[Next]]</title></svg> [[Next]]',
			2
		],
		[
			'implied list item end restores SVG',
			'<svg><foreignObject><ul><li>text</ul></foreignObject><title>[[Next]]</title></svg> [[Next]]',
			2
		],
		[
			'implied paragraph start restores SVG',
			'<svg><foreignObject><p><div></div></foreignObject><title>[[Next]]</title></svg> [[Next]]',
			2
		],
		[
			'implied paragraph end restores MathML',
			'<math><mtext><div><p></div></mtext><title>[[Next]]</title></math> [[Next]]',
			2
		],

		[
			'foreign CDATA remains inert',
			'<svg><script><![CDATA[</script>[[Next]]]]></svg> [[Next]]',
			1
		],
		[
			'foreign style CDATA remains inert',
			'<svg><style><![CDATA[</style>[[Next]]]]></svg> [[Next]]',
			1
		],
		[
			'formatting exits foreign content',
			"<svg>''bold''<title>[[Next]]</title></svg> [[Next]]",
			1
		],
		[
			'source newline inside SVG is suppressed',
			'<svg>\n<title>[[Next]]</title></svg> [[Next]]',
			2
		],
		[
			'verbatim line break exits foreign content',
			'<svg>`one\ntwo`<title>[[Next]]</title></svg> [[Next]]',
			1
		],

		['SVG title integration', '<svg><title>[[Next]]</title></svg> [[Next]]', 2],
		['ordinary HTML title', '<title>[[Next]]</title> [[Next]]', 1],
		[
			'SVG desc integration',
			'<svg><desc>[[Next]]<title>[[Next]]</title></desc></svg> [[Next]]',
			2
		],
		[
			'foreignObject HTML title',
			'<svg><foreignObject><title>[[Next]]</title> [[Next]]</foreignObject><title>[[Next]]</title></svg> [[Next]]',
			3
		],
		[
			'nested SVG inside HTML integration',
			'<svg><foreignObject><svg><title>[[Next]]</title></svg><title>[[Next]]</title></foreignObject></svg> [[Next]]',
			2
		],
		[
			'HTML after SVG close',
			'<svg><g><title>[[Next]]</title></g></svg><title>[[Next]]</title> [[Next]]',
			2
		],
		['self-closing SVG root', '<svg/><title>[[Next]]</title> [[Next]]', 1],
		[
			'self-closing SVG integration point',
			'<svg><foreignObject/><title>[[Next]]</title></svg> [[Next]]',
			2
		],
		[
			'HTML start tag exits foreign content',
			'<svg><g><div><title>[[Next]]</title></div></g><title>[[Next]]</title></svg> [[Next]]',
			1
		],
		[
			'font attribute exits foreign content',
			'<svg><font color="red"><title>[[Next]]</title></font></svg> [[Next]]',
			1
		],
		[
			'font without breakout attribute stays foreign',
			'<svg><font><title>[[Next]]</title></font></svg> [[Next]]',
			2
		],
		[
			'MathML foreign title',
			'<math><title>[[Next]]</title></math> [[Next]]',
			2
		],
		[
			'MathML text integration',
			'<math><mtext><title>[[Next]]</title> [[Next]]</mtext><title>[[Next]]</title></math> [[Next]]',
			3
		],
		[
			'MathML text integration exception',
			'<math><mi><mglyph><title>[[Next]]</title></mglyph><title>[[Next]]</title></mi></math> [[Next]]',
			2
		],
		[
			'MathML HTML annotation',
			'<math><annotation-xml encoding="text/html"><title>[[Next]]</title> [[Next]]</annotation-xml><title>[[Next]]</title></math> [[Next]]',
			3
		],
		[
			'MathML XHTML annotation',
			'<math><annotation-xml encoding="APPLICATION/XHTML+XML"><title>[[Next]]</title></annotation-xml></math> [[Next]]',
			1
		],
		[
			'MathML foreign annotation',
			'<math><annotation-xml encoding="text/plain"><title>[[Next]]</title></annotation-xml></math> [[Next]]',
			2
		],
		[
			'MathML annotation encoded attribute',
			'<math><annotation-xml encoding="text&#47;html"><title>[[Next]]</title></annotation-xml></math> [[Next]]',
			1
		],
		[
			'MathML annotation duplicate encoding first wins',
			'<math><annotation-xml encoding="text/plain" encoding="text/html"><title>[[Next]]</title></annotation-xml></math> [[Next]]',
			2
		],
		[
			'SVG in foreign MathML annotation',
			'<math><annotation-xml><svg><title>[[Next]]</title></svg></annotation-xml></math> [[Next]]',
			2
		],
		[
			'deferred hook starts separate HTML fragment',
			'<svg><title>[<title>[[Next]]</title> [[Next]]]</title></svg> [[Next]]',
			2
		]
	].map(([name, source, count]) => ({
		name: name as string,
		source: source as string,
		count: count as number
	})),
	{
		name: 'self-closing script',
		source: '<script/>[[Next]]',
		count: 1
	},
	{
		name: 'self-closing spaced script',
		source: '<script />[[Next]]',
		count: 1
	},
	{
		name: 'self-closing style',
		source: '<style/>[[Next]]',
		count: 1
	},
	{
		name: 'self-closing textarea',
		source: '<textarea/>[[Next]]',
		count: 1
	},
	{
		name: 'abrupt empty comment',
		source: '<!-->[[Next]]',
		count: 1
	},
	{
		name: 'abrupt dash comment',
		source: '<!--->[[Next]]',
		count: 1
	},
	{
		name: 'bang comment close',
		source: '<!-- text --!>[[Next]]',
		count: 1
	},
	{
		name: 'unclosed comment',
		source: '<!-- [[Next]]',
		count: 0
	},
	{
		name: 'macro-hidden script close',
		source: '<script>(print:"</script >") [[Next]]',
		count: 0
	},
	{
		name: 'macro-hidden style close',
		source: '<style>(print:"</style >") [[Next]]',
		count: 0
	},
	{
		name: 'macro-hidden textarea close',
		source: '<textarea>(print:"</textarea >") [[Next]]',
		count: 0
	},
	{
		name: 'hook-hidden script close',
		source: '<script>[</script >] [[Next]]',
		count: 0
	},
	{
		name: 'conditional hook-hidden script close',
		source: '<script>(if:true)[</script > [[Next]]] [[Next]]',
		count: 0
	},
	{
		name: 'hook-local raw fragment',
		source: '[<script>[[Next]]] [[Next]]',
		count: 1
	},
	{
		name: 'hook-local comment fragment',
		source: '[<!-- [[Next]]] [[Next]]',
		count: 1
	},
	{
		name: 'hidden close then emitted close',
		source: '<script>(print:"</script >") </script > [[Next]]',
		count: 1
	},
	{
		name: 'literal tag attribute close',
		source: '<script><b title="</script >"> [[Next]]',
		count: 1
	},
	{
		name: 'macro cannot abruptly close comment',
		source: '<!--(print:"x")>[[Next]]',
		count: 0
	},
	{
		name: 'comment close hidden in hook',
		source: '<!--[--!>] [[Next]]',
		count: 0
	},
	{
		name: 'comment close after hidden hook',
		source: '<!--[--!>] --!> [[Next]]',
		count: 1
	},
	{
		name: 'unclosed hook raw fragment',
		source: '[<script/>[[Next]]',
		count: 1
	},
	{
		name: 'script double escape',
		source: '<script><!--<script></script > [[Next]]',
		count: 0
	},
	{name: 'less-than recovery link', source: '<[[Next]]', count: 1},
	{name: 'repeated less-than recovery link', source: '<<[[Next]]', count: 1},
	{name: 'less-than recovery macro', source: '<(link-goto:"Next")', count: 1},
	...['title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'].map(
		name => ({
			name: `inert ${name} body`,
			source: `<${name}>[[Next]]</${name} > [[Next]]`,
			count: 1
		})
	),
	{
		name: 'plaintext consumes the fragment',
		source: '<plaintext>[[Next]]</plaintext>[[Next]]',
		count: 0
	},
	{
		name: 'plaintext self-close still consumes the fragment',
		source: '<plaintext/>[[Next]]',
		count: 0
	},
	{
		name: 'incomplete expression tag prefix is not a generated element',
		source: '<tw-expression[[Next]]',
		count: 0
	},
	{
		name: 'similar incomplete tag is not a generated element',
		source: '<tw-expressive[[Next]]',
		count: 0
	},
	{
		name: 'exact incomplete expression tag recovery',
		source: '<tw-expression [[Next]]',
		count: 1
	},
	{
		name: 'exact incomplete hook tag recovery',
		source: '<tw-hook [ [[Next]] ]',
		count: 1
	},
	{
		name: 'expression tag cannot consume deferred hook source',
		source: '<tw-expression [ [[Next]] ]',
		count: 0
	}
] as const;
