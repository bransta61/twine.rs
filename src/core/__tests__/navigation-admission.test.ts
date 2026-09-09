import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {webcrypto} from 'node:crypto';
import {extractStoryFormatProperties} from '../../electron/main-process/story-format-source';
import type {StoryFormat} from '../../store/story-formats/story-formats.types';
import {
	NavigationAdmissionService,
	awaitNavigationPreparation
} from '../navigation-admission';

const properties = extractStoryFormatProperties(
	readFileSync(
		resolve(__dirname, '../../../public/story-formats/harlowe-3.3.9/format.js'),
		'utf8'
	)
);
const format: StoryFormat = {
	id: 'canonical',
	name: 'Harlowe',
	version: '3.3.9',
	url: 'story-formats/harlowe-3.3.9/format.js',
	userAdded: false,
	loadState: 'loaded',
	properties
};
describe('navigation source admission', () => {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
	beforeAll(() =>
		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: webcrypto
		})
	);
	afterAll(
		() => original && Object.defineProperty(globalThis, 'crypto', original)
	);
	it('admits the audited bundled source without a preview or editor', async () => {
		const service = new NavigationAdmissionService([format]);
		const snapshot = await service.prepare('Harlowe', '3.3.9');
		expect(snapshot.provider.providerIdentifier).toBe(
			'harlowe-3.3.9-static-passages'
		);
		expect(Object.isFrozen(snapshot)).toBe(true);
	});
	it.each(
		[
			[{...format, userAdded: true}],
			[{...format, url: 'custom.js'}],
			[format, {...format, id: 'duplicate'}],
			[
				{
					...format,
					properties: {...properties, source: properties.source + ' changed'}
				}
			],
			[{...format, properties: {...properties, version: '3.3.8'}}]
		].map(formats => ({formats}))
	)('rejects mismatched loaded source identity', async ({formats}) => {
		const service = new NavigationAdmissionService(formats as StoryFormat[]);
		expect(
			(await service.prepare('Harlowe', '3.3.9')).provider.providerIdentifier
		).toBe('twine-core.standard-links');
	});
	it('revokes synchronously and cannot reuse a snapshot after A-B-A', async () => {
		const service = new NavigationAdmissionService([format]);
		const first = await service.prepare('Harlowe', '3.3.9');
		let currentDuringNotification = true;
		service.subscribe(() => {
			currentDuringNotification = service.isCurrent(first);
		});
		service.acceptState([]);
		expect(currentDuringNotification).toBe(false);
		service.acceptState([format]);
		const last = await service.prepare('Harlowe', '3.3.9');
		expect(last.providerEpoch).toBeGreaterThan(first.providerEpoch);
		expect(service.isCurrent(first)).toBe(false);
		service.acceptState([{...format}]);
		expect(service.isCurrent(last)).toBe(true);
	});
	it('ignores obsolete digest completion', async () => {
		const service = new NavigationAdmissionService([format]);
		const pending = service.prepare('Harlowe', '3.3.9');
		service.acceptState([]);
		await expect(pending).rejects.toThrow('provider changed');
		expect(service.snapshot(true).provider.providerIdentifier).toBe(
			'twine-core.standard-links'
		);
	});
});

describe('navigation preparation cancellation', () => {
	it('detaches only the aborted waiter and observes late failure', async () => {
		let reject!: (error: Error) => void;
		const shared = new Promise<string>((_, failure) => {
			reject = failure;
		});
		const controller = new AbortController();
		const first = awaitNavigationPreparation(() => shared, controller.signal);
		const second = awaitNavigationPreparation(() => shared);
		await Promise.resolve();
		controller.abort();
		await expect(first).rejects.toThrow('semantic-cancelled');
		reject(new Error('late load failure'));
		await expect(second).rejects.toThrow('late load failure');
	});
	it('never starts a pre-aborted operation', async () => {
		const controller = new AbortController();
		controller.abort();
		const prepare = jest.fn(() => Promise.resolve('ready'));
		await expect(
			awaitNavigationPreparation(prepare, controller.signal)
		).rejects.toThrow('semantic-cancelled');
		expect(prepare).not.toHaveBeenCalled();
	});
});

it('preparation authority allows loading but revokes removal, replacement, and loaded source changes', () => {
	const initial = {...format, loadState: 'unloaded' as const};
	const service = new NavigationAdmissionService([initial]);
	const current = service.capturePreparationAuthority();
	service.acceptState([{...initial, loadState: 'loading'}]);
	expect(current()).toBe(true);
	service.acceptState([format]);
	expect(current()).toBe(true);
	const loaded = service.capturePreparationAuthority();
	service.acceptState([
		{...format, properties: {...properties, source: 'other'}}
	]);
	expect(loaded()).toBe(false);
	expect(current()).toBe(false);
	service.acceptState([format]);
	expect(current()).toBe(false);
	const staysLoaded = service.capturePreparationAuthority();
	service.acceptState([{...format, loadState: 'loading'}]);
	expect(staysLoaded()).toBe(false);
	service.acceptState([format]);
	expect(staysLoaded()).toBe(false);
	service.acceptState([]);
	expect(current()).toBe(false);
	service.acceptState([{...format, id: 'new'}]);
	expect(current()).toBe(false);
});
