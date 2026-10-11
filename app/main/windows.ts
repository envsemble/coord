// One window per planning folder, like VS Code. Opening a folder that is already open focuses
// its window; a window without a folder (the welcome window) is reused for the first folder
// opened from it. The folder is read by an Atlas host: this computer's own (as the owner), or
// another computer's that this app paired with (read-only). Each window has its own in-memory
// session, so its `atlas:` file protocol can only ever see that window's folder.
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, screen, session as electronSession, shell, type Session } from 'electron';
import { inspectPlanningRoot, RecentPlanningRoots, samePlatformPath } from '@envsemble/atlas-planning';
import type { AccessState, EventChannel, FolderChange, MenuCommand, RecentFolder, WindowInfo } from '../shared/contract.ts';
import { AtlasError } from './errors.ts';
import type { ClientStatus, FolderState, HostClient } from '@envsemble/atlas-host';
import type { Connections } from './connections.ts';
import { FolderView, parseRemoteRoot, remoteRoot } from './folderView.ts';
import type { RotatingLog } from './log.ts';
import { createProtocolHandler, originOf, rendererOrigin, scheme } from './protocol.ts';
import type { Bounds, StateStore } from './state.ts';

export interface WindowContext {
  state: StateStore;
  log: RotatingLog;
  connections: Connections;
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
  /** The folder as the host shows it; null until the host opened it (or when it could not). */
  folder: FolderView | null = null;
  /** Which folder this window shows, known as soon as it is bound, before the host opened it. */
  private target: { root: string; name: string; remote: FolderView['remote'] } | null = null;
  /** Counts binds, so a slow bind that a newer one replaced does not take the window back. */
  private binding = 0;
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
    this.win.once('ready-to-show', () => { this.win.show(); context.log.info('Window ready', { folder: this.root }); });
    this.win.on('page-title-updated', event => event.preventDefault());
    this.win.on('resize', () => this.scheduleBounds());
    this.win.on('move', () => this.scheduleBounds());
    this.guardNavigation();
    this.win.webContents.on('render-process-gone', (_event, details) => this.recover(details.reason));
    this.win.webContents.on('unresponsive', () => context.log.warn('Window unresponsive', { folder: this.root }));
    this.win.on('close', () => { this.saveBounds(); });
    this.win.on('closed', () => manager.closed(this));
  }

  get id() { return this.win.id; }
  /** The folder this window shows (its path, or `atlas-remote:` key), including one still opening. */
  get root() { return this.target?.root ?? null; }
  /** Set when the folder is on another computer. */
  get remote() { return this.target?.remote ?? null; }

  /** Lock this window's session down: our protocol only, no remote requests, no permissions. */
  private harden() {
    const { context } = this.manager;
    const session = this.session;
    session.protocol.handle(scheme, createProtocolHandler({ rendererDirectory: context.devUrl ? null : context.rendererDirectory, planningFile: relative => this.folder?.folderId ? this.folder.file(relative) : null }));
    // Copying text (the viewer's copy buttons) is the only permission a window gets.
    const allowed = (permission: string) => permission === 'clipboard-sanitized-write';
    session.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed(permission)));
    session.setPermissionCheckHandler((_contents, permission) => allowed(permission));
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

  /** Bind (or rebind) this window to a planning folder on this computer and start reading it. */
  async bind(root: string) {
    const { context } = this.manager;
    const name = path.basename(root) || root;
    const generation = this.prepare(root, name, null);
    const client = context.connections.local;
    let view: FolderView;
    try {
      const opened = await client.request('folders.open', { path: root });
      const state = await client.follow(opened.folderId);
      view = new FolderView({ client, folderId: opened.folderId, root, name, remote: null }, state);
    } catch (error) {
      context.log.error('Folder could not open', error);
      view = new FolderView({ client, folderId: '', root, name, remote: null }, { folderId: '', name, status: 'invalid', error: (error as Error).message, notice: null, revision: 0 });
    }
    this.settle(generation, view);
  }

  /** Bind this window to a planning folder another computer shares; it only reads. */
  async bindRemote(hostId: string, folderId: string) {
    const { context } = this.manager;
    const root = remoteRoot(hostId, folderId);
    const hostName = context.connections.name(hostId);
    const remote = { hostId, hostName };
    const generation = this.prepare(root, hostName, remote);
    let client: HostClient = context.connections.local;
    let view: FolderView;
    try {
      client = context.connections.client(hostId);
      const shared = await client.request('folders.shared', {}, { timeout: 20000 });
      const entry = shared.find(folder => folder.folderId === folderId);
      if (!entry) throw new AtlasError('forbidden', `${hostName} no longer shares this planning folder.`);
      const state = await client.follow(folderId);
      view = new FolderView({ client, folderId, root, name: entry.name, remote }, state);
    } catch (error) {
      context.log.warn('Remote folder could not open', { hostId, message: (error as Error).message });
      view = new FolderView({ client, folderId, root, name: hostName, remote }, { folderId, name: hostName, status: 'invalid', error: (error as Error).message, notice: null, revision: 0 });
    }
    this.settle(generation, view);
  }

  /** Point the window at a folder before the host opened it: the renderer shows it loading. */
  private prepare(root: string, name: string, remote: FolderView['remote']) {
    const { context } = this.manager;
    this.folder?.close();
    this.folder = null;
    this.target = { root, name, remote };
    const saved = context.state.folder(root);
    if (saved?.bounds && !this.win.isVisible()) this.win.setBounds(visibleBounds(saved.bounds));
    this.updateTitle();
    return ++this.binding;
  }
  /** The host opened the folder (or could not): show it, unless the window moved on meanwhile. */
  private settle(generation: number, view: FolderView) {
    if (generation !== this.binding || this.win.isDestroyed()) { view.close(); return; }
    this.folder = view;
    this.updateTitle();
    this.send('planning:changed', view.change());
  }

  updateTitle() {
    if (this.win.isDestroyed()) return;
    const target = this.target;
    const name = this.folder?.name ?? target?.name;
    this.win.setTitle(target ? name + (target.remote ? ' — ' + target.remote.hostName : '') + ' — Atlas' : 'Atlas');
    if (target && !target.remote) this.win.setRepresentedFilename?.(target.root);
  }

  info(): WindowInfo {
    const folder = this.folder;
    const target = this.target;
    return {
      folder: target ? { root: target.root, name: folder?.name ?? target.name } : null,
      // Until the host opened the folder, the window shows it loading.
      status: folder?.status ?? (target ? 'loading' : null), error: folder?.error ?? null, notice: folder?.notice ?? null, revision: folder?.revision ?? 0,
      version: this.manager.context.version, platform: process.platform, remote: target?.remote ?? null,
    };
  }

  requireFolder(): FolderView {
    if (!this.folder) throw new AtlasError('no-folder', 'Open a planning folder first.');
    return this.folder;
  }

  send(channel: EventChannel, payload: FolderChange | MenuCommand | AccessState) {
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
    if (!this.target || this.win.isDestroyed()) return;
    const bounds = this.win.getNormalBounds();
    this.manager.context.state.updateFolder(this.target.root, { bounds: { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) }, maximized: this.win.isMaximized() });
  }

  /** A crashed renderer reloads; its tabs come back from the saved window state. */
  private recover(reason: string) {
    const { log } = this.manager.context;
    log.error('Window renderer gone', { reason, folder: this.root });
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
    this.binding++;
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
    if (this.windows.size) this.context.state.setWindows(this.all().flatMap(window => window.root ? [window.root] : []));
  }

  /** A new window, optionally for a folder. */
  async create(root: string | null) {
    const saved = root ? this.context.state.folder(root) : undefined;
    const window = new AtlasWindow(this, saved?.bounds, saved?.maximized ?? false);
    this.windows.set(window.id, window);
    // Read the folder while the renderer starts; the renderer waits for the first change event.
    const remote = root ? parseRemoteRoot(root) : null;
    const binding = remote ? window.bindRemote(remote.hostId, remote.folderId) : root ? window.bind(root) : null;
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
    const existing = this.all().find(window => window.root && samePlatformPath(window.root, root));
    if (existing) { existing.focus(); await this.remember(root); return existing; }
    const empty = options.from && !options.from.root ? options.from : undefined;
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

  /** Open a folder another computer shares: focus its window, reuse an empty one, or open a new one. */
  async openRemote(hostId: string, folderId: string, from?: AtlasWindow) {
    const root = remoteRoot(hostId, folderId);
    const existing = this.all().find(window => window.root === root);
    if (existing) { existing.focus(); return existing; }
    let window: AtlasWindow;
    if (from && !from.root) {
      const binding = from.bindRemote(hostId, folderId);
      from.load();
      await binding;
      window = from;
    } else window = await this.create(root);
    this.rememberOpen();
    return window;
  }

  /** A folder event from a host reaches the windows showing that folder. */
  folderChanged(client: HostClient, state: FolderState) {
    for (const window of this.all()) {
      const folder = window.folder;
      if (!folder || folder.client !== client || folder.folderId !== state.folderId) continue;
      folder.update(state);
      window.updateTitle();
      window.send('planning:changed', folder.change());
    }
  }
  /** A connection's status reaches the windows reading through it. */
  connectionChanged(client: HostClient, status: ClientStatus, detail: string | null) {
    for (const window of this.all()) {
      const folder = window.folder;
      if (!folder || folder.client !== client) continue;
      folder.connection(status, detail);
      window.send('planning:changed', folder.change());
    }
  }
  /** Remote access changed on this computer's host (devices, listening): every window may show it. */
  accessChanged(state: AccessState) {
    for (const window of this.all()) window.send('access:changed', state);
  }

  /** Point a window whose folder moved at its new location. */
  async locate(window: AtlasWindow) {
    if (window.remote) throw new AtlasError('forbidden', 'A folder on another computer cannot be located here.');
    const choice = await dialog.showOpenDialog(window.win, { title: 'Locate the planning folder', properties: ['openDirectory'] });
    if (choice.canceled || !choice.filePaths[0]) return;
    let root: string;
    try { root = (await inspectPlanningRoot(choice.filePaths[0])).path; } catch (error) {
      await this.explain(window, 'This folder cannot be opened as a planning folder.', (error as Error).message);
      return;
    }
    const existing = this.all().find(other => other !== window && other.root && samePlatformPath(other.root, root));
    if (existing) { existing.focus(); window.win.close(); return; }
    const previous = window.root;
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
    this.context.state.setWindows(this.all().flatMap(window => window.root ? [window.root] : []));
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
