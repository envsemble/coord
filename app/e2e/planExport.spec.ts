import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { close, launch, planningFixture, removeDirectory, temporaryDirectory, type Launched } from './app';

let launched: Launched | undefined;
let folder: string;
let scratch: string;
test.beforeEach(async () => {
  folder = planningFixture();
  scratch = temporaryDirectory('atlas-e2e-exports-');
  launched = await launch({ folder });
  await expect(launched.window.locator('.work-row')).toHaveCount(3);
});
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(path.dirname(folder)); removeDirectory(scratch); });

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

test('the export and import entries are in the File menu and on a work folder’s context menu', async () => {
  const { app, window } = launched!;
  const file = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find(entry => entry.label === '&File')!.submenu!.items.map(item => item.label));
  expect(file).toEqual(expect.arrayContaining(['&Import Plan…', '&Export Plan…']));
  await window.locator('[role="treeitem"][data-id="d:active"]').click();
  await window.locator('[role="treeitem"][data-id="d:active/0002-order-fulfilment-model"]').click({ button: 'right' });
  await expect(window.getByRole('menu')).toContainText('Export Plan…');
  await window.keyboard.press('Escape');
});

test('Export Plan… from the File menu and the explorer writes one HTML file per work item', async () => {
  const { app, window } = launched!;
  // File › Export Plan… exports the work item in the active tab.
  const fromMenu = path.join(scratch, 'from-menu.html');
  await stubDialogs(app, { save: fromMenu });
  await window.locator('.work-row', { hasText: 'Saved payment methods' }).getByRole('link', { name: 'Saved payment methods' }).click();
  await clickMenu(app, '&Export Plan…');
  await expect(window.getByText('Exported #0001 to ' + fromMenu)).toBeVisible();
  expect(readFileSync(fromMenu, 'utf8')).toMatch(/^<!doctype html>/i);

  // The explorer's context menu exports the folder it was opened on.
  const fromExplorer = path.join(scratch, 'from-explorer.html');
  await stubDialogs(app, { save: fromExplorer });
  await window.locator('[role="treeitem"][data-id="d:active/0002-order-fulfilment-model"]').click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Export Plan…' }).click();
  await expect(window.getByText('Exported #0002 to ' + fromExplorer)).toBeVisible();
  const html = readFileSync(fromExplorer, 'utf8');
  expect(html).toMatch(/^<!doctype html>/i);
  expect(html).toContain('Order fulfilment model');
  // Exporting writes nothing into the planning folder.
  expect(git('status', '--porcelain')).toBe('');
});

test('Import Plan… previews the file, then adds it as new work under the next number without committing', async () => {
  const { app, window } = launched!;
  const exported = path.join(scratch, 'fulfilment.html');
  await stubDialogs(app, { save: exported });
  await window.locator('[role="treeitem"][data-id="d:active"]').click();
  await window.locator('[role="treeitem"][data-id="d:active/0002-order-fulfilment-model"]').click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Export Plan…' }).click();
  await expect(window.getByText(/^Exported #0002/)).toBeVisible();

  await stubDialogs(app, { open: exported });
  const commits = git('rev-list', '--count', 'HEAD');
  await clickMenu(app, '&Import Plan…');
  const preview = window.getByRole('dialog', { name: /^Import “/ });
  await expect(preview).toContainText('Import “Order fulfilment model”');
  await expect(preview).toContainText('#0002 from planning');
  await expect(preview).toContainText(/#0005 in active\/0005-/);
  await expect(preview).toContainText(/\d+ files, /);
  await expect(preview).toContainText('Fulfilment · conceptual model');
  await preview.getByRole('button', { name: 'Import' }).click();
  await expect(window.getByText(/^Imported as #0005/)).toBeVisible();
  await expect(window.locator('.work-header h1')).toHaveText('Order fulfilment model');
  await expect(window.locator('.breadcrumb')).toContainText('#0005');
  const imported = window.locator('[role="treeitem"][data-id^="d:active/0005-"]');
  await expect(imported).toBeVisible();
  await expect(imported).toContainText('Order fulfilment model');
  await window.getByRole('navigation', { name: 'Atlas' }).getByRole('button', { name: /^Work/ }).click();
  await expect(window.locator('.work-row')).toHaveCount(4);
  // New files only, nothing committed, and no import lock left behind.
  expect(git('rev-list', '--count', 'HEAD')).toBe(commits);
  const changes = git('status', '--porcelain', '--untracked-files=all').trim().split('\n');
  expect(changes.every(line => line.startsWith('??') || line.endsWith('planning.json'))).toBe(true);
  expect(changes.some(line => line.includes('active/0005-'))).toBe(true);
  expect(existsSync(path.join(folder, '.atlas-import.lock'))).toBe(false);
  expect(await shownMessages(app)).toEqual([]);
});

test('an invalid export is refused in an error dialog and nothing is written', async () => {
  const { app, window } = launched!;
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
});

test('import previews in two windows do not replace each other', async () => {
  const { app, window } = launched!;
  const exported = path.join(scratch, 'notifications.html');
  await stubDialogs(app, { save: exported });
  const bridge = (page: typeof window) => ({
    exportPlan: (work: string) => page.evaluate(id => (window as unknown as { atlas: { exportPlan(id: string): Promise<{ ok: boolean }> } }).atlas.exportPlan(id), work),
    choose: () => page.evaluate(() => (window as unknown as { atlas: { chooseImport(): Promise<{ ok: boolean; value: { token: string; newId: string } }> } }).atlas.chooseImport()),
    confirm: (token: string) => page.evaluate(key => (window as unknown as { atlas: { confirmImport(token: string): Promise<{ ok: boolean; value?: { workId: string }; error?: { message: string } }> } }).atlas.confirmImport(key), token),
  });
  expect((await bridge(window).exportPlan('work-0003')).ok).toBe(true);
  // A second planning folder in its own window.
  const second = planningFixture();
  const opened = app.waitForEvent('window');
  await stubDialogs(app, { open: second });
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()!.items.find(entry => entry.label === '&File')!.submenu!.items.find(entry => entry.label === '&Open Folder…')!;
    item.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  });
  const other = await opened;
  await expect(other.locator('.work-row')).toHaveCount(3);
  await stubDialogs(app, { open: exported });
  const first = await bridge(window).choose();
  const next = await bridge(other).choose();
  expect(first.ok && next.ok).toBe(true);
  expect(await bridge(window).confirm(first.value.token)).toMatchObject({ ok: true, value: { workId: 'work-0005' } });
  expect(await bridge(other).confirm(next.value.token)).toMatchObject({ ok: true, value: { workId: 'work-0005' } });
  expect(existsSync(path.join(second, 'planning.json'))).toBe(true);
  expect(readFileSync(path.join(second, 'planning.json'), 'utf8')).toContain('work-0005');
  removeDirectory(path.dirname(second));
});
