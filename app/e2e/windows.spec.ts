import { renameSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { addProject, chooseMenu, close, expectHub, filterHub, goHome, launch, launchProject, openPlan, projectHome, removeDirectory, searchPopup, secondInstance, windowTitles, type Launched } from './app';

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
  // Starting Coord again only brings it forward (single instance).
  expect(secondInstance(home.dataDirectory, [])).toBe(0);
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect((await windowTitles(app)).length).toBe(2);
  await window.waitForTimeout(600);
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await app.waitForEvent('close').catch(() => undefined);

  launched = await launch({ dataDirectory: home.dataDirectory });
  await expect.poll(() => windowTitles(launched!.app).then(titles => titles.length)).toBe(2);
  const shown = async () => (await Promise.all(launched!.app.windows().map(page => page.locator('.hub h1, .work-page h1').first().textContent()))).sort();
  await expect.poll(shown).toEqual(['Plans', 'Saved payment methods']);

  // The newer window closes by hand; the one left keeps its place when Coord quits, and opens alone next time.
  const again = launched.app;
  await again.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().sort((a, b) => b.id - a.id)[0].close(); });
  await expect.poll(() => windowTitles(again).then(titles => titles.length)).toBe(1);
  await expect.poll(() => again.windows().length).toBe(1);
  const left = again.windows()[0];
  await goHome(left);
  // Opened from the search, it is under the search's Recent after the restart too.
  await left.keyboard.press('Control+K');
  await searchPopup(left).getByRole('combobox').fill('Order fulfilment');
  await expect(searchPopup(left).getByRole('option').first()).toContainText('Order fulfilment model');
  await searchPopup(left).getByRole('combobox').press('Enter');
  await expect(left.locator('.work-page h1')).toHaveText('Order fulfilment model');
  await left.waitForTimeout(600);
  await again.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await again.waitForEvent('close').catch(() => undefined);
  launched = await launch({ dataDirectory: home.dataDirectory });
  await expect.poll(() => windowTitles(launched!.app).then(titles => titles.length)).toBe(1);
  await expect(launched.window.locator('.work-page h1')).toHaveText('Order fulfilment model');
  await launched.window.keyboard.press('Control+K');
  await expect(searchPopup(launched.window).locator('.env-command-palette-group', { hasText: 'Recent' })).toContainText('Order fulfilment model');
});

test('a plan of a project whose folder is not a planning folder at the start shows again when it is', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  const harbor = addProject(home.dataDirectory, 'harbor', 'Harbor');
  launched = await launchProject(home);
  await filterHub(launched.window, 'Harbor');
  await openPlan(launched.window, 'Customer order notifications');
  await launched.window.waitForTimeout(600);
  await close(launched);
  // Harbor's planning.json is briefly away: it is not listed, and the window shows the hub meanwhile.
  renameSync(path.join(harbor, 'planning.json'), path.join(harbor, 'planning.json.away'));
  launched = await launch({ dataDirectory: home.dataDirectory });
  await expectHub(launched.window);
  await launched.window.waitForTimeout(600);
  await close(launched);
  renameSync(path.join(harbor, 'planning.json.away'), path.join(harbor, 'planning.json'));
  launched = await launch({ dataDirectory: home.dataDirectory });
  await expect(launched.window.locator('.work-page h1')).toHaveText('Customer order notifications');
  await expect(launched.window.locator('.page-trail .breadcrumb')).toContainText('Harbor');
});

/** Open a plan of the project Shop from the hub, and see it read from its folder. */
async function openShopPlan(window: Page, title: string) {
  if (!await window.locator('.hub h1', { hasText: 'Shop' }).count()) await filterHub(window, 'Shop');
  await openPlan(window, title);
  await expect(window.locator('.page-trail .breadcrumb')).toContainText('Shop');
  await expect(window.locator('.reader .prose')).toContainText('Outcome');
}

