import { renameSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { addProject, chooseMenu, close, expectHub, filterHub, goHome, launch, launchProject, openPlan, openProjects, planningFixture, projectAction, projectHome, projectRow, removeDirectory, secondInstance, windowTitles, type Launched } from './app';

let launched: Launched | undefined;
const homes: string[] = [];
test.afterEach(async () => { await close(launched); launched = undefined; for (const home of homes.splice(0)) removeDirectory(home); });

/** New Window from the application menu, in the first window. */
async function newWindow(app: ElectronApplication): Promise<Page> {
  const opened = app.waitForEvent('window');
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()!.items.find(entry => entry.label === '&File')!.submenu!.items.find(entry => entry.label === 'New &Window')!.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  });
  const page = await opened;
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test('a second launch brings the running app forward, and windows open again showing what they showed next time; a window closed by hand is forgotten', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  launched = await launchProject(home);
  const { app, window } = launched;
  // New Window opens another window on the same computer, on the hub.
  const second = await newWindow(app);
  await expectHub(second);
  await openPlan(second, 'Saved payment methods');
  // Starting Atlas again only brings it forward (single instance).
  expect(secondInstance(home.dataDirectory, [])).toBe(0);
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect((await windowTitles(app)).length).toBe(2);
  await window.waitForTimeout(600);
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await app.waitForEvent('close').catch(() => undefined);

  launched = await launch({ dataDirectory: home.dataDirectory });
  await expect.poll(() => windowTitles(launched!.app).then(titles => titles.length)).toBe(2);
  const shown = async () => (await Promise.all(launched!.app.windows().map(page => page.locator('.hub h1, .work-header h1').first().textContent()))).sort();
  await expect.poll(shown).toEqual(['Plans', 'Saved payment methods']);

  // The newer window closes by hand; the one left keeps its place when Atlas quits, and opens alone next time.
  const again = launched.app;
  await again.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().sort((a, b) => b.id - a.id)[0].close(); });
  await expect.poll(() => windowTitles(again).then(titles => titles.length)).toBe(1);
  await expect.poll(() => again.windows().length).toBe(1);
  const left = again.windows()[0];
  await goHome(left);
  await openPlan(left, 'Order fulfilment model');
  await left.waitForTimeout(600);
  await again.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await again.waitForEvent('close').catch(() => undefined);
  launched = await launch({ dataDirectory: home.dataDirectory });
  await expect.poll(() => windowTitles(launched!.app).then(titles => titles.length)).toBe(1);
  await expect(launched.window.locator('.work-header h1')).toHaveText('Order fulfilment model');
});

test('a plan of a project whose folder is not a planning folder at the start shows again when it is', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  const coord = addProject(home.dataDirectory, 'coord', 'Coord');
  launched = await launchProject(home);
  await filterHub(launched.window, 'Coord');
  await openPlan(launched.window, 'Customer order notifications');
  await launched.window.waitForTimeout(600);
  await close(launched);
  // Coord's planning.json is briefly away: it is not listed, and the window shows the hub meanwhile.
  renameSync(path.join(coord, 'planning.json'), path.join(coord, 'planning.json.away'));
  launched = await launch({ dataDirectory: home.dataDirectory });
  await expectHub(launched.window);
  await launched.window.waitForTimeout(600);
  await close(launched);
  renameSync(path.join(coord, 'planning.json.away'), path.join(coord, 'planning.json'));
  launched = await launch({ dataDirectory: home.dataDirectory });
  await expect(launched.window.locator('.work-header h1')).toHaveText('Customer order notifications');
  await expect(launched.window.locator('.work-main .breadcrumb')).toContainText('Coord');
});

/** Open a plan of the project Shop from the hub, and see it read from its folder. */
async function openShopPlan(window: Page, title: string) {
  if (!await window.locator('.hub h1', { hasText: 'Shop' }).count()) await filterHub(window, 'Shop');
  await openPlan(window, title);
  await expect(window.locator('.work-main .breadcrumb')).toContainText('Shop');
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
  await openShopPlan(window, 'Saved payment methods');
  // Closing another window that showed the project leaves it open in this one.
  await openShopPlan(await newWindow(app), 'Customer order notifications');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().sort((a, b) => b.id - a.id)[0].close(); });
  await expect.poll(() => windowTitles(app).then(titles => titles.length)).toBe(1);
  await expect(window.locator('.reader .prose')).toContainText('Current checkout');
  const second = await newWindow(app);
  await openShopPlan(second, 'Customer order notifications');

  // A move that is refused (the folder is not a Git repository now) leaves it followed where it is.
  renameSync(path.join(outside, '.git'), path.join(outside, '.git-away'));
  await openProjects(window);
  await expect(projectRow(window, 'Shop')).toContainText('Outside the Atlas home');
  await projectAction(window, 'Shop', 'Move into the Atlas home');
  await expect(window.locator('.env-toast-message', { hasText: 'is not the top of a Git repository' })).toBeVisible();

  // Moved, what shows of the project and its history follow it in every window: here, and in the other one.
  renameSync(path.join(outside, '.git-away'), path.join(outside, '.git'));
  await projectAction(window, 'Shop', 'Move into the Atlas home');
  await expect(window.locator('.env-toast-message', { hasText: 'Moved Shop into the Atlas home' })).toBeVisible();
  await expect(projectRow(window, 'Shop')).not.toContainText('Outside the Atlas home');
  await expect(second.locator('.work-header h1')).toHaveText('Customer order notifications');
  await expect(second.locator('.reader .prose')).toContainText('Outcome');
  await second.keyboard.press('Alt+ArrowLeft');
  await expectHub(second, 'Shop');
  await second.keyboard.press('Alt+ArrowRight');
  await expect(second.locator('.work-header h1')).toHaveText('Customer order notifications');
  await expect(second.locator('.work-main .breadcrumb')).toContainText('Shop');
  await window.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(window.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect(window.locator('.reader .prose')).toContainText('Current checkout');
  await expect(window.locator('.work-main .breadcrumb')).toContainText('Shop');
});

test('a home without projects opens on the hub, which points to the Projects page to make one; About Atlas, from the menu, shows the version in the window and copies the details', async () => {
  launched = await launch();
  const { app, window } = launched;
  await expect(window.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
  await expect(window.locator('.hub')).toContainText('Projects › New project');
  await window.locator('.hub').getByRole('button', { name: 'Projects' }).click();
  await expect(window.locator('.projects-page h1')).toHaveText('Projects');
  await expect(window.locator('.projects-page')).toContainText('No projects yet');
  await expect(window.getByRole('button', { name: 'New project', exact: true })).toBeVisible();

  // About Atlas, from the File menu.
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  await chooseMenu(window, 'About Atlas', 'Help');
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
