import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { addProject, close, launch, launchProject, openProject, projectHome, removeDirectory, showFiles, sidebarProject, type Launched } from './app';

let launched: Launched | undefined;
const homes: string[] = [];
test.afterEach(async () => { await close(launched); launched = undefined; for (const home of homes.splice(0)) removeDirectory(home); });

const row = (id: string) => `[role="treeitem"][data-id="${id}"]`;
const tabList = (window: Page) => window.getByRole('tablist', { name: 'Open tabs' });
const tabs = (window: Page) => tabList(window).getByRole('tab');
const activeTab = (window: Page) => tabList(window).locator('[role="tab"][aria-selected="true"]');
const previewTabs = (window: Page) => tabList(window).locator('[role="tab"][data-preview="true"]');
const titles = (launchedApp: Launched) => launchedApp.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(item => item.getTitle()));

test('the sidebar lists the projects; a project opens its page as a tab with its work, statistics and activity', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  launched = await launch({ dataDirectory: home.dataDirectory });
  const { window } = launched;
  // A window starts with the projects in the sidebar and nothing open.
  await expect(sidebarProject(window)).toBeVisible();
  await expect(window.getByRole('heading', { name: 'Open a project' })).toBeVisible();
  await expect(tabs(window)).toHaveCount(0);
  await expect.poll(() => titles(launched!)).toEqual(['Atlas']);
  // The Work, Statistics and Activity pages and the explorer are gone from the sidebar.
  for (const gone of ['Work', 'Statistics', 'Activity']) await expect(window.getByRole('navigation').getByRole('button', { name: new RegExp('^' + gone) })).toHaveCount(0);
  await expect(window.locator('.workbench .env-app-sidebar [role="tree"]')).toHaveCount(0);

  await openProject(window);
  await expect(tabs(window)).toHaveCount(1);
  await expect(activeTab(window)).toContainText('Northwind');
  await expect(sidebarProject(window)).toHaveAttribute('aria-current', 'page');
  // One page: the work list with its filters, then statistics, then activity.
  await expect(window.locator('.project-page .page-section > .page-header h2')).toHaveText(['Work', 'Statistics', 'Activity']);
  await expect(window.locator('.work-row')).toHaveCount(3);
  await expect(window.locator('.work-row').first()).toContainText('Customer order notifications');
  await expect(window.locator('.stats-grid .stat')).toHaveCount(4);
  await expect(window.locator('.activity-row')).toHaveCount(1);
  await expect(window.locator('.project-path')).toHaveText(home.folder);
  // The project tab is a regular tab: closed like any other.
  await window.keyboard.press('Control+W');
  await expect(tabs(window)).toHaveCount(0);
  await expect(window.getByRole('heading', { name: 'Open a project' })).toBeVisible();
});

