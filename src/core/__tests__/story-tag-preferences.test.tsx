import * as React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {
	CoreProjectHostProvider,
	useCoreProjectHost,
	renameStoryTagCommand
} from '..';
import {
	PrefsContextProvider,
	usePrefsContext,
	PrefsAction
} from '../../store/prefs';
import {StoriesContext} from '../../store/stories';
import {reducer as storiesReducer} from '../../store/stories/reducer';
import {usePersistence} from '../../store/persistence/use-persistence';
import {
	isPersistenceAffectingAction,
	saveMiddleware
} from '../../store/persistence/electron-ipc/prefs';
import {persistenceQuitCoordinator} from '../../store/persistence/electron-ipc/persistence-quit-coordinator';
import {fakeStory} from '../../test-util';
import {StoreCoreProjectHost} from '../../test-util/core-project-host-runtime';
import useThunkReducer from '../../util/use-thunk-reducer';
import type {TwineElectronWindow} from '../../electron/shared';

jest.mock('../../store/persistence/use-persistence');

function Fixture() {
	const [stories, dispatch] = useThunkReducer(storiesReducer, [
		{...fakeStory(), tags: ['draft']}
	]);
	return (
		<StoriesContext.Provider value={{stories, dispatch}}>
			<PrefsContextProvider>
				<CoreProjectHostProvider>
					<Controls />
				</CoreProjectHostProvider>
			</PrefsContextProvider>
		</StoriesContext.Provider>
	);
}
function Controls() {
	const host = useCoreProjectHost();
	const {prefs, dispatch} = usePrefsContext();
	return (
		<>
			<button
				onClick={() =>
					dispatch({
						type: 'init',
						state: {
							storyTagColors: {draft: 'green', other: 'red'},
							storyListTagFilter: ['draft', 'other']
						}
					})
				}
			>
				Seed
			</button>
			<button
				onClick={() =>
					void host.applyStoryCommand(renameStoryTagCommand('draft', 'ready'))
				}
			>
				Rename
			</button>
			<output>
				{JSON.stringify([prefs.storyTagColors, prefs.storyListTagFilter])}
			</output>
		</>
	);
}

it('persists an admitted pending rename and its preferences before Electron quit preparation completes', async () => {
	let releaseRename!: () => void;
	let releaseSave!: () => void;
	const renameGate = new Promise<void>(resolve => {
		releaseRename = resolve;
	});
	const saveGate = new Promise<void>(resolve => {
		releaseSave = resolve;
	});
	const saveJson = jest.fn(() => saveGate);
	const browser = window as TwineElectronWindow;
	const previousBridge = browser.twineElectron;
	browser.twineElectron = {saveJson} as unknown as NonNullable<
		TwineElectronWindow['twineElectron']
	>;
	jest.mocked(usePersistence).mockReturnValue({
		prefs: {
			load: jest.fn(),
			saveMiddleware,
			canReduceAction: (action: PrefsAction) =>
				!isPersistenceAffectingAction(action) ||
				persistenceQuitCoordinator.allowsPersistenceMutation()
		}
	} as unknown as ReturnType<typeof usePersistence>);
	const original = StoreCoreProjectHost.prototype.applyStoryCommand;
	const apply = jest
		.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommand')
		.mockImplementationOnce(async function (
			this: StoreCoreProjectHost,
			command,
			options
		) {
			await renameGate;
			return original.call(this, command, options);
		});
	let preparation: Promise<void> | undefined;
	try {
		render(<Fixture />);
		fireEvent.click(screen.getByRole('button', {name: 'Seed'}));
		fireEvent.click(screen.getByRole('button', {name: 'Rename'}));
		await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
		let prepared = false;
		await act(async () => {
			preparation = persistenceQuitCoordinator
				.prepare('tag-rename-test')
				.then(() => {
					prepared = true;
				});
			await Promise.resolve();
		});
		expect(persistenceQuitCoordinator.state.phase).toBe('draining');
		await act(async () => {
			releaseRename();
			await renameGate;
		});
		await waitFor(() =>
			expect(saveJson).toHaveBeenCalledWith(
				'prefs.json',
				expect.objectContaining({
					storyTagColors: {ready: 'green', other: 'red'},
					storyListTagFilter: ['ready', 'other']
				})
			)
		);
		expect(prepared).toBe(false);
		await act(async () => {
			releaseSave();
			await preparation;
		});
		expect(prepared).toBe(true);
		expect(screen.getByRole('status')).toHaveTextContent('ready');
	} finally {
		releaseRename();
		releaseSave();
		persistenceQuitCoordinator.cancel('tag-rename-test');
		await preparation?.catch(() => undefined);
		browser.twineElectron = previousBridge;
		jest.restoreAllMocks();
	}
});
