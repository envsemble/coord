// The Atlas desktop app's main process: single instance, one window per planning folder,
// the application menu, and the typed message channel the windows use.
import path from 'node:path';
import { app, dialog, Menu, protocol, shell } from 'electron';
import { atlasDataDirectory, RecentPlanningRoots, recentRootsFile } from '@envsemble/atlas-planning';
import icon from '../build/icon.png?asset';
import { folderArguments } from './args.ts';
import { registerIpc } from './ipc.ts';
import { RotatingLog } from './log.ts';
import { buildMenu } from './menu.ts';
import { scheme } from './protocol.ts';
import { StateStore } from './state.ts';
import { WindowManager, type AtlasWindow } from './windows.ts';

const dataDirectory = atlasDataDirectory();
// Electron's per-user folder is the Atlas data folder shared with the `atlas` command; Chromium's
// own caches stay in one subfolder of it. Setting this before the lock scopes the single
// instance to the data folder.
app.setPath('userData', dataDirectory);
app.setPath('sessionData', path.join(dataDirectory, 'chromium'));
app.setAppUserModelId('dev.envsemble.atlas');
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);

const log = new RotatingLog(path.join(dataDirectory, 'logs'));
const unpackaged = Boolean(process.defaultApp);
const launch = { argv: [...process.argv], cwd: process.cwd() };

process.on('uncaughtException', error => log.error('Uncaught exception', error));
process.on('unhandledRejection', error => log.error('Unhandled rejection', error));

if (!app.requestSingleInstanceLock(launch)) {
  app.quit();
} else {
  start();
}

function start() {
  const devUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : null;
  const state = new StateStore(path.join(dataDirectory, 'desktop-state.json'), error => log.warn('Desktop state not saved', error));
  const recents = new RecentPlanningRoots(recentRootsFile());
  const devTools = !app.isPackaged;
  let manager: WindowManager;

  const openLogs = () => { void shell.openPath(log.directory); };
  const about = (window?: AtlasWindow) => {
    const options = {
      type: 'info' as const, title: 'About Atlas', message: 'Atlas ' + app.getVersion(),
      detail: [
        'Plans, models and shared understanding for agents and the people they work with.',
        '',
        `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node.js ${process.versions.node}`,
        'Data folder: ' + dataDirectory,
        '',
        'Atlas works offline. Plans, models, statistics and logs stay on this computer.',
      ].join('\n'),
      buttons: ['OK'],
    };
    const target = window ?? manager.focused();
    void (target ? dialog.showMessageBox(target.win, options) : dialog.showMessageBox(options));
  };
  const refreshMenu = () => { void manager.recents().then(list => buildMenu(manager, list, { openLogs, about: () => about(), devTools })); };

  manager = new WindowManager({
    state, log, recents, version: app.getVersion(), icon, devUrl, devTools,
    preload: path.join(import.meta.dirname, '../preload/index.cjs'),
    rendererDirectory: path.join(import.meta.dirname, '../renderer'),
    onRecentsChanged: refreshMenu,
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  app.on('second-instance', (_event, argv, cwd, additional) => {
    const extra = additional as { argv?: unknown; cwd?: unknown } | null;
    const source = Array.isArray(extra?.argv) && extra.argv.every(item => typeof item === 'string') ? extra.argv as string[] : argv;
    const directory = typeof extra?.cwd === 'string' ? extra.cwd : cwd;
    const folders = folderArguments(source, directory, unpackaged);
    log.info('Second instance', { folders: folders.length });
    void openFolders(folders, 'command-line').then(opened => { if (!opened) manager.focused()?.focus(); });
  });

  async function openFolders(folders: string[], mode: 'command-line' | 'restore') {
    let opened = 0;
    for (const folder of folders) if (await manager.open(folder, { mode })) opened++;
    return opened;
  }

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => manager.setQuitting());
  app.on('will-quit', () => state.flush());

  void app.whenReady().then(async () => {
    log.info('Atlas started', { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, uptimeMs: Math.round(process.uptime() * 1000) });
    Menu.setApplicationMenu(null);
    registerIpc(manager, { openLogs, about });
    refreshMenu();
    const requested = folderArguments(launch.argv, launch.cwd, unpackaged);
    const opened = requested.length ? await openFolders(requested, 'command-line') : await openFolders(state.windows, 'restore');
    if (!opened && !manager.all().length) await manager.create(null);
  });
}
