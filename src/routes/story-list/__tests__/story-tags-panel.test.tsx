import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import i18next from 'i18next';
import {I18nextProvider} from 'react-i18next';
import en from '../../../../public/locales/en-US.json';
import ja from '../../../../public/locales/ja.json';

jest.unmock('i18next');
jest.unmock('react-i18next');
const translations = i18next.createInstance();
beforeEach(async () => {
	await translations.init({
		lng: 'en-US',
		fallbackLng: 'en-US',
		resources: {'en-US': {translation: en}, ja: {translation: ja}},
		interpolation: {escapeValue: false}
	});
});
import {usePrefsContext} from '../../../store/prefs';
import {useStoriesContext} from '../../../store/stories';
import {FakeStateProvider, fakeStory} from '../../../test-util';
import {StoreCoreProjectHost} from '../../../test-util/core-project-host-runtime';
import {StoryTagsPanel} from '../story-tags-panel';

function Harness() {
	const [open, setOpen] = React.useState(true);
	const [mounted, setMounted] = React.useState(true);
	const {prefs, dispatch} = usePrefsContext();
	const {stories} = useStoriesContext();
	return (
		<>
			<button onClick={() => setOpen(value => !value)}>Toggle panel</button>
			<button onClick={() => setMounted(value => !value)}>Navigate</button>
			<button
				onClick={() => {
					dispatch({
						type: 'update',
						name: 'storyTagColors',
						value: {release: 'green', other: 'red'}
					});
					dispatch({
						type: 'update',
						name: 'storyListTagFilter',
						value: ['release', 'other']
					});
				}}
			>
				Change preferences
			</button>
			<output data-testid="prefs">
				{JSON.stringify({
					colors: prefs.storyTagColors,
					filters: prefs.storyListTagFilter
				})}
			</output>
			<output data-testid="tags">
				{JSON.stringify(stories.map(story => story.tags))}
			</output>
			{mounted && <StoryTagsPanel open={open} onClose={() => setOpen(false)} />}
		</>
	);
}

function renderPanel(tagSets = [['release']]) {
	const stories = tagSets.map(tags => ({...fakeStory(), tags}));
	return render(
		<I18nextProvider i18n={translations}>
			<FakeStateProvider
				stories={stories}
				prefs={{
					storyTagColors: {release: 'purple'},
					storyListTagFilter: ['release']
				}}
			>
				<Harness />
			</FakeStateProvider>
		</I18nextProvider>
	);
}

function submitRename() {
	fireEvent.change(screen.getByRole('textbox', {name: 'Rename tag release'}), {
		target: {value: 'candidate'}
	});
	fireEvent.click(screen.getByRole('button', {name: 'Rename'}));
}

afterEach(() => jest.restoreAllMocks());

it('shows an accessible empty state', async () => {
	const {container} = renderPanel([[]]);
	expect(
		screen.getByText('No tags have been added to your stories.')
	).toBeVisible();
	expect(await axe(container)).toHaveNoViolations();
});

it('updates colors including none without a project mutation', () => {
	const apply = jest.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommand');
	renderPanel();
	const select = screen.getByRole('combobox', {name: 'Color for release'});
	fireEvent.change(select, {target: {value: 'green'}});
	expect(select).toHaveValue('green');
	fireEvent.change(select, {target: {value: 'none'}});
	expect(select).toHaveValue('none');
	expect(screen.getByTestId('prefs')).toHaveTextContent('"release":"none"');
	expect(apply).not.toHaveBeenCalled();
});

it('renames every matching story and carries the active filter and color', async () => {
	renderPanel([['release'], ['release']]);
	submitRename();
	await waitFor(() =>
		expect(screen.getByTestId('tags')).toHaveTextContent(
			'[["candidate"],["candidate"]]'
		)
	);
	expect(screen.getByTestId('prefs')).toHaveTextContent(
		'{"colors":{"candidate":"purple"},"filters":["candidate"]}'
	);
	expect(
		screen.getByRole('textbox', {name: 'Rename tag candidate'})
	).toHaveValue('candidate');
});

it.each([false, true])(
	'merges current preferences after pending rename (route remount: %s)',
	async remount => {
		let finish!: () => void;
		const pending = new Promise<undefined>(resolve => {
			finish = () => resolve(undefined);
		});
		const originalApply = StoreCoreProjectHost.prototype.applyStoryCommand;
		const apply = jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommand')
			.mockImplementationOnce(async function (
				this: StoreCoreProjectHost,
				command,
				options
			) {
				await pending;
				return originalApply.call(this, command, options);
			});
		renderPanel();
		submitRename();
		await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
		if (remount) {
			fireEvent.click(screen.getByRole('button', {name: 'Navigate'}));
			expect(
				screen.queryByRole('region', {name: 'Story Tags'})
			).not.toBeInTheDocument();
			fireEvent.click(screen.getByRole('button', {name: 'Navigate'}));
		} else {
			fireEvent.click(screen.getByRole('button', {name: 'Close'}));
			fireEvent.click(screen.getByRole('button', {name: 'Toggle panel'}));
			expect(screen.getByRole('button', {name: 'Rename'})).toBeDisabled();
			fireEvent.click(screen.getByRole('button', {name: 'Rename'}));
		}
		fireEvent.click(screen.getByRole('button', {name: 'Change preferences'}));
		await act(async () => {
			finish();
			await pending;
		});
		await waitFor(() =>
			expect(screen.getByTestId('prefs')).toHaveTextContent(
				'{"colors":{"other":"red","candidate":"green"},"filters":["candidate","other"]}'
			)
		);
		expect(apply).toHaveBeenCalledTimes(1);
	}
);

