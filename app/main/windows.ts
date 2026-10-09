// One window per planning folder, like VS Code. Opening a folder that is already open focuses
// its window; a window without a folder (the welcome window) is reused for the first folder
// opened from it. Each window has its own in-memory session, so its `atlas:` file protocol can
// only ever see that window's folder.
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, screen, session as electronSession, shell, type Session } from 'electron';
import { inspectPlanningRoot, RecentPlanningRoots, samePlatformPath } from '@envsemble/atlas-planning';
import type { EventChannel, FolderChange, MenuCommand, RecentFolder, WindowInfo } from '../shared/contract.ts';
import { AtlasError } from './errors.ts';
import { FolderSession } from './folder.ts';
import type { RotatingLog } from './log.ts';
import { createProtocolHandler, originOf, rendererOrigin, scheme } from './protocol.ts';
import type { Bounds, StateStore } from './state.ts';

export interface WindowContext {
  state: StateStore;
  log: RotatingLog;
  recents: RecentPlanningRoots;
  dataBase?: string;
  version: string;
  preload: string;
  icon?: string;
  /** Development renderer URL (electron-vite dev server); production uses atlas://app. */
  devUrl: string | null;
  rendererDirectory: string;
  devTools: boolean;
  onRecentsChanged(): void;
}

const defaultSize = { width: 1280, height: 820 };
const allowedExternal = new Set(['https:', 'http:', 'mailto:']);

export function externalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return allowedExternal.has(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

let partitions = 0;

export class AtlasWindow {
  readonly win: BrowserWindow;
  readonly session: Session;
  folder: FolderSession | null = null;
  private readonly manager: WindowManager;
  private crashes: number[] = [];
  private boundsTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(manager: WindowManager, bounds: Partial<Bounds> | undefined, maximized: boolean) {
    this.manager = manager;
    const context = manager.context;
    this.session = electronSession.fromPartition('atlas-window-' + ++partitions, { cache: false });
    this.harden();
    this.win = new BrowserWindow({
      ...defaultSize, ...visibleBounds(bounds),
      minWidth: 640, minHeight: 420, show: false, backgroundColor: '#22272e', title: 'Atlas',
      icon: context.icon, autoHideMenuBar: false,
      webPreferences: {
        preload: context.preload, session: this.session,
        contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
        webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, experimentalFeatures: false,
        navigateOnDragDrop: false, spellcheck: false, safeDialogs: true, devTools: context.devTools,
      },
    });
    if (maximized) this.win.maximize();
    this.win.once('ready-to-show', () => this.win.show());
    this.win.on('page-title-updated', event => event.preventDefault());
    this.win.on('resize', () => this.scheduleBounds());
    this.win.on('move', () => this.scheduleBounds());
    this.guardNavigation();
    this.win.webContents.on('render-process-gone', (_event, details) => this.recover(details.reason));
    this.win.webContents.on('unresponsive', () => context.log.warn('Window unresponsive', { folder: this.folder?.root ?? null }));
    this.win.on('close', () => { this.saveBounds(); });
    this.win.on('closed', () => manager.closed(this));
  }

  get id() { return this.win.id; }

  /** Lock this window's session down: our protocol only, no remote requests, no permissions. */
  private harden() {
    const { context } = this.manager;
    const session = this.session;
    session.protocol.handle(scheme, createProtocolHandler({ rendererDirectory: context.devUrl ? null : context.rendererDirectory, planningRoot: () => this.folder?.root ?? null }));
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.setDevicePermissionHandler(() => false);
    const dev = context.devUrl ? new URL(context.devUrl) : null;
    session.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const local = ['atlas:', 'data:', 'blob:', 'devtools:'].includes(url.protocol);
      const devServer = dev && (url.protocol === 'http:' || url.protocol === 'ws:') && url.host === dev.host;
      if (!local && !devServer) context.log.warn('Blocked a request', { url: url.protocol + '//' + url.host });
      callback({ cancel: !local && !devServer });
    });
    session.on('will-download', (event, item) => {
      // Only files the viewer generates itself (SVG/JSON exports) may be saved; the user picks where.
      if (!item.getURL().startsWith('blob:')) { event.preventDefault(); return; }
    });
  }

  private guardNavigation() {
    const contents = this.win.webContents;
    const own = (url: string) => originOf(url) !== null && originOf(url) === originOf(this.manager.context.devUrl ?? rendererOrigin);
    contents.on('will-navigate', (event, url) => {
      if (own(url)) return;
      event.preventDefault();
      const external = externalUrl(url);
      if (external) void shell.openExternal(external);
    });
    contents.on('will-redirect', (event, url) => { if (!own(url)) event.preventDefault(); });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      const external = externalUrl(url);
      if (external) void shell.openExternal(external);
      return { action: 'deny' };
    });
  }

  load() {
    const { context } = this.manager;
    void (context.devUrl ? this.win.loadURL(context.devUrl) : this.win.loadURL(rendererOrigin + '/index.html'));
  }

  /** Bind (or rebind) this window to a planning folder and start reading it. */
  async bind(root: string) {
    const { context } = this.manager;
    this.folder?.close();
    const folder = new FolderSession(root, {
      dataBase: context.dataBase, log: context.log,
      onChange: change => { if (this.folder === folder) this.send('planning:changed', change); },
    });
    this.folder = folder;
    this.updateTitle();
    const saved = context.state.folder(root);
    if (saved?.bounds && !this.win.isVisible()) this.win.setBounds(visibleBounds(saved.bounds));
    await folder.start().catch(error => context.log.error('Folder could not start', error));
    this.updateTitle();
  }

  updateTitle() {
    this.win.setTitle(this.folder ? this.folder.name + ' — Atlas' : 'Atlas');
    if (this.folder) this.win.setRepresentedFilename?.(this.folder.root);
  }

  info(): WindowInfo {
    const folder = this.folder;
    return {
      folder: folder ? { root: folder.root, name: folder.name } : null,
      status: folder?.status ?? null, error: folder?.error ?? null, revision: folder?.revision ?? 0,
      version: this.manager.context.version, platform: process.platform,
    };
  }

  requireFolder(): FolderSession {
    if (!this.folder) throw new AtlasError('no-folder', 'Open a planning folder first.');
    return this.folder;
  }

  send(channel: EventChannel, payload: FolderChange | MenuCommand) {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  focus() {
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  private scheduleBounds() {
    if (this.boundsTimer) clearTimeout(this.boundsTimer);
    this.boundsTimer = setTimeout(() => this.saveBounds(), 500);
  }
  private saveBounds() {
    if (this.boundsTimer) { clearTimeout(this.boundsTimer); this.boundsTimer = null; }
    if (!this.folder || this.win.isDestroyed()) return;
    const bounds = this.win.getNormalBounds();
    this.manager.context.state.updateFolder(this.folder.root, { bounds: { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) }, maximized: this.win.isMaximized() });
  }

  /** A crashed renderer reloads; its tabs come back from the saved window state. */
  private recover(reason: string) {
    const { log } = this.manager.context;
    log.error('Window renderer gone', { reason, folder: this.folder?.root ?? null });
    if (reason === 'clean-exit' || this.win.isDestroyed()) return;
    const now = Date.now();
    this.crashes = [...this.crashes.filter(time => now - time < 60000), now];
    if (this.crashes.length <= 3) { this.load(); return; }
    void dialog.showMessageBox(this.win, {
      type: 'error', title: 'Atlas', message: 'This window keeps closing unexpectedly.',
      detail: 'Atlas reloaded it three times in the last minute. Details are in the log (Help › Open Logs).',
      buttons: ['Reload', 'Close Window'], defaultId: 0, cancelId: 1,
    }).then(({ response }) => {
      if (this.win.isDestroyed()) return;
      if (response === 0) { this.crashes = []; this.load(); } else this.win.close();
    });
  }

  close() {
    this.folder?.close();
    this.folder = null;
  }
}

