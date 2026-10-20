// The release build itself (the unpacked app the installer and AppImage contain, with the
// inspector fuse off), the AppImage, and (opt-in, because it installs Atlas for the current
// user) the Windows installer. Playwright cannot attach to these builds, so the tests start them
// as a user would and read the app's log.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { expect, test } from '@playwright/test';
import { endToEndExecutable, environment, packagedInstaller, releaseExecutable, removeDirectory, temporaryDirectory } from './app';

// A fuse wire stores each fuse as the character '0' (off) or '1' (on).
const FuseState = { DISABLE: '0'.charCodeAt(0), ENABLE: '1'.charCodeAt(0) };
const cleanup: string[] = [];
test.afterEach(() => { for (const directory of cleanup.splice(0)) removeDirectory(directory); });

/** Start an executable, wait until its log has every expected line, run a check, then stop it (and all its processes). */
async function runUntilLogged(executable: string, args: readonly string[], expected: string | string[], whileRunning: () => Promise<void> = async () => undefined) {
  const lines = typeof expected === 'string' ? [expected] : expected;
  const data = temporaryDirectory('atlas-release-data-');
  cleanup.push(data);
  const child = spawn(executable, args, { env: environment(data), detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  // The app logs to atlas.log and the Atlas host it runs (which reads the folders) to host.log.
  const logs = ['atlas.log', 'host.log'].map(name => path.join(data, 'logs', name));
  const read = () => logs.filter(file => existsSync(file)).map(file => readFileSync(file, 'utf8')).join('\n');
  const logged = () => lines.every(line => read().includes(line));
  try {
    const started = Date.now();
    while (!logged()) {
      const waiting = lines.map(line => '"' + line + '"').join(', ');
      if (Date.now() - started > 60_000) throw new Error(`${waiting} not logged. Output: ${output}`);
      if (child.exitCode !== null) throw new Error(`Exited with ${child.exitCode} before logging ${waiting}. Output: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await whileRunning();
    return { output, log: read() };
  } finally {
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* Already gone. */ } }
    else { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* Already gone. */ } }
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  }
}
const portOpen = (port: number) => new Promise<boolean>(resolve => {
  const socket = connect(port, '127.0.0.1', () => { socket.destroy(); resolve(true); });
  socket.on('error', () => resolve(false));
});
function release() {
  const executable = releaseExecutable();
  test.skip(!existsSync(executable), 'Build the release first with npm run package.');
  return executable;
}

test('the release build opens a window and starts its Atlas host', async () => {
  const result = await runUntilLogged(release(), [], ['Window ready', 'Host started']);
  expect(result.log).not.toContain('Refused');
});

test('the release build has the inspector fuse off; only the end-to-end build has it on', async () => {
  const wire = await getCurrentFuseWire(release());
  expect(wire[FuseV1Options.EnableNodeCliInspectArguments]).toBe(FuseState.DISABLE);
  expect(wire[FuseV1Options.RunAsNode]).toBe(FuseState.DISABLE);
  expect(wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(FuseState.DISABLE);
  expect((await getCurrentFuseWire(endToEndExecutable()))[FuseV1Options.EnableNodeCliInspectArguments]).toBe(FuseState.ENABLE);
});

for (const [name, args, port] of [
  ['--remote-debugging-port', ['--remote-debugging-port=9340'], 9340],
  ['--remote-debugging-pipe', ['--remote-debugging-pipe'], null],
  ['--inspect', ['--inspect=127.0.0.1:9341'], 9341],
] as const) {
  test(`the release build refuses ${name}`, async () => {
    let open = false;
    const result = await runUntilLogged(release(), [...args], 'Refused to start with debugging switches', async () => {
      if (port) open = await portOpen(port);
    });
    expect(open).toBe(false);
    expect(result.log).not.toContain('Window ready');
  });
}

test('the app refuses to start without its sandbox', async () => {
  const result = await runUntilLogged(release(), ['--no-sandbox'], 'Refused to start without the sandbox');
  expect(result.log).not.toContain('Window ready');
});

test('the AppImage keeps the sandbox in its desktop entry and starts', async () => {
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
  await runUntilLogged(image!, [], ['Window ready', 'Host started']);
});

test('the Windows installer installs per user, starts and uninstalls', async () => {
  test.skip(process.platform !== 'win32', 'Windows only');
  test.skip(process.env.ATLAS_E2E_INSTALLER !== '1', 'Installs Atlas for the current user; set ATLAS_E2E_INSTALLER=1.');
  const installer = packagedInstaller();
  test.skip(!installer, 'Build the installer first with npm run package.');
  const target = path.join(temporaryDirectory('atlas-install-'), 'Atlas');
  cleanup.push(path.dirname(target));
  execFileSync(installer!, ['/S', '/currentuser', '/D=' + target], { windowsHide: true });
  try {
    expect(existsSync(path.join(target, 'Atlas.exe'))).toBe(true);
    await runUntilLogged(path.join(target, 'Atlas.exe'), [], ['Window ready', 'Host started']);
  } finally {
    execFileSync(path.join(target, 'Uninstall Atlas.exe'), ['/S', '/currentuser'], { windowsHide: true });
  }
});
