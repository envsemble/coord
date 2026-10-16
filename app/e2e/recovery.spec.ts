import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { close, expectHub, launch, launchProject, openPlan, projectHome, removeDirectory, section, showFiles, type Launched } from './app';

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

test('a crashed window reloads showing what it showed', async () => {
  launched = await launchProject(home);
  const { app, window } = launched;
  await openPlan(window, 'Saved payment methods');
  const files = await showFiles(window);
  await files.locator('[role="treeitem"][data-id="d:knowledge"]').click();
  await files.locator('[role="treeitem"][data-id="d:knowledge/shop"]').click();
  await files.locator('[role="treeitem"][data-id="f:knowledge/shop/inventory-schema.md"]').click();
  await expect(window.locator('.reader-name')).toContainText('inventory-schema.md');
  await window.waitForTimeout(600);
  // End the renderer process as a crash would. (forcefullyCrashRenderer() on Linux leaves a sandboxed
  // renderer stuck in its crash handler, so the process never ends.)
  await app.evaluate(({ BrowserWindow }) => { process.kill(BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(), 'SIGKILL'); });
  // Playwright's page object ends with the crashed renderer, so read the reloaded page from main.
  const shown = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript("document.querySelector('.reader-name strong')?.textContent ?? ''").catch(() => ''));
  let restored = '';
  for (let attempt = 0; attempt < 40 && restored !== 'inventory-schema.md'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    restored = await shown();
  }
  expect(restored).toBe('inventory-schema.md');
  const log = readFileSync(path.join(launched.dataDirectory, 'logs', 'atlas.log'), 'utf8');
  expect(log).toContain('Window renderer gone');
});

test('a broken planning.json keeps the last good view with an error, and recovers when fixed', async () => {
  launched = await launchProject(home);
  const { window } = launched;
  await openPlan(window, 'Customer order notifications');
  const registry = path.join(home.folder, 'planning.json');
  const good = readFileSync(registry, 'utf8');
  writeFileSync(registry, '{ "schema_version": 1, "repositories": [');
  await expect(window.locator('.folder-error')).toBeVisible();
  await expect(window.locator('.folder-error')).toContainText('planning.json');
  await expect(window.locator('.work-header h1')).toHaveText('Customer order notifications');
  // An atomic save (write a temporary file, then rename it over the original) is picked up too.
  writeFileSync(registry + '.tmp', good);
  renameSync(registry + '.tmp', registry);
  await expect(window.locator('.folder-error')).toHaveCount(0);
  await expect(window.locator('.work-header h1')).toHaveText('Customer order notifications');
});

test('a ledger change appears without a refresh', async () => {
  launched = await launchProject(home);
  const { window } = launched;
  await openPlan(window, 'Customer order notifications');
  const ledger = path.join(home.folder, 'active/0003-customer-notifications/ledger.md');
  writeFileSync(ledger, readFileSync(ledger, 'utf8').replace(/^current: .*$/m, 'current: "Waiting for the provider review"'));
  await expect(window.locator('.about')).toContainText('Waiting for the provider review');
});

test('a project whose folder is moved away says so, and returns when it comes back', async () => {
  launched = await launchProject(home);
  const { window } = launched;
  await openPlan(window, 'Customer order notifications');
  const moved = home.folder + '-moved';
  await move(home.folder, moved);
  await expect(window.getByRole('heading', { name: 'This project’s folder was moved or deleted' })).toBeVisible();
  await expect(window.locator('.folder-problem-path')).toHaveText(home.folder);
  // No Locate… or Close Folder: projects live in the home.
  await expect(window.getByRole('button', { name: 'Locate…' })).toHaveCount(0);
  await move(moved, home.folder);
  await expect(window.locator('.work-header h1')).toHaveText('Customer order notifications', { timeout: 20_000 });
});

test('a project that cannot be read at all explains why', async () => {
  writeFileSync(path.join(home.folder, 'planning.json'), 'not json');
  launched = { ...await launch({ dataDirectory: home.dataDirectory, ownsData: false }), folder: home.folder };
  const { window } = launched;
  // Its name is the folder's while its planning.json cannot be read; its statistics say why.
  await expectHub(window);
  await section(window, 'Statistics').click();
  await expect(window.getByRole('heading', { name: 'This project can’t be read' })).toBeVisible();
  await expect(window.locator('.page-empty')).toContainText('planning.json');
});
