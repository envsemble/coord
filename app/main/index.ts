// The Atlas desktop app's main process: single instance, windows that each show one computer's
// projects, the application menu, and the typed message channel the windows use. Projects are read
// by the Atlas host of the computer they are on: this computer's, which this process starts in a
// utility process (main/host/localHost.ts), or a paired computer's. The app keeps its own state in the
// home database (main/state.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { app, dialog, Menu, nativeTheme, powerMonitor, protocol, shell } from 'electron';
import { hostRunning } from '@envsemble/atlas/host';
import { atlasHome, HomeDatabase, legacyData, legacyDataDirectory, legacySettings, migrateHomeFiles, migrateLegacyData, pendingHomeFiles, prepareHome } from '@envsemble/atlas/planning';
import icon from '../build/icon.png?asset';
import { Connections } from './host/connections.ts';
import { dropImports, registerIpc } from './windows/ipc.ts';
import { LocalHost } from './host/localHost.ts';
import { RotatingLog } from './log.ts';
import { buildMenu } from './windows/menu.ts';
import { refusalMessage, startupRefusal, type Refusal } from './refusal.ts';
import { scheme } from './windows/protocol.ts';
import { DesktopState } from './state.ts';
import { WindowManager } from './windows/windows.ts';
import type { AboutInfo } from '../shared/contract.ts';
import { isProjectListing } from '../shared/validate.ts';

// Atlas keeps its state in the Atlas home (~/.atlas, shared with the `atlas` command). Electron's
// own files and Chromium's caches stay in Electron's per-user folder, except for a home chosen with
// ATLAS_HOME (tests, a separate instance), which keeps them too. Setting this before the lock scopes
// the single instance to it; older versions kept all their files there and share that lock.
const dataDirectory = atlasHome();
const electronData = process.env.ATLAS_HOME ? path.join(dataDirectory, 'electron') : legacyDataDirectory();
app.setPath('userData', electronData);
app.setPath('sessionData', path.join(electronData, 'chromium'));
app.setAppUserModelId('dev.envsemble.atlas');
// Atlas never runs without Chromium's sandbox (some AppImage launchers add --no-sandbox when the
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
  const waiting = (process.env.ATLAS_HOME ? null : await moveLegacyData()) ?? await homeFilesBusy();
  let database: HomeDatabase | null = null;
  if (waiting) refuseHome(waiting);
  else {
    try { database = HomeDatabase.open(dataDirectory); } catch (error) {
      refuseHome(`Atlas cannot open its home database: ${(error as Error).message}`);
    }
  }
  if (database) {
    // What Atlas kept in its home before the database moves into it, before the host starts.
    const migration = await migrateHomeFiles(database);
    if (migration.imported.length || migration.failed.length) log.info('Moved the home\'s files into its database', { ...migration });
    start(database);
  }
}

/**
 * The home's files from before its database are imported as Atlas starts, but not while an older
 * `atlas serve` works from them. Returns why it cannot start, or null.
 */
async function homeFilesBusy(): Promise<string | null> {
  if (!(await pendingHomeFiles(dataDirectory)).some(name => !name.startsWith('usage/')) || !await hostRunning(dataDirectory)) return null;
  return `An older atlas serve is using Atlas's settings in ${dataDirectory}. Stop it, then start Atlas again to move them into the home's database.`;
}

/**
 * Move the old data folder's files into the home. Holding the lock means no older Atlas app uses
 * them, but an older `atlas serve` may. Only the packaged app moves them on its own; a development
 * run leaves them to `atlas setup`, as the user's own Atlas may still be an older version that needs
 * them. Atlas never starts on the home while its settings wait (host/, connections, desktop state, the
 * recent list), or it would fill the home with new ones and the move would then set the user's own
 * aside; logs and statistics left behind are merged or set aside later. Returns why it cannot start, or null.
 */
async function moveLegacyData(): Promise<string | null> {
  if (!(await legacyData(electronData)).length) return null;
  if (!app.isPackaged) return !(await legacySettings(electronData)).length ? null : `Atlas's settings are still in ${electronData}. A development run does not move them: run atlas setup to move them into ${dataDirectory}, or set ATLAS_HOME to develop with a separate home.`;
  if (await hostRunning(electronData)) return `An older atlas serve is using Atlas's settings in ${electronData}. Stop it, then start Atlas again to move them into ${dataDirectory}.`;
  const migration = await migrateLegacyData(dataDirectory, electronData);
  log.info('Moved the old data folder into the home', { from: electronData, ...migration });
  // What could not move (a file held open elsewhere) would otherwise be shadowed by the home's new settings.
  const left = await legacySettings(electronData);
  return left.length ? `Some of Atlas's settings could not be moved from ${electronData} into ${dataDirectory} (${migration.failed.filter(item => left.includes(item.split(':')[0])).join('; ') || left.join(', ')}). Close any other program using them, then start Atlas again.` : null;
}

