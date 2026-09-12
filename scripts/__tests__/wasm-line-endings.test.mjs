import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../..'
);

function git(cwd, args) {
	const result = spawnSync('git', args, {cwd, encoding: 'utf8'});
	assert.equal(result.status, 0, result.stderr);
	return result.stdout;
}

test('WASM text remains clean when regenerated on an autocrlf checkout', t => {
	const root = mkdtempSync(join(tmpdir(), 'twine-wasm-eol-'));
	t.after(() => rmSync(root, {recursive: true, force: true}));

	const files = {
		'crates/twine_wasm/src/lib.rs':
			'#[wasm_bindgen(inline_js = r#"\nexport function helper() {}\n"#)]\n',
		'src/core/wasm/pkg/twine_wasm.js': 'export function helper() {}\n',
		'src/core/wasm/pkg/twine_wasm.d.ts': 'export function helper(): void;\n',
		'src/core/wasm/pkg/twine_wasm_bg.wasm.d.ts':
			'export const memory: WebAssembly.Memory;\n',
		'src/core/wasm/pkg/snippets/version-dependent/inline0.js':
			'export function helper() {}\n'
	};

	writeFileSync(
		join(root, '.gitattributes'),
		readFileSync(join(repositoryRoot, '.gitattributes'))
	);
	for (const [relativePath, contents] of Object.entries(files)) {
		const filePath = join(root, relativePath);
		mkdirSync(dirname(filePath), {recursive: true});
		writeFileSync(filePath, contents);
	}
	const wasmPath = join(root, 'src/core/wasm/pkg/twine_wasm_bg.wasm');
	writeFileSync(wasmPath, Uint8Array.of(0, 97, 115, 109, 13, 10));

	git(root, ['init', '--quiet']);
	git(root, ['config', 'core.autocrlf', 'true']);
	git(root, ['config', 'user.name', 'Twine RS Tests']);
	git(root, ['config', 'user.email', 'tests@example.invalid']);
	git(root, ['add', '.']);
	git(root, ['commit', '--quiet', '-m', 'test fixture']);
	for (const relativePath of [
		...Object.keys(files),
		'src/core/wasm/pkg/twine_wasm_bg.wasm'
	]) {
		rmSync(join(root, relativePath));
	}
	git(root, ['checkout-index', '--force', '--all']);

	const attributes = git(root, [
		'check-attr',
		'text',
		'eol',
		'--',
		...Object.keys(files),
		'src/core/wasm/pkg/twine_wasm_bg.wasm'
	]);
	for (const relativePath of Object.keys(files)) {
		assert.ok(
			attributes.includes(`${relativePath}: text: set\n`),
			relativePath
		);
		assert.ok(attributes.includes(`${relativePath}: eol: lf\n`), relativePath);
		assert.ok(!readFileSync(join(root, relativePath)).includes('\r\n'));
	}
	assert.ok(
		attributes.includes('src/core/wasm/pkg/twine_wasm_bg.wasm: text: unset\n')
	);

	const snippet = 'src/core/wasm/pkg/snippets/version-dependent/inline0.js';
	writeFileSync(join(root, snippet), files[snippet]);
	assert.equal(git(root, ['status', '--porcelain=v1', '--', snippet]), '');
});
