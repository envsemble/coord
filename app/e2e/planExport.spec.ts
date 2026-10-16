import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { addProject, chooseMenu, close, expectHub, goHome, hubRows, launchProject, openPlan, projectHome, removeDirectory, showFiles, temporaryDirectory, type Launched } from './app';

let launched: Launched | undefined;
let folder: string;
let dataDirectory: string;
let scratch: string;
test.beforeEach(async () => {
  ({ dataDirectory, folder } = projectHome());
  scratch = temporaryDirectory('atlas-e2e-exports-');
  launched = await launchProject({ dataDirectory, folder });
});
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(dataDirectory); removeDirectory(scratch); });

async function clickMenu(app: ElectronApplication, label: string) {
  await app.evaluate(({ Menu, BrowserWindow }, name) => {
    const item = Menu.getApplicationMenu()!.items.find(entry => entry.label === '&File')!.submenu!.items.find(entry => entry.label === name)!;
    item.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  }, label);
}
/** Answer the native dialogs as a user would, and record the message boxes shown. */
async function stubDialogs(app: ElectronApplication, answers: { save?: string; open?: string }) {
  await app.evaluate(({ dialog }, { save, open }) => {
    const shown: unknown[] = [];
    (globalThis as { shownMessages?: unknown[] }).shownMessages = shown;
    if (save) dialog.showSaveDialog = (async () => ({ canceled: false, filePath: save })) as unknown as typeof dialog.showSaveDialog;
    if (open) dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [open] })) as unknown as typeof dialog.showOpenDialog;
    dialog.showMessageBox = (async (...args: unknown[]) => { shown.push(args.at(-1)); return { response: 0, checkboxChecked: false }; }) as unknown as typeof dialog.showMessageBox;
  }, answers);
}
const shownMessages = (app: ElectronApplication) => app.evaluate(() => (globalThis as { shownMessages?: { message: string; detail?: string }[] }).shownMessages ?? []);
const git = (...args: string[]) => execFileSync('git', ['-C', folder, ...args], { encoding: 'utf8', windowsHide: true });