test('a work item opens on its plan, with a link to its ledger beside it and its diagrams in tabs of their own', async () => {
  launched = await launchProject();
  const { window } = launched;
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click({ modifiers: ['Control'] });
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  // No Plan / Ledger / Diagrams switcher: the plan is what opens.
  await expect(window.getByRole('radiogroup', { name: 'Work sections' })).toHaveCount(0);
  await expect(window.locator('.reader .prose')).toContainText('Current checkout');
  // The side column keeps progress, dates and statistics, and links the ledger.
  await expect(window.locator('.about .ledger-progress-summary')).toHaveText('2 of 7 steps done · 5 left');
  await expect(window.locator('.about .ledger-step')).toHaveCount(7);
  await window.locator('.about').getByRole('link', { name: 'Ledger' }).click();
  await expect(window.locator('.reader-name')).toContainText('ledger.md');
  await expect(activeTab(window)).toContainText('ledger.md');
  // A diagram opens from its card in the plan, in a tab of its own, with a way back to the plan.
  await tabs(window).filter({ hasText: 'Saved payment methods' }).first().click();
  await window.locator('.diagram-card').first().getByRole('button', { name: 'Open diagram' }).click();
  await expect(window.locator('.diagrams .atlas-panel').first()).toBeVisible();
  await expect(activeTab(window)).toContainText('Saved payment methods');
  // It took the ledger's preview tab's place: the project's page, the plan and the diagram.
  await expect(tabs(window)).toHaveCount(3);
  await window.getByRole('button', { name: 'Saved payment methods', exact: true }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  // A row's diagram count opens its first diagram.
  await tabs(window).filter({ hasText: 'Northwind' }).click();
  await window.locator('.work-row', { hasText: 'Order fulfilment model' }).locator('.diagram-count').click();
  await expect(window.locator('.model-picker-title')).toBeVisible();
});

test('tabs of different projects sit side by side, persist with the window, and Close All Tabs closes them all', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  addProject(home.dataDirectory, 'coord', 'Coord');
  launched = await launch({ dataDirectory: home.dataDirectory });
  let { window } = launched;
  await openProject(window, 'Northwind');
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click({ modifiers: ['Control'] });
  await openProject(window, 'Coord');
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click({ modifiers: ['Control'] });
  // The same work item of two projects is two tabs, each knowing its project.
  await expect(tabs(window)).toHaveCount(4);
  await expect(tabs(window).filter({ hasText: 'Saved payment methods' })).toHaveCount(2);
  await expect(tabs(window).nth(3)).toHaveAttribute('title', /· Coord$/);
  await tabs(window).nth(1).click();
  await expect(window.locator('.work-main .breadcrumb')).toContainText('Northwind');
  await tabs(window).nth(3).click();
  await expect(window.locator('.work-main .breadcrumb')).toContainText('Coord');
  await window.waitForTimeout(600);
  await close(launched);

  launched = await launch({ dataDirectory: home.dataDirectory });
  window = launched.window;
  await expect(tabs(window)).toHaveCount(4);
  await expect(activeTab(window)).toHaveAttribute('title', /· Coord$/);
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  // The tab rail's context menu closes every tab of the window.
  await activeTab(window).click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Close all tabs' }).click();
  await expect(tabs(window)).toHaveCount(0);
  await expect(window.getByRole('heading', { name: 'Open a project' })).toBeVisible();
});

test('the file panel slides in from the right with the active tab\'s project; files open as previews, diagrams as diagrams', async () => {
  launched = await launchProject();
  const { window } = launched;
  await expect(window.getByRole('region', { name: 'Files' })).toHaveCount(0);
  const panel = await showFiles(window);
  await expect(panel).toContainText('Northwind');
  const box = (await panel.boundingBox())!;
  const page = (await window.locator('.workbench-page').boundingBox())!;
  expect(box.x + box.width).toBeGreaterThan(page.x + page.width - 40);
  await expect(panel.locator('[role="treeitem"]', { hasText: '.atlas' })).toHaveCount(0);
  await panel.locator(row('d:active')).click();
  const work = panel.locator(row('d:active/0001-saved-payment-methods'));
  await expect(work).toContainText('Saved payment methods');
  await expect(work.locator('.status-icon')).toHaveAttribute('aria-label', 'In progress');
  // Clicking a work folder expands it and opens its plan in a preview tab.
  await work.click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect(previewTabs(window)).toContainText('Saved payment methods');
  await panel.locator(row('d:active/0001-saved-payment-methods/diagrams')).click();
  await panel.locator(row('f:active/0001-saved-payment-methods/diagrams/checkout-proposal.puml')).click();
  await expect(window.locator('.model-picker-title')).toHaveText('Checkout · proposed payment methods');
  // A file replaces the preview; a double click keeps it.
  await panel.locator(row('f:active/0001-saved-payment-methods/CONTEXT.md')).click();
  await expect(previewTabs(window)).toContainText('CONTEXT.md');
  await expect(window.locator('.reader-name')).toContainText('CONTEXT.md');
  await panel.locator(row('f:active/0001-saved-payment-methods/CONTEXT.md')).dblclick();
  await expect(previewTabs(window)).toHaveCount(0);
  // Ctrl+Shift+E hides it again.
  await window.keyboard.press('Control+Shift+E');
  await expect(window.getByRole('region', { name: 'Files' })).toHaveCount(0);
});

