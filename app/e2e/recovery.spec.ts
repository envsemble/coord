import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { close, launchProject, projectHome, removeDirectory, showFiles, sidebarProject, type Launched } from './app';

let launched: (Launched & { folder: string }) | undefined;
let home: { dataDirectory: string; folder: string };
test.beforeEach(() => { home = projectHome(); });
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(home.dataDirectory); });

/** Rename a folder as a user would, trying again while Atlas reads it for a moment (Windows refuses to rename a folder in use). */
async function move(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try { renameSync(from, to); return; } catch (error) {
      if (!['EBUSY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt >= 30) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

test('a crashed window reloads with its tabs', async () => {
  launched = await launchProject(home);
  const { app, window } = launched;
  await window.locator('.work-row', { hasText: 'Saved payment methods' }).getByRole('link', { name: 'Saved payment methods' }).click();
  await window.getByRole('tablist', { name: 'Open tabs' }).locator('[role="tab"][data-preview="true"]').dblclick();
  const files = await showFiles(window);
  await files.locator('[role="treeitem"][data-id="d:knowledge"]').click();
  await files.locator('[role="treeitem"][data-id="d:knowledge/shop"]').click();
  await files.locator('[role="treeitem"][data-id="f:knowledge/shop/inventory-schema.md"]').dblclick();
  await expect(window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab')).toHaveCount(3);
  await window.waitForTimeout(600);
  // End the renderer process as a crash would. (forcefullyCrashRenderer() on Linux leaves a sandboxed
  // renderer stuck in its crash handler, so the process never ends.)
  await app.evaluate(({ BrowserWindow }) => { process.kill(BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(), 'SIGKILL'); });
  // Playwright's page object ends with the crashed renderer, so read the reloaded page from main.
  const tabs = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
    "[...document.querySelectorAll('[role=tablist][aria-label=\"Open tabs\"] [role=tab]')].map(tab => (tab.getAttribute('aria-selected') === 'true' ? '*' : '') + tab.textContent).join('|')").catch(() => ''));
  let restored = '';
  for (let attempt = 0; attempt < 40 && restored !== 'Northwind|Saved payment methods|*inventory-schema.md'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    restored = await tabs();
  }
  expect(restored).toBe('Northwind|Saved payment methods|*inventory-schema.md');
  const log = readFileSync(path.join(launched.dataDirectory, 'logs', 'atlas.log'), 'utf8');
  expect(log).toContain('Window renderer gone');
});

test('a broken planning.json keeps the last good view with an error, and recovers when fixed', async () => {
  launched = await launchProject(home);
  const { window } = launched;
  const registry = path.join(home.folder, 'planning.json');
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

test('a ledger change appears without a refresh', async () => {
  launched = await launchProject(home);
  const { window } = launched;
  const ledger = path.join(home.folder, 'active/0003-customer-notifications/ledger.md');
  writeFileSync(ledger, readFileSync(ledger, 'utf8').replace(/^current: .*$/m, 'current: "Waiting for the provider review"'));
  await expect(window.locator('.work-row', { hasText: 'Customer order notifications' })).toContainText('Waiting for the provider review');
});

test('a project whose folder is moved away says so, and returns when it comes back', async () => {
  launched = await launchProject(home);
  const { window } = launched;
  const moved = home.folder + '-moved';
  await move(home.folder, moved);
  await expect(window.getByRole('heading', { name: 'This project’s folder was moved or deleted' })).toBeVisible();
  await expect(window.locator('.folder-problem-path')).toHaveText(home.folder);
  // No Locate… or Close Folder: projects live in the home, and a project page is closed as a tab.
  await expect(window.getByRole('button', { name: 'Locate…' })).toHaveCount(0);
  await move(moved, home.folder);
  await expect(window.locator('.work-row')).toHaveCount(3, { timeout: 20_000 });
});

test('a project that cannot be read at all explains why', async () => {
  writeFileSync(path.join(home.folder, 'planning.json'), 'not json');
  launched = await launchProject({ ...home, open: false });
  const { window } = launched;
  // Its name is the folder's while its planning.json cannot be read.
  await sidebarProject(window, 'northwind').click();
  await expect(window.getByRole('heading', { name: 'This project can’t be read' })).toBeVisible();
  await expect(window.locator('.page-empty')).toContainText('planning.json');
});
