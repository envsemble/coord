import { expect, test } from '@playwright/test';
import { close, launch, launchProject, openProject, projectHome, removeDirectory, secondInstance, windowTitles, type Launched } from './app';

let launched: Launched | undefined;
const homes: string[] = [];
test.afterEach(async () => { await close(launched); launched = undefined; for (const home of homes.splice(0)) removeDirectory(home); });

test('a home without projects starts empty, with New Project in the sidebar', async () => {
  launched = await launch();
  const { window } = launched;
  await expect(window.getByRole('group', { name: 'Projects' })).toContainText('No projects yet.');
  await expect(window.getByRole('group', { name: 'Projects' }).getByRole('button', { name: 'New Project…' })).toBeVisible();
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
