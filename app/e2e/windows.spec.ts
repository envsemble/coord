import { renameSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { close, launch, planningFixture, removeDirectory, secondInstance, temporaryDirectory, windowTitles, type Launched } from './app';

let launched: Launched | undefined;
const folders: string[] = [];
const fixture = () => { const folder = planningFixture(); folders.push(path.dirname(folder)); return folder; };
test.afterEach(async () => { await close(launched); launched = undefined; for (const folder of folders.splice(0)) removeDirectory(folder); });

async function stubFolderPicker(app: ElectronApplication, folder: string) {
  await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog; }, folder);
}
async function recentMenu(app: ElectronApplication) {
  return app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('open-recent')?.submenu?.items.map(item => item.label) ?? []);
}

test('without a folder, the welcome window opens one with Open Folder… and it joins the folder list', async () => {
  launched = await launch();
  const { app, window } = launched;
  await expect(window.getByRole('heading', { name: 'Atlas', level: 1 })).toBeVisible();
  await expect(window.getByText('No recent folders.')).toBeVisible();
  expect(await recentMenu(app)).toEqual(['No recent folders']);
  const folder = fixture();
  await stubFolderPicker(app, folder);
  await window.getByRole('button', { name: 'Open Folder…' }).click();
  // The empty window is reused for the folder.
  await expect(window.locator('.work-row')).toHaveCount(3);
  await expect.poll(() => windowTitles(app)).toEqual(['planning — Atlas']);
  await expect.poll(() => recentMenu(app)).toEqual([folder]);
});

test('Open Folder… opens another folder in a new window; opening it again focuses that window', async () => {
  const first = fixture();
  launched = await launch({ folder: first });
  const { app, window } = launched;
  await expect(window.locator('.work-row')).toHaveCount(3);
  const second = fixture();
  const renamed = path.join(path.dirname(second), 'demo');
  renameSync(second, renamed);
  await stubFolderPicker(app, renamed);
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()!.items.find(entry => entry.label === '&File')!.submenu!.items.find(entry => entry.label === '&Open Folder…')!;
    item.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  });
  await expect.poll(() => windowTitles(app).then(titles => titles.sort())).toEqual(['demo — Atlas', 'planning — Atlas']);
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()!.items.find(entry => entry.label === '&File')!.submenu!.items.find(entry => entry.label === '&Open Folder…')!;
    item.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  });
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect((await windowTitles(app)).length).toBe(2);
  await expect.poll(() => recentMenu(app)).toEqual([renamed, first]);
});

test('a second launch hands its folder to the running app (single instance) and restores windows next time', async () => {
  const dataDirectory = temporaryDirectory('atlas-e2e-data-');
  folders.push(dataDirectory);
  const first = fixture();
  launched = await launch({ folder: first, dataDirectory });
  const { app, window } = launched;
  await expect(window.locator('.work-row')).toHaveCount(3);
  const other = fixture();
  expect(secondInstance(dataDirectory, [other])).toBe(0);
  await expect.poll(() => windowTitles(app).then(titles => titles.length)).toBe(2);
  // Asking for an open folder only focuses its window.
  expect(secondInstance(dataDirectory, [first])).toBe(0);
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect((await windowTitles(app)).length).toBe(2);
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await app.waitForEvent('close').catch(() => undefined);

  launched = await launch({ dataDirectory });
  await expect.poll(() => windowTitles(launched!.app).then(titles => titles.length)).toBe(2);
});

test('Help › Open Logs and About are in the menu, and About shows the version', async () => {
  launched = await launch({ folder: fixture() });
  const { app } = launched;
  const help = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find(entry => entry.label === '&Help')!.submenu!.items.map(item => item.label));
  expect(help).toEqual(['Open &Logs', '', '&About Atlas']);
  const about = await app.evaluate(async ({ app: electronApp, dialog, Menu }) => {
    let shown: Electron.MessageBoxOptions | undefined;
    dialog.showMessageBox = (async (...args: unknown[]) => { shown = args.at(-1) as Electron.MessageBoxOptions; return { response: 0, checkboxChecked: false }; }) as typeof dialog.showMessageBox;
    Menu.getApplicationMenu()!.items.find(entry => entry.label === '&Help')!.submenu!.items.find(item => item.label === '&About Atlas')!.click();
    await new Promise(resolve => setTimeout(resolve, 200));
    return { message: shown?.message, version: electronApp.getVersion() };
  });
  expect(about.message).toBe('Atlas ' + about.version);
});