/** Keep restored windows on a connected display. */
function visibleBounds(bounds: Partial<Bounds> | undefined): Partial<Bounds> {
  if (!bounds || bounds.x === undefined || bounds.y === undefined || !bounds.width || !bounds.height) return bounds?.width && bounds.height ? { width: bounds.width, height: bounds.height } : {};
  const area = screen.getDisplayMatching(bounds as Bounds).workArea;
  const overlapX = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const overlapY = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  if (overlapX < 100 || overlapY < 50) return { width: Math.min(bounds.width, area.width), height: Math.min(bounds.height, area.height) };
  return bounds;
}

export class WindowManager {
  readonly context: WindowContext;
  private readonly windows = new Map<number, AtlasWindow>();
  private quitting = false;

  constructor(context: WindowContext) { this.context = context; }

  all() { return [...this.windows.values()]; }
  fromId(id: number) { return this.windows.get(id); }
  focused() { const win = BrowserWindow.getFocusedWindow(); return win ? this.windows.get(win.id) : this.all().at(-1); }
  /** At quit, the open folder windows are restored next time. Closing windows one by one keeps the last one. */
  setQuitting() {
    if (this.quitting) return;
    this.quitting = true;
    if (this.windows.size) this.context.state.setWindows(this.all().flatMap(window => window.folder ? [window.folder.root] : []));
  }

  /** A new window, optionally for a folder. */
  async create(root: string | null) {
    const saved = root ? this.context.state.folder(root) : undefined;
    const window = new AtlasWindow(this, saved?.bounds, saved?.maximized ?? false);
    this.windows.set(window.id, window);
    // Read the folder while the renderer starts; the renderer waits for the first change event.
    const binding = root ? window.bind(root) : null;
    window.load();
    await binding;
    this.rememberOpen();
    return window;
  }

