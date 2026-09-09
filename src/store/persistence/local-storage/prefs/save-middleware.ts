import {PrefsAction, PrefsState} from '../../../prefs';
import {save} from './save';

export function saveMiddleware(state: PrefsState, action: PrefsAction) {
	if (
		action.type === 'repair' ||
		action.type === 'update' ||
		action.type === 'setStoryTagColor' ||
		action.type === 'reconcileStoryTagRename'
	) {
		save(state);
	}
}
