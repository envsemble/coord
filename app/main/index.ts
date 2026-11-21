// The Coord desktop app's main process: single instance, windows that each show one computer's
// projects, the application menu, and the typed message channel the windows use. Projects are read
// by the Coord host of the computer they are on: this computer's, which this process starts in a
// utility process (main/host/localHost.ts), or a paired computer's. The app keeps its own state in the
// home database (main/appState.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { app, dialog, Menu, nativeTheme, net, powerMonitor, protocol, shell } from 'electron';
import { coordHome, electronDataDirectory, HomeDatabase, prepareHome } from '@envsemble/coord/planning';
import icon from '../build/app-1024.png?asset';
import { Computers } from './computers/computers.ts';
import { registerIpc } from './windows/ipc.ts';
import { LocalHost } from './host/localHost.ts';
import { RotatingLog } from './log.ts';
import { buildMenu } from './windows/menu.ts';
import { refusalMessage, startupRefusal, type Refusal } from './startupRefusal.ts';
import { scheme } from './windows/protocol.ts';
import { AppState } from './appState.ts';
import { Agents } from './agent/agents.ts';
import { WindowManager } from './windows/windowManager.ts';
import updater, { type BaseUpdater } from 'electron-updater';
import { Updates, type UpdaterEngine } from './updates.ts';
import { fetchChanges } from './updateChanges.ts';
import { devActions, isCoordDev } from './dev.ts';
import type { AboutInfo } from '../shared/contract.ts';
import { isProjectListing } from '../shared/validate.ts';
import { linkScheme, parseAppLink } from '@envsemble/coord/planning/links';

// Coord keeps its state in the Coord home (~/.coord, shared with the `coord` command). Electron's
// own files and Chromium's caches stay in Electron's per-user folder, except for a home chosen with
// COORD_HOME (tests, a separate instance), which keeps them too. Setting this before the lock scopes
// the single instance to it.
const dataDirectory = coordHome();
const electronData = process.env.COORD_HOME ? path.join(dataDirectory, 'electron') : electronDataDirectory();
app.setPath('userData', electronData);
app.setPath('sessionData', path.join(electronData, 'chromium'));
app.setAppUserModelId('dev.envsemble.coord');
// Coord never runs without Chromium's sandbox (some AppImage launchers add --no-sandbox when the
// system lacks unprivileged user namespaces), and a released build never runs with a debugger.
const refusal = startupRefusal({
  hasSwitch: name => app.commandLine.hasSwitch(name),
  environment: process.env,
  packaged: app.isPackaged,
  endToEndBuild: endToEndBuild(),
});
if (refusal?.reason !== 'sandbox') app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);

const log = new RotatingLog(path.join(dataDirectory, 'logs'));

process.on('uncaughtException', error => log.error('Uncaught exception', error));
process.on('unhandledRejection', error => log.error('Unhandled rejection', error));

if (refusal) {
  refuse(refusal);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  await prepareHome();
  let database: HomeDatabase | null = null;
  try { database = HomeDatabase.open(dataDirectory); } catch (error) {
    refuseHome(`Coord cannot open its home database: ${(error as Error).message}`);
  }
  if (database) start(database);
}

/** Leave without touching the home when its database cannot be opened. */
function refuseHome(reason: string) {
  log.warn('Not started: the home is not ready', { reason });
  process.stderr.write(reason + '\n');
  void app.whenReady().then(async () => {
    await dialog.showMessageBox({ type: 'warning', title: 'Coord', message: 'Coord cannot start yet', detail: reason, buttons: ['Close'] });
    app.exit(1);
  });
}

/** The end-to-end test build is packaged with "coordEndToEndBuild": true in its package.json. */
/** The work a link among the arguments names (the system starts Coord with the link it was asked to open); null without one. */
const linkIn = (argv: readonly string[]) => argv.map(parseAppLink).find(link => link !== null) ?? null;

