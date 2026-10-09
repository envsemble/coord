import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { close, launch, planningFixture, removeDirectory, type Launched } from './app';

let launched: Launched | undefined;
let folder: string;
test.beforeEach(async () => {
  folder = planningFixture();
  launched = await launch({ folder });
  await expect(launched.window.locator('.work-row')).toHaveCount(3);
});
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(path.dirname(folder)); });

async function clickMenu(app: ElectronApplication, label: string) {
  await app.evaluate(({ Menu, BrowserWindow }, name) => {
    const item = Menu.getApplicationMenu()!.items.find(entry => entry.label === '&File')!.submenu!.items.find(entry => entry.label === name)!;
    item.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  }, label);
}

test('the export and import entries are in the File menu and on a work folder’s context menu', async () => {
  const { app, window } = launched!;
  const file = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find(entry => entry.label === '&File')!.submenu!.items.map(item => item.label));
  expect(file).toEqual(expect.arrayContaining(['&Import Plan…', '&Export Plan…']));
  await window.locator('.tree-row[data-id="d:active"]').click();
  await window.locator('.tree-row[data-id="d:active/0002-order-fulfilment-model"]').click({ button: 'right' });
  await expect(window.getByRole('menu')).toContainText('Export Plan…');
  await window.keyboard.press('Escape');
});

test('without work-0012 in this build, both commands say so instead of failing', async () => {
  const { app, window } = launched!;
  // A build with plan export would show the save dialog; cancel it so the probe writes nothing.
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as unknown as typeof dialog.showSaveDialog; });
  const probe = await window.evaluate(() => (window as unknown as { atlas: { exportPlan(work: string): Promise<{ ok: boolean; error?: { code: string } }> } }).atlas.exportPlan('work-0002'));
  test.skip(probe.ok, 'This build includes plan export; the import and export tests cover it.');
  expect(probe.error?.code).toBe('unavailable');
  // With no work item open, File › Export Plan… first asks which one.
  await clickMenu(app, '&Export Plan…');
  await expect(window.locator('.quick-open input')).toHaveAttribute('placeholder', 'Choose a work item to export');
  await window.locator('.quick-open input').fill('fulfilment');
  await window.locator('.quick-open input').press('Enter');
  await expect(window.locator('.toast')).toContainText('Plan export is not available in this build.');
  await window.locator('.tree-row[data-id="d:active"]').click();
  await window.locator('.tree-row[data-id="d:active/0002-order-fulfilment-model"]').click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Export Plan…' }).click();
  await expect(window.locator('.toast').last()).toContainText('Plan export is not available in this build.');
  await clickMenu(app, '&Import Plan…');
  await expect(window.locator('.toast').last()).toContainText('Plan export is not available in this build.');
});

// TODO(work-0012): enable once the plan-export branch is merged into desktop-app.
test.skip('Export Plan… writes one HTML file for the selected work item', async () => {
  // Stub dialog.showSaveDialog to a temporary path, run File › Export Plan… on #0002,
  // and check the file starts with <!doctype html> and reopens with readPlanExport.
});
test.skip('Import Plan… previews the file, then adds it as new work without committing', async () => {
  // Export #0002 to a file, stub dialog.showOpenDialog to it, run File › Import Plan…,
  // check the preview (title, original #0002 from "planning", new #0005 folder, file count, diagrams),
  // confirm, and expect the new work item in the list and explorer and `git status` showing new files only.
});
test.skip('an invalid export is rejected before anything is written', async () => {
  // A tampered file (changed byte) shows the integrity error and leaves planning.json unchanged.
});
