import { renameSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { addProject, close, launch, launchProject, newProjectButton, openProject, planningFixture, projectCards, projectHome, removeDirectory, secondInstance, sidebar, sidebarProject, windowTitles, type Launched } from './app';

let launched: Launched | undefined;
const homes: string[] = [];
test.afterEach(async () => { await close(launched); launched = undefined; for (const home of homes.splice(0)) removeDirectory(home); });

test('a home without projects starts empty, with New Project and the search above the projects', async () => {
  launched = await launch();
  const { window } = launched;
  await expect(sidebar(window)).toContainText('No projects yet.');
  await expect(projectCards(window)).toHaveCount(0);
  await expect(newProjectButton(window)).toBeVisible();
  // A quiet strip: the search, only its icon and placeholder at rest, and New Project.
  const search = sidebar(window).getByRole('searchbox', { name: 'Search projects' });
  await expect(search).toBeVisible();
  await expect(search.locator('xpath=..')).toHaveAttribute('data-variant', 'quiet');
  await expect(newProjectButton(window)).toHaveClass(/env-button-quiet/);
  // The old New Project… item at the end of the list is gone.
  await expect(sidebar(window).getByRole('button', { name: 'New Project…' })).toHaveCount(0);
  await expect(window.getByRole('heading', { name: 'Open a project' })).toBeVisible();
});

test('a second launch brings the running app forward, and windows open again with their tabs next time', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  launched = await launchProject(home);
  const { app, window } = launched;
  // File › New Window opens another window on the same computer.
  const opened = app.waitForEvent('window');
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()!.items.find(entry => entry.label === '&File')!.submenu!.items.find(entry => entry.label === 'New &Window')!;
    item.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  });
  const second = await opened;
  await openProject(second);
  // Starting Atlas again only brings it forward (single instance).
  expect(secondInstance(home.dataDirectory, [])).toBe(0);
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect((await windowTitles(app)).length).toBe(2);
  await window.waitForTimeout(600);
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await app.waitForEvent('close').catch(() => undefined);

  launched = await launch({ dataDirectory: home.dataDirectory });
  await expect.poll(() => windowTitles(launched!.app).then(titles => titles.length)).toBe(2);
  for (const page of launched.app.windows()) await expect(page.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab')).toHaveText(['Northwind']);
});

test('a project whose folder is not a planning folder at the start keeps its tabs for when it is again', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  const coord = addProject(home.dataDirectory, 'coord', 'Coord');
  launched = await launchProject(home);
  await openProject(launched.window, 'Coord');
  const tabs = () => launched!.window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
  await expect(tabs()).toHaveText(['Northwind', 'Coord']);
  await launched.window.waitForTimeout(600);
  await close(launched);
  // Coord's planning.json is briefly away: it is not listed, and the window saves without it.
  renameSync(path.join(coord, 'planning.json'), path.join(coord, 'planning.json.away'));
  launched = await launch({ dataDirectory: home.dataDirectory });
  await expect(tabs()).toHaveText(['Northwind']);
  await launched.window.keyboard.press('Control+B');
  await launched.window.keyboard.press('Control+B');
  await launched.window.waitForTimeout(600);
  await close(launched);
  renameSync(path.join(coord, 'planning.json.away'), path.join(coord, 'planning.json'));
  launched = await launch({ dataDirectory: home.dataDirectory });
  await expect(tabs()).toHaveText(['Northwind', 'Coord']);
});

/** File › New Window, from the first window. */
async function newWindow(app: ElectronApplication): Promise<Page> {
  const opened = app.waitForEvent('window');
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()!.items.find(entry => entry.label === '&File')!.submenu!.items.find(entry => entry.label === 'New &Window')!.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  });
  const page = await opened;
  await page.waitForLoadState('domcontentloaded');
  return page;
}
/** Open a work item's plan from the project page shown, and see it read from its folder. */
async function openPlan(window: Page, title: string) {
  await window.locator('.work-row a', { hasText: title }).click({ modifiers: ['Control'] });
  await expect(window.locator('.work-header h1')).toHaveText(title);
  await expect(window.locator('.reader .prose')).toContainText('Outcome');
}

