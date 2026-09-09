import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	Button,
	IconButton,
	Input,
	Panel,
	Select,
	Tag
} from '../../components/design-system';
import {renameStoryTagCommand, useCoreProjectHost} from '../../core';
import {usePrefsContext} from '../../store/prefs';
import {storyTags, useStoriesContext} from '../../store/stories';
import {colors, Color} from '../../util/color';

export interface StoryTagsPanelProps {
	open: boolean;
	onClose: () => void;
}

const tagPageSize = 50;

function normalizeTagName(name: string) {
	return name.replace(/\s/g, '-');
}

export const StoryTagsPanel: React.FC<StoryTagsPanelProps> = ({
	open,
	onClose
}) => {
	const {t} = useTranslation();
	const coreProjectHost = useCoreProjectHost();
	const {prefs, dispatch: prefsDispatch} = usePrefsContext();
	const {stories} = useStoriesContext();
	const headingRef = React.useRef<HTMLHeadingElement>(null);
	const wasOpen = React.useRef(false);
	const renameInFlight = React.useRef(false);
	const [drafts, setDrafts] = React.useState(() => new Map<string, string>());
	const [renameError, setRenameError] = React.useState<string>();
	const [renamingTag, setRenamingTag] = React.useState<string>();
	const tags = React.useMemo(() => storyTags(stories), [stories]);
	const [page, setPage] = React.useState(0);
	const currentPage = Math.min(
		page,
		Math.max(0, Math.ceil(tags.length / tagPageSize) - 1)
	);
	const inputs = React.useRef(new Map<string, HTMLInputElement>());
	const focusAfterRename = React.useRef<string | undefined>(undefined);

	React.useLayoutEffect(() => {
		const name = focusAfterRename.current;
		if (!open) {
			focusAfterRename.current = undefined;
			return;
		}
		if (renamingTag !== undefined || !name) return;
		const index = tags.indexOf(name);
		if (index === -1) {
			focusAfterRename.current = undefined;
			headingRef.current?.focus({preventScroll: true});
			return;
		}
		const destinationPage = Math.floor(index / tagPageSize);
		if (currentPage !== destinationPage) {
			setPage(destinationPage);
			return;
		}
		inputs.current.get(name)?.focus();
		focusAfterRename.current = undefined;
	}, [currentPage, open, renamingTag, tags]);

	React.useEffect(() => {
		if (open && !wasOpen.current) {
			headingRef.current?.focus({preventScroll: true});
		}
		wasOpen.current = open;
	}, [open]);

	function draftFor(tag: string) {
		return drafts.get(tag) ?? tag;
	}

	function changeColor(tag: string, color: Color) {
		prefsDispatch({type: 'setStoryTagColor', tag, color});
	}

	async function renameTag(tag: string) {
		if (renameInFlight.current) return;
		const newName = normalizeTagName(draftFor(tag));
		if (newName.length === 0) {
			setRenameError(t('routes.storyList.tags.emptyName'));
			return;
		}
		if (newName !== tag && tags.includes(newName)) {
			setRenameError(t('components.tagEditor.alreadyExists'));
			return;
		}
		if (newName === tag) return;

		const origin = document.activeElement;
		const row = inputs.current.get(tag)?.closest('form');
		let ownsFocus = !!origin && !!row?.contains(origin);
		const relinquishFocus = (event: FocusEvent) => {
			if (event.target !== origin && event.target !== document.body)
				ownsFocus = false;
		};
		document.addEventListener('focusin', relinquishFocus);
		renameInFlight.current = true;
		setRenameError(undefined);
		setRenamingTag(tag);
		try {
			await coreProjectHost.applyStoryCommand(
				renameStoryTagCommand(tag, newName),
				t('undoChange.renameTag')
			);
			setDrafts(current => {
				const next = new Map(current);
				next.delete(tag);
				return next;
			});
			if (ownsFocus) focusAfterRename.current = newName;
		} catch (error) {
			setRenameError(
				t('routes.storyList.tags.renameFailed', {
					error: error instanceof Error ? error.message : String(error)
				})
			);
			if (ownsFocus) focusAfterRename.current = tag;
		} finally {
			document.removeEventListener('focusin', relinquishFocus);
			renameInFlight.current = false;
			setRenamingTag(undefined);
		}
	}

	return (
		<Panel
			aria-hidden={!open}
			aria-label={t('dialogs.storyTags.title')}
			className="story-tags-panel"
			hidden={!open}
			id="story-tags-panel"
			actions={
				<IconButton
					icon="x"
					label={t('common.close')}
					onClick={onClose}
					size="sm"
				/>
			}
			icon="tags"
			title={t('dialogs.storyTags.title')}
			onKeyDown={event => {
				if (
					event.key === 'Escape' &&
					!event.nativeEvent.isComposing &&
					!(event.target instanceof HTMLSelectElement)
				) {
					event.preventDefault();
					onClose();
				}
			}}
		>
			<h2 className="story-tags-panel__heading" ref={headingRef} tabIndex={-1}>
				{t('dialogs.storyTags.title')}
			</h2>
			{renameError && (
				<p className="story-tags-panel__error" role="alert">
					{renameError}
				</p>
			)}
			{open &&
				(tags.length === 0 ? (
					<p className="story-tags-panel__empty">
						{t('dialogs.storyTags.noTags')}
					</p>
				) : (
					<>
						<div className="story-tags-panel__rows">
							{tags
								.slice(
									currentPage * tagPageSize,
									(currentPage + 1) * tagPageSize
								)
								.map(tag => (
									<form
										className="story-tags-panel__row"
										key={tag}
										onSubmit={event => {
											event.preventDefault();
											void renameTag(tag);
										}}
									>
										<Tag
											color={
												prefs.storyTagColors[tag] === 'none'
													? 'transparent'
													: prefs.storyTagColors[tag]
											}
										>
											{tag}
										</Tag>
										<Input
											aria-label={t('routes.storyList.tags.renameLabel', {
												name: tag
											})}
											disabled={renamingTag !== undefined}
											onChange={event => {
												setRenameError(undefined);
												const value = normalizeTagName(event.target.value);
												setDrafts(current => new Map(current).set(tag, value));
											}}
											ref={element => {
												if (element) inputs.current.set(tag, element);
												else inputs.current.delete(tag);
											}}
											value={draftFor(tag)}
										/>
										<Select
											ariaLabel={t('routes.storyList.tags.colorLabel', {
												name: tag
											})}
											disabled={renamingTag !== undefined}
											onChange={color => changeColor(tag, color as Color)}
											options={colors.map(color => ({
												label: t(`colors.${color}`),
												value: color
											}))}
											size="sm"
											value={prefs.storyTagColors[tag] ?? 'none'}
										/>
										<Button
											disabled={
												renamingTag !== undefined || draftFor(tag) === tag
											}
											loading={renamingTag === tag}
											size="sm"
											type="submit"
										>
											{t('common.rename')}
										</Button>
									</form>
								))}
						</div>
						{tags.length > tagPageSize && (
							<nav
								aria-label={t('dialogs.storyTags.title')}
								className="story-tags-panel__pagination"
							>
								<Button
									disabled={currentPage === 0}
									onClick={() => setPage(currentPage - 1)}
									size="sm"
								>
									{t('common.previous')}
								</Button>
								<span>
									{t('routes.storyList.tags.range', {
										first: currentPage * tagPageSize + 1,
										last: Math.min(
											(currentPage + 1) * tagPageSize,
											tags.length
										),
										total: tags.length
									})}
								</span>
								<Button
									disabled={(currentPage + 1) * tagPageSize >= tags.length}
									onClick={() => setPage(currentPage + 1)}
									size="sm"
								>
									{t('common.next')}
								</Button>
							</nav>
						)}
					</>
				))}
		</Panel>
	);
};