function endToEndBuild() {
  try { return JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')).coordEndToEndBuild === true; } catch { return false; }
}

/**
 * electron-updater's updater for this build, or why updates are off: they come with the installed
 * app on Windows and the AppImage on Linux, never with a development or end-to-end build, and a
 * test run can turn them off (COORD_NO_UPDATES=1).
 */
function updaterEngine(): UpdaterEngine | { off: string } {
  if (!app.isPackaged) return { off: 'This is a development build: updates come with the installed app.' };
  if (endToEndBuild() || process.env.COORD_NO_UPDATES === '1') return { off: 'Updates are turned off for this run.' };
  if (process.platform === 'linux' && !process.env.APPIMAGE) return { off: 'Coord updates itself when it runs as its AppImage.' };
  if (process.platform !== 'win32' && process.platform !== 'linux') return { off: 'Coord updates itself on Windows and Linux.' };
  const engine = updater.autoUpdater;
  if (process.platform === 'linux') {
    // electron-updater starts the new AppImage at once and then quits; while Coord's host stops, the
    // old process still holds the single-instance lock, and the new one would quit on it. So the new
    // AppImage is only put in place here, and Electron starts it once this process has exited.
    const appImage = engine as unknown as BaseUpdater;
    let moved: string | null = null;
    appImage.on('appimage-filename-updated', (file: string) => { moved = file; });
    appImage.quitAndInstall = () => {
      // A failed install is in the log; the next press tries again, as electron-updater's own does.
      if (!appImage.install(true, false)) { (appImage as unknown as { quitAndInstallCalled: boolean }).quitAndInstallCalled = false; return; }
      app.relaunch({ execPath: moved ?? process.env.APPIMAGE!, args: [] });
      app.quit();
    };
  }
  engine.logger = { info: (message: unknown) => log.info('Updater: ' + String(message)), warn: (message: unknown) => log.warn('Updater: ' + String(message)), error: (message: unknown) => log.warn('Updater: ' + String(message)), debug: () => {} };
  return engine as unknown as UpdaterEngine;
}

function refuse(found: Refusal) {
  log.error(found.reason === 'sandbox' ? 'Refused to start without the sandbox' : 'Refused to start with debugging switches', { switches: found.switches });
  if (found.reason === 'debugging') {
    // Leave before Chromium opens its debugging port; a developer passing these switches reads stderr.
    const { message, detail } = refusalMessage(found);
    process.stderr.write(message + ' ' + detail + '\n');
    app.exit(1);
    return;
  }
  void app.whenReady().then(async () => {
    await dialog.showMessageBox({ type: 'error', title: 'Coord', ...refusalMessage(found), buttons: ['Close'] });
    app.exit(1);
  });
}

function start(database: HomeDatabase) {
  const devUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : null;
  const state = new AppState(database);
  // The chosen theme reaches every window as prefers-color-scheme, and themes Coord's own menus and dialogs.
  nativeTheme.themeSource = state.theme;
  const devTools = !app.isPackaged;
  // Coord Dev: `npm run dev`'s app, on a copy of the data with its own plugin (main/dev.ts).
  const coordDev = isCoordDev(app.isPackaged, process.env);
  let manager: WindowManager;

  const openLogs = () => { void shell.openPath(log.directory); };
  // About Coord, in the menu, is a dialog in the window; these are its facts.
  const systems: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  const about = (): AboutInfo => ({
    version: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node,
    system: `${systems[process.platform] ?? process.platform} ${process.getSystemVersion()} (${process.arch})`, dataFolder: dataDirectory,
  });

  const localHost = new LocalHost({
    entry: path.join(import.meta.dirname, 'host.js'), dataDirectory, version: app.getVersion(), log,
    // A restarted host has a new owner token; the connection reads it again and reconnects.
    onRestart: () => computers.local.wake(),
  });
  const computers: Computers = new Computers({
    database, localHost, log,
    onEvent: (client, event, data) => {
      if (event === 'project.changed') { manager.projectChanged(client, data as never); return; }
      const hostId = client === computers.local ? null : computers.hostIdOf(client);
      if (client !== computers.local && hostId === null) return;
      // A listing that does not read as one (from another computer's host, say) is asked for again instead.
      if (event === 'projects.changed') { const listed = (data as { projects?: unknown } | null)?.projects; manager.projectsChanged(hostId, isProjectListing(listed) ? listed : undefined); }
      else if (event === 'access.changed') manager.accessChanged(hostId, data as never);
    },
    onStatus: (client, status, detail) => manager.connectionChanged(client, status, detail),
  });

  // The coord command and the plugin, which the packaged app carries in resources/agent, and Coord
  // Dev gets from its launcher (main/dev.ts). Only the installed app on the user's own home puts the
  // command on the PATH and refreshes the connected agents after an update: a home chosen with
  // COORD_HOME (tests, a separate instance, Coord Dev's copy) leaves the user's `coord` and agents alone.
  const agents = new Agents({
    home: dataDirectory, log,
    bundle: app.isPackaged ? path.join(process.resourcesPath, 'agent') : coordDev ? process.env.COORD_DEV_BUNDLE! : null,
    checkout: path.resolve(app.getAppPath(), '..'),
    ownHome: app.isPackaged && !process.env.COORD_HOME,
    lastSession: harness => (database.db.prepare('SELECT max(updated_at) AS at FROM session WHERE harness = ?').get(harness) as { at: string | null }).at,
  });

  // Coord's own updates, from its releases on GitHub, in the installed app only.
  const dev = coordDev ? devActions(agents, log) : null;

  const updates = new Updates({
    version: app.getVersion(), log,
    engine: updaterEngine(),
    setting: { get: () => database.setting('updateChannel'), set: value => database.setSetting('updateChannel', value) },
    onChange: state => manager?.updatesChanged(state),
    // Through Chromium's network stack, so a system proxy applies as it does to the update itself.
    changes: (from, to) => fetchChanges(from, to, net.fetch as typeof fetch),
  });

  manager = new WindowManager({
    state, database, log, computers, version: app.getVersion(), icon, devUrl, devTools, dev: coordDev,
    preload: path.join(import.meta.dirname, '../preload/index.cjs'),
    rendererDirectory: path.join(import.meta.dirname, '../renderer'),
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  // Starting Coord again brings it forward; started by a link that names work (coord://open/<project>/<part>), it opens that work.
  app.on('second-instance', (_event, argv) => {
    const link = linkIn(argv);
    log.info('Second instance', { link: link !== null });
    if (link) manager.openLink(link);
    else manager.focused()?.focus();
  });

  app.on('window-all-closed', () => app.quit());
  // Stop the host before quitting, so it releases its folders and the remote access lock.
  let hostStopped = false;
  app.on('before-quit', event => {
    manager.setQuitting();
    if (hostStopped) return;
    event.preventDefault();
    hostStopped = true;
    computers.closeAll();
    void Promise.race([localHost.stop(), new Promise(resolve => setTimeout(resolve, 3000))]).finally(() => app.quit());
  });
  app.on('will-quit', () => database.close());

  void app.whenReady().then(async () => {
    log.info('Coord started', { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, uptimeMs: Math.round(process.uptime() * 1000) });
    Menu.setApplicationMenu(null);
    registerIpc(manager, { openLogs, about, agents, updates, dev });
    buildMenu(manager, { openLogs, devTools });
    // The host starts while the windows open: the connection waits for its owner token.
    const hostStarted = localHost.start().catch(async error => {
      log.error('Host could not start', error);
      await dialog.showMessageBox({ type: 'error', title: 'Coord', message: 'Coord could not start reading projects.', detail: (error as Error).message + '\n\nDetails are in the log (Open Logs, in the menu).', buttons: ['OK'] });
    });
    computers.local.start();
    // The window buttons in each title bar follow the theme.
    nativeTheme.on('updated', () => { for (const window of manager.all()) window.updateTitleBar(); });
    // After sleep, connections may be dead without either side knowing: try them all again now.
    powerMonitor.on('resume', () => computers.wakeAll());
    manager.restore();
    // Started by a link that names work: a window opens it once it has its projects.
    const link = linkIn(process.argv);
    if (link) manager.openLink(link);
    // The installed app, on the user's own home, answers such links from now on: a build under test, Coord Dev and a
    // separate instance (COORD_HOME) leave the system's registration alone.
    if (app.isPackaged && !process.env.COORD_HOME && !endToEndBuild() && !coordDev) app.setAsDefaultProtocolClient(linkScheme);
    // After the windows open: an update copies the command and the plugin into the home.
    void agents.start().then(() => dev?.start());
    updates.start();
    await hostStarted;
  });
}
