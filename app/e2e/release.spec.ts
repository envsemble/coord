// The release build itself (the unpacked app the installer and AppImage contain, with the
// inspector fuse off), the AppImage, and (opt-in, because it installs Atlas for the current
// user) the Windows installer. Playwright cannot attach to these builds, so the tests start them
// as a user would and read the app's log.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { environment, packagedInstaller, planningFixture, releaseExecutable, removeDirectory, temporaryDirectory } from './app';

const cleanup: string[] = [];
test.afterEach(() => { for (const directory of cleanup.splice(0)) removeDirectory(directory); });

/** Start an executable, wait until its log contains a line, then stop it (and all its processes). */
async function runUntilLogged(executable: string, args: string[], expected: string, whileRunning: () => Promise<void> = async () => undefined) {
  const data = temporaryDirectory('atlas-release-data-');
  cleanup.push(data);
  const child = spawn(executable, args, { env: environment(data), detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const log = path.join(data, 'logs', 'atlas.log');
  try {
    const started = Date.now();
    while (!(existsSync(log) && readFileSync(log, 'utf8').includes(expected))) {
      if (Date.now() - started > 60_000) throw new Error(`"${expected}" was not logged. Output:\n${output}`);
      if (child.exitCode !== null) throw new Error(`Exited with ${child.exitCode} before logging "${expected}". Output:\n${output}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await whileRunning();
    return { output, log: readFileSync(log, 'utf8') };
  } finally {
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* Already gone. */ } }
    else { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* Already gone. */ } }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
const portOpen = (port: number) => new Promise<boolean>(resolve => {
  const socket = connect(port, '127.0.0.1', () => { socket.destroy(); resolve(true); });
  socket.on('error', () => resolve(false));
});
function fixture() {
  const folder = planningFixture();
  cleanup.push(path.dirname(folder));
  return folder;
}

test('the release build opens a planning folder and ignores --inspect (inspector fuse off)', async () => {
  const executable = releaseExecutable();
  test.skip(!existsSync(executable), 'Build the release first with npm run package.');
  const port = 9339;
  let inspectorOpen = true;
  const result = await runUntilLogged(executable, ['--inspect=127.0.0.1:' + port, fixture()], 'Window ready', async () => { inspectorOpen = await portOpen(port); });
  expect(result.log).toContain('Planning folder read');
  expect(result.output).not.toContain('Debugger listening');
  expect(inspectorOpen).toBe(false);
});

test('the app refuses to start without its sandbox', async () => {
  const executable = releaseExecutable();
  test.skip(!existsSync(executable), 'Build the release first with npm run package.');
  const result = await runUntilLogged(executable, ['--no-sandbox', fixture()], 'Refused to start without the sandbox');
  expect(result.log).not.toContain('Window ready');
});

test('the AppImage keeps the sandbox in its desktop entry and opens a planning folder', async () => {
  test.skip(process.platform !== 'linux', 'Linux only');
  const image = packagedInstaller();
  test.skip(!image, 'Build the AppImage first with npm run package.');
  const extracted = temporaryDirectory('atlas-appimage-');
  cleanup.push(extracted);
  execFileSync(image!, ['--appimage-extract', '*.desktop'], { cwd: extracted, stdio: 'ignore' });
  const root = path.join(extracted, 'squashfs-root');
  const desktop = readdirSync(root).find(name => name.endsWith('.desktop'));
  expect(desktop).toBeTruthy();
  const entry = readFileSync(path.join(root, desktop!), 'utf8');
  expect(entry).toMatch(/^Exec=AppRun %U$/m);
  expect(entry).not.toContain('--no-sandbox');
  // APPIMAGE_EXTRACT_AND_RUN runs it without FUSE (environment() sets it).
  await runUntilLogged(image!, [fixture()], 'Window ready');
});

test('the Windows installer installs per user, opens a planning folder and uninstalls', async () => {
  test.skip(process.platform !== 'win32', 'Windows only');
  test.skip(process.env.ATLAS_E2E_INSTALLER !== '1', 'Installs Atlas for the current user; set ATLAS_E2E_INSTALLER=1 (CI does).');
  const installer = packagedInstaller();
  test.skip(!installer, 'Build the installer first with npm run package.');
  const target = path.join(temporaryDirectory('atlas-install-'), 'Atlas');
  cleanup.push(path.dirname(target));
  execFileSync(installer!, ['/S', '/currentuser', '/D=' + target], { windowsHide: true });
  try {
    expect(existsSync(path.join(target, 'Atlas.exe'))).toBe(true);
    await runUntilLogged(path.join(target, 'Atlas.exe'), [fixture()], 'Window ready');
  } finally {
    execFileSync(path.join(target, 'Uninstall Atlas.exe'), ['/S', '/currentuser'], { windowsHide: true });
  }
});
