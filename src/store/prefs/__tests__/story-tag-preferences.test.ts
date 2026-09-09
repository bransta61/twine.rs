import {defaults} from '../defaults';
import {PrefsState} from '../prefs.types';
import {reducer} from '../reducer';

const rename = (
	state: PrefsState,
	oldName: string,
	newName: string,
	oldNameStillUsed: boolean
) =>
	reducer(state, {
		type: 'reconcileStoryTagRename',
		oldName,
		newName,
		oldNameStillUsed
	});

it('follows partial and complete multi-project rename, undo and redo without reverting unrelated edits', () => {
	let state: PrefsState = {
		...defaults(),
		storyTagColors: {draft: 'green' as const},
		storyListTagFilter: ['draft']
	};
	state = rename(state, 'draft', 'ready', true);
	expect(state.storyTagColors).toEqual({draft: 'green', ready: 'green'});
	state = rename(state, 'draft', 'ready', false);
	state = reducer(state, {
		type: 'setStoryTagColor',
		tag: 'other',
		color: 'red'
	});
	state = reducer(state, {
		type: 'update',
		name: 'storyListTagFilter',
		value: ['ready', 'other']
	});
	state = rename(state, 'ready', 'draft', true);
	expect(state.storyTagColors).toEqual({
		ready: 'green',
		draft: 'green',
		other: 'red'
	});
	expect(state.storyListTagFilter).toEqual(['ready', 'draft', 'other']);
	state = rename(state, 'ready', 'draft', false);
	expect(state.storyTagColors).toEqual({draft: 'green', other: 'red'});
	expect(state.storyListTagFilter).toEqual(['draft', 'other']);
	state = rename(state, 'draft', 'ready', true);
	state = rename(state, 'draft', 'ready', false);
	expect(state.storyTagColors).toEqual({ready: 'green', other: 'red'});
	expect(state.storyListTagFilter).toEqual(['ready', 'other']);
});

it('preserves a newer destination color and unrelated filter selection', () => {
	const state = rename(
		{
			...defaults(),
			storyTagColors: {draft: 'green', ready: 'purple', other: 'red'},
			storyListTagFilter: ['other']
		},
		'draft',
		'ready',
		false
	);
	expect(state.storyTagColors).toEqual({ready: 'purple', other: 'red'});
	expect(state.storyListTagFilter).toEqual(['other']);
});

it('reconciles compensation after a partially completed rename', () => {
	const state = {
		...defaults(),
		storyTagColors: {draft: 'green' as const, other: 'red' as const},
		storyListTagFilter: ['draft', 'other']
	};
	expect(
		rename(rename(state, 'draft', 'ready', true), 'ready', 'draft', false)
	).toEqual(state);
});

it('merges color changes and does not reset existing colors when adding tags', () => {
	let state = reducer(defaults(), {
		type: 'setStoryTagColor',
		tag: 'draft',
		color: 'green'
	});
	state = reducer(state, {
		type: 'setStoryTagColor',
		tag: 'other',
		color: 'red'
	});
	state = reducer(state, {
		type: 'setStoryTagColor',
		tag: 'draft',
		color: 'blue',
		onlyIfMissing: true
	});
	expect(state.storyTagColors).toEqual({draft: 'green', other: 'red'});
	state = rename(state, 'draft', '__proto__', false);
	expect(Object.hasOwn(state.storyTagColors, '__proto__')).toBe(true);
	expect(state.storyTagColors.__proto__).toBe('green');
});