test('a closed window leaves a project it showed open in the others', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  addProject(home.dataDirectory, 'shop', 'Shop');
  launched = await launchProject(home);
  const { app, window } = launched;
  await openShopPlan(window, 'Saved payment methods');
  // Closing another window that showed the project leaves it open in this one.
  await openShopPlan(await newWindow(app), 'Customer order notifications');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().sort((a, b) => b.id - a.id)[0].close(); });
  await expect.poll(() => windowTitles(app).then(titles => titles.length)).toBe(1);
  await expect(window.locator('.reader .prose')).toContainText('Current checkout');
  await expect(window.locator('.page-trail .breadcrumb')).toContainText('Shop');
});

test('a new home starts with the onboarding until it is finished, with no agent connected if none is chosen; the window shows after it, and at the next launch', async () => {
  const home = projectHome();
  homes.push(home.dataDirectory);
  launched = await launch({ dataDirectory: home.dataDirectory, onboarding: true });
  const { window } = launched;
  await expect(window.getByRole('heading', { name: 'Welcome to Coord' })).toBeVisible();
  await window.getByRole('button', { name: 'Next', exact: true }).click();
  // The agents on this computer, checked there (nothing is connected without Connect).
  await expect(window.getByRole('heading', { name: 'Connect your agents' })).toBeFocused();
  await expect(window.getByRole('list', { name: 'Agents on this computer' }).locator('.agent-row')).toHaveCount(2);
  // There is no Skip: the agents found start ticked, and with none ticked Next leads past Connect to the Start step.
  await expect(window.getByRole('button', { name: 'Skip' })).toHaveCount(0);
  for (const box of await window.getByRole('checkbox', { name: /^Connect / }).all()) if (await box.isChecked()) await box.click();
  await window.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(window.getByRole('heading', { name: 'Start a session' })).toBeFocused();
  await window.getByRole('button', { name: 'Finish', exact: true }).click();
  await expectHub(window);
  await window.waitForTimeout(600);
  await close(launched);
  launched = await launch({ dataDirectory: home.dataDirectory, onboarding: true });
  await expectHub(launched.window);
  await expect(launched.window.getByRole('heading', { name: 'Welcome to Coord' })).toHaveCount(0);
});

test('a home without projects opens on the hub, which makes one; About Coord, from the menu, shows the version in the window and copies the details', async () => {
  launched = await launch();
  const { app, window } = launched;
  await expect(window.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
  await window.locator('.hub').getByRole('button', { name: 'New project', exact: true }).click();
  const create = window.getByRole('dialog', { name: 'Create project' });
  await expect(create).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(create).toHaveCount(0);

  // About Coord, from the Help menu.
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  await chooseMenu(window, 'About Coord');
  const about = window.getByRole('dialog', { name: 'Coord' });
  await expect(about).toContainText('Version ' + version);
  await expect(about).toContainText('Coord works offline.');
  await expect(about.locator('dt')).toHaveText(['Electron', 'Chromium', 'Node.js', 'System', 'Coord home']);
  await expect(about.locator('dd').last()).toHaveText(launched.dataDirectory);
  // The details a bug report needs, without the home's path.
  await about.getByRole('button', { name: 'Copy Details' }).click();
  await expect(about.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(copied.split('\n')[0]).toBe('Coord ' + version);
  expect(copied).toMatch(/^Electron \S+$/m);
  expect(copied).not.toContain(launched.dataDirectory);
  await about.getByRole('button', { name: 'Close' }).click();
  await expect(about).toHaveCount(0);

  // The application menu's About opens the same dialog in the window in front; no system dialog opens.
  const help = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find(entry => entry.label === '&Help')!.submenu!.items.map(item => item.label));
  expect(help).toEqual(['Open &Logs', '', '&About Coord']);
  await app.evaluate(({ dialog, Menu }) => {
    dialog.showMessageBox = (async () => { throw new Error('A system dialog opened.'); }) as typeof dialog.showMessageBox;
    Menu.getApplicationMenu()!.items.find(entry => entry.label === '&Help')!.submenu!.items.find(item => item.label === '&About Coord')!.click();
  });
  await expect(about).toContainText('Version ' + version);
  await window.keyboard.press('Escape');
  await expect(about).toHaveCount(0);
});
