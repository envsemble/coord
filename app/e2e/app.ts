// Launch helpers for the end-to-end suite. `npm run package` builds the app twice: the release
// (release/: installer or AppImage, and the unpacked app they contain), and an otherwise identical
// unpacked copy with the inspector fuse on (release/e2e), which Playwright needs to drive the app.
// The suite drives release/e2e; release.spec.ts starts the release build itself. Set
// COORD_E2E_EXECUTABLE to drive another build, or COORD_E2E_UNPACKAGED=1 to run out/ with Electron.
// The app's windows open off screen and never take focus, so a run stays out of the way of whoever
// works at the computer; COORD_E2E_VISIBLE=1 shows them where the app puts them, to watch a run.
import { execFileSync, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { canonicalProjectFolderSync, HomeDatabase, insertReport, type WorkReport } from '@envsemble/coord/planning';
import type { CoordBridge } from '../shared/contract.ts';

const appDirectory = path.resolve(import.meta.dirname, '..');
const fixture = path.join(import.meta.dirname, 'fixtures', 'planning');
/** The agents' reports on the fixture's work, by work item, as the hooks record them in the home's database. */
const fixtureReports = path.join(import.meta.dirname, 'fixtures', 'reports.json');

/** The AppImage or Windows installer built by `npm run package`, when present. */
export function packagedInstaller(): string | null {
  const release = path.join(appDirectory, 'release');
  const name = existsSync(release) ? readdirSync(release).find(item => process.platform === 'win32' ? /^Coord-Setup-.*\.exe$/.test(item) : item.endsWith('.AppImage')) : undefined;
  return name ? path.join(release, name) : null;
}

function unpackedExecutable(release: string): string {
  if (process.platform === 'win32') return path.join(release, 'win-unpacked', 'Coord.exe');
  if (process.platform === 'linux') return path.join(release, 'linux-unpacked', 'coord-desktop');
  throw new Error('The end-to-end suite runs on Windows and Linux.');
}
/** The unpacked end-to-end build: the release with the inspector fuse on, for Playwright. */
export function endToEndExecutable(): string {
  return unpackedExecutable(path.join(appDirectory, 'release', 'e2e'));
}
function packagedExecutable(): string {
  return process.env.COORD_E2E_EXECUTABLE ? path.resolve(process.env.COORD_E2E_EXECUTABLE) : endToEndExecutable();
}
/** The unpacked release build: what the installer and AppImage contain (inspector fuse off). */
export function releaseExecutable(): string {
  return unpackedExecutable(path.join(appDirectory, 'release'));
}

export function temporaryDirectory(prefix: string) {
  // The native call expands Windows 8.3 short names (CI temp folders use them), matching what the app records.
  return realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));
}

/**
 * A fresh copy of the committed fixture planning folder, as its own Git repository, at `root` (by
 * default a new temporary folder); `name` names its project.
 */
export function planningFixture(name?: string, root = path.join(temporaryDirectory('coord-e2e-'), 'planning')): string {
  cpSync(fixture, root, { recursive: true });
  if (name) writeFileSync(path.join(root, 'planning.json'), readFileSync(path.join(root, 'planning.json'), 'utf8').replace('"name": "Northwind"', JSON.stringify('name') + ': ' + JSON.stringify(name)));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore', windowsHide: true });
  try {
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=Coord fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'add', '-A');
    git('-c', 'user.name=Coord fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Fixture planning folder');
  } catch { /* Activity is empty without Git; other tests still run. */ }
  return root;
}

/**
 * A Coord home with the fixture as a project in its planning folder (`<home>/planning/<slug>`), with
 * the agents' reports on its work in the home's database, as the hooks record them. `name` renames
 * the project in its planning.json. More projects join with addProject. The home is removed with the
 * launched app, or with removeDirectory.
 */
