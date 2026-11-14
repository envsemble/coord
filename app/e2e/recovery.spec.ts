import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { close, expectHub, launch, launchProject, openDocument, openPlan, openProjectMenu, projectHome, removeDirectory, type Launched } from './app';

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
  await openDocument(window, 'inventory-schema.md');
  await window.waitForTimeout(600);
  // End the renderer process as a crash would. (forcefullyCrashRenderer() on Linux leaves a sandboxed
  // renderer stuck in its crash handler, so the process never ends.)
  await app.evaluate(({ BrowserWindow }) => { process.kill(BrowserWindow.getAllWindows()[0].webContents.getOSProcessId(), 'SIGKILL'); });
  // Playwright's page object ends with the crashed renderer, so read the reloaded page from main.
  const shown = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript("document.querySelector('.file-page .file-name')?.textContent ?? ''").catch(() => ''));
  let restored = '';
  for (let attempt = 0; attempt < 40 && restored !== 'inventory-schema.md'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    restored = await shown();
  }
  expect(restored).toBe('inventory-schema.md');
  const log = readFileSync(path.join(launched.dataDirectory, 'logs', 'atlas.log'), 'utf8');
  expect(log).toContain('Window renderer gone');
});

test('an open plan follows its folder: a ledger change appears without a refresh, a broken planning.json keeps the last good view with an error, and a folder moved away says so; each recovers', async () => {
  launched = await launchProject(home);
  const { window } = launched;
  await openPlan(window, 'Customer order notifications');
  const ledger = path.join(home.folder, 'active/0003-customer-notifications/ledger.md');
  writeFileSync(ledger, readFileSync(ledger, 'utf8').replace('title: "Bounce and complaint webhook handling"', 'title: "Waiting for the provider review"'));
  await expect(window.locator('.plan-aside')).toContainText('Waiting for the provider review');
  // A broken planning.json.
  const registry = path.join(home.folder, 'planning.json');
  const good = readFileSync(registry, 'utf8');
  writeFileSync(registry, '{ "schema_version": 2, "folders": [');
  await expect(window.locator('.folder-error')).toBeVisible();
  await expect(window.locator('.folder-error')).toContainText('planning.json');
  await expect(window.locator('.work-page h1')).toHaveText('Customer order notifications');
  // An atomic save (write a temporary file, then rename it over the original) is picked up too.
  writeFileSync(registry + '.tmp', good);
  renameSync(registry + '.tmp', registry);
  await expect(window.locator('.folder-error')).toHaveCount(0);
  await expect(window.locator('.work-page h1')).toHaveText('Customer order notifications');
  // The folder moved away and back.
  const moved = home.folder + '-moved';
  await move(home.folder, moved);
  await expect(window.getByRole('heading', { name: 'This project’s folder was moved or deleted' })).toBeVisible();
  await expect(window.locator('.folder-problem-path')).toHaveText(home.folder);
  await move(moved, home.folder);
  await expect(window.locator('.work-page h1')).toHaveText('Customer order notifications', { timeout: 20_000 });
});

test('a project that cannot be read at all explains why', async () => {
  writeFileSync(path.join(home.folder, 'planning.json'), 'not json');
  launched = { ...await launch({ dataDirectory: home.dataDirectory, ownsData: false }), folder: home.folder };
  const { window } = launched;
  // Its name is the folder's while its planning.json cannot be read; its statistics, from the hub filtered to it, say why.
  await expectHub(window);
  await (await openProjectMenu(window)).getByRole('group', { name: 'Projects' }).getByRole('menuitem').nth(1).click();
  await window.locator('.hub').getByRole('button', { name: 'Statistics', exact: true }).click();
  await expect(window.getByRole('heading', { name: 'This project can’t be read' })).toBeVisible();
  await expect(window.locator('.page-empty')).toContainText('planning.json');
});
