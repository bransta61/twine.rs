import {v4 as uuid} from '@lukeed/uuid';
import * as React from 'react';
import useThunkReducer from '../../util/use-thunk-reducer';
import {usePersistence} from '../persistence/use-persistence';
import {builtins} from './defaults';
import {
	StoryFormat,
	StoryFormatsAction,
	StoryFormatsContextProps,
	StoryFormatsState
} from './story-formats.types';
import {useStoreErrorReporter} from '../use-store-error-reporter';
import {reducer} from './reducer';
import {NavigationAdmissionService} from '../../core/navigation-admission';

export const NavigationAdmissionContext = React.createContext<
	NavigationAdmissionService | undefined
>(undefined);

const defaultBuiltins: StoryFormat[] = builtins().map(f => ({
	...f,
	id: uuid(),
	loadState: 'unloaded',
	selected: false,
	userAdded: false
}));

export const StoryFormatsContext =
	React.createContext<StoryFormatsContextProps>({
		dispatch: () => {},
		formats: []
	});

StoryFormatsContext.displayName = 'StoryFormats';

export const useStoryFormatsContext = () =>
	React.useContext(StoryFormatsContext);

export const StoryFormatsContextProvider: React.FC<
	React.PropsWithChildren
> = props => {
	const {storyFormats} = usePersistence();
	const {reportError} = useStoreErrorReporter();
	const persistedReducer: React.Reducer<StoryFormatsState, StoryFormatsAction> =
		React.useCallback(
			(state, action) => {
				if (storyFormats.canReduceAction?.(action) === false) {
					return state;
				}
				const newState = reducer(state, action);

				try {
					const completion = storyFormats.saveMiddleware(newState, action);

					if (completion) {
						void completion.catch(error =>
							reportError(
								error as Error,
								'store.errors.cantPersistStoryFormats'
							)
						);
					}
				} catch (error) {
					reportError(error as Error, 'store.errors.cantPersistStoryFormats');
				}
				return newState;
			},
			[reportError, storyFormats]
		);

	const [navigation] = React.useState(
		() => new NavigationAdmissionService(defaultBuiltins)
	);
	const [state, dispatch] = useThunkReducer(
		persistedReducer,
		defaultBuiltins,
		undefined,
		navigation.acceptState
	);
	navigation.setLoader(dispatch);

	return (
		<NavigationAdmissionContext.Provider value={navigation}>
			<StoryFormatsContext.Provider
				value={{
					dispatch,
					formats: state
				}}
			>
				{props.children}
			</StoryFormatsContext.Provider>
		</NavigationAdmissionContext.Provider>
	);
};