test('a project moved into the home moves along in every window; a refused move or a closed window leaves it open in the others', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  // A project outside the home: a planning folder elsewhere with a row in the home database.
  const outside = planningFixture('Shop');
  homes.push(path.dirname(outside));
  const database = new DatabaseSync(path.join(home.dataDirectory, 'atlas.db'));
  database.prepare("INSERT INTO project (connection_id, name, folder, position, state, created_at) VALUES (NULL, 'Shop', ?, 1, 'active', '2026-10-15T00:00:00.000Z')").run(outside);
  database.close();
  launched = await launchProject(home);
  const { app, window } = launched;
  const shop = (page: Page) => sidebarProject(page, 'Shop');
  const openShop = async (page: Page) => { await shop(page).click(); await expect(page.locator('.project-page h1')).toHaveText('Shop'); };
  await openShop(window);
  // Closing another window that showed the project leaves it open in this one.
  await openShop(await newWindow(app));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().sort((a, b) => b.id - a.id)[0].close(); });
  await expect.poll(() => windowTitles(app).then(titles => titles.length)).toBe(1);
  await openPlan(window, 'Saved payment methods');
  const second = await newWindow(app);
  await openShop(second);

  // A move that is refused (the folder is not a Git repository now) leaves it followed where it is.
  renameSync(path.join(outside, '.git'), path.join(outside, '.git-away'));
  await shop(window).click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Move into the Atlas home' }).click();
  await expect(window.locator('.env-toast-message', { hasText: 'is not the top of a Git repository' })).toBeVisible();
  await window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab', { name: 'Shop' }).click();
  await openPlan(window, 'Order fulfilment model');

  // Moved, the project's tabs and history follow it in every window: here, and in the other one.
  renameSync(path.join(outside, '.git-away'), path.join(outside, '.git'));
  await shop(window).click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Move into the Atlas home' }).click();
  await expect(window.locator('.env-toast-message', { hasText: 'Moved Shop into the Atlas home' })).toBeVisible();
  await expect(shop(second)).not.toContainText('Outside home');
  await openPlan(second, 'Customer order notifications');
  await second.keyboard.press('Alt+ArrowLeft');
  await expect(second.locator('.project-page h1')).toHaveText('Shop');
  await window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab', { name: 'Saved payment methods' }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect(window.locator('.reader .prose')).toContainText('Current checkout');
});

test('a window closed by hand is forgotten; the last one stays for the next start', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  launched = await launchProject(home);
  const { app } = launched;
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()!.items.find(entry => entry.label === '&File')!.submenu!.items.find(entry => entry.label === 'New &Window')!.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  });
  await expect.poll(() => windowTitles(app).then(titles => titles.length)).toBe(2);
  // The new window closes by hand; the first keeps its project tab when Atlas quits.
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().sort((a, b) => b.id - a.id)[0].close(); });
  await expect.poll(() => windowTitles(app).then(titles => titles.length)).toBe(1);
  await launched.window.waitForTimeout(600);
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await app.waitForEvent('close').catch(() => undefined);
  launched = await launch({ dataDirectory: home.dataDirectory });
  await expect.poll(() => windowTitles(launched!.app).then(titles => titles.length)).toBe(1);
  await expect(launched.window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab')).toHaveText(['Northwind']);
});

test('Help › About Atlas shows the version in the window and copies the details', async () => {
  launched = await launch();
  const { app, window } = launched;
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  await window.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'Help' }).click();
  await window.getByRole('menuitem', { name: 'About Atlas' }).click();
  const about = window.getByRole('dialog', { name: 'Atlas' });
  await expect(about).toContainText('Version ' + version);
  await expect(about).toContainText('Atlas works offline.');
  await expect(about.locator('dt')).toHaveText(['Electron', 'Chromium', 'Node.js', 'System', 'Atlas home']);
  await expect(about.locator('dd').last()).toHaveText(launched.dataDirectory);
  // The details a bug report needs, without the home's path.
  await about.getByRole('button', { name: 'Copy Details' }).click();
  await expect(about.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(copied.split('\n')[0]).toBe('Atlas ' + version);
  expect(copied).toMatch(/^Electron \S+$/m);
  expect(copied).not.toContain(launched.dataDirectory);
  await about.getByRole('button', { name: 'Close' }).click();
  await expect(about).toHaveCount(0);

  // The application menu's About opens the same dialog in the window in front; no system dialog opens.
  const help = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find(entry => entry.label === '&Help')!.submenu!.items.map(item => item.label));
  expect(help).toEqual(['Open &Logs', '', '&About Atlas']);
  await app.evaluate(({ dialog, Menu }) => {
    dialog.showMessageBox = (async () => { throw new Error('A system dialog opened.'); }) as typeof dialog.showMessageBox;
    Menu.getApplicationMenu()!.items.find(entry => entry.label === '&Help')!.submenu!.items.find(item => item.label === '&About Atlas')!.click();
  });
  await expect(about).toContainText('Version ' + version);
  await window.keyboard.press('Escape');
  await expect(about).toHaveCount(0);
});
