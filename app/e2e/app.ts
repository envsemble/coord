// Launch helpers for the end-to-end suite. `npm run package` builds the app twice: the release
// (release/: installer or AppImage, and the unpacked app they contain), and an otherwise identical
// unpacked copy with the inspector fuse on (release/e2e), which Playwright needs to drive the app.
// The suite drives release/e2e; release.spec.ts starts the release build itself. Set
// ATLAS_E2E_EXECUTABLE to drive another build, or ATLAS_E2E_UNPACKAGED=1 to run out/ with Electron.
import { execFileSync, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';

const appDirectory = path.resolve(import.meta.dirname, '..');
const fixture = path.join(import.meta.dirname, 'fixtures', 'planning');
/** This checkout's atlas command, which adopts the fixture into a home as a user would. */
const command = path.resolve(appDirectory, '..', 'packages', 'cli', 'bin', 'atlas.js');

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

/** A fresh copy of the committed fixture planning folder, as its own Git repository; `name` names its project. */
export function planningFixture(name?: string): string {
  const root = path.join(temporaryDirectory('atlas-e2e-'), 'planning');
  cpSync(fixture, root, { recursive: true });
  if (name) writeFileSync(path.join(root, 'planning.json'), readFileSync(path.join(root, 'planning.json'), 'utf8').replace('"name": "Northwind"', JSON.stringify('name') + ': ' + JSON.stringify(name)));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore', windowsHide: true });
  try {
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=Atlas fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'add', '-A');
    git('-c', 'user.name=Atlas fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Fixture planning folder');
  } catch { /* Activity is empty without Git; other tests still run. */ }
  return root;
}

/**
 * An Atlas home with the fixture as a project in its planning folder (`<home>/planning/<slug>`),
 * moved there with `atlas home adopt`, which also imports its work statistics into the home's
 * database. `name` renames the project in its planning.json first. More projects join with
 * addProject. The home is removed with the launched app, or with removeDirectory.
 */
export function projectHome(options: { slug?: string; name?: string; dataDirectory?: string } = {}) {
  const dataDirectory = options.dataDirectory ?? temporaryDirectory('atlas-e2e-data-');
  const slug = options.slug ?? 'northwind';
  const source = planningFixture(options.name);
  execFileSync(process.execPath, [command, 'home', 'adopt', source, '--name', slug], { env: environment(dataDirectory), stdio: 'ignore', windowsHide: true });
  removeDirectory(path.dirname(source));
  // Adopting deleted the statistics files it imported; the user commits that.
  const folder = path.join(dataDirectory, 'planning', slug);
  try { execFileSync('git', ['-C', folder, '-c', 'user.name=Atlas fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-q', '-a', '-m', 'Statistics moved into the Atlas home'], { stdio: 'ignore', windowsHide: true }); } catch { /* Nothing to commit. */ }
  return { dataDirectory, folder };
}
export const addProject = (dataDirectory: string, slug: string, name: string) => projectHome({ dataDirectory, slug, name }).folder;

export function removeDirectory(directory: string) {
  // Windows releases a closed app's files a moment after its processes end.
  try { rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* Best effort. */ }
}

export function environment(dataDirectory: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  env.ATLAS_HOME = dataDirectory;
  // The AppImage extracts itself instead of mounting through FUSE (not available on CI runners).
  env.APPIMAGE_EXTRACT_AND_RUN = '1';
  return env;
}

/** Start the app again, as a user does while Atlas runs; returns its exit code. */
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

