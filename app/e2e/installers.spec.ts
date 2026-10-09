// The distributables themselves: the Linux AppImage, and (opt-in, because it installs Atlas for
// the current user) the Windows installer. CI runs both.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { close, launch, packagedInstaller, planningFixture, removeDirectory, temporaryDirectory, type Launched } from './app';

let launched: Launched | undefined;
test.afterEach(async () => { await close(launched); launched = undefined; });

test('the AppImage opens a planning folder', async () => {
  test.skip(process.platform !== 'linux', 'Linux only');
  const image = packagedInstaller();
  test.skip(!image, 'Build the AppImage first with npm run package.');
  const folder = planningFixture();
  // APPIMAGE_EXTRACT_AND_RUN (set by launch) runs it without FUSE.
  launched = await launch({ folder, executable: image! });
  await expect(launched.window.locator('.work-row')).toHaveCount(3);
  removeDirectory(path.dirname(folder));
});

test('the Windows installer installs, opens a planning folder and uninstalls', async () => {
  test.skip(process.platform !== 'win32', 'Windows only');
  test.skip(process.env.ATLAS_E2E_INSTALLER !== '1', 'Installs Atlas for the current user; set ATLAS_E2E_INSTALLER=1 (CI does).');
  const installer = packagedInstaller();
  test.skip(!installer, 'Build the installer first with npm run package.');
  const target = path.join(temporaryDirectory('atlas-install-'), 'Atlas');
  execFileSync(installer!, ['/S', '/D=' + target], { windowsHide: true });
  try {
    expect(existsSync(path.join(target, 'Atlas.exe'))).toBe(true);
    const folder = planningFixture();
    launched = await launch({ folder, executable: path.join(target, 'Atlas.exe') });
    await expect(launched.window.locator('.work-row')).toHaveCount(3);
    await close(launched);
    launched = undefined;
    removeDirectory(path.dirname(folder));
  } finally {
    execFileSync(path.join(target, 'Uninstall Atlas.exe'), ['/S'], { windowsHide: true });
  }
});
