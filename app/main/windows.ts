// Each window shows one planning folder, like VS Code: on this computer, or on another computer this
// app paired with. A folder that is already open somewhere brings that window forward. Choosing a
// folder or a computer from a window opens it in that window or, when asked, in a new one; a window
// without a folder (the welcome window) shows one computer's folder list. The folder is read by an
// Atlas host: this computer's own (as the owner), or the paired computer's. Each window has its own
// in-memory session, so its `atlas:` file protocol can only ever see that window's folder.
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, nativeTheme, screen, session as electronSession, shell, type Session } from 'electron';
import { inspectPlanningRoot, samePlatformPath } from '@envsemble/atlas-planning';
import type { AccessState, BrowseResult, ComputerFolder, EventChannel, FolderChange, MenuCommand, WindowInfo } from '../shared/contract.ts';
import { AtlasError } from './errors.ts';
import type { ClientStatus, FolderState, HostClient } from '@envsemble/atlas-host';
import type { Connections } from './connections.ts';
import { FolderView, parseRemoteRoot, remoteRoot } from './folderView.ts';
import type { RotatingLog } from './log.ts';
import { createProtocolHandler, originOf, rendererOrigin, scheme } from './protocol.ts';
import { computerKey, type Bounds, type StateStore } from './state.ts';

/** Whether opening a folder may reuse the window it was asked from: always, only a window without a folder, or never. */
export type Reuse = 'always' | 'empty' | 'never';
/** The last part of a path from any computer (another computer's paths may use the other separator). */
export const baseName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;

/** envUI's canvas colour in the window's theme, shown until the page paints. */
const windowBackground = () => nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#ffffff';

/** The height of the title bar the window draws itself (envUI's `--title-bar-height`), at 100% zoom. */
export const titleBarHeight = 40;
/**
 * The system's window buttons over the title bar the page draws: on the canvas colour, in its text
 * colour, and as tall as the bar when zoomed in (zoomed out, the bar keeps its height and so do they).
 * The page reads their area from the window controls overlay's environment variables.
 */
export const titleBarOverlay = (zoom = 1) => {
  const height = Math.round(titleBarHeight * Math.max(1, zoom));
  return nativeTheme.shouldUseDarkColors ? { color: '#1f1f1f', symbolColor: '#e8eaed', height } : { color: '#ffffff', symbolColor: '#202124', height };
};
/** Input only a person at the computer produces (presses, keys, taps; not pointer movement), which a page cannot fake. */
const activations = new Set(['mouseDown', 'mouseUp', 'rawKeyDown', 'keyDown', 'keyUp', 'char', 'gestureTap', 'touchEnd']);
/** macOS keeps its traffic lights, centred in the title bar; elsewhere the overlay draws minimize, maximize and close. */
const titleBar = () => process.platform === 'darwin'
  ? { titleBarStyle: 'hidden' as const, titleBarOverlay: true, trafficLightPosition: { x: 14, y: 13 } }
  : { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlay() };

export interface WindowContext {
  state: StateStore;
  log: RotatingLog;
  connections: Connections;
  dataBase?: string;
  version: string;
  preload: string;
  icon?: string;
  /** Development renderer URL (electron-vite dev server); production uses atlas://app. */
  devUrl: string | null;
  rendererDirectory: string;
  devTools: boolean;
  /** This computer's folder list changed (the File menu lists it). */
  onFoldersChanged(): void;
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
  /** Without a folder: the computer whose folder list the welcome page shows (null: this one). */
  private welcomeComputer: string | null = null;
  /** The highest revision this window has shown: a new binding continues above it, so the window never ignores fresh data. */
  private revisionFloor = 0;
  private readonly manager: WindowManager;
  private crashes: number[] = [];
  private boundsTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the person last pressed, typed or tapped in this window. */
  private lastActivation = 0;