it('retains a pending failure and existing preferences after reopening', async () => {
	let fail!: (error: Error) => void;
	const pending = new Promise<undefined>((_, reject) => {
		fail = reject;
	});
	const apply = jest
		.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommand')
		.mockReturnValue(pending);
	renderPanel();
	submitRename();
	await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
	fireEvent.click(screen.getByRole('button', {name: 'Close'}));
	await act(async () => {
		fail(new Error('Save failed'));
		await pending.catch(() => undefined);
	});
	fireEvent.click(screen.getByRole('button', {name: 'Toggle panel'}));
	expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
	expect(screen.getByRole('textbox', {name: 'Rename tag release'})).toHaveValue(
		'candidate'
	);
	expect(screen.getByTestId('prefs')).toHaveTextContent(
		'{"colors":{"release":"purple"},"filters":["release"]}'
	);
});

it('leaves Escape to composition and native color selection', () => {
	renderPanel();
	fireEvent.keyDown(screen.getByRole('textbox', {name: 'Rename tag release'}), {
		key: 'Escape',
		isComposing: true
	});
	expect(screen.getByRole('region', {name: 'Story Tags'})).toBeVisible();
	fireEvent.keyDown(screen.getByRole('combobox', {name: 'Color for release'}), {
		key: 'Escape'
	});
	expect(screen.getByRole('region', {name: 'Story Tags'})).toBeVisible();
});

it('retains focus after a keyboard rename, including a different result page', async () => {
	renderPanel([
		[
			'release',
			...Array.from(
				{length: 100},
				(_, index) => `tag-${String(index).padStart(3, '0')}`
			)
		]
	]);
	const input = screen.getByRole('textbox', {name: 'Rename tag release'});
	input.focus();
	fireEvent.change(input, {target: {value: 'z-release'}});
	fireEvent.submit(input.closest('form')!);
	await waitFor(() =>
		expect(
			screen.getByRole('textbox', {name: 'Rename tag z-release'})
		).toHaveFocus()
	);
	expect(screen.getAllByRole('textbox')).toHaveLength(1);
});

it.each(['outside', 'close'])(
	'does not reclaim focus after the user chooses %s during rename',
	async destination => {
		let finish!: () => void;
		const gate = new Promise<void>(resolve => {
			finish = resolve;
		});
		const originalApply = StoreCoreProjectHost.prototype.applyStoryCommand;
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommand')
			.mockImplementationOnce(async function (
				this: StoreCoreProjectHost,
				command,
				options
			) {
				await gate;
				return originalApply.call(this, command, options);
			});
		renderPanel();
		const input = screen.getByRole('textbox', {name: 'Rename tag release'});
		input.focus();
		submitRename();
		if (destination === 'close')
			fireEvent.click(screen.getByRole('button', {name: 'Close'}));
		const outside = screen.getByRole('button', {name: 'Toggle panel'});
		outside.focus();
		await act(async () => {
			finish();
			await gate;
		});
		await waitFor(() =>
			expect(screen.getByTestId('tags')).toHaveTextContent('[["candidate"]]')
		);
		expect(outside).toHaveFocus();
	}
);

it('bounds large tag lists and does not render row controls while closed', () => {
	renderPanel([
		Array.from(
			{length: 1000},
			(_, index) => `tag-${String(index).padStart(4, '0')}`
		)
	]);
	expect(screen.getAllByRole('textbox')).toHaveLength(50);
	fireEvent.click(screen.getByRole('button', {name: 'Next'}));
	expect(
		screen.getByRole('textbox', {name: 'Rename tag tag-0050'})
	).toBeVisible();
	expect(screen.getAllByRole('textbox')).toHaveLength(50);
	fireEvent.click(screen.getByRole('button', {name: 'Close'}));
	expect(screen.queryAllByRole('textbox', {hidden: true})).toHaveLength(0);
});

it('preserves existing Japanese tag translations and falls back for new labels', async () => {
	await translations.changeLanguage('ja');
	const rendered = renderPanel();
	expect(
		screen.getByRole('region', {name: ja.dialogs.storyTags.title})
	).toBeVisible();
	expect(screen.getByRole('button', {name: ja.common.rename})).toBeVisible();
	expect(screen.getByRole('button', {name: ja.common.close})).toBeVisible();
	expect(
		screen.getByRole('textbox', {name: 'Rename tag release'})
	).toBeVisible();
	rendered.unmount();
	renderPanel([[]]);
	expect(screen.getByText(ja.dialogs.storyTags.noTags)).toBeVisible();
});