export async function launch(options: { dataDirectory?: string; args?: string[]; executable?: string; ownsData?: boolean } = {}): Promise<Launched> {
  const ownsData = options.ownsData ?? !options.dataDirectory;
  const dataDirectory = options.dataDirectory ?? temporaryDirectory('atlas-e2e-data-');
  const env = environment(dataDirectory);
  const extra = options.args ?? [];
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
    // The app logs to atlas.log, and the Atlas host it runs to host.log.
    const recorded = (name: string) => { const log = path.join(dataDirectory, 'logs', name); return existsSync(log) ? readFileSync(log, 'utf8') : '(no log)'; };
    await app.close().catch(() => undefined);
    throw new Error(`${(error as Error).message}\nApp output:\n${output.slice(-4000)}\nApp log:\n${recorded('atlas.log').slice(-4000)}\nHost log:\n${recorded('host.log').slice(-2000)}`);
  }
  await window.waitForLoadState('domcontentloaded');
  return { app, window, dataDirectory, ownsData, process: app.process() };
}

/** Close the app and remove the data folder launch() created for it. */
export async function close(launched: Launched | undefined) {
  if (!launched) return;
  const child = launched.process;
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const exit = new Promise(resolve => { if (exited()) resolve(null); else child.once('exit', resolve); });
  // Quit the app; if it has not exited within 15 seconds, end it and its processes.
  void launched.app.close().catch(() => undefined);
  const stopped = await Promise.race([exit.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 15_000))]);
  if (!stopped) {
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* Already gone. */ } }
    else child.kill('SIGKILL');
    await exit;
  }
  if (launched.ownsData) removeDirectory(launched.dataDirectory);
  if (!stopped) throw new Error('The app did not quit within 15 seconds of being asked to.');
}

/**
 * The sidebar's project cards: the active projects', or those in the hidden and archived group. Found
 * by their markup rather than their role, so they are read past an open dialog too.
 */
export const projectCards = (window: Page, group: 'Projects' | 'Hidden and archived projects' = 'Projects') => window.locator(`[role="group"][aria-label="${group}"] .project-card`);
/** The sidebar's card of the project of that name (a card also says what is going on in the project). */
export const sidebarProject = (window: Page, name = 'Northwind', group?: 'Projects' | 'Hidden and archived projects') => projectCards(window, group).filter({ has: window.getByText(name, { exact: true }) });
/** The sidebar's cards are those of these projects, in this order. */
export async function expectProjects(window: Page, names: string[], group?: 'Projects' | 'Hidden and archived projects') {
  await expect(projectCards(window, group)).toHaveCount(names.length);
  for (const [index, name] of names.entries()) await expect(projectCards(window, group).nth(index).getByText(name, { exact: true }).first()).toBeVisible();
}
/** The sidebar, where it says it has no projects. */
export const sidebar = (window: Page) => window.locator('.workbench .env-app-sidebar');
/** The button in the strip above the projects that makes a new one. */
export const newProjectButton = (window: Page) => sidebar(window).getByRole('button', { name: 'New project', exact: true });

/** Open a project's page from the sidebar and wait for its work list. */
export async function openProject(window: Page, name = 'Northwind') {
  await sidebarProject(window, name).click();
  await expect(window.locator('.project-page h1')).toHaveText(name);
  await expect(window.locator('.work-row').first()).toBeVisible();
}

/**
 * Launch the app on a home with the fixture project (or the home given), and open the project's page.
 * The home is the launch's own unless given, and goes with it.
 */
export async function launchProject(options: { dataDirectory?: string; folder?: string; open?: boolean } = {}) {
  const home = options.dataDirectory ? { dataDirectory: options.dataDirectory, folder: options.folder ?? path.join(options.dataDirectory, 'planning', 'northwind') } : projectHome();
  const launched = await launch({ dataDirectory: home.dataDirectory, ownsData: !options.dataDirectory });
  if (options.open !== false) await openProject(launched.window);
  return { ...launched, folder: home.folder };
}

/** Show the file panel, with the files of the active tab's project. */
export async function showFiles(window: Page) {
  const panel = window.getByRole('region', { name: 'Files' });
  if (!await panel.isVisible()) await window.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(panel.getByRole('tree')).toBeVisible();
  return panel;
}

/** Every window currently open, with the computer it shows. */
export async function windowTitles(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => window.getTitle()));
}
