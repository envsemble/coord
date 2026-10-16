import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  addProject, applicationMenu, chooseMenu, close, expectHub, expectProjects, fileMenu, filterHub, goHome, hubRows, launch, launchProject, openPlan, openProjects, pageScroll,
  listedProjects, projectAction, projectHome, projectRow, removeDirectory, searchPopup, section, showFiles, temporaryDirectory, type Launched,
} from './app';

let launched: Launched | undefined;
const homes: string[] = [];
test.afterEach(async () => { await close(launched); launched = undefined; for (const home of homes.splice(0)) removeDirectory(home); });

const row = (id: string) => `[role="treeitem"][data-id="${id}"]`;
/** The last step of a work item's trail: its number. */
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
  // Blocked and being implemented first, then the drafts; each row says its project.
  await expect(window.locator('.hub-group-heading')).toHaveText([/^In progress\s*4$/, /^Drafts\s*2$/]);
  await expect(groupRows(window, 'In progress').locator('.status-icon').first()).toHaveAttribute('aria-label', 'Blocked');
  await expect(groupRows(window, 'Drafts')).toHaveText([/Order fulfilment model\s*#0002\s*(Northwind|Coord)/, /Order fulfilment model\s*#0002\s*(Northwind|Coord)/]);
  await expect(hubRows(window, 'Saved payment methods').locator('.hub-row-project')).toHaveText(['Northwind', 'Coord']);
  // One click on the row, away from its title, opens the plan; Back returns to the hub.
  const plan = hubRows(window, 'Customer order notifications').first();
  await expect(plan.getByRole('link')).toHaveAttribute('draggable', 'false');
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

test("the hub's search field opens the search with what is typed and never filters the hub; the project and state filters narrow its plans; on a plan the search finds its project's documents", async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  addProject(home.dataDirectory, 'coord', 'Coord');
  launched = await launch({ dataDirectory: home.dataDirectory });
  const { window } = launched;
  await expect(hubRows(window)).toHaveCount(6);
  // The title bar has no search of its own on the hub: the hub's field is the search.
  await expect(window.locator('.env-title-bar').getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
  const field = window.getByRole('searchbox', { name: 'Search' });
  const popup = searchPopup(window);
  const input = popup.getByRole('combobox');
  // A click opens the search; what is typed goes there, and the hub's list stays as it is.
  await field.click();
  await expect(popup).toBeVisible();
  await window.keyboard.type('payment');
  await expect(input).toHaveValue('payment');
  await expect(popup.getByRole('option', { name: /^Saved payment methods/ })).toHaveCount(2);
  await expect(hubRows(window)).toHaveCount(6);
  await window.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  // Focus back in the field does not open it again; typing there does, carrying what was typed over.
  await expect(field).toBeFocused();
  await window.waitForTimeout(600);
  await expect(popup).toHaveCount(0);
  await expect(field).toHaveValue('');
  // Nor does the window going to the background and coming back, which focuses the field again.
  await field.evaluate(element => {
    globalThis.dispatchEvent(new Event('blur'));
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    globalThis.dispatchEvent(new Event('focus'));
    element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  });
  await window.waitForTimeout(400);
  await expect(popup).toHaveCount(0);
  // Moving away from the field and back into it does.
  await window.keyboard.press('Tab');
  await expect(field).not.toBeFocused();
  await window.keyboard.press('Shift+Tab');
  await expect(popup).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(field).toBeFocused();
  await window.keyboard.type('fulfil coord');
  await expect(input).toHaveValue('fulfil coord');
  await expect(hubRows(window)).toHaveCount(6);
  await popup.getByRole('option', { name: /Order fulfilment model.*Coord/ }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Order fulfilment model');
  await expect(window.locator('.work-main .breadcrumb')).toContainText('Coord');
  // Focusing the field from the keyboard opens it too.
  await goHome(window);
  await window.getByRole('searchbox', { name: 'Search' }).focus();
  await expect(popup).toBeVisible();
  await expect(input).toHaveValue('');
  // From the hub it finds plans, not documents.
  await input.fill('payments-cons');
  await expect(popup.getByRole('option')).toHaveCount(0);
  await window.keyboard.press('Escape');
  await expect(hubRows(window)).toHaveCount(6);
  // The project filter: All projects by default.
  const filter = window.getByRole('combobox', { name: 'Project' });
  await expect(filter).toHaveText(/All projects/);
  await filterHub(window, 'Coord');
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
  // The state filter stays while the window shows something else.
  await openPlan(window, 'Saved payment methods');
  // On a plan, the title bar's search finds the documents of its project too.
  await window.locator('.env-title-bar').getByRole('button', { name: 'Search', exact: true }).click();
  await input.fill('payments-cons');
  await expect(popup.getByRole('option').first()).toContainText('payments-constraints.md');
  await expect(popup.getByRole('group', { name: 'Documents' })).toBeVisible();
  await input.press('Escape');
  await window.keyboard.press('Alt+ArrowLeft');
  await expect(state.getByRole('radio', { name: /^All/ })).toHaveAttribute('aria-checked', 'true');
});

test("a plan opens from the hub with its summary and its side column, and with its request folded; its project leads to the project's plans", async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  const work = path.join(home.folder, 'active/0001-saved-payment-methods');
  const summary = 'Customers save a card at checkout and pay with it next time. The gateway work is under way.';
  writeFileSync(path.join(work, 'plan.md'), readFileSync(path.join(work, 'plan.md'), 'utf8').replace('title: Saved payment methods\n', 'title: Saved payment methods\nsummary: "' + summary + '"\n'));
  // The first two steps settled the design.
  let planning = 0;
  writeFileSync(path.join(work, 'ledger.md'), readFileSync(path.join(work, 'ledger.md'), 'utf8').replace(/    status: done\n/g, match => planning++ < 2 ? match + '    phase: planning\n' : match));
  const plan = path.join(home.folder, 'active/0002-order-fulfilment-model/plan.md');
  writeFileSync(plan, readFileSync(plan, 'utf8').replace('## Problem', '## Request (Jacob, 2026-09-07)\n\n> Model how an order is fulfilled before we build it.\n\n### Later\n\nAnd split shipments too.\n\n## Problem\n\nAs [asked later](#later).'));
  launched = await launchProject(home);
  const { window } = launched;
  // The hub shows the summary on the title's hover, and the steps done with the planning ones in their colour.
  const row = hubRows(window, 'Saved payment methods');
  await expect(row.getByRole('link')).toHaveAttribute('title', summary);
  await expect(row.locator('.hub-row-steps')).toHaveText('2 of 7');
  await expect(row.locator('.step-bar-planning-done')).toHaveCount(1);
  await openPlan(window, 'Saved payment methods');
  await expect(window.locator('.work-header .work-summary')).toHaveText(summary);
  await expect(window.locator('.reader .prose')).toContainText('Current checkout');
  // One list of steps: the planning steps in a colour of their own, and named so.
  const steps = window.locator('.about .ledger-step');
  await expect(steps.nth(0).locator('.step-icon')).toHaveAttribute('aria-label', 'Planning step, done');
  await expect(steps.nth(0)).toHaveAttribute('title', /^Planning step: .+, done$/);
  await expect(steps.nth(2).locator('.step-icon')).toHaveAttribute('aria-label', 'In progress');
  const colour = (index: number) => steps.nth(index).locator('.step-icon').evaluate(element => getComputedStyle(element).color);
  expect(await colour(0)).not.toBe(await colour(2));
  await expect(window.locator('.about .step-bar-planning-done')).toHaveCount(1);
  // The side column keeps progress, dates and statistics.
  await expect(window.locator('.about .ledger-progress-summary')).toHaveText('2 of 7 steps done · 5 left');
  await expect(window.locator('.about .ledger-step')).toHaveCount(7);
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

  // A plan's request shows folded, its heading one press from opening it.
  await goHome(window);
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
  await filterHub(window, 'Coord');
  await openPlan(window, 'Saved payment methods');
  await expect(window.locator('.work-main .breadcrumb')).toContainText('Coord');
  await window.waitForTimeout(600);
  await close(launched);

  launched = await launch({ dataDirectory: home.dataDirectory });
  window = launched.window;
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect(window.locator('.work-main .breadcrumb')).toContainText('Coord');
  await expect(trailEnd(window)).toHaveText('#0001');
});

test("the file panel shows the open plan's project, and is not offered on the hub", async () => {
  launched = await launchProject();
  const { window } = launched;
  await expect(window.getByRole('button', { name: 'Files', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await window.keyboard.press('Control+Shift+E');
  await expect(window.getByRole('region', { name: 'Files' })).toHaveCount(0);
  await openPlan(window, 'Customer order notifications');
  const panel = await showFiles(window);
  await expect(panel).toContainText('Northwind');
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

test('the Projects page makes a project from a name and a folder, gives a project workspace folders and takes them away, and renames, hides, archives and restores projects', async () => {
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
  // Workspace folders, added and removed on the project's row: each change goes into its planning.json.
  const workspaces = () => JSON.parse(readFileSync(path.join(home.folder, 'planning.json'), 'utf8')).workspaces ?? [];
  const [first, second] = [temporaryDirectory('atlas-e2e-workspace-'), temporaryDirectory('atlas-e2e-workspace-')];
  homes.push(first, second);
  const addFolder = window.getByRole('dialog', { name: 'Add a folder to Northwind' });
  const add = async (added: string) => {
    await projectRow(window).getByRole('button', { name: 'Add folder…' }).click();
    await expect(addFolder.getByRole('button', { name: 'Browse…' })).toBeVisible();
    await addFolder.getByLabel('Folder').fill(added);
    await addFolder.getByRole('button', { name: 'Add' }).click();
    await expect(addFolder).toHaveCount(0);
  };
  await expect(projectRow(window)).toContainText('None: agents find the project by its repositories');
  await add(first);
  await add(second);
  await expect(projectRow(window).locator('.project-folders li')).toHaveText([first, second]);
  expect(workspaces()).toEqual([first, second]);
  // Removing one waits for the change before the next.
  await projectRow(window).getByRole('button', { name: 'Remove ' + first }).click();
  await expect(projectRow(window).locator('.project-folders li')).toHaveText([second]);
  expect(workspaces()).toEqual([second]);
  await projectRow(window).getByRole('button', { name: 'Remove ' + second }).click();
  await expect(projectRow(window).locator('.project-folders')).toHaveCount(0);
  expect(workspaces()).toEqual([]);
  // A folder by a relative path is refused.
  await projectRow(window).getByRole('button', { name: 'Add folder…' }).click();
  await addFolder.getByLabel('Folder').fill('relative/folder');
  await expect(addFolder).toContainText('Type the folder’s full path.');
  await expect(addFolder.getByRole('button', { name: 'Add' })).toBeDisabled();
  await window.keyboard.press('Escape');
  await expect(addFolder).toHaveCount(0);
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

test('two rows at the top: the logo, back and forward, File, the computer, search, Files, record health and the theme; below them the sections with their counts', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  addProject(home.dataDirectory, 'coord', 'Coord');
  launched = await launch({ dataDirectory: home.dataDirectory });
  const { window, app } = launched;
  await expect(hubRows(window)).toHaveCount(6);
  const bar = window.locator('.env-title-bar');
  // File is the one menu.
  await expect(bar.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem')).toHaveText(['File']);
  await openPlan(window, 'Customer order notifications');
  const left = async (name: string, role: 'button' | 'menuitem' = 'button') => (await bar.getByRole(role, { name, exact: true }).boundingBox())!.x;
  const order = [await left('All plans'), await left('Back'), await left('Forward'), await left('File', 'menuitem'), await left('Search'), await left('Files'), await left('Theme')];
  expect(order).toEqual([...order].sort((a, b) => a - b));
  await expect(bar.getByRole('button', { name: /^Computer:/ })).toBeVisible();
  const regions = await window.evaluate(() => {
    const region = (element: Element | null) => element ? getComputedStyle(element).getPropertyValue('-webkit-app-region') : null;
    return { bar: region(document.querySelector('.env-title-bar')), search: region(document.querySelector('.search-button')), sections: region(document.querySelector('.section-bar')), tab: region(document.querySelector('.section-tab')) };
  });
  expect(regions).toEqual({ bar: 'drag', search: 'no-drag', sections: 'drag', tab: 'no-drag' });

  // The second row: Plans with the open plans, Projects with the projects, Statistics.
  const sections = window.getByRole('navigation', { name: 'Sections' });
  await expect(sections.locator('.section-tab')).toHaveText([/^Plans\s*6/, /^Projects\s*2/, /^Statistics$/]);
  await expect(sections.getByRole('button', { name: 'Plans 6 open', exact: true })).toBeVisible();
  await expect(sections.getByRole('button', { name: 'Projects 2 active', exact: true })).toBeVisible();
  // A plan belongs to Plans; each section shows its page and is marked.
  const current = sections.locator('[aria-current="page"]');
  await expect(current).toHaveAttribute('data-section', 'plans');
  await section(window, 'Projects').click();
  await expect(window.locator('.projects-page h1')).toHaveText('Projects');
  await expect(current).toHaveAttribute('data-section', 'projects');
  await section(window, 'Statistics').click();
  await expect(window.locator('.statistics-page h1')).toHaveText('Statistics');
  await expect(window.getByRole('combobox', { name: 'Project' })).toHaveText(/Northwind/);
  await expect(current).toHaveAttribute('data-section', 'statistics');
  await section(window, 'Plans').click();
  await expectHub(window);
  await expect(current).toHaveAttribute('data-section', 'plans');
  // The counts follow the projects: an archived project and its plans are not counted.
  await openProjects(window);
  await projectAction(window, 'Coord', 'Archive');
  await expect(sections.locator('.section-tab')).toHaveText([/^Plans\s*3/, /^Projects\s*1/, /^Statistics$/]);
  await projectAction(window, 'Coord', 'Restore');
  await expect(sections.locator('.section-tab').first()).toHaveText(/^Plans\s*6/);

  // File holds the commands.
  await fileMenu(window).click();
  const menu = window.getByRole('menu', { name: 'File' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    /^New Window\s*Ctrl\s*\+?\s*Shift\s*\+?\s*N$/, 'New Project…', 'Import Plan…', 'Connect to Another Atlas…', 'Remote Access…',
    /^Zoom In/, /^Zoom Out/, /^Actual Size/, /^Full Screen\s*F11$/, 'Open Logs', 'About Atlas', 'Exit',
  ]);
  await window.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // Alt+F opens it from the keyboard, at its first item.
  await window.keyboard.press('Alt+F');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^New Window/ })).toBeFocused();
  await window.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // New Project… opens its dialog where the window is.
  await chooseMenu(window, 'New Project…');
  await expect(window.getByRole('dialog', { name: 'New project' })).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(window.locator('.projects-page h1')).toHaveText('Projects');
  // Main's application menu keeps the shortcuts (and is the menu bar on macOS), with the sections in View.
  const items = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map(entry => [entry.label, entry.submenu!.items.filter(item => item.type !== 'separator').map(item => item.accelerator ? item.label + ' ' + item.accelerator : item.label || item.role)]));
  expect(items).toEqual([
    ['&File', ['New &Window CmdOrCtrl+Shift+N', 'New &Project…', '&Import Plan…', 'Co&nnect to Another Atlas…', 'Re&mote Access…', 'Close Win&dow CmdOrCtrl+Shift+W', 'E&xit']],
    ['&Edit', ['Undo CommandOrControl+Z', 'Redo Control+Y', 'Cut CommandOrControl+X', 'Copy CommandOrControl+C', 'Paste CommandOrControl+V', 'Select All CommandOrControl+A']],
    ['&View', ['&Back Alt+Left', '&Forward Alt+Right', '&Projects', 'S&tatistics', '&Search… CmdOrCtrl+P', 'F&iles CmdOrCtrl+Shift+E', 'Zoom &In CmdOrCtrl+Plus', 'Zoom &Out CmdOrCtrl+-', '&Actual Size CmdOrCtrl+0', 'Toggle Full Screen F11']],
    ['&Help', ['Open &Logs', '&About Atlas']],
  ]);
  await applicationMenu(app, '&File', 'New &Project…');
  await expect(window.getByRole('dialog', { name: 'New project' })).toBeVisible();
  await window.keyboard.press('Escape');
  // The shortcuts: search, Files on a plan, back and forward.
  await section(window, 'Plans').click();
  await window.keyboard.press('Control+P');
  await expect(searchPopup(window)).toBeVisible();
  await window.keyboard.press('Escape');
  await openPlan(window, 'Saved payment methods');
  await window.keyboard.press('Control+Shift+E');
  await expect(window.getByRole('region', { name: 'Files' })).toBeVisible();
  await window.keyboard.press('Control+Shift+E');
  await window.keyboard.press('Alt+ArrowLeft');
  await expectHub(window);
  // Edit's keys act on the focused field.
  await window.keyboard.press('Control+P');
  const input = searchPopup(window).getByRole('combobox');
  await input.fill('fulfil');
  await input.selectText();
  await window.keyboard.press('Control+C');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('fulfil');
  await window.keyboard.press('Escape');
  // Projects and Statistics come from the application menu too.
  await applicationMenu(app, '&View', '&Projects');
  await expect(window.locator('.projects-page h1')).toHaveText('Projects');
  await applicationMenu(app, '&View', 'S&tatistics');
  await expect(window.locator('.statistics-page h1')).toHaveText('Statistics');
});

test("the search shows the host's results grouped by kind with their project, work item and snippet, opens them, and shows nothing stale", async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  addProject(home.dataDirectory, 'coord', 'Coord');
  launched = await launch({ dataDirectory: home.dataDirectory });
  const { window, app } = launched;
  await expect(hubRows(window).first()).toBeVisible();
  const listed = await listedProjects(window);
  const folderOf = (name: string) => listed.find(project => project.name === name)!.folderId;
  const northwind = folderOf('Northwind'), coord = folderOf('Coord');
  const result = (change: Record<string, unknown>) => ({ kind: 'plan', title: '', snippet: null, folderId: northwind, project: 'Northwind', work: null, path: null, anchor: null, element: null, ...change });
  const results = [
    result({ kind: 'element', title: 'Shipment', work: 'work-0002', path: 'active/0002-order-fulfilment-model/diagrams/fulfilment.puml', element: 'Shipment' }),
    result({ kind: 'heading', title: 'Current checkout', snippet: 'card details are typed in again on every order', work: 'work-0001', path: 'active/0001-saved-payment-methods/plan.md', anchor: 'current-checkout' }),
    result({ kind: 'document', title: 'Payments constraints', snippet: 'tokens only, never card numbers', path: 'knowledge/shop/payments-constraints.md' }),
    result({ kind: 'step', title: 'Wire placeOrderWithSavedMethod into checkout', work: 'work-0001', path: 'active/0001-saved-payment-methods/plan.md' }),
    result({ kind: 'project', title: 'Coord', folderId: coord, project: 'Coord' }),
  ];
  // The host's search, stubbed: these results for any query, the queries asked and answered noted. A
  // query with "slow" in it answers late with a plan; one starting with "saved" a little late.
  await app.evaluate(({ ipcMain }, stubbed) => {
    const noted = { asked: [] as string[], answered: [] as string[] };
    (globalThis as { noted?: typeof noted }).noted = noted;
    ipcMain.removeHandler('search:query');
    ipcMain.handle('search:query', async (_event, query: string) => {
      noted.asked.push(query);
      const late = query.includes('slow') ? 1500 : query.startsWith('saved') ? 1000 : 0;
      if (late) await new Promise(resolve => setTimeout(resolve, late));
      noted.answered.push(query);
      return { ok: true, value: query.includes('slow') ? [{ ...stubbed[0], kind: 'plan', title: 'Stale answer', work: 'work-0002', path: null, element: null }] : stubbed };
    });
  }, results);
  const noted = () => app.evaluate(() => (globalThis as { noted?: { asked: string[]; answered: string[] } }).noted!);
  const asked = async () => (await noted()).asked;
  const palette = searchPopup(window);
  const input = palette.getByRole('combobox');
  const choose = async (title: string) => {
    await window.keyboard.press('Control+P');
    await input.fill('qqq');
    await palette.getByRole('option', { name: new RegExp('^' + title) }).click();
  };

  // Typing asks once it pauses; the results come grouped by kind, each with its project, work item and snippet.
  await window.keyboard.press('Control+P');
  await input.pressSequentially('qqq');
  await expect(palette.getByRole('option')).toHaveCount(5);
  await expect.poll(asked).toEqual(['qqq']);
  for (const group of ['Elements', 'Headings', 'Documents', 'Steps', 'Projects']) await expect(palette.getByRole('group', { name: group })).toHaveCount(1);
  const heading = palette.getByRole('option', { name: /^Current checkout/ });
  await expect(heading).toContainText('Northwind · #0001 Saved payment methods');
  await expect(heading).toContainText('card details are typed in again on every order');
  // The keyboard moves through them.
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect(window.locator('.prose h2', { hasText: 'Current checkout' })).toBeInViewport();

  // A diagram's element, a plan at a step (pointed out in its progress) and a project.
  await choose('Shipment');
  await expect(window.locator('.model-picker-title')).toHaveText('Fulfilment · conceptual model');
  await window.locator('.model-picker-button').hover();
  await expect(window.locator('.inspector.open').getByRole('heading', { level: 1 })).toHaveText('Shipment');
  await choose('Wire placeOrderWithSavedMethod into checkout');
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  const step = window.locator('.about .ledger-step[data-found]');
  await expect(step).toHaveText('Wire placeOrderWithSavedMethod into checkout');
  await expect(step).toBeInViewport();
  await expect(step).toHaveCount(0, { timeout: 5000 });
  await choose('Coord');
  await expectHub(window, 'Coord');

  // The host's results come below those shown: the result highlighted meanwhile is the one Enter opens.
  await window.keyboard.press('Control+P');
  await input.fill('saved payment');
  await expect(palette.getByRole('option')).toHaveCount(2);
  await input.press('ArrowDown');
  await expect(palette.getByRole('option').nth(1)).toHaveAttribute('data-highlighted', '');
  await expect(palette.getByRole('option')).toHaveCount(7);
  await expect(palette.getByRole('option').nth(1)).toHaveAttribute('data-highlighted', '');
  await input.press('Enter');
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect(window.locator('.work-main .breadcrumb')).toContainText('Coord');

  // An answer to an earlier query that comes after a later one's is not shown.
  await window.keyboard.press('Control+P');
  await input.fill('qqq slow');
  await expect.poll(asked).toContain('qqq slow');
  await input.fill('qqq fast');
  await expect(palette.getByRole('option')).toHaveCount(5);
  await expect.poll(async () => (await noted()).answered.slice(-2), { timeout: 5000 }).toEqual(['qqq fast', 'qqq slow']);
  await window.waitForTimeout(300);
  await expect(palette.getByRole('option', { name: /^Stale answer/ })).toHaveCount(0);
  await expect(palette.getByRole('option')).toHaveCount(5);
  await input.press('Escape');
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