test('New Project makes a planning folder from the templates; a project is renamed, moved, hidden and archived from its context menu', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  launched = await launch({ dataDirectory: home.dataDirectory });
  const { window } = launched;
  await window.getByRole('group', { name: 'Projects' }).getByRole('button', { name: 'New Project…' }).click();
  const dialog = window.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Name').first().fill('Coord');
  await dialog.getByLabel('Git remote').fill('git@github.com:example/coord-web.git');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(window.locator('.project-page h1')).toHaveText('Coord');
  const folder = path.join(home.dataDirectory, 'planning', 'coord');
  const registry = JSON.parse(readFileSync(path.join(folder, 'planning.json'), 'utf8'));
  expect([registry.name, registry.repositories]).toEqual(['Coord', [{ id: 'coord-web', name: 'coord-web', remote: 'git@github.com:example/coord-web.git' }]]);
  expect(existsSync(path.join(folder, '.git')) && existsSync(path.join(folder, 'AGENTS.md'))).toBe(true);
  const names = () => window.getByRole('group', { name: 'Projects' }).locator('[data-project]');
  await expect(names()).toHaveText(['Northwind', 'Coord']);

  // Rename: the name goes into its planning.json.
  await sidebarProject(window, 'Coord').click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Rename…' }).click();
  await window.getByRole('dialog', { name: 'Rename project' }).getByLabel('Name').fill('Coord platform');
  await window.getByRole('dialog', { name: 'Rename project' }).getByRole('button', { name: 'Rename' }).click();
  await expect(names()).toHaveText(['Northwind', 'Coord platform']);
  expect(JSON.parse(readFileSync(path.join(folder, 'planning.json'), 'utf8')).name).toBe('Coord platform');
  // Move up.
  await sidebarProject(window, 'Coord platform').click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Move Up' }).click();
  await expect(names()).toHaveText(['Coord platform', 'Northwind']);
  // Hidden and archived projects wait in a closed group at the bottom; there is no delete.
  await sidebarProject(window, 'Northwind').click({ button: 'right' });
  await expect(window.getByRole('menuitem', { name: /Delete/ })).toHaveCount(0);
  await window.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(names()).toHaveText(['Coord platform']);
  const group = window.locator('.project-group');
  await expect(group.locator('summary')).toHaveText(/Hidden and archived\s*1/);
  await expect(group.getByRole('button', { name: /Northwind/ })).toBeHidden();
  await group.locator('summary').click();
  await expect(group.getByRole('button', { name: /Northwind/ })).toContainText('Archived');
  await group.getByRole('button', { name: /Northwind/ }).click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(names()).toHaveText(['Coord platform', 'Northwind']);
  await expect(group).toHaveCount(0);
});

test('the title bar holds the menus, the computer and the actions', async () => {
  launched = await launchProject();
  const { window } = launched;
  const menubar = window.getByRole('menubar', { name: 'Application menu' });
  await expect(menubar.getByRole('menuitem')).toHaveText(['File', 'Edit', 'View', 'Help']);
  await expect(window.getByRole('button', { name: /^Computer:/ })).toBeVisible();
  const regions = await window.evaluate(() => {
    const region = (element: Element | null) => element ? getComputedStyle(element).getPropertyValue('-webkit-app-region') : null;
    return { bar: region(document.querySelector('.env-app-topbar')), search: region(document.querySelector('.search-button')) };
  });
  expect(regions).toEqual({ bar: 'drag', search: 'no-drag' });
  // File has New Project and no folder commands.
  await menubar.getByRole('menuitem', { name: 'File' }).click();
  await expect(window.getByRole('menuitem', { name: 'New Project…' })).toBeVisible();
  for (const gone of ['Open Folder…', 'Open Recent', 'Close Folder', 'Locate…']) await expect(window.getByRole('menuitem', { name: gone })).toHaveCount(0);
  await window.keyboard.press('Escape');
  const file = await launched.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find(entry => entry.label === '&File')!.submenu!.items.map(item => item.label).filter(Boolean));
  expect(file).toEqual(['New &Window', 'New &Project…', 'Co&nnect to Another Atlas…', 'Re&mote Access…', '&Import Plan…', '&Export Plan…', 'Close &Tab', 'Close &All Tabs', 'Close Win&dow', 'E&xit']);
  // Alt with a menu's letter opens it from the keyboard.
  await window.keyboard.press('Alt+V');
  await expect(window.getByRole('menu', { name: 'View' })).toBeVisible();
  await expect(window.getByRole('menuitem', { name: 'Show Files' })).toBeVisible();
  await window.keyboard.press('Escape');
  // Edit acts on the field that had focus before the menu opened.
  const search = window.getByLabel('Search work');
  await search.fill('fulfil');
  await search.selectText();
  await menubar.getByRole('menuitem', { name: 'Edit' }).click();
  await window.getByRole('menuitem', { name: 'Copy' }).click();
  await expect.poll(() => launched!.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('fulfil');
});

