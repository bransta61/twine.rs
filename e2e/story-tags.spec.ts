import {expect, Page, test} from '@playwright/test';

const appUrl = 'http://127.0.0.1:5173';

async function createTaggedProject(page: Page, name: string, tag: string) {
	await page.goto(`${appUrl}/#/new-project`);
	await page.getByLabel('Project name').fill(name);
	await page.getByRole('button', {name: 'Create Project', exact: true}).click();
	await expect(page).toHaveURL(/#\/stories\/[^/]+$/);
	await page.goto(`${appUrl}/#/`);
	const row = page.getByTestId('story-list-row').filter({hasText: name});
	await row.getByRole('button', {name: 'Tags', exact: true}).click();
	await page.getByRole('combobox', {name: 'Tag Name'}).fill(tag);
	await page.getByRole('button', {name: 'Add', exact: true}).click();
	await page.getByRole('heading', {name: 'Projects', exact: true}).click();
	await expect(
		page
			.getByLabel('Project actions')
			.getByRole('button', {name: `# ${tag}`, exact: true})
	).toBeVisible();
}

test('manages story tags in the launcher and preserves rename, colors and filters after reload', async ({
	page
}, testInfo) => {
	await page.goto(`${appUrl}/#/`);
	await page.evaluate(() => window.localStorage.clear());
	await page.reload();
	const trigger = page.getByRole('button', {name: 'Story Tags', exact: true});
	const panel = page.getByRole('region', {name: 'Story Tags', exact: true});
	await trigger.click();
	await expect(panel).toContainText('No tags have been added');
	await panel.getByRole('button', {name: 'Close'}).click();
	await expect(trigger).toBeFocused();
	await createTaggedProject(page, 'Tag Alpha', 'draft');
	await createTaggedProject(page, 'Tag Beta', 'draft');
	await createTaggedProject(page, 'Tag Other', 'other');
	const rail = page.getByLabel('Project actions');
	await rail.getByRole('button', {name: '# draft', exact: true}).click();
	await expect(page.getByTestId('story-list-row')).toHaveCount(2);
	await trigger.click();
	await expect(panel.getByRole('heading', {name: 'Story Tags'})).toBeFocused();
	await expect(page.locator('.story-tags-dialog')).toHaveCount(0);
	await panel
		.getByRole('combobox', {name: 'Color for draft'})
		.selectOption('purple');
	const input = panel.getByRole('textbox', {name: 'Rename tag draft'});
	await input.fill('release candidate');
	await input.press('Enter');
	await expect(
		panel.getByRole('textbox', {name: 'Rename tag release-candidate'})
	).toBeFocused();
	await expect(
		panel.getByRole('combobox', {name: 'Color for release-candidate'})
	).toHaveValue('purple');
	await expect(
		rail.getByRole('button', {name: '# release-candidate', exact: true})
	).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('story-list-row')).toHaveCount(2);
	await panel
		.getByRole('textbox', {name: 'Rename tag release-candidate'})
		.press('Escape');
	await expect(panel).toBeHidden();
	await expect(trigger).toBeFocused();
	await page.reload();
	await expect(page.getByTestId('story-list-row')).toHaveCount(2);
	await expect(
		rail.getByRole('button', {name: '# release-candidate', exact: true})
	).toHaveAttribute('aria-pressed', 'true');
	await trigger.click();
	await expect(
		panel.getByRole('combobox', {name: 'Color for release-candidate'})
	).toHaveValue('purple');
	await panel
		.getByRole('combobox', {name: 'Color for release-candidate'})
		.selectOption('none');
	await expect(
		panel.getByRole('combobox', {name: 'Color for release-candidate'})
	).toHaveValue('none');
	await page.getByRole('textbox', {name: 'Search projects'}).fill('Alpha');
	await expect(page.getByTestId('story-list-row')).toHaveCount(1);
	await expect(panel).toBeVisible();
	for (const [name, width, height] of [
		['desktop', 1280, 900],
		['narrow', 900, 700]
	] as const) {
		await page.setViewportSize({width, height});
		await expect(panel.getByRole('button', {name: 'Close'})).toBeVisible();
		await page.screenshot({
			path: testInfo.outputPath(`story-tags-${name}.png`)
		});
	}
	await panel.getByRole('button', {name: 'Close'}).click();
	await expect(trigger).toBeFocused();
});