test('Import Plan… refuses a file that is not an export; Export Plan… writes one HTML file per work item, which Import Plan… previews, then adds as new work under the next number without committing', async () => {
  const { app, window } = launched!;
  // A file that is not an export is refused in an error dialog, and nothing is written.
  const invalid = path.join(scratch, 'not-an-export.html');
  writeFileSync(invalid, '<!doctype html><title>Not an Atlas plan export</title><p>Hello</p>');
  await stubDialogs(app, { open: invalid });
  const registry = readFileSync(path.join(folder, 'planning.json'), 'utf8');
  await clickMenu(app, '&Import Plan…');
  await expect.poll(() => shownMessages(app).then(items => items.length)).toBe(1);
  const [message] = await shownMessages(app);
  expect(message.message).toBe('This file cannot be imported.');
  expect(message.detail).toContain('Nothing was written.');
  await expect(window.getByRole('dialog', { name: /^Import “/ })).toHaveCount(0);
  await expect(window.getByText(/^(Exported|Imported) /)).toHaveCount(0);
  expect(readFileSync(path.join(folder, 'planning.json'), 'utf8')).toBe(registry);
  expect(git('status', '--porcelain', '--untracked-files=all')).toBe('');

  // The plan page's Export Plan… exports its work item.
  const fromPage = path.join(scratch, 'from-page.html');
  await stubDialogs(app, { save: fromPage });
  await openPlan(window, 'Saved payment methods');
  await window.locator('.work-header').getByRole('button', { name: 'Export Plan…' }).click();
  await expect(window.getByText('Exported #0001 to ' + fromPage)).toBeVisible();
  expect(readFileSync(fromPage, 'utf8')).toMatch(/^<!doctype html>/i);

  // The file panel's context menu exports the folder it was opened on.
  const fromExplorer = path.join(scratch, 'from-explorer.html');
  await stubDialogs(app, { save: fromExplorer });
  // The open plan's work folder is revealed in it.
  const files = await showFiles(window);
  await files.locator('[role="treeitem"][data-id="d:active/0002-order-fulfilment-model"]').click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Export Plan…' }).click();
  await expect(window.getByText('Exported #0002 to ' + fromExplorer)).toBeVisible();
  const html = readFileSync(fromExplorer, 'utf8');
  expect(html).toMatch(/^<!doctype html>/i);
  expect(html).toContain('Order fulfilment model');
  // Exporting writes nothing into the planning folder.
  expect(git('status', '--porcelain')).toBe('');

  // The plan is imported into the project shown: from the hub, the only project.
  await goHome(window);
  await stubDialogs(app, { open: fromExplorer });
  const commits = git('rev-list', '--count', 'HEAD');
  await chooseMenu(window, 'Import Plan…');
  const preview = window.getByRole('dialog', { name: /^Import “/ });
  await expect(preview).toContainText('Import “Order fulfilment model”');
  await expect(preview).toContainText('#0002 from northwind');
  await expect(preview).toContainText(/#0005 in active\/0005-/);
  await expect(preview).toContainText(/\d+ files, /);
  await expect(preview).toContainText('Fulfilment · conceptual model');
  await expect(preview).toContainText('new work in Northwind');
  await preview.getByRole('button', { name: 'Import' }).click();
  await expect(window.getByText(/^Imported as #0005/)).toBeVisible();
  await expect(window.locator('.work-header h1')).toHaveText('Order fulfilment model');
  await expect(window.locator('.work-header .work-number')).toHaveText('#0005');
  const imported = (await showFiles(window)).locator('[role="treeitem"][data-id^="d:active/0005-"]');
  await expect(imported).toBeVisible();
  await expect(imported).toContainText('Order fulfilment model');
  await goHome(window);
  await expect(hubRows(window)).toHaveCount(4);
  // New files only, nothing committed, and no import lock left behind.
  expect(git('rev-list', '--count', 'HEAD')).toBe(commits);
  const changes = git('status', '--porcelain', '--untracked-files=all').trim().split('\n');
  expect(changes.every(line => line.startsWith('??') || line.endsWith('planning.json'))).toBe(true);
  expect(changes.some(line => line.includes('active/0005-'))).toBe(true);
  expect(existsSync(path.join(folder, '.atlas-import.lock'))).toBe(false);
  expect(await shownMessages(app)).toEqual([]);
});

test('import previews in two windows do not replace each other', async () => {
  const { app, window } = launched!;
  const exported = path.join(scratch, 'notifications.html');
  await stubDialogs(app, { save: exported });
  // The project's folder ID, as the window's bridge names projects.
  const project = (page: typeof window, name: string) => page.evaluate(async wanted => {
    const result = await (window as unknown as { atlas: { projects(): Promise<{ ok: boolean; value: { folderId: string; name: string }[] }> } }).atlas.projects();
    return result.value.find(item => item.name === wanted)!.folderId;
  }, name);
  const bridge = (page: typeof window, id: string) => ({
    exportPlan: (work: string) => page.evaluate(([folderId, workId]) => (window as unknown as { atlas: { exportPlan(project: string, id: string): Promise<{ ok: boolean }> } }).atlas.exportPlan(folderId, workId), [id, work]),
    choose: () => page.evaluate(folderId => (window as unknown as { atlas: { chooseImport(project: string): Promise<{ ok: boolean; value: { token: string; newId: string } }> } }).atlas.chooseImport(folderId), id),
    confirm: (token: string) => page.evaluate(key => (window as unknown as { atlas: { confirmImport(token: string): Promise<{ ok: boolean; value?: { workId: string }; error?: { message: string } }> } }).atlas.confirmImport(key), token),
  });
  const northwind = await project(window, 'Northwind');
  expect((await bridge(window, northwind).exportPlan('work-0003')).ok).toBe(true);
  // A second project in its own window.
  const second = addProject(dataDirectory, 'coord', 'Coord');
  const opened = app.waitForEvent('window');
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()!.items.find(entry => entry.label === '&File')!.submenu!.items.find(entry => entry.label === 'New &Window')!.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  });
  const other = await opened;
  await expectHub(other);
  await stubDialogs(app, { open: exported });
  const first = await bridge(window, northwind).choose();
  const next = await bridge(other, await project(other, 'Coord')).choose();
  expect(first.ok && next.ok).toBe(true);
  expect(await bridge(window, northwind).confirm(first.value.token)).toMatchObject({ ok: true, value: { workId: 'work-0005' } });
  expect(await bridge(other, '').confirm(next.value.token)).toMatchObject({ ok: true, value: { workId: 'work-0005' } });
  expect(readFileSync(path.join(second, 'planning.json'), 'utf8')).toContain('work-0005');
});
