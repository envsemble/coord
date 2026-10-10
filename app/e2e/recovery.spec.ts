import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { close, launch, planningFixture, removeDirectory, type Launched } from './app';

let launched: Launched | undefined;
let folder: string;
test.beforeEach(() => { folder = planningFixture(); });
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(path.dirname(folder)); });

test('a crashed window reloads with its tabs', async () => {
  launched = await launch({ folder });
  const { app, window } = launched;
  await window.locator('.work-row', { hasText: 'Saved payment methods' }).getByRole('link', { name: 'Saved payment methods' }).click();
  await window.locator('.tab.preview').dblclick();
  await window.locator('.tree-row[data-id="d:knowledge"]').click();
  await window.locator('.tree-row[data-id="d:knowledge/shop"]').click();
  await window.locator('.tree-row[data-id="f:knowledge/shop/inventory-schema.md"]').dblclick();
  await expect(window.locator('.tab')).toHaveCount(3);
  await window.waitForTimeout(600);
  // End the renderer process as a crash would. (forcefullyCrashRenderer() on Linux leaves a sandboxed
  // renderer stuck in its crash handler, so the process never ends.)
  await app.evaluate(({ BrowserWindow }) => { process.kill(BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(), 'SIGKILL'); });
  // Playwright's page object ends with the crashed renderer, so read the reloaded page from main.
  const tabs = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
    "[...document.querySelectorAll('.tab')].map(tab => (tab.classList.contains('active') ? '*' : '') + tab.textContent).join('|')").catch(() => ''));
  let restored = '';
  for (let attempt = 0; attempt < 40 && restored !== 'Work|Saved payment methods|*inventory-schema.md'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    restored = await tabs();
  }
  expect(restored).toBe('Work|Saved payment methods|*inventory-schema.md');
  const log = readFileSync(path.join(launched.dataDirectory, 'logs', 'atlas.log'), 'utf8');
  expect(log).toContain('Window renderer gone');
});

test('a broken planning.json keeps the last good view with an error, and recovers when fixed', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await expect(window.locator('.work-row')).toHaveCount(3);
  const registry = path.join(folder, 'planning.json');
  const good = readFileSync(registry, 'utf8');
  writeFileSync(registry, '{ "schema_version": 1, "repositories": [');
  await expect(window.locator('.folder-error')).toBeVisible();
  await expect(window.locator('.folder-error')).toContainText('planning.json');
  await expect(window.locator('.work-row')).toHaveCount(3);
  // An atomic save (write a temporary file, then rename it over the original) is picked up too.
  writeFileSync(registry + '.tmp', good);
  renameSync(registry + '.tmp', registry);
  await expect(window.locator('.folder-error')).toHaveCount(0);
  await expect(window.locator('.work-row')).toHaveCount(3);
});

test('a new work item appears without a refresh', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await expect(window.locator('.work-row')).toHaveCount(3);
  const ledger = path.join(folder, 'active/0003-customer-notifications/ledger.md');
  writeFileSync(ledger, readFileSync(ledger, 'utf8').replace(/^current: .*$/m, 'current: "Waiting for the provider review"'));
  await expect(window.locator('.work-row', { hasText: 'Customer order notifications' })).toContainText('Waiting for the provider review');
});

test('a moved planning folder shows Locate… and Close, and returns when it comes back', async () => {
  launched = await launch({ folder });
  const { window } = launched;
  await expect(window.locator('.work-row')).toHaveCount(3);
  const moved = folder + '-moved';
  renameSync(folder, moved);
  await expect(window.getByRole('heading', { name: 'This planning folder was moved or deleted' })).toBeVisible();
  await expect(window.getByRole('button', { name: 'Locate…' })).toBeVisible();
  await expect(window.getByRole('button', { name: 'Close' })).toBeVisible();
  renameSync(moved, folder);
  await expect(window.locator('.work-row')).toHaveCount(3, { timeout: 20_000 });
});

test('Locate… points the window at the folder’s new location and keeps its tabs', async () => {
  launched = await launch({ folder });
  const { app, window } = launched;
  await window.locator('.tree-row[data-id="d:knowledge"]').click();
  await window.locator('.tree-row[data-id="d:knowledge/shop"]').click();
  await window.locator('.tree-row[data-id="f:knowledge/shop/inventory-schema.md"]').dblclick();
  await expect(window.locator('.tab')).toHaveCount(2);
  await window.waitForTimeout(600);
  const moved = path.join(path.dirname(folder), 'relocated');
  renameSync(folder, moved);
  await expect(window.getByRole('button', { name: 'Locate…' })).toBeVisible();
  await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog; }, moved);
  await window.getByRole('button', { name: 'Locate…' }).click();
  await expect(window.locator('.tab')).toHaveCount(2);
  await expect(window.locator('.tab.active')).toContainText('inventory-schema.md');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(item => item.getTitle()))).toEqual(['relocated — Atlas']);
  folder = moved;
});

test('a folder that cannot be read at all explains why, and Close closes the window', async () => {
  writeFileSync(path.join(folder, 'planning.json'), 'not json');
  launched = await launch({ folder });
  const { window, app } = launched;
  await expect(window.getByRole('heading', { name: 'This planning folder can’t be read' })).toBeVisible();
  await expect(window.locator('.folder-problem-error')).toContainText('planning.json');
  const closed = app.waitForEvent('close');
  await window.getByRole('button', { name: 'Close' }).click();
  await closed;
  // afterEach still runs close(), which removes the data folder of the exited app.
});
