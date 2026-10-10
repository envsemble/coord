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
  await window.locator('.tree-row[data-id="d:active"]').click();
  await window.locator('.tree-row[data-id="d:active/0002-order-fulfilment-model"]').click({ button: 'right' });
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
  await expect(window.locator('.toast')).toContainText('Exported #0001 to ' + fromMenu);
  expect(readFileSync(fromMenu, 'utf8')).toMatch(/^<!doctype html>/i);

  // The explorer's context menu exports the folder it was opened on.
  const fromExplorer = path.join(scratch, 'from-explorer.html');
  await stubDialogs(app, { save: fromExplorer });
  await window.locator('.tree-row[data-id="d:active/0002-order-fulfilment-model"]').click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Export Plan…' }).click();
  await expect(window.locator('.toast').last()).toContainText('Exported #0002 to ' + fromExplorer);
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
  await window.locator('.tree-row[data-id="d:active"]').click();
  await window.locator('.tree-row[data-id="d:active/0002-order-fulfilment-model"]').click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Export Plan…' }).click();
  await expect(window.locator('.toast')).toContainText('Exported #0002');

  await stubDialogs(app, { open: exported });
  const commits = git('rev-list', '--count', 'HEAD');
  await clickMenu(app, '&Import Plan…');
  const preview = window.getByRole('dialog', { name: 'Import plan' });
  await expect(preview).toContainText('Import “Order fulfilment model”');
  await expect(preview).toContainText('#0002 from planning');
  await expect(preview).toContainText(/#0005 in active\/0005-/);
  await expect(preview).toContainText(/\d+ files, /);
  await expect(preview).toContainText('Fulfilment · conceptual model');
  await preview.getByRole('button', { name: 'Import' }).click();
  await expect(window.locator('.toast').last()).toContainText('Imported as #0005');
  await expect(window.locator('.work-header h1')).toHaveText('Order fulfilment model');
  await expect(window.locator('.breadcrumb')).toContainText('#0005');
  const imported = window.locator('.tree-row[data-id^="d:active/0005-"]');
  await expect(imported).toBeVisible();
  await expect(imported.locator('.tree-secondary')).toHaveText('#0005 Order fulfilment model');
  await window.getByRole('button', { name: 'Work', exact: true }).click();
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
  await expect(window.getByRole('dialog', { name: 'Import plan' })).toHaveCount(0);
  await expect(window.locator('.toast')).toHaveCount(0);
  expect(readFileSync(path.join(folder, 'planning.json'), 'utf8')).toBe(registry);
  expect(git('status', '--porcelain', '--untracked-files=all')).toBe('');
});