export function projectHome(options: { slug?: string; name?: string; dataDirectory?: string } = {}) {
  const dataDirectory = options.dataDirectory ?? temporaryDirectory('coord-e2e-data-');
  const slug = options.slug ?? 'northwind';
  const folder = planningFixture(options.name, path.join(dataDirectory, 'planning', slug));
  const reports = JSON.parse(readFileSync(fixtureReports, 'utf8')) as Record<string, WorkReport[]>;
  const database = HomeDatabase.open(dataDirectory);
  try {
    const project = database.addProject(canonicalProjectFolderSync(folder), options.name ?? 'Northwind');
    for (const [work, items] of Object.entries(reports)) for (const report of items) insertReport(database, project.id, work, report);
  } finally { database.close(); }
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
  env.COORD_HOME = dataDirectory;
  // The agents the app lists (claude and codex plugin list) read configurations of the test's own.
  env.CLAUDE_CONFIG_DIR = path.join(dataDirectory, 'claude');
  env.CODEX_HOME = path.join(dataDirectory, 'codex');
  for (const folder of [env.CLAUDE_CONFIG_DIR, env.CODEX_HOME]) mkdirSync(folder, { recursive: true });
  // The AppImage extracts itself instead of mounting through FUSE (not available on CI runners).
  env.APPIMAGE_EXTRACT_AND_RUN = '1';
  // A release build would look for its update on GitHub; tests stay offline.
  env.COORD_NO_UPDATES = '1';
  return env;
}

/** Start the app again, as a user does while Coord runs; returns its exit code. */
export function secondInstance(dataDirectory: string, args: string[]): number | null {
  const unpackaged = process.env.COORD_E2E_UNPACKAGED === '1';
  const command = unpackaged ? electronBinary() : packagedExecutable();
  const result = spawnSync(command, unpackaged ? [appDirectory, ...args] : args, { env: environment(dataDirectory), timeout: 30_000, windowsHide: true });
  return result.status;
}

function electronBinary(): string {
  return createRequire(import.meta.url)('electron') as unknown as string;
}

const visible = process.env.COORD_E2E_VISIBLE === '1';
/** Chromium keeps painting a window off screen as it does one on screen, instead of treating it as hidden. */
const offScreenSwitches = visible ? [] : ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows'];

/**
 * Keep the app's windows out of the way: each shows without taking focus, off screen, and never
 * maximizes or comes forward. Done before the first window shows (it shows once its page has loaded).
 */
async function keepOffScreen(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    const away = (window: InstanceType<typeof BrowserWindow>) => { if (!window.isDestroyed()) window.setPosition(-32000, -32000); };
    const prototype = BrowserWindow.prototype;
    prototype.show = function (this: InstanceType<typeof BrowserWindow>) { away(this); this.showInactive(); };
    prototype.focus = function () {};
    prototype.maximize = function () {};
    prototype.moveTop = function () {};
    for (const window of BrowserWindow.getAllWindows()) away(window);
  });
}

export interface Launched { app: ElectronApplication; window: Page; dataDirectory: string; ownsData: boolean; process: ChildProcess }

/**
 * Start the app on a home (by default a new temporary one). The onboarding, which shows on launch until
 * it is finished, counts as done unless `onboarding` asks for it, so the window shows at once.
 */