test('quick open finds work items, documents and diagrams across the computer\'s projects', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  addProject(home.dataDirectory, 'coord', 'Coord');
  launched = await launch({ dataDirectory: home.dataDirectory });
  const { window } = launched;
  await expect(sidebarProject(window, 'Coord')).toBeVisible();
  const palette = window.getByRole('dialog', { name: 'Quick open' });
  const input = palette.getByRole('combobox');
  await window.keyboard.press('Control+P');
  await input.fill('order fulfil');
  // Both projects' work items, each saying which project it is in.
  await expect(palette.getByRole('option', { name: /^Order fulfilment model/ })).toHaveCount(2);
  await expect(palette.getByRole('option', { name: /Order fulfilment model.*Coord/ })).toBeVisible();
  await palette.getByRole('option', { name: /Order fulfilment model.*Coord/ }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Order fulfilment model');
  await expect(activeTab(window)).toHaveAttribute('title', /· Coord$/);
  await window.keyboard.press('Control+P');
  await input.fill('reservation proposal');
  await expect(palette.getByRole('option').first()).toContainText('Inventory · reservation proposal');
  await input.press('Enter');
  await expect(window.locator('.model-picker-title')).toHaveText('Inventory · reservation proposal');
  await window.keyboard.press('Control+P');
  await input.fill('payments-cons');
  await expect(palette.getByRole('option').first()).toContainText('payments-constraints.md');
  await input.press('Escape');
  await expect(palette).toHaveCount(0);
});

test('the work list shows each version-2 ledger\'s progress and keeps version-1 status readable', async () => {
  launched = await launchProject();
  const { window } = launched;
  const payments = window.locator('.work-row', { hasText: 'Saved payment methods' });
  await expect(payments.locator('.work-row-steps')).toHaveText('2/7');
  await expect(payments.locator('.work-row-steps')).toHaveAttribute('title', '2 of 7 steps done · 5 left');
  await expect(payments.locator('.work-row-focus')).toHaveText(/^Add authoriseWithToken/);
  const notifications = window.locator('.work-row', { hasText: 'Customer order notifications' });
  await expect(notifications.locator('.work-row-steps')).toHaveCount(0);
  await expect(notifications.locator('.blocked-reason')).toContainText('Mailcourier');
});

test('a long plan scrolls below the tabs, each tab keeps its position, and the sidebar collapses and resizes', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  launched = await launch({ dataDirectory: home.dataDirectory });
  let { window } = launched;
  await openProject(window);
  await launched.app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(900, 480); });
  await window.locator('.work-row a', { hasText: 'Saved payment methods' }).click({ modifiers: ['Control'] });
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  const scrollTop = () => window.evaluate(() => document.querySelector('main')!.scrollTop);
  await window.locator('.work-main').hover();
  await window.mouse.wheel(0, 600);
  let position = -1;
  await expect.poll(async () => { const top = await scrollTop(); const steady = top > 0 && Math.abs(top - position) < 0.5; position = top; return steady; }, { intervals: [150] }).toBe(true);
  await expect(tabList(window)).toBeInViewport();
  expect(await window.evaluate(() => document.scrollingElement!.scrollHeight > document.scrollingElement!.clientHeight)).toBe(false);
  // The project page and back: each keeps its place.
  await tabs(window).filter({ hasText: 'Northwind' }).click();
  await expect(window.locator('.work-row').first()).toBeVisible();
  await tabs(window).filter({ hasText: 'Saved payment methods' }).click();
  await expect.poll(async () => Math.abs(await scrollTop() - position)).toBeLessThan(2);
  // Ctrl+B collapses the sidebar to its icons; its edge resizes it, and the width stays with the window.
  await window.mouse.move(800, 300);
  await window.keyboard.press('Control+B');
  await expect(window.getByRole('group', { name: 'Projects' }).getByText('Northwind')).toBeHidden();
  await window.keyboard.press('Control+B');
  await expect(sidebarProject(window)).toBeVisible();
  const divider = window.getByRole('separator', { name: /sidebar/i });
  await divider.focus();
  await window.keyboard.press('ArrowRight');
  await window.keyboard.press('ArrowRight');
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBe(312);
  await window.waitForTimeout(600);
  await close(launched);
  launched = await launch({ dataDirectory: home.dataDirectory });
  window = launched.window;
  await expect(window.getByRole('separator', { name: /sidebar/i })).toHaveAttribute('aria-valuenow', '312');
  await expect(tabs(window)).toHaveCount(2);
});
