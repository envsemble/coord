// Launch helpers for the end-to-end suite. `npm run package` builds the app twice: the release
// (release/: installer or AppImage, and the unpacked app they contain), and an otherwise identical
// unpacked copy with the inspector fuse on (release/e2e), which Playwright needs to drive the app.
// The suite drives release/e2e; release.spec.ts starts the release build itself. Set
// ATLAS_E2E_EXECUTABLE to drive another build, or ATLAS_E2E_UNPACKAGED=1 to run out/ with Electron.
import { execFileSync, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const appDirectory = path.resolve(import.meta.dirname, '..');
const fixture = path.join(import.meta.dirname, 'fixtures', 'planning');

/** The AppImage or Windows installer built by `npm run package`, when present. */
export function packagedInstaller(): string | null {
  const release = path.join(appDirectory, 'release');
  const name = existsSync(release) ? readdirSync(release).find(item => process.platform === 'win32' ? /^Atlas-Setup-.*\.exe$/.test(item) : item.endsWith('.AppImage')) : undefined;
  return name ? path.join(release, name) : null;
}

function unpackedExecutable(release: string): string {
  if (process.platform === 'win32') return path.join(release, 'win-unpacked', 'Atlas.exe');
  if (process.platform === 'linux') return path.join(release, 'linux-unpacked', 'atlas-desktop');
  throw new Error('The end-to-end suite runs on Windows and Linux.');
}
/** The unpacked end-to-end build: the release with the inspector fuse on, for Playwright. */
export function endToEndExecutable(): string {
  return unpackedExecutable(path.join(appDirectory, 'release', 'e2e'));
}
function packagedExecutable(): string {
  return process.env.ATLAS_E2E_EXECUTABLE ? path.resolve(process.env.ATLAS_E2E_EXECUTABLE) : endToEndExecutable();
}
/** The unpacked release build: what the installer and AppImage contain (inspector fuse off). */
export function releaseExecutable(): string {
  return unpackedExecutable(path.join(appDirectory, 'release'));
}

export function temporaryDirectory(prefix: string) {
  // The native call expands Windows 8.3 short names (CI temp folders use them), matching what the app records.
  return realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));
}

/** A fresh copy of the committed fixture planning folder, as its own Git repository. */
export function planningFixture(): string {
  const root = path.join(temporaryDirectory('atlas-e2e-'), 'planning');
  cpSync(fixture, root, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore', windowsHide: true });
  try {
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=Atlas fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'add', '-A');
    git('-c', 'user.name=Atlas fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Fixture planning folder');
  } catch { /* Activity is empty without Git; other tests still run. */ }
  return root;
}

export function removeDirectory(directory: string) {
  // Windows releases a closed app's files a moment after its processes end.
  try { rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* Best effort. */ }
}

export function environment(dataDirectory: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  env.ATLAS_DATA_DIR = dataDirectory;
  // The AppImage extracts itself instead of mounting through FUSE (not available on CI runners).
  env.APPIMAGE_EXTRACT_AND_RUN = '1';
  return env;
}

/** Start the app again, as a user opening a folder while Atlas runs; returns its exit code. */
export function secondInstance(dataDirectory: string, args: string[]): number | null {
  const unpackaged = process.env.ATLAS_E2E_UNPACKAGED === '1';
  const command = unpackaged ? electronBinary() : packagedExecutable();
  const result = spawnSync(command, unpackaged ? [appDirectory, ...args] : args, { env: environment(dataDirectory), timeout: 30_000, windowsHide: true });
  return result.status;
}

function electronBinary(): string {
  return createRequire(import.meta.url)('electron') as unknown as string;
}

export interface Launched { app: ElectronApplication; window: Page; dataDirectory: string; ownsData: boolean; process: ChildProcess }

export async function launch(options: { folder?: string; dataDirectory?: string; args?: string[]; executable?: string } = {}): Promise<Launched> {
  const ownsData = !options.dataDirectory;
  const dataDirectory = options.dataDirectory ?? temporaryDirectory('atlas-e2e-data-');
  const env = environment(dataDirectory);
  const extra = [...(options.folder ? [options.folder] : []), ...(options.args ?? [])];
  // Playwright adds --no-sandbox on Linux unless told to keep the sandbox; Atlas refuses to run without it.
  const common = { args: extra, env, chromiumSandbox: true };
  const app = options.executable ? await electron.launch({ ...common, executablePath: options.executable })
    : process.env.ATLAS_E2E_UNPACKAGED === '1'
    ? await electron.launch({ ...common, args: [appDirectory, ...extra], cwd: appDirectory })
    : await electron.launch({ ...common, executablePath: packagedExecutable() });
  // When the app never opens a window, say why: its output and its own log.
  let output = '';
  app.process().stdout?.on('data', chunk => { output += chunk; });
  app.process().stderr?.on('data', chunk => { output += chunk; });
  let window: Page;
  try {
    window = await app.firstWindow();
  } catch (error) {
    const log = path.join(dataDirectory, 'logs', 'atlas.log');
    const recorded = existsSync(log) ? readFileSync(log, 'utf8') : '(no log)';
    await app.close().catch(() => undefined);
    throw new Error(`${(error as Error).message}\nApp output:\n${output.slice(-4000)}\nApp log:\n${recorded.slice(-4000)}`);
  }
  await window.waitForLoadState('domcontentloaded');
  return { app, window, dataDirectory, ownsData, process: app.process() };
}

/** Close the app and remove the data folder launch() created for it. */
export async function close(launched: Launched | undefined) {
  if (!launched) return;
  const child = launched.process;
  await launched.app.close().catch(() => undefined);
  if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('exit', resolve));
  if (launched.ownsData) removeDirectory(launched.dataDirectory);
}

/** Every window currently open, with the folder name it shows. */
export async function windowTitles(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => window.getTitle()));
}