/** Leave without touching the home's settings while the old data folder's wait to be moved. */
function refuseHome(reason: string) {
  log.warn('Not started: the home is not ready', { reason });
  process.stderr.write(reason + '\n');
  void app.whenReady().then(async () => {
    await dialog.showMessageBox({ type: 'warning', title: 'Atlas', message: 'Atlas cannot start yet', detail: reason, buttons: ['Close'] });
    app.exit(1);
  });
}

/** The end-to-end test build is packaged with "atlasEndToEndBuild": true in its package.json. */
function endToEndBuild() {
  try { return JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')).atlasEndToEndBuild === true; } catch { return false; }
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
    await dialog.showMessageBox({ type: 'error', title: 'Atlas', ...refusalMessage(found), buttons: ['Close'] });
    app.exit(1);
  });
}

function start(database: HomeDatabase) {
  const devUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : null;
  const state = new DesktopState(database);
  // The chosen theme reaches every window as prefers-color-scheme, and themes Atlas's own menus and dialogs.
  nativeTheme.themeSource = state.theme;
  const devTools = !app.isPackaged;
  let manager: WindowManager;

  const openLogs = () => { void shell.openPath(log.directory); };
  // About Atlas, in the menu, is a dialog in the window; these are its facts.
  const systems: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  const about = (): AboutInfo => ({
    version: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node,
    system: `${systems[process.platform] ?? process.platform} ${process.getSystemVersion()} (${process.arch})`, dataFolder: dataDirectory,
  });

  const localHost = new LocalHost({
    entry: path.join(import.meta.dirname, 'host.js'), dataDirectory, version: app.getVersion(), log,
    // A restarted host has a new owner token; the connection reads it again and reconnects.
    onRestart: () => connections.local.wake(),
  });
  const connections: Connections = new Connections({
    database, localHost, log,
    onEvent: (client, event, data) => {
      if (event === 'folder.changed') { manager.folderChanged(client, data as never); return; }
      const hostId = client === connections.local ? null : connections.hostIdOf(client);
      if (client !== connections.local && hostId === null) return;
      // A listing that does not read as one (from another computer's host, say) is asked for again instead.
      if (event === 'projects.changed') { const listed = (data as { projects?: unknown } | null)?.projects; manager.projectsChanged(hostId, isProjectListing(listed) ? listed : undefined); }
      else if (event === 'access.changed') manager.accessChanged(hostId, data as never);
    },
    onStatus: (client, status, detail) => manager.connectionChanged(client, status, detail),
  });

  manager = new WindowManager({
    state, database, log, connections, version: app.getVersion(), icon, devUrl, devTools,
    preload: path.join(import.meta.dirname, '../preload/index.cjs'),
    rendererDirectory: path.join(import.meta.dirname, '../renderer'),
  });

  app.on('browser-window-created', (_event, window) => {
    const id = window.id;
    window.on('closed', () => { void dropImports(entry => entry.window === id); });
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  // Starting Atlas again brings it forward.
  app.on('second-instance', () => {
    log.info('Second instance');
    manager.focused()?.focus();
  });

  app.on('window-all-closed', () => app.quit());
  // Stop the host before quitting, so it releases its folders and the remote access lock.
  let hostStopped = false;
  app.on('before-quit', event => {
    manager.setQuitting();
    if (hostStopped) return;
    event.preventDefault();
    hostStopped = true;
    connections.closeAll();
    void Promise.race([localHost.stop(), new Promise(resolve => setTimeout(resolve, 3000))]).finally(() => app.quit());
  });
  app.on('will-quit', () => database.close());

  void app.whenReady().then(async () => {
    log.info('Atlas started', { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, uptimeMs: Math.round(process.uptime() * 1000) });
    Menu.setApplicationMenu(null);
    registerIpc(manager, { openLogs, about });
    buildMenu(manager, { openLogs, devTools });
    try { await localHost.start(); }
    catch (error) {
      log.error('Host could not start', error);
      await dialog.showMessageBox({ type: 'error', title: 'Atlas', message: 'Atlas could not start reading projects.', detail: (error as Error).message + '\n\nDetails are in the log (Open Logs, in the menu).', buttons: ['OK'] });
    }
    connections.local.start();
    // The window buttons in each title bar follow the theme.
    nativeTheme.on('updated', () => { for (const window of manager.all()) window.updateTitleBar(); });
    // After sleep, connections may be dead without either side knowing: try them all again now.
    powerMonitor.on('resume', () => connections.wakeAll());
    manager.restore();
  });
}
