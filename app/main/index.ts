// The Atlas desktop app's main process: single instance, windows that each show one computer's
// projects, the application menu, and the typed message channel the windows use. Projects are read
// by the Atlas host of the computer they are on: this computer's, which this process starts in a
// utility process (main/host/localHost.ts), or a paired computer's. The app keeps its own state in the
// home database (main/state.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { app, dialog, Menu, nativeTheme, powerMonitor, protocol, shell } from 'electron';
import { atlasHome, electronDataDirectory, HomeDatabase, prepareHome } from '@envsemble/atlas/planning';
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
// the single instance to it.
const dataDirectory = atlasHome();
const electronData = process.env.ATLAS_HOME ? path.join(dataDirectory, 'electron') : electronDataDirectory();
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
  let database: HomeDatabase | null = null;
  try { database = HomeDatabase.open(dataDirectory); } catch (error) {
    refuseHome(`Atlas cannot open its home database: ${(error as Error).message}`);
  }
  if (database) start(database);
}

/** Leave without touching the home when its database cannot be opened. */
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
