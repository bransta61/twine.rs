import {saveMiddleware} from '../save-middleware';
import {saveJson} from '../../save-json';
import {PrefsState} from '../../../../prefs';
import {fakePrefs} from '../../../../../test-util';

jest.mock('../../save-json');

describe('prefs Electron IPC save middleware', () => {
	const saveJsonMock = saveJson as jest.Mock;
	let prefs: PrefsState;

	beforeEach(() => {
		prefs = fakePrefs();
		saveJsonMock.mockResolvedValue(undefined);
	});

	it('returns the save acknowledgement for an update action', async () => {
		await saveMiddleware(prefs, {type: 'update', name: 'locale', value: 'en'});
		expect(saveJsonMock.mock.calls).toEqual([['prefs.json', prefs]]);
	});

	it('calls saveJson() on a state when a repair action is received', () => {
		saveMiddleware(prefs, {type: 'repair', allFormats: []});
		expect(saveJsonMock.mock.calls).toEqual([['prefs.json', prefs]]);
	});

	it.each([
		{type: 'setStoryTagColor' as const, tag: 'draft', color: 'green' as const},
		{
			type: 'reconcileStoryTagRename' as const,
			oldName: 'draft',
			newName: 'ready',
			oldNameStillUsed: false
		}
	])('persists tag preference delta $type', async action => {
		await saveMiddleware(prefs, action);
		expect(saveJsonMock.mock.calls).toEqual([['prefs.json', prefs]]);
	});

	it('does not call saveJson() on any other action', () => {
		saveMiddleware(prefs, {type: 'init', state: {}});
		expect(saveJsonMock).not.toHaveBeenCalled();
	});
});