  constructor(manager: WindowManager, bounds: Partial<Bounds> | undefined, maximized: boolean) {
    this.manager = manager;
    const context = manager.context;
    this.session = electronSession.fromPartition('atlas-window-' + ++partitions, { cache: false });
    this.harden();
    this.win = new BrowserWindow({
      ...defaultSize, ...visibleBounds(bounds),
      minWidth: 640, minHeight: 420, show: false, backgroundColor: windowBackground(), title: 'Atlas',
      icon: context.icon, ...titleBar(),
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
    this.win.webContents.on('input-event', (_event, input) => { if (activations.has(input.type)) this.lastActivation = performance.now(); });
    this.win.webContents.on('unresponsive', () => context.log.warn('Window unresponsive', { folder: this.root }));
    this.win.on('close', () => { this.saveBounds(); });
    this.win.on('closed', () => manager.closed(this));
  }

  get id() { return this.win.id; }
  /** The folder this window shows (its path, or `atlas-remote:` key), including one still opening. */
  get root() { return this.target?.root ?? null; }
  /** Set when the folder is on another computer. */
  get remote() { return this.target?.remote ?? null; }
  /** The computer this window works on: its folder's, or the one its welcome page shows (null: this one). */
  get computer() { return this.target ? this.target.remote?.hostId ?? null : this.welcomeComputer; }

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

  /**
   * Bind (or rebind) this window to a planning folder on this computer and start reading it.
   * `remember`: whether opening it moves it to the top of the folder list (not for a restored window).
   */
  async bind(root: string, remember = true) {
    const { context } = this.manager;
    const name = path.basename(root) || root;
    const generation = this.prepare(root, name, null);
    const client = context.connections.local;
    let view: FolderView;
    try {
      const opened = await client.request('folders.open', { path: root, remember });
      // A restarted host has not opened this folder yet: open it again by path before subscribing, without moving it on the list.
      const state = await client.follow(opened.folderId, () => client.request('folders.open', { path: root, remember: false }));
      view = new FolderView({ client, folderId: opened.folderId, root, name, remote: null }, state);
    } catch (error) {
      context.log.error('Folder could not open', error);
      view = new FolderView({ client, folderId: '', root, name, remote: null, following: false }, { folderId: '', name, status: 'invalid', error: (error as Error).message, notice: null, revision: 0 });
    }
    this.settle(generation, view);
  }

  /**
   * Bind this window to a planning folder on a paired computer. It is opened there by its path
   * (from that computer's folder list when not given), which also reopens it after that computer's
   * host restarts.
   */
  async bindRemote(hostId: string, folderId: string, known: string | null = null) {
    const { context } = this.manager;
    const root = remoteRoot(hostId, folderId);
    const hostName = context.connections.name(hostId);
    const remote = { hostId, hostName };
    const generation = this.prepare(root, hostName, remote);
    let client: HostClient = context.connections.local;
    let view: FolderView;
    try {
      client = context.connections.client(hostId);
      // Its path: as given, as saved with the window, or from that computer's folder list.
      const folderPath = known ?? context.state.folder(root)?.remotePath ?? (await client.request('folders.list', {}, { timeout: 20000 })).find(entry => entry.folderId === folderId)?.path ?? null;
      const connection = client;
      // Opening it here (or again after a reconnection) leaves that computer's folder list as it is: whoever chose the folder already put it there.
      const reopen = folderPath ? () => connection.request('folders.open', { path: folderPath, remember: false }) : null;
      if (reopen) {
        const opened = await reopen();
        if (opened.folderId !== folderId) throw new AtlasError('unavailable', `${hostName} no longer knows this planning folder by the same identity. Open it again from its folder list.`);
        context.state.updateFolder(root, { remotePath: folderPath! });
      }
      const state = await client.follow(folderId, reopen);
      view = new FolderView({ client, folderId, root, name: state.name || (folderPath ? baseName(folderPath) : hostName), remote }, state);
    } catch (error) {
      context.log.warn('Remote folder could not open', { hostId, message: (error as Error).message });
      // Not followed: when the computer is reachable again, the manager binds the window again.
      view = new FolderView({ client, folderId, root, name: hostName, remote, following: false }, { folderId, name: hostName, status: 'invalid', error: (error as Error).message, notice: null, revision: 0 });
    }
    this.settle(generation, view);
  }

  /**
   * Show the welcome page for a computer (null: this one): the window lets its folder go. A paired
   * computer's connection stays open while its welcome page shows, so its folder list stays current.
   */
  showWelcome(hostId: string | null) {
    this.revisionFloor = Math.max(this.revisionFloor, this.folder?.revision ?? 0);
    this.folder?.close();
    this.folder = null;
    this.target = null;
    this.binding++;
    this.welcomeComputer = hostId;
    if (hostId !== null) {
      try { this.manager.context.connections.client(hostId); } catch { /* Forgotten meanwhile: the page says so. */ }
    }
    this.updateTitle();
    this.load();
  }

  /** File › Close Folder: back to the welcome page of the computer the folder is on. */
  closeFolder() {
    if (!this.target) return;
    this.saveBounds();
    this.showWelcome(this.computer);
  }

  /** The window buttons follow the theme and the page zoom (macOS keeps its own traffic lights). */
  updateTitleBar() {
    if (process.platform !== 'darwin' && !this.win.isDestroyed()) this.win.setTitleBarOverlay(titleBarOverlay(Math.pow(1.2, this.win.webContents.getZoomLevel())));
  }

  /** View › Zoom: half a zoom level a step, as Chromium's own, from 25% to 471%; the title bar keeps up. */
  zoom(change: 'in' | 'out' | 'reset') {
    if (this.win.isDestroyed()) return;
    const contents = this.win.webContents;
    contents.setZoomLevel(change === 'reset' ? 0 : Math.min(8.5, Math.max(-7.5, contents.getZoomLevel() + (change === 'in' ? 0.5 : -0.5))));
    this.updateTitleBar();
  }

  /**
   * Whether the person pressed, typed or tapped in the window just now. Commands a compromised page
   * could misuse (reading the clipboard through Paste, quitting) need it.
   */
  activatedRecently(within = 2000) { return this.lastActivation > 0 && performance.now() - this.lastActivation <= within; }

  /** Point the window at a folder before the host opened it: the renderer shows it loading. */
  private prepare(root: string, name: string, remote: FolderView['remote']) {
    const { context } = this.manager;
    this.revisionFloor = Math.max(this.revisionFloor, this.folder?.revision ?? 0);
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
    view.revision = Math.max(view.revision, this.revisionFloor + 1);
    this.folder = view;
    // The folder this device last showed on that computer, for switching back to it.
    if (view.following) this.manager.context.state.setLastFolder(computerKey(view.remote?.hostId ?? null), view.root);
    this.updateTitle();
    this.send('planning:changed', view.change());
  }

  updateTitle() {
    if (this.win.isDestroyed()) return;
    const target = this.target;
    const name = this.folder?.name ?? target?.name;
    this.win.setTitle(target ? name + (target.remote ? ' — ' + target.remote.hostName : '') + ' — Atlas' : 'Atlas');
    if (process.platform === 'darwin') this.win.setRepresentedFilename(target && !target.remote ? target.root : '');
  }

  info(): WindowInfo {
    const folder = this.folder;
    const target = this.target;
    const hostId = this.computer;
    const { connections } = this.manager.context;
    return {
      folder: target ? { root: target.root, name: folder?.name ?? target.name } : null,
      // Until the host opened the folder, the window shows it loading.
      status: folder?.status ?? (target ? 'loading' : null), error: folder?.error ?? null, notice: folder?.notice ?? null, revision: folder?.revision ?? this.revisionFloor,
      version: this.manager.context.version, platform: process.platform, remote: target?.remote ?? null, devTools: this.manager.context.devTools,
      computer: { hostId, name: hostId === null ? connections.localName : connections.name(hostId) },
    };
  }

  requireFolder(): FolderView {
    if (!this.folder) throw new AtlasError('no-folder', 'Open a planning folder first.');
    return this.folder;
  }

  send(channel: EventChannel, payload: unknown) {
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

  /** A new window, optionally for a folder (a path, or a remote key), or for a computer's welcome page. */
  async create(root: string | null, welcome: string | null = null, known: string | null = null, remember = true) {
    const saved = root ? this.context.state.folder(root) : undefined;
    const window = new AtlasWindow(this, saved?.bounds, saved?.maximized ?? false);
    this.windows.set(window.id, window);
    // Read the folder while the renderer starts; the renderer waits for the first change event.
    const remote = root ? parseRemoteRoot(root) : null;
    if (!root && welcome) window.showWelcome(welcome);
    const binding = remote ? window.bindRemote(remote.hostId, remote.folderId, known) : root ? window.bind(root, remember) : null;
    if (root || !welcome) window.load();
    await binding;
    this.rememberOpen();
    return window;
  }

  /** Point a window at another folder (or computer) and reload it; the computer it left lets go if nothing else shows it. */
  private async retarget(window: AtlasWindow, bind: () => Promise<void>) {
    const left = window.computer;
    const binding = bind();
    window.load();
    await binding;
    this.releaseUnused(left);
    this.rememberOpen();
  }
  /** The connection to a paired computer closes once no window shows one of its folders. */
  private releaseUnused(hostId: string | null) {
    if (hostId && !this.all().some(other => other.computer === hostId)) this.context.connections.release(hostId);
  }
  /** The window to open a folder in: the one asked from when it may be reused, else a new one (null). */
  private reusable(from: AtlasWindow | undefined, reuse: Reuse) {
    if (!from || from.win.isDestroyed() || reuse === 'never') return null;
    return reuse === 'always' || !from.root ? from : null;
  }

  /**
   * Open a planning folder on this computer: bring forward the window that has it, or open it in
   * the window asked from (as `reuse` allows), or in a new window.
   * - picker: the folder must be a valid planning folder; problems are explained in a dialog.
   * - command-line: the folder must exist; a broken planning.json shows in its window, with Locate… and Close.
   * - restore: restored folders open even when missing, so their window can offer Locate… and Close.
   */
  async open(input: string, options: { from?: AtlasWindow; mode: 'picker' | 'command-line' | 'restore'; reuse?: Reuse }) {
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
    if (existing) { existing.focus(); return existing; }
    // A window restored at start does not move its folder on the folder list.
    const remember = options.mode !== 'restore';
    const target = this.reusable(options.from, options.reuse ?? 'empty');
    if (!target) return this.create(root, null, null, remember);
    await this.retarget(target, () => target.bind(root, remember));
    return target;
  }

  /** Open a folder on a paired computer: bring forward the window that has it, reuse the one asked from (as `reuse` allows), or open a new one. */
  async openRemote(hostId: string, folderId: string, options: { from?: AtlasWindow; reuse?: Reuse; path?: string | null } = {}) {
    const root = remoteRoot(hostId, folderId);
    const existing = this.all().find(window => window.root === root);
    if (existing) {
      // A window whose connection ended (revoked, or replaced by pairing again) opens the folder afresh.
      const folder = existing.folder;
      existing.focus();
      if (folder && (!folder.following || ['closed', 'revoked', 'mismatch', 'incompatible'].includes(folder.client.status))) await existing.bindRemote(hostId, folderId, options.path ?? null);
      return existing;
    }
    const target = this.reusable(options.from, options.reuse ?? 'empty');
    if (!target) return this.create(root, null, options.path ?? null);
    await this.retarget(target, () => target.bindRemote(hostId, folderId, options.path ?? null));
    return target;
  }

  /**
   * Open a folder by its path on a computer (null: this one). On another computer the folder is
   * opened there first, so a folder that is not a planning folder is refused before any window changes.
   */
  async openOn(hostId: string | null, folderPath: string, from: AtlasWindow | undefined, reuse: Reuse) {
    if (hostId === null) {
      const opened = await this.open(folderPath, { from, mode: 'picker', reuse });
      if (!opened) throw new AtlasError('cancelled', 'This folder cannot be opened as a planning folder.');
      return opened;
    }
    const opened = await this.context.connections.use(hostId, client => client.request('folders.open', { path: folderPath }, { timeout: 30000 }));
    return this.openRemote(hostId, opened.folderId, { from, reuse, path: folderPath });
  }

  /** A computer's folder list (null: this computer's). */
  foldersOf(hostId: string | null): Promise<ComputerFolder[]> {
    return this.context.connections.use(hostId, client => client.request('folders.list', {}, { timeout: 20000 }));
  }
  /** Take a folder off a computer's folder list, for every device. */
  async removeFolder(hostId: string | null, folderId: string) {
    await this.context.connections.use(hostId, client => client.request('folders.remove', { folderId }));
  }
  /** Another computer's folders, for the in-app folder browser. */
  browse(hostId: string, folder: string | null): Promise<BrowseResult> {
    return this.context.connections.use(hostId, client => client.request('folders.browse', { path: folder }, { timeout: 20000 }));
  }

  /**
   * Work on another computer (null: this one): open its only folder, or the one this app last showed
   * there, or its most recent; a computer with no folders shows its welcome page, to open one there.
   * A welcome page switches to the computer's own welcome page instead.
   */
  async switchComputer(hostId: string | null, from: AtlasWindow | undefined, newWindow: boolean) {
    // A welcome page shows the chosen computer's folders, to choose one from.
    if (from && !from.root && !newWindow) {
      const left = from.computer;
      from.showWelcome(hostId);
      this.releaseUnused(left);
      return from;
    }
    const folders = (await this.foldersOf(hostId)).filter(folder => folder.available);
    const last = this.context.state.lastFolder(computerKey(hostId));
    const rootOf = (folder: ComputerFolder) => hostId === null ? folder.path : remoteRoot(hostId, folder.folderId);
    const chosen = folders.length === 1 ? folders[0] : folders.find(folder => last !== null && samePlatformPath(rootOf(folder), last)) ?? folders[0];
    const reuse: Reuse = newWindow ? 'never' : 'always';
    if (chosen) return this.openOn(hostId, chosen.path, from, reuse);
    const target = this.reusable(from, reuse);
    if (!target) return this.create(null, hostId);
    const left = target.computer;
    target.showWelcome(hostId);
    this.releaseUnused(left);
    this.rememberOpen();
    return target;
  }

  /** File › Close Folder: the window lets its folder go and shows its computer's welcome page. */
  closeFolder(window: AtlasWindow) {
    if (!window.root) return;
    window.closeFolder();
    this.rememberOpen();
  }

  /** A computer's folder list changed: every window may show it (the title bar's Open Recent, the welcome page). */
  foldersChanged(hostId: string | null, folders: ComputerFolder[]) {
    for (const window of this.all()) window.send('folders:changed', { hostId, folders });
    if (hostId === null) this.context.onFoldersChanged();
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
    // A paired computer's welcome page that could not load its folder list gets it once the computer answers.
    const hostId = client === this.context.connections.local ? null : this.context.connections.hostIdOf(client);
    if (status === 'connected' && hostId !== null && this.all().some(window => !window.root && window.computer === hostId)) {
      void client.request('folders.list', {}, { timeout: 20000 }).then(folders => this.foldersChanged(hostId, folders), () => undefined);
    }
    for (const window of this.all()) {
      const folder = window.folder;
      if (!folder || folder.client !== client) continue;
      // A remote folder that could not open (its computer was unreachable) opens once the computer is back.
      if (status === 'connected' && folder.remote && !folder.following && client !== this.context.connections.local) { void window.bindRemote(folder.remote.hostId, folder.folderId); continue; }
      folder.connection(status, detail);
      window.send('planning:changed', folder.change());
    }
  }
  /** Remote access changed on a computer (devices, listening): every window may show it. */
  accessChanged(hostId: string | null, state: AccessState) {
    for (const window of this.all()) window.send('access:changed', { hostId, state });
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
    const previousId = window.folder?.folderId;
    // Carry the window's tabs and sidebar over to the new location; the old one leaves the folder list.
    if (previous) this.context.state.updateFolder(root, { ui: this.context.state.ui(previous) });
    if (previousId) await this.context.connections.local.request('folders.remove', { folderId: previousId }).catch(() => undefined);
    await this.retarget(window, () => window.bind(root));
  }

  /** Choose a folder on this computer with the system's dialog, and open it (as `reuse` allows). */
  async chooseFolder(from: AtlasWindow | undefined, reuse: Reuse = 'empty') {
    const options = { title: 'Open a planning folder', properties: ['openDirectory' as const] };
    const choice = from ? await dialog.showOpenDialog(from.win, options) : await dialog.showOpenDialog(options);
    if (choice.canceled || !choice.filePaths[0]) return null;
    return this.open(choice.filePaths[0], { from, mode: 'picker', reuse });
  }
  /** File › Open Folder…: the system's dialog on this computer; the in-app browser in a window on another one. */
  openFolderCommand(from: AtlasWindow | undefined) {
    if (from && from.computer !== null) { from.focus(); from.send('menu:command', 'browseFolder'); return; }
    void this.chooseFolder(from);
  }

  /** This computer's folder list (File › Open Recent); empty while its host is not reachable. */
  localFolders(): Promise<ComputerFolder[]> {
    return this.foldersOf(null).catch(() => []);
  }
  async openRecent(root: string, from?: AtlasWindow) {
    if (!(await this.localFolders()).some(item => samePlatformPath(item.path, root))) throw new AtlasError('invalid-argument', 'This folder is not on this computer\'s folder list.');
    await this.open(root, { from, mode: 'picker' });
  }

  sendMenu(command: MenuCommand, focusedOnly = false) {
    const focused = BrowserWindow.getFocusedWindow();
    const window = focusedOnly ? (focused ? this.windows.get(focused.id) : undefined) : this.focused();
    if (window) { window.focus(); window.send('menu:command', command); }
  }

  /** Pairing again replaced a computer's connection: its windows open their folders, and its welcome pages their list, through the new one. */
  rebindRemote(hostId: string) {
    for (const window of this.all()) {
      const folder = window.folder;
      if (folder?.remote?.hostId === hostId) void window.bindRemote(hostId, folder.folderId);
      else if (!window.root && window.computer === hostId) window.showWelcome(hostId);
    }
  }
  /**
   * Forget a paired computer: windows showing its folders close, except the one that asked, which
   * shows this computer's welcome page (so forgetting from the last window does not quit Atlas);
   * welcome pages that showed it show this computer again. Closing a window saves its layout, so
   * the layouts are forgotten after the windows close.
   */
  async forgetComputer(hostId: string, from: AtlasWindow) {
    const closing = this.all().filter(other => other !== from && other.root && other.computer === hostId);
    if (from.computer === hostId) from.showWelcome(null);
    for (const window of this.all()) if (window !== from && !window.root && window.computer === hostId) window.showWelcome(null);
    await Promise.all(closing.map(other => new Promise<void>(resolve => {
      if (other.win.isDestroyed()) { resolve(); return; }
      other.win.once('closed', () => resolve());
      other.win.close();
    })));
    this.context.connections.forget(hostId);
    this.context.state.forgetFolders(root => parseRemoteRoot(root)?.hostId === hostId);
    this.rememberOpen();
  }

  closed(window: AtlasWindow) {
    const left = window.computer;
    window.close();
    this.windows.delete(window.id);
    // The last window showing a computer's folders (or its welcome page) closes its connection.
    this.releaseUnused(left);
    if (!this.quitting && this.windows.size) this.rememberOpen();
  }

  private rememberOpen() {
    if (this.quitting) return;
    this.context.state.setWindows(this.all().flatMap(window => window.root ? [window.root] : []));
  }
  private async explain(window: AtlasWindow | undefined, message: string, detail: string) {
    const options = { type: 'warning' as const, title: 'Atlas', message, detail, buttons: ['OK'] };
    if (window && !window.win.isDestroyed()) await dialog.showMessageBox(window.win, options); else await dialog.showMessageBox(options);
  }
}