async function returnToLibrary(page: Page) {
	await page.getByRole('button', {name: 'Command', exact: true}).click();
	const palette = page
		.getByRole('dialog')
		.filter({has: page.getByRole('textbox', {name: 'Command'})});
	const input = palette.getByRole('textbox', {name: 'Command'});
	await expect(input).toBeFocused();
	await input.fill('Story Library');
	await expect(
		palette.getByRole('option', {name: 'Story Library'})
	).toHaveAttribute('aria-selected', 'true');
	await input.press('Enter');
	await expect(palette).toHaveCount(0);
	await expect(
		page.getByRole('heading', {name: 'Projects', exact: true})
	).toBeVisible();
}

test('keeps library colors and filters through each project undo and redo', async ({
	page
}) => {
	test.setTimeout(60000);
	await page.goto(`${appUrl}/#/`);
	await page.evaluate(() => window.localStorage.clear());
	await page.reload();
	await createTaggedProject(page, 'History Alpha', 'draft');
	await createTaggedProject(page, 'History Beta', 'draft');
	await createTaggedProject(page, 'History Other', 'other');
	const panel = page.getByRole('region', {name: 'Story Tags', exact: true});
	const rail = page.getByLabel('Project actions');
	await rail.getByRole('button', {name: '# draft', exact: true}).click();
	await page.getByRole('button', {name: 'Story Tags', exact: true}).click();
	await panel
		.getByRole('combobox', {name: 'Color for draft'})
		.selectOption('green');
	await panel.getByRole('textbox', {name: 'Rename tag draft'}).fill('ready');
	await panel.getByRole('textbox', {name: 'Rename tag draft'}).press('Enter');
	await expect(
		panel.getByRole('textbox', {name: 'Rename tag ready'})
	).toBeFocused();
	// These independent preference edits must survive every later history step.
	await panel
		.getByRole('combobox', {name: 'Color for other'})
		.selectOption('red');
	await rail.getByRole('button', {name: '# other', exact: true}).click();
	await expect(page.getByTestId('story-list-row')).toHaveCount(3);
	for (const [project, direction, names] of [
		['Alpha', 'Undo', ['draft', 'ready']],
		['Beta', 'Undo', ['draft']],
		['Alpha', 'Redo', ['draft', 'ready']],
		['Beta', 'Redo', ['ready']]
	] as const) {
		await page
			.getByRole('button', {name: `Open History ${project}`, exact: true})
			.first()
			.click();
		const command = page.getByRole('button', {
			name: new RegExp(`^${direction} Rename`)
		});
		await expect(command).toBeEnabled();
		await command.click();
		await expect(
			page.getByRole('button', {
				name: new RegExp(`^${direction === 'Undo' ? 'Redo' : 'Undo'} Rename`)
			})
		).toBeEnabled();
		await returnToLibrary(page);
		await expect(page.getByTestId('story-list-row')).toHaveCount(3);
		await page.getByRole('button', {name: 'Story Tags', exact: true}).click();
		for (const name of names) {
			await expect(
				panel.getByRole('combobox', {name: `Color for ${name}`})
			).toHaveValue('green');
			await expect(
				rail.getByRole('button', {name: `# ${name}`, exact: true})
			).toHaveAttribute('aria-pressed', 'true');
		}
		await expect(panel.getByRole('combobox')).toHaveCount(names.length + 1);
		await expect(
			panel.getByRole('combobox', {name: 'Color for other'})
		).toHaveValue('red');
		await expect(
			rail.getByRole('button', {name: '# other', exact: true})
		).toHaveAttribute('aria-pressed', 'true');
	}
	await page.reload();
	await expect(page.getByTestId('story-list-row')).toHaveCount(3);
	await page.getByRole('button', {name: 'Story Tags', exact: true}).click();
	await expect(
		panel.getByRole('combobox', {name: 'Color for ready'})
	).toHaveValue('green');
	await expect(
		panel.getByRole('combobox', {name: 'Color for other'})
	).toHaveValue('red');
});