  /**
   * Open a planning folder: focus the window that has it, reuse an empty window, or open a new one.
   * - picker: the folder must be a valid planning folder; problems are explained in a dialog.
   * - command-line: the folder must exist; a broken planning.json shows in its window, with Locate… and Close.
   * - restore: restored folders open even when missing, so their window can offer Locate… and Close.
   */
  async open(input: string, options: { from?: AtlasWindow; mode: 'picker' | 'command-line' | 'restore' }) {
    let root: string;
    try {
      if (options.mode === 'picker') root = (await inspectPlanningRoot(input)).path;
      else if (options.mode === 'command-line') {
        root = await realpath(input).catch(() => { throw new Error('This folder does not exist: ' + input); });
        if (!(await stat(root)).isDirectory()) throw new Error('Choose a folder, not a file: ' + input);
      } else root = await realpath(input).catch(() => path.resolve(input));
    } catch (error) {
      this.context.log.warn('Folder not opened', { input, error: (error as Error).message });
      if (options.mode !== 'restore') await this.explain(options.from, 'This folder cannot be opened as a planning folder.', (error as Error).message + '\n\nA planning folder has a planning.json registry (schema version 1). Use the atlas-bootstrap skill to create one.');
      return null;
    }
    const existing = this.all().find(window => window.folder && samePlatformPath(window.folder.root, root));
    if (existing) { existing.focus(); await this.remember(root); return existing; }
    const empty = options.from && !options.from.folder ? options.from : undefined;
    let window: AtlasWindow;
    if (empty) {
      const binding = empty.bind(root);
      empty.load();
      await binding;
      window = empty;
    } else window = await this.create(root);
    await this.remember(root);
    this.rememberOpen();
    return window;
  }

  /** Point a window whose folder moved at its new location. */
  async locate(window: AtlasWindow) {
    const choice = await dialog.showOpenDialog(window.win, { title: 'Locate the planning folder', properties: ['openDirectory'] });
    if (choice.canceled || !choice.filePaths[0]) return;
    let root: string;
    try { root = (await inspectPlanningRoot(choice.filePaths[0])).path; } catch (error) {
      await this.explain(window, 'This folder cannot be opened as a planning folder.', (error as Error).message);
      return;
    }
    const existing = this.all().find(other => other !== window && other.folder && samePlatformPath(other.folder.root, root));
    if (existing) { existing.focus(); window.win.close(); return; }
    const previous = window.folder?.root;
    if (previous) {
      // Carry the window's tabs and sidebar over to the new location.
      this.context.state.updateFolder(root, { ui: this.context.state.ui(previous) });
      await this.context.recents.forget(previous);
    }
    const binding = window.bind(root);
    window.load();
    await binding;
    await this.remember(root);
    this.rememberOpen();
  }

  async chooseFolder(from?: AtlasWindow) {
    const choice = from ? await dialog.showOpenDialog(from.win, { title: 'Open a planning folder', properties: ['openDirectory'] }) : await dialog.showOpenDialog({ title: 'Open a planning folder', properties: ['openDirectory'] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    return this.open(choice.filePaths[0], { from, mode: 'picker' });
  }

  async recents(): Promise<RecentFolder[]> {
    const list = await this.context.recents.list();
    return Promise.all(list.map(async item => {
      const available = await stat(item).then(info => info.isDirectory(), () => false);
      let workItems: number | null = null;
      if (available) workItems = await inspectPlanningRoot(item).then(info => info.workItems, () => null);
      return { path: item, name: path.basename(item) || item, parent: path.dirname(item), workItems, available };
    }));
  }

  async openRecent(root: string, from?: AtlasWindow) {
    if (!(await this.context.recents.list()).some(item => samePlatformPath(item, root))) throw new AtlasError('invalid-argument', 'This folder is not in the recent list.');
    const opened = await this.open(root, { from, mode: 'picker' });
    if (!opened && !(await stat(root).then(() => true, () => false))) {
      await this.context.recents.forget(root);
      this.context.onRecentsChanged();
    }
  }
  async clearRecents() {
    await this.context.recents.clear();
    this.context.onRecentsChanged();
  }

  sendMenu(command: MenuCommand) {
    const window = this.focused();
    if (window) { window.focus(); window.send('menu:command', command); }
  }

  closed(window: AtlasWindow) {
    window.close();
    this.windows.delete(window.id);
    if (!this.quitting && this.windows.size) this.rememberOpen();
  }

  private rememberOpen() {
    if (this.quitting) return;
    this.context.state.setWindows(this.all().flatMap(window => window.folder ? [window.folder.root] : []));
  }
  private async remember(root: string) {
    await this.context.recents.remember(root);
    this.context.onRecentsChanged();
  }
  private async explain(window: AtlasWindow | undefined, message: string, detail: string) {
    const options = { type: 'warning' as const, title: 'Atlas', message, detail, buttons: ['OK'] };
    if (window && !window.win.isDestroyed()) await dialog.showMessageBox(window.win, options); else await dialog.showMessageBox(options);
  }
}
