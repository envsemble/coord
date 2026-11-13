import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { close, launchProject, openPlan, projectHome, removeDirectory, searchPopup, type Launched } from './app';

let launched: Launched | undefined;
let folder: string;
let dataDirectory: string;
test.beforeEach(() => { ({ dataDirectory, folder } = projectHome()); });
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(dataDirectory); });

test('a page opens in place from its plan link, Files and search, saves a choice, follows its files live, and a broken one shows why while Atlas carries on', async () => {
  launched = await launchProject({ dataDirectory, folder });
  const { window } = launched;
  const page = path.join(folder, 'active/0001-saved-payment-methods/pages/card-picker');
  await openPlan(window, 'Saved payment methods');
  // The plan's link reads as a page and opens it in place, under the plan's breadcrumb, marked in Files.
  await window.locator('.prose .page-link', { hasText: 'the card picker' }).click();
  await expect(window.locator('.page-view .breadcrumb')).toContainText('#0001');
  await expect(window.locator('.plan-files [role="treeitem"][data-id="d:active/0001-saved-payment-methods/pages/card-picker"]')).toHaveAttribute('aria-selected', 'true');
  const frame = window.frameLocator('iframe.page-frame');
  // Built on the stack: envUI, an icon, its data, the Atlas tools and the work item's diagram.
  await expect(frame.getByRole('heading', { name: 'Choosing a saved card' })).toBeVisible();
  await expect(frame.getByText('the plan has 7 steps')).toBeVisible();
  await expect(frame.locator('.atlas-page-diagram .node').first()).toBeVisible();
  // A choice is saved beside the page, where the agent reads it.
  await frame.getByRole('button', { name: 'Choose Tiles' }).click();
  await expect(frame.getByText('Chosen')).toBeVisible();
  await expect.poll(() => { try { return JSON.parse(readFileSync(path.join(page, 'choices.json'), 'utf8')).layout?.value; } catch { return null; } }).toBe('tiles');
  // Its data changes: the page reads it again, in place, and the choice it made stays.
  const layouts = JSON.parse(readFileSync(path.join(page, 'layouts.json'), 'utf8')) as object[];
  writeFileSync(path.join(page, 'layouts.json'), JSON.stringify([...layouts, { key: 'sheet', title: 'Sheet', summary: 'Saved cards in a sheet over the form.' }]));
  await expect(frame.getByRole('button', { name: 'Choose Sheet' })).toBeVisible();
  // The agent closes the choice: the page says it is settled and can't change it.
  writeFileSync(path.join(page, 'choices.json'), JSON.stringify({ layout: { value: 'tiles', chosenAt: '2026-11-13T10:00:00Z', closed: true, note: 'tiles, as agreed' } }));
  await expect(frame.getByText('Settled: tiles, as agreed.')).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Choose List' })).toBeDisabled();

  // Its code breaks: why shows in its place; Files and the breadcrumb still work.
  const source = readFileSync(path.join(page, 'page.tsx'), 'utf8');
  writeFileSync(path.join(page, 'page.tsx'), source.replace('export default function CardPicker() {', 'export default function CardPicker() { return <div>;'));
  await expect(window.locator('.page-view-state')).toContainText('This page doesn’t build');
  await expect(window.locator('.page-view-state')).toContainText('page.tsx:');
  // A page that throws as it runs shows the failure in its frame.
  writeFileSync(path.join(page, 'page.tsx'), source.replace('export default function CardPicker() {', 'export default function CardPicker() { throw new Error("No cards to pick"); '));
  await expect(frame.getByText('No cards to pick')).toBeVisible();
  writeFileSync(path.join(page, 'page.tsx'), source);
  await expect(frame.getByRole('heading', { name: 'Choosing a saved card' })).toBeVisible();

  // Files opens it as itself; search finds it by its name.
  await window.locator('.plan-files [role="treeitem"]', { hasText: 'plan.md' }).click();
  await expect(window.locator('.work-page h1')).toHaveText('Saved payment methods');
  await window.locator('.plan-files [role="treeitem"][data-id="d:active/0001-saved-payment-methods/pages/card-picker"]').click();
  await expect(frame.getByRole('heading', { name: 'Choosing a saved card' })).toBeVisible();
  await window.keyboard.press('Control+P');
  await searchPopup(window).getByRole('combobox').fill('card picker');
  await expect(searchPopup(window).getByRole('group', { name: 'Pages' })).toBeVisible();
});