export async function launch(options: { dataDirectory?: string; args?: string[]; executable?: string; ownsData?: boolean; onboarding?: boolean } = {}): Promise<Launched> {
  const ownsData = options.ownsData ?? !options.dataDirectory;
  const dataDirectory = options.dataDirectory ?? temporaryDirectory('coord-e2e-data-');
  // Where the app records the onboarding as done (main/agent/agents.ts).
  const onboarding = path.join(dataDirectory, 'agent', 'onboarding.json');
  if (!options.onboarding && !existsSync(onboarding)) {
    mkdirSync(path.dirname(onboarding), { recursive: true });
    writeFileSync(onboarding, JSON.stringify({ done: true }) + '\n');
  }
  const env = environment(dataDirectory);
  const extra = [...offScreenSwitches, ...options.args ?? []];
  // Playwright adds --no-sandbox on Linux unless told to keep the sandbox; Coord refuses to run without it.
  const common = { args: extra, env, chromiumSandbox: true };
  const app = options.executable ? await electron.launch({ ...common, executablePath: options.executable })
    : process.env.COORD_E2E_UNPACKAGED === '1'
    ? await electron.launch({ ...common, args: [appDirectory, ...extra], cwd: appDirectory })
    : await electron.launch({ ...common, executablePath: packagedExecutable() });
  if (!visible) await keepOffScreen(app);
  // When the app never opens a window, say why: its output and its own log.
  let output = '';
  app.process().stdout?.on('data', chunk => { output += chunk; });
  app.process().stderr?.on('data', chunk => { output += chunk; });
  let window: Page;
  try {
    window = await app.firstWindow();
  } catch (error) {
    // The app logs to coord.log, and the Coord host it runs to host.log.
    const recorded = (name: string) => { const log = path.join(dataDirectory, 'logs', name); return existsSync(log) ? readFileSync(log, 'utf8') : '(no log)'; };
    await app.close().catch(() => undefined);
    throw new Error(`${(error as Error).message}\nApp output:\n${output.slice(-4000)}\nApp log:\n${recorded('coord.log').slice(-4000)}\nHost log:\n${recorded('host.log').slice(-2000)}`);
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

/** The hub's plan rows, or the row of the plan of that title. */
export const hubRows = (window: Page, title?: string) => title ? window.locator('.hub-row').filter({ has: window.getByRole('link', { name: title, exact: true }) }) : window.locator('.hub-row');
/** The window shows the hub, with every plan or (`heading`) one project's. */
export async function expectHub(window: Page, heading = 'Plans') {
  await expect(window.locator('.hub h1')).toHaveText(heading);
}
/** Open a plan from the hub with one click (the first, when projects share it) and wait for it. */
export async function openPlan(window: Page, title: string) {
  await hubRows(window, title).first().getByRole('link', { name: title, exact: true }).click();
  await expect(window.locator('.work-page h1')).toHaveText(title);
}
/** The window's title bar: envUI's TopBar, one row above the page. */
export const titleBar = (window: Page) => window.locator('.window-title-bar');
/** One of the title bar's buttons: Plans, Settings or Help, which opens its menu. */
export const titleButton = (window: Page, name: 'Plans' | 'Settings' | 'Help') => titleBar(window).getByRole('button', { name, exact: true });
/** Choose an item of the title bar's Help menu. */
export async function chooseMenu(window: Page, item: string) {
  await titleButton(window, 'Help').click();
  await window.getByRole('menu', { name: 'Help' }).getByRole('menuitem', { name: item, exact: true }).click();
}
/** Go to the hub of every project: the title bar's Plans. */
export async function goHome(window: Page) {
  await titleButton(window, 'Plans').click();
  await expectHub(window);
}
/** The projects as the window's computer lists them, asked through the window's bridge. */
export const listedProjects = (window: Page) => window.evaluate(async () => {
  const result = await (globalThis as unknown as { coord: CoordBridge }).coord.projects();
  return result.ok ? result.value : [];
});
/** The search popup: the hub's search field, the title bar's search and Ctrl+P open it. */
export const searchPopup = (window: Page) => window.getByRole('dialog', { name: 'Search' });
/** Run an item of main's application menu (the system's menu bar on macOS, hidden elsewhere, holding the shortcuts). */
export async function applicationMenu(app: ElectronApplication, menu: string, item: string) {
  await app.evaluate(({ BrowserWindow, Menu }, [menuLabel, itemLabel]) => {
    const entry = Menu.getApplicationMenu()!.items.find(candidate => candidate.label === menuLabel)!.submenu!.items.find(candidate => candidate.label === itemLabel)!;
    entry.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  }, [menu, item] as const);
}

/** The hub's project menu button, which names the project the hub shows (or All projects). */
export const projectButton = (window: Page, name?: string) => window.locator('.hub').getByRole('button', name ? { name: 'Project: ' + name, exact: true } : { name: /^Project: / });
/** Open the hub's project menu, where projects are chosen, made and managed. */
export async function openProjectMenu(window: Page) {
  await projectButton(window).click();
  const menu = window.getByRole('menu', { name: 'Project' });
  await expect(menu).toBeVisible();
  return menu;
}
/** Close the open menus with Escape. */
export async function closeMenus(window: Page) {
  await window.keyboard.press('Escape');
  await expect(window.getByRole('menu')).toHaveCount(0);
}
/** Show one project's plans in the hub, by its project menu. */
export async function filterHub(window: Page, project: string) {
  const menu = await openProjectMenu(window);
  await menu.getByRole('group', { name: 'Projects' }).getByRole('menuitem', { name: project, exact: true }).click();
  await expectHub(window, project);
}
/** The project menu lists these active projects, in this order. */
export async function expectProjects(window: Page, names: string[]) {
  const menu = await openProjectMenu(window);
  await expect(menu.getByRole('group', { name: 'Projects' }).getByRole('menuitem').locator('.env-menu-item-label')).toHaveText(['All projects', ...names]);
  await closeMenus(window);
}
/** The project menu's Archived projects, opened. */
async function openArchived(window: Page) {
  const menu = await openProjectMenu(window);
  await menu.getByRole('menuitem', { name: /^Archived projects/ }).click();
  const archived = window.getByRole('menu', { name: /^Archived projects/ });
  await expect(archived).toBeVisible();
  return archived;
}
/** The project menu's Archived projects lists these, each to restore; with none, it has no such submenu. */
export async function expectArchived(window: Page, names: string[]) {
  if (!names.length) {
    const menu = await openProjectMenu(window);
    await expect(menu.getByRole('menuitem', { name: /^Archived projects/ })).toHaveCount(0);
  } else {
    const archived = await openArchived(window);
    await expect(archived.getByRole('menuitem').locator('.env-menu-item-label')).toHaveText(names);
    // Escape closes the submenu first, then the menu.
    await window.keyboard.press('Escape');
    await expect(archived).toHaveCount(0);
  }
  await closeMenus(window);
}
/** Restore an archived project from the project menu. */
export async function restoreProject(window: Page, name: string) {
  await (await openArchived(window)).getByRole('menuitem', { name: 'Restore ' + name, exact: true }).click();
  await expect(window.getByRole('menu')).toHaveCount(0);
}
/** Run one of a project's actions from the hub's project menu, the hub filtered to the project first. */
export async function projectAction(window: Page, name: string, action: string) {
  if (!await projectButton(window, name).count()) await filterHub(window, name);
  const menu = await openProjectMenu(window);
  await menu.getByRole('menuitem', { name: action, exact: true }).click();
}
/** A project's folders, opened from the hub's project menu. */
export async function projectDetails(window: Page, name: string) {
  await projectAction(window, name, 'Folders…');
  const dialog = window.getByRole('dialog', { name: name + ': folders' });
  await expect(dialog).toBeVisible();
  return dialog;
}
/** A project's statistics, from the hub filtered to it (going to the hub first when it is not shown). */
export async function openProjectStatistics(window: Page, name = 'Northwind') {
  if (!await window.locator('.hub').count()) await goHome(window);
  if (!await projectButton(window, name).count()) await filterHub(window, name);
  await window.locator('.hub').getByRole('button', { name: 'Statistics', exact: true }).click();
  await expect(window.locator('.statistics-page h1')).toHaveText('Statistics');
  await expect(window.locator('.window-page .breadcrumb')).toHaveText(new RegExp('^Plans.*' + name + '.*Statistics$'));
}

/** The element the window's content scrolls in, below the title bar. */
export const pageScroll = (window: Page) => window.evaluate(() => document.querySelector('.env-scaffold-body')!.scrollTop);
/** The content's scroll position once it has settled. */
export async function settledScroll(window: Page) {
  let position = -1;
  await expect.poll(async () => {
    const top = await pageScroll(window);
    const steady = Math.abs(top - position) < 0.5;
    position = top;
    return steady;
  }, { intervals: [200] }).toBe(true);
  return position;
}

/**
 * Launch the app on a home with the fixture project (or the home given), and wait for the hub to list
 * its plans. The home is the launch's own unless given, and goes with it.
 */
export async function launchProject(options: { dataDirectory?: string; folder?: string } = {}) {
  const home = options.dataDirectory ? { dataDirectory: options.dataDirectory, folder: options.folder ?? path.join(options.dataDirectory, 'planning', 'northwind') } : projectHome();
  const launched = await launch({ dataDirectory: home.dataDirectory, ownsData: !options.dataDirectory });
  await expect(hubRows(launched.window).first()).toBeVisible();
  return { ...launched, folder: home.folder };
}

/** The plan's files, at the left of its pages, with the files of the plan's own folder. */
export const filesSidebar = (window: Page) => window.getByRole('navigation', { name: /^Files of / });
export async function showFiles(window: Page) {
  const sidebar = filesSidebar(window);
  await expect(sidebar.getByRole('tree')).toBeVisible();
  return sidebar;
}

/** The name of the file the window shows: the last part of its breadcrumb. */
export const shownFile = (window: Page) => window.locator('.file-page .file-name');

/** Open a document of the open plan's project by its name, through the search. */
export async function openDocument(window: Page, name: string) {
  await titleBar(window).getByRole('button', { name: 'Search', exact: true }).click();
  const popup = searchPopup(window);
  await popup.getByRole('combobox').fill(name.replace(/\.md$/, ''));
  await popup.getByRole('option').filter({ hasText: name }).first().click();
  await expect(shownFile(window)).toContainText(name);
}

/** Every window currently open, with the computer it shows. */
export async function windowTitles(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => window.getTitle()));
}
