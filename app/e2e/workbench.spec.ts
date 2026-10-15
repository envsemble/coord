import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  addProject, applicationMenu, chooseMenu, close, expectHub, expectProjects, goHome, hubRows, launch, launchProject, menuButton, openPlan, openProjects, pageScroll,
  projectAction, projectHome, projectRow, removeDirectory, showFiles, temporaryDirectory, type Launched,
} from './app';

let launched: Launched | undefined;
const homes: string[] = [];
test.afterEach(async () => { await close(launched); launched = undefined; for (const home of homes.splice(0)) removeDirectory(home); });

const row = (id: string) => `[role="treeitem"][data-id="${id}"]`;
/** The last step of a work item's trail: its number while the plan shows, Ledger while the ledger does. */
const trailEnd = (window: Page) => window.locator('.work-main .breadcrumb [aria-current="page"]');
/** A Git checkout with a remote, as a workspace folder holds them. */
function checkout(folder: string, remote: string) {
  mkdirSync(folder, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', folder, ...args], { stdio: 'ignore', windowsHide: true });
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', remote);
}
const titles = (launchedApp: Launched) => launchedApp.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(item => item.getTitle()));
const groupRows = (window: Page, group: string) => window.getByRole('region', { name: group }).locator('.hub-row');

test('a window opens on the hub: every plan of every active project, grouped by where it stands, each one click from its plan', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  addProject(home.dataDirectory, 'coord', 'Coord');
  launched = await launch({ dataDirectory: home.dataDirectory });
  const { window } = launched;
  await expectHub(window);
  await expect.poll(() => titles(launched!)).toEqual(['Atlas']);
  // No sidebar, project cards, project page or tabs.
  for (const gone of ['.env-app-sidebar', '.project-card', '.project-page', '[role="tablist"]']) await expect(window.locator(gone)).toHaveCount(0);
  // Blocked and being implemented first, then the drafts; each row says its project.
  await expect(window.locator('.hub-group-heading')).toHaveText([/^In progress\s*4$/, /^Drafts\s*2$/]);
  await expect(groupRows(window, 'In progress').locator('.status-icon').first()).toHaveAttribute('aria-label', 'Blocked');
  await expect(groupRows(window, 'Drafts')).toHaveText([/Order fulfilment model\s*#0002\s*(Northwind|Coord)/, /Order fulfilment model\s*#0002\s*(Northwind|Coord)/]);
  await expect(hubRows(window, 'Saved payment methods').locator('.hub-row-project')).toHaveText(['Northwind', 'Coord']);
  // One click on the row, away from its title, opens the plan; Back returns to the hub.
  const plan = hubRows(window, 'Customer order notifications').first();
  const number = (await plan.locator('.hub-row-number').boundingBox())!;
  await window.mouse.click(number.x + number.width / 2, number.y + number.height / 2);
  await expect(window.locator('.work-header h1')).toHaveText('Customer order notifications');
  await window.getByRole('button', { name: 'Back', exact: true }).click();
  await expectHub(window);
  // The logo leads back to the hub from anywhere.
  await openPlan(window, 'Order fulfilment model');
  await goHome(window);
  await expect(window.getByRole('button', { name: 'Back', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
});

test("the hub's search, project filter and state filter narrow its plans; the project filter is a place of its own", async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  addProject(home.dataDirectory, 'coord', 'Coord');
  launched = await launch({ dataDirectory: home.dataDirectory });
  const { window } = launched;
  await expect(hubRows(window)).toHaveCount(6);
  const search = window.getByRole('searchbox', { name: 'Search plans' });
  await search.fill('payment');
  await expect(hubRows(window)).toHaveCount(2);
  await search.fill('#0003 coord');
  await expect(hubRows(window)).toHaveCount(1);
  await expect(hubRows(window).locator('.hub-row-project')).toHaveText('Coord');
  await search.fill('nothing like this');
  await expect(window.getByRole('heading', { name: 'No plans match' })).toBeVisible();
  await search.fill('');
  // The project filter: All projects by default.
  const filter = window.getByRole('combobox', { name: 'Project' });
  await expect(filter).toHaveText(/All projects/);
  await filter.click();
  await window.getByRole('option', { name: 'Coord' }).click();
  await expectHub(window, 'Coord');
  await expect(hubRows(window)).toHaveCount(3);
  await expect(hubRows(window).locator('.hub-row-project')).toHaveText(['Coord', 'Coord', 'Coord']);
  // Back and forward set it.
  await window.getByRole('button', { name: 'Back', exact: true }).click();
  await expectHub(window);
  await expect(hubRows(window)).toHaveCount(6);
  await window.getByRole('button', { name: 'Forward', exact: true }).click();
  await expectHub(window, 'Coord');
  // Closed work only on request: open by default, closed, or all.
  const state = window.getByRole('radiogroup', { name: 'Plan state' });
  await state.getByRole('radio', { name: /^Closed/ }).click();
  await expect(hubRows(window, 'Saved payment methods')).toHaveCount(0);
  await expect(window.locator('.hub-group-heading')).toHaveText([/^Closed\s*1$/]);
  await expect(window.getByRole('region', { name: 'Closed' }).locator('.hub-row .status-icon')).toHaveAttribute('aria-label', 'Complete');
  await expect(window.getByRole('region', { name: 'Closed' }).locator('.hub-row')).toContainText('Inventory reservations');
  await state.getByRole('radio', { name: /^All/ }).click();
  await expect(hubRows(window, 'Saved payment methods')).toHaveCount(1);
  // The search and state filter stay while the window shows something else.
  await openPlan(window, 'Saved payment methods');
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(state.getByRole('radio', { name: /^All/ })).toHaveAttribute('aria-checked', 'true');
});

test("a plan opens from the hub with its summary, its side column and its ledger in the plan's place; its project leads to the project's plans", async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  const work = path.join(home.folder, 'active/0001-saved-payment-methods');
  const summary = 'Customers save a card at checkout and pay with it next time. The gateway work is under way.';
  writeFileSync(path.join(work, 'plan.md'), readFileSync(path.join(work, 'plan.md'), 'utf8').replace('title: Saved payment methods\n', 'title: Saved payment methods\nsummary: "' + summary + '"\n'));
  // The first two steps settled the design.
  let planning = 0;
  writeFileSync(path.join(work, 'ledger.md'), readFileSync(path.join(work, 'ledger.md'), 'utf8').replace(/    status: done\n/g, match => planning++ < 2 ? match + '    phase: planning\n' : match));
  launched = await launchProject(home);
  const { window } = launched;
  // The hub shows the summary on one line, and the steps done with the planning ones in their colour.
  const row = hubRows(window, 'Saved payment methods');
  await expect(row.locator('.hub-row-summary')).toHaveText(summary);
  await expect(row.locator('.hub-row-steps')).toHaveText('2/7');
  await expect(row.locator('.step-bar-planning-done')).toHaveCount(1);
  await openPlan(window, 'Saved payment methods');
  await expect(window.locator('.work-header .work-summary')).toHaveText(summary);
  await expect(window.locator('.reader .prose')).toContainText('Current checkout');
  // One list of steps: the planning steps in a colour of their own, and named so.
  const steps = window.locator('.about .ledger-step');
  await expect(steps.nth(0).locator('.step-icon')).toHaveAttribute('aria-label', 'Planning step, done');
  await expect(steps.nth(0)).toHaveAttribute('title', /^Planning step: .+, done$/);
  await expect(steps.nth(2).locator('.step-icon')).toHaveAttribute('aria-label', 'In progress');
  await expect(window.locator('.about .ledger-phase-heading')).toHaveCount(0);
  const colour = (index: number) => steps.nth(index).locator('.step-icon').evaluate(element => getComputedStyle(element).color);
  expect(await colour(0)).not.toBe(await colour(2));
  await expect(window.locator('.about .step-bar-planning-done')).toHaveCount(1);
  // The side column keeps progress, dates and statistics, with the link to the ledger under the progress steps.
  await expect(window.locator('.about .ledger-progress-summary')).toHaveText('2 of 7 steps done · 5 left');
  await expect(window.locator('.about .ledger-step')).toHaveCount(7);
  const progress = window.locator('.about .about-section', { has: window.locator('.ledger-step') });
  const ledgerLink = progress.getByRole('link', { name: 'Ledger' });
  await expect(ledgerLink).toBeVisible();
  expect(await progress.locator('.ledger-step').last().evaluate((step, link) => Boolean(step.compareDocumentPosition(link!) & Node.DOCUMENT_POSITION_FOLLOWING), await ledgerLink.elementHandle())).toBe(true);
  await expect(trailEnd(window)).toHaveText('#0001');
  // Export Plan is on the page.
  await expect(window.locator('.work-header').getByRole('button', { name: 'Export Plan…' })).toBeVisible();
  // Ledger shows the ledger in the plan's place, and Plan takes its link's place.
  await ledgerLink.click();
  await expect(trailEnd(window)).toHaveText('Ledger');
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect(window.locator('.reader .prose h1')).toHaveText('Saved payment methods: ledger');
  await expect(progress.getByRole('link', { name: 'Ledger' })).toHaveCount(0);
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(trailEnd(window)).toHaveText('#0001');
  await window.keyboard.press('Alt+ArrowRight');
  await expect(trailEnd(window)).toHaveText('Ledger');
  await window.locator('.about').getByRole('link', { name: 'Plan' }).click();
  await expect(trailEnd(window)).toHaveText('#0001');
  // A diagram opens from its card in the plan; Back returns to the plan.
  await window.locator('.diagram-card').first().getByRole('button', { name: 'Open diagram' }).click();
  await expect(window.locator('.diagrams .atlas-panel').first()).toBeVisible();
  await expect(window.locator('.diagrams .island-start .model-picker-button')).toBeVisible();
  await window.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  // The trail's project leads to the hub filtered to the project, which Back leaves again.
  await window.locator('.work-main .breadcrumb').getByRole('button', { name: 'Northwind' }).click();
  await expectHub(window, 'Northwind');
  await expect(window.getByRole('combobox', { name: 'Project' })).toHaveText(/Northwind/);
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
});

test('a plan shows its request folded, its heading one press from opening it', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  const plan = path.join(home.folder, 'active/0002-order-fulfilment-model/plan.md');
  writeFileSync(plan, readFileSync(plan, 'utf8').replace('## Problem', '## Request (Jacob, 2026-09-07)\n\n> Model how an order is fulfilled before we build it.\n\n### Later\n\nAnd split shipments too.\n\n## Problem\n\nAs [asked later](#later).'));
  launched = await launchProject(home);
  const { window } = launched;
  await openPlan(window, 'Order fulfilment model');
  const toggle = window.locator('.prose').getByRole('button', { name: 'Request (Jacob, 2026-09-07)' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(window.locator('.prose').getByText('Model how an order is fulfilled')).toBeHidden();
  await expect(window.locator('.prose').getByText('And split shipments too.')).toBeHidden();
  // Everything else shows as before.
  await expect(window.locator('.prose h2', { hasText: 'Problem' })).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(window.locator('.prose').getByText('Model how an order is fulfilled')).toBeVisible();
  await expect(window.locator('.prose').getByText('And split shipments too.')).toBeVisible();
  // It stays open while the plan changes on disk.
  writeFileSync(plan, readFileSync(plan, 'utf8') + '\n## Added meanwhile\n\nA new section.\n');
  await expect(window.locator('.prose h2', { hasText: 'Added meanwhile' })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(window.locator('.prose').getByText('And split shipments too.')).toBeVisible();
  await toggle.click();
  await expect(window.locator('.prose').getByText('Model how an order is fulfilled')).toBeHidden();
  // A link to a heading inside the folded request opens it there.
  await window.locator('.prose').getByRole('link', { name: 'asked later' }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(window.locator('.prose').getByText('And split shipments too.')).toBeInViewport();
});

test('a window shows one place at a time, and shows it again at the next start', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  addProject(home.dataDirectory, 'coord', 'Coord');
  launched = await launch({ dataDirectory: home.dataDirectory });
  let { window } = launched;
  await window.getByRole('searchbox', { name: 'Search plans' }).fill('coord payment');
  await openPlan(window, 'Saved payment methods');
  await expect(window.locator('.work-main .breadcrumb')).toContainText('Coord');
  await window.locator('.about').getByRole('link', { name: 'Ledger' }).click();
  await expect(trailEnd(window)).toHaveText('Ledger');
  await window.waitForTimeout(600);
  await close(launched);

  launched = await launch({ dataDirectory: home.dataDirectory });
  window = launched.window;
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect(window.locator('.work-main .breadcrumb')).toContainText('Coord');
  await expect(trailEnd(window)).toHaveText('Ledger');
  // The hub filtered to a project comes back too.
  await window.locator('.work-main .breadcrumb').getByRole('button', { name: 'Coord' }).click();
  await expectHub(window, 'Coord');
  await window.waitForTimeout(600);
  await close(launched);
  launched = await launch({ dataDirectory: home.dataDirectory });
  await expectHub(launched.window, 'Coord');
});

test('a window from before the hub opens on its active tab', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  // A window that had the project's page, a plan (active) and a file open in tabs.
  launched = await launch({ dataDirectory: home.dataDirectory });
  await expectHub(launched.window);
  await close(launched);
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(path.join(home.dataDirectory, 'atlas.db'));
  const project = Number((database.prepare('SELECT id FROM project').get() as { id: number }).id);
  const window = Number((database.prepare('SELECT id FROM "window"').get() as { id: number }).id);
  const insert = database.prepare('INSERT INTO tab (window_id, project_id, position, kind, target, active) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run(window, project, 0, 'project', null, 0);
  insert.run(window, project, 1, 'work', '{"work":"work-0003","anchor":null}', 1);
  insert.run(window, project, 2, 'file', '{"path":"README.md"}', 0);
  database.close();
  launched = await launch({ dataDirectory: home.dataDirectory });
  await expect(launched.window.locator('.work-header h1')).toHaveText('Customer order notifications');
});

test("the file panel slides in from the right with the open plan's project, and is not offered on the hub", async () => {
  launched = await launchProject();
  const { window } = launched;
  await expect(window.getByRole('button', { name: 'Files', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await window.keyboard.press('Control+Shift+E');
  await expect(window.getByRole('region', { name: 'Files' })).toHaveCount(0);
  await openPlan(window, 'Customer order notifications');
  const panel = await showFiles(window);
  await expect(panel).toContainText('Northwind');
  const box = (await panel.boundingBox())!;
  const page = (await window.locator('.workbench-page').boundingBox())!;
  expect(box.x + box.width).toBeGreaterThan(page.x + page.width - 40);
  await expect(panel.locator('[role="treeitem"]', { hasText: '.atlas' })).toHaveCount(0);
  // The open plan's folder is revealed.
  const work = panel.locator(row('d:active/0001-saved-payment-methods'));
  await expect(work).toContainText('Saved payment methods');
  await expect(work.locator('.status-icon')).toHaveAttribute('aria-label', 'In progress');
  // A work folder expands and opens its plan; a diagram file opens as a diagram, any other file as a file.
  await work.click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await panel.locator(row('d:active/0001-saved-payment-methods/diagrams')).click();
  await panel.locator(row('f:active/0001-saved-payment-methods/diagrams/checkout-proposal.puml')).click();
  await expect(window.locator('.model-picker-title')).toHaveText('Checkout · proposed payment methods');
  await panel.locator(row('f:active/0001-saved-payment-methods/CONTEXT.md')).click();
  await expect(window.locator('.reader-name')).toContainText('CONTEXT.md');
  // Ctrl+Shift+E hides it again; the hub has none.
  await window.keyboard.press('Control+Shift+E');
  await expect(window.getByRole('region', { name: 'Files' })).toHaveCount(0);
  await window.keyboard.press('Control+Shift+E');
  await expect(window.getByRole('region', { name: 'Files' })).toBeVisible();
  await goHome(window);
  await expect(window.getByRole('region', { name: 'Files' })).toHaveCount(0);
});

test('the Projects page makes a project from a name and a folder, and renames, hides, archives and restores projects', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  const workspace = temporaryDirectory('atlas-e2e-workspace-');
  homes.push(workspace);
  checkout(path.join(workspace, 'coord-shop'), 'git@github.com:example/coord-shop.git');
  launched = await launch({ dataDirectory: home.dataDirectory });
  const { window } = launched;
  await openProjects(window);
  await expectProjects(window, ['Northwind']);
  await expect(projectRow(window)).toContainText(home.folder);
  await expect(projectRow(window).locator('.project-facts')).toContainText('shop');
  await window.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = window.getByRole('dialog', { name: 'New project' });
  await expect(dialog.getByRole('button', { name: 'Browse…' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled();
  // Typed with no name yet, the folder names the project, until a name is typed.
  await dialog.getByLabel('Folder').pressSequentially(workspace, { delay: 5 });
  await expect(dialog.getByLabel('Name')).toHaveValue(path.basename(workspace));
  await dialog.getByLabel('Name').fill('Coord');
  await dialog.getByLabel('Folder').fill(workspace + path.sep);
  await expect(dialog.getByLabel('Name')).toHaveValue('Coord');
  await dialog.getByLabel('Folder').fill(workspace);
  // The repositories found in the folder, before creating.
  const found = dialog.locator('.scan-result');
  await expect(found).toContainText('coord-shop');
  await expect(found).toContainText('git@github.com:example/coord-shop.git');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toHaveCount(0);
  const folder = path.join(home.dataDirectory, 'planning', 'coord');
  const registry = JSON.parse(readFileSync(path.join(folder, 'planning.json'), 'utf8'));
  expect([registry.name, registry.workspaces, registry.repositories.map((item: { remote: string }) => item.remote)]).toEqual(['Coord', [workspace], ['git@github.com:example/coord-shop.git']]);
  await expect(projectRow(window, 'Coord').locator('.project-folders')).toContainText(workspace);
  expect(existsSync(path.join(folder, '.git')) && existsSync(path.join(folder, 'AGENTS.md'))).toBe(true);
  await expectProjects(window, ['Northwind', 'Coord']);
  // Rename: the name goes into its planning.json.
  await projectAction(window, 'Coord', 'Rename…');
  await window.getByRole('dialog', { name: 'Rename project' }).getByLabel('Name').fill('Coord platform');
  await window.getByRole('dialog', { name: 'Rename project' }).getByRole('button', { name: 'Rename' }).click();
  await expectProjects(window, ['Northwind', 'Coord platform']);
  expect(JSON.parse(readFileSync(path.join(folder, 'planning.json'), 'utf8')).name).toBe('Coord platform');
  // Hidden and archived projects stay on the page, after the others; there is no delete.
  await window.getByRole('button', { name: 'Actions for Northwind', exact: true }).click();
  await expect(window.getByRole('menuitem', { name: /Delete/ })).toHaveCount(0);
  await window.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await expectProjects(window, ['Coord platform']);
  await expectProjects(window, ['Northwind'], 'Hidden and archived projects');
  await expect(projectRow(window, 'Northwind', 'Hidden and archived projects')).toContainText('Archived');
  // Its plans leave the hub.
  await goHome(window);
  await expect(hubRows(window, 'Saved payment methods')).toHaveCount(0);
  await openProjects(window);
  await projectAction(window, 'Northwind', 'Restore');
  await expectProjects(window, ['Northwind', 'Coord platform']);
  await projectAction(window, 'Coord platform', 'Hide');
  await expect(projectRow(window, 'Coord platform', 'Hidden and archived projects')).toContainText('Hidden');
  await projectAction(window, 'Coord platform', 'Show');
  await expectProjects(window, ['Northwind', 'Coord platform']);
  // A project's name leads to its plans; the window opens there next time, and on the hub once it
  // has gone back to the hub, a project made since the window opened included.
  await projectRow(window, 'Coord platform').getByRole('button', { name: 'Coord platform', exact: true }).click();
  await expectHub(window, 'Coord platform');
  await goHome(window);
  await window.waitForTimeout(600);
  await close(launched);
  launched = await launch({ dataDirectory: home.dataDirectory });
  await expectHub(launched.window);
});

test('a project gets and loses workspace folders on the Projects page', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  const workspace = temporaryDirectory('atlas-e2e-workspace-');
  homes.push(workspace);
  const other = temporaryDirectory('atlas-e2e-workspace-');
  homes.push(other);
  launched = await launch({ dataDirectory: home.dataDirectory });
  const { window } = launched;
  await openProjects(window);
  const registry = () => JSON.parse(readFileSync(path.join(home.folder, 'planning.json'), 'utf8')).workspaces ?? [];
  const add = async (folder: string) => {
    await projectRow(window).getByRole('button', { name: 'Add folder…' }).click();
    const dialog = window.getByRole('dialog', { name: 'Add a folder to Northwind' });
    await expect(dialog.getByRole('button', { name: 'Browse…' })).toBeVisible();
    await dialog.getByLabel('Folder').fill(folder);
    await dialog.getByRole('button', { name: 'Add' }).click();
    await expect(dialog).toHaveCount(0);
  };
  await expect(projectRow(window)).toContainText('None: agents find the project by its repositories');
  await add(workspace);
  await add(other);
  await expect(projectRow(window).locator('.project-folders li')).toHaveText([workspace, other]);
  expect(registry()).toEqual([workspace, other]);
  // Removing one waits for the change before the next.
  await projectRow(window).getByRole('button', { name: 'Remove ' + workspace }).click();
  await expect(projectRow(window).locator('.project-folders li')).toHaveText([other]);
  expect(registry()).toEqual([other]);
  await projectRow(window).getByRole('button', { name: 'Remove ' + other }).click();
  await expect(projectRow(window).locator('.project-folders')).toHaveCount(0);
  expect(registry()).toEqual([]);
  // A folder by a relative path is refused.
  await projectRow(window).getByRole('button', { name: 'Add folder…' }).click();
  const dialog = window.getByRole('dialog', { name: 'Add a folder to Northwind' });
  await dialog.getByLabel('Folder').fill('relative/folder');
  await expect(dialog).toContainText('Type the folder’s full path.');
  await expect(dialog.getByRole('button', { name: 'Add' })).toBeDisabled();
});

test('the title bar holds the logo, back and forward, one menu, the computer, search, Files, record health and the theme', async () => {
  launched = await launchProject();
  const { window, app } = launched;
  const bar = window.locator('.env-title-bar');
  await expect(window.getByRole('menubar')).toHaveCount(0);
  const left = async (name: string) => (await bar.getByRole('button', { name, exact: true }).boundingBox())!.x;
  const order = [await left('All plans'), await left('Back'), await left('Forward'), await left('Menu'), await left('Search'), await left('Files'), await left('Theme')];
  expect(order).toEqual([...order].sort((a, b) => a - b));
  await expect(bar.getByRole('button', { name: /^Computer:/ })).toBeVisible();
  const regions = await window.evaluate(() => {
    const region = (element: Element | null) => element ? getComputedStyle(element).getPropertyValue('-webkit-app-region') : null;
    return { bar: region(document.querySelector('.env-title-bar')), search: region(document.querySelector('.search-button')) };
  });
  expect(regions).toEqual({ bar: 'drag', search: 'no-drag' });
  // The one menu.
  await menuButton(window).click();
  const menu = window.getByRole('menu', { name: 'Menu' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    /^New Window\s*Ctrl\s*\+?\s*Shift\s*\+?\s*N$/, 'Projects', 'Statistics', 'Import Plan…', 'Connect to Another Atlas…', 'Remote Access…',
    /^Zoom In/, /^Zoom Out/, /^Actual Size/, /^Full Screen\s*F11$/, 'Open Logs', 'About Atlas', 'Exit',
  ]);
  for (const gone of ['Export Plan…', 'Close Tab', 'Close All Tabs', 'New Project…', 'Show Sidebar', 'Hide Sidebar']) await expect(menu.getByRole('menuitem', { name: gone })).toHaveCount(0);
  await window.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await chooseMenu(window, 'About Atlas');
  await expect(window.getByRole('dialog', { name: 'Atlas' })).toBeVisible();
  await window.keyboard.press('Escape');
  // Main's application menu keeps the shortcuts (and is the menu bar on macOS).
  const items = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map(entry => [entry.label, entry.submenu!.items.filter(item => item.type !== 'separator').map(item => item.accelerator ? item.label + ' ' + item.accelerator : item.label || item.role)]));
  expect(items).toEqual([
    ['&File', ['New &Window CmdOrCtrl+Shift+N', '&Projects', '&Statistics', '&Import Plan…', 'Co&nnect to Another Atlas…', 'Re&mote Access…', 'Close Win&dow CmdOrCtrl+Shift+W', 'E&xit']],
    ['&Edit', ['Undo CommandOrControl+Z', 'Redo Control+Y', 'Cut CommandOrControl+X', 'Copy CommandOrControl+C', 'Paste CommandOrControl+V', 'Select All CommandOrControl+A']],
    ['&View', ['&Back Alt+Left', '&Forward Alt+Right', '&Search… CmdOrCtrl+P', 'F&iles CmdOrCtrl+Shift+E', 'Zoom &In CmdOrCtrl+Plus', 'Zoom &Out CmdOrCtrl+-', '&Actual Size CmdOrCtrl+0', 'Toggle Full Screen F11']],
    ['&Help', ['Open &Logs', '&About Atlas']],
  ]);
  // The shortcuts: search, Files on a plan, back and forward.
  await window.keyboard.press('Control+P');
  await expect(window.getByRole('dialog', { name: 'Quick open' })).toBeVisible();
  await window.keyboard.press('Escape');
  await openPlan(window, 'Saved payment methods');
  await window.keyboard.press('Control+Shift+E');
  await expect(window.getByRole('region', { name: 'Files' })).toBeVisible();
  await window.keyboard.press('Control+Shift+E');
  await window.keyboard.press('Alt+ArrowLeft');
  await expectHub(window);
  // Edit's keys act on the focused field.
  const search = window.getByRole('searchbox', { name: 'Search plans' });
  await search.fill('fulfil');
  await search.selectText();
  await window.keyboard.press('Control+C');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('fulfil');
  // Projects and Statistics come from the application menu too.
  await applicationMenu(app, '&File', '&Projects');
  await expect(window.locator('.projects-page h1')).toHaveText('Projects');
  await applicationMenu(app, '&File', '&Statistics');
  await expect(window.locator('.statistics-page h1')).toHaveText('Statistics');
});

test("quick open finds the plans of every active project, and the documents and diagrams of the open plan's project", async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  addProject(home.dataDirectory, 'coord', 'Coord');
  launched = await launch({ dataDirectory: home.dataDirectory });
  const { window } = launched;
  await expect(hubRows(window).first()).toBeVisible();
  const palette = window.getByRole('dialog', { name: 'Quick open' });
  const input = palette.getByRole('combobox');
  await window.keyboard.press('Control+P');
  await input.fill('order fulfil');
  // Both projects' plans, each saying which project it is in; no documents from the hub.
  await expect(palette.getByRole('option', { name: /^Order fulfilment model/ })).toHaveCount(2);
  await input.fill('payments-cons');
  await expect(palette.getByRole('option')).toHaveCount(0);
  await input.fill('order fulfil coord');
  await palette.getByRole('option', { name: /Order fulfilment model.*Coord/ }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Order fulfilment model');
  await expect(window.locator('.work-main .breadcrumb')).toContainText('Coord');
  // On a plan, the documents and diagrams of its project are found too.
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

test('a long plan scrolls below the title bar, and each place keeps its position', async () => {
  launched = await launchProject();
  const { window, app } = launched;
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(900, 480); });
  await openPlan(window, 'Saved payment methods');
  await window.locator('.work-main').hover();
  await window.mouse.wheel(0, 600);
  let position = -1;
  await expect.poll(async () => { const top = await pageScroll(window); const steady = top > 0 && Math.abs(top - position) < 0.5; position = top; return steady; }, { intervals: [150] }).toBe(true);
  await expect(window.locator('.env-title-bar')).toBeInViewport();
  expect(await window.evaluate(() => document.scrollingElement!.scrollHeight > document.scrollingElement!.clientHeight)).toBe(false);
  // The hub and back: the plan is where it was left.
  await window.keyboard.press('Alt+ArrowLeft');
  await expectHub(window);
  await window.keyboard.press('Alt+ArrowRight');
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect.poll(async () => Math.abs(await pageScroll(window) - position)).toBeLessThan(2);
});

test('the side column of a plan stays still while the page scrolls, and scrolls on its own when it is taller than the window', async () => {
  launched = await launchProject();
  const { window, app } = launched;
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setContentSize(1400, 460); });
  await openPlan(window, 'Saved payment methods');
  const about = window.locator('.about');
  await expect.poll(() => about.evaluate(element => element.scrollHeight > element.clientHeight + 50)).toBe(true);
  const top = async () => (await about.boundingBox())!.y;
  await window.mouse.move(5, 300);
  const resting = await top();
  // Its scrollbar shows only while the pointer is over it.
  expect(await about.evaluate(element => getComputedStyle(element).scrollbarColor)).toMatch(/^(transparent|rgba\(0, 0, 0, 0\)) (transparent|rgba\(0, 0, 0, 0\))$/);
  await about.hover();
  await expect.poll(() => about.evaluate(element => getComputedStyle(element).scrollbarColor)).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\)) /);
  // A wheel over the plan scrolls the page; the column does not move.
  await window.locator('.work-main').hover();
  await window.mouse.wheel(0, 600);
  await expect.poll(() => pageScroll(window)).toBeGreaterThan(300);
  expect(Math.abs(await top() - resting)).toBeLessThan(1);
  await expect(about).toBeInViewport();
  const page = await pageScroll(window);
  // A wheel over the column scrolls only the column, and past its end the page stays where it is.
  await about.hover();
  await window.mouse.wheel(0, 200);
  await expect.poll(() => about.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  for (let index = 0; index < 8; index++) await window.mouse.wheel(0, 600);
  await expect.poll(() => about.evaluate(element => Math.abs(element.scrollTop + element.clientHeight - element.scrollHeight) < 2)).toBe(true);
  await window.waitForTimeout(400);
  expect(await pageScroll(window)).toBe(page);
  expect(Math.abs(await top() - resting)).toBeLessThan(1);
});
