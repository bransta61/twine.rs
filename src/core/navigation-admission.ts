import type {CoreSemanticProvenance} from './bindings/CoreSemanticProvenance';
import type {
	StoryFormat,
	StoryFormatsDispatch
} from '../store/story-formats/story-formats.types';
import {loadFormatProperties} from '../store/story-formats/action-creators';
import {
	snapshotPreviewStoryFormat,
	sourceFormatAdmission
} from '../routes/story-preview-format';
import {HARLOWE_3_3_9_COMPATIBILITY} from '../routes/story-preview-harlowe';

export const HARLOWE_PASSAGE_PROVIDER: Readonly<CoreSemanticProvenance> =
	Object.freeze({
		capabilityRevision: 1,
		formatName: 'Harlowe',
		formatVersion: '3.3.9',
		providerIdentifier: 'harlowe-3.3.9-static-passages'
	});
export const STANDARD_PASSAGE_PROVIDER: Readonly<CoreSemanticProvenance> =
	Object.freeze({
		capabilityRevision: 1,
		formatName: null,
		formatVersion: null,
		providerIdentifier: 'twine-core.standard-links'
	});
export interface NavigationAdmission {
	readonly provider: Readonly<CoreSemanticProvenance>;
	readonly providerEpoch: number;
}

/** Cancel one waiter without cancelling a shared loader or digest. */
export function awaitNavigationPreparation<T>(
	prepare: () => Promise<T>,
	signal?: AbortSignal
): Promise<T> {
	if (signal?.aborted)
		return Promise.reject(
			new Error('semantic-cancelled: references cancelled')
		);
	return new Promise<T>((resolve, reject) => {
		const abort = () => {
			signal?.removeEventListener('abort', abort);
			reject(new Error('semantic-cancelled: references cancelled'));
		};
		signal?.addEventListener('abort', abort, {once: true});
		Promise.resolve()
			.then(() => {
				if (signal?.aborted)
					throw new Error('semantic-cancelled: references cancelled');
				return prepare();
			})
			.then(resolve, reject)
			.finally(() => signal?.removeEventListener('abort', abort));
	});
}

/** Dispatch-time authority. No editor, preview build, or React delivery is required. */
export class NavigationAdmissionService {
	private formats: StoryFormat[] = [];
	private epoch = 0;
	private admitted = false;
	private dispatch?: StoryFormatsDispatch;
	setLoader(dispatch: StoryFormatsDispatch) {
		this.dispatch = dispatch;
	}
	private digest?: Promise<void>;
	private listeners = new Set<() => void>();
	private relevant: ReadonlyArray<Readonly<Record<string, unknown>>> = [];
	constructor(formats: StoryFormat[]) {
		this.acceptState(formats);
	}
	private changed() {
		this.epoch++;
		for (const listener of [...this.listeners]) listener();
	}
	readonly subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	readonly acceptState = (formats: StoryFormat[]) => {
		this.formats = formats;
		const relevant = formats
			.filter(f => f.name === 'Harlowe' && f.version === '3.3.9')
			.map(f =>
				Object.freeze({
					id: f.id,
					name: f.name,
					version: f.version,
					url: f.url,
					userAdded: f.userAdded,
					loadState: f.loadState,
					propertyName:
						f.loadState === 'loaded' ? f.properties.name : undefined,
					propertyVersion:
						f.loadState === 'loaded' ? f.properties.version : undefined,
					source: f.loadState === 'loaded' ? f.properties.source : undefined
				})
			);
		if (
			relevant.length === this.relevant.length &&
			relevant.every((f, i) =>
				Object.keys(f).every(
					k => f[k as keyof typeof f] === this.relevant[i][k]
				)
			)
		)
			return;
		this.relevant = relevant;
		this.admitted = false;
		this.digest = undefined;
		this.changed(); // Revoke before any digest or React delivery.
	};
	private exact() {
		const matches = this.formats.filter(
			f => f.name === 'Harlowe' && f.version === '3.3.9'
		);
		return matches.length === 1 &&
			!matches[0].userAdded &&
			matches[0].url === HARLOWE_3_3_9_COMPATIBILITY.url
			? matches[0]
			: undefined;
	}
	capturePreparationAuthority() {
		const initial = this.exact();
		let loaded = initial?.loadState === 'loaded';
		let source =
			initial?.loadState === 'loaded' ? initial.properties.source : undefined;
		let valid = true;
		return () => {
			if (!valid) return false;
			const current = this.exact();
			if (!initial) return (valid = !current);
			if (!current || current.id !== initial.id) return (valid = false);
			if (current.loadState !== 'loaded') return (valid = !loaded);
			if (
				current.properties.name !== 'Harlowe' ||
				current.properties.version !== '3.3.9' ||
				(loaded && current.properties.source !== source)
			)
				return (valid = false);
			loaded = true;
			source = current.properties.source;
			return true;
		};
	}
	isCurrent(snapshot: NavigationAdmission) {
		return snapshot.providerEpoch === this.epoch;
	}
	snapshot(harlowe: boolean): NavigationAdmission {
		return Object.freeze({
			provider:
				harlowe && this.admitted
					? HARLOWE_PASSAGE_PROVIDER
					: STANDARD_PASSAGE_PROVIDER,
			providerEpoch: this.epoch
		});
	}
	async prepare(
		name: string,
		version: string,
		dispatch = this.dispatch
	): Promise<NavigationAdmission> {
		const harlowe = name === 'Harlowe' && version === '3.3.9';
		if (!harlowe) return this.snapshot(false);
		let format = this.exact();
		if (format && format.loadState !== 'loaded') {
			if (!dispatch) throw new Error('Story format loader is unavailable.');
			await dispatch(loadFormatProperties(format));
			format = this.exact();
			if (format && format.loadState !== 'loaded')
				throw new Error(
					'The bundled Harlowe format could not be loaded. Retry Find References.'
				);
		}
		if (format?.loadState === 'loaded' && !this.admitted) {
			if (!this.digest) {
				const epoch = this.epoch;
				const snapshot = snapshotPreviewStoryFormat(
					this.formats,
					format,
					format.properties
				);
				this.digest = sourceFormatAdmission(snapshot).then(admission => {
					if (this.epoch !== epoch) return;
					this.admitted = admission.kind === 'builtin-sha256';
				});
			}
			const epoch = this.epoch;
			await this.digest;
			if (this.epoch !== epoch)
				throw new Error(
					'The navigation provider changed. Retry Find References.'
				);
		}
		return this.snapshot(true);
	}
}
