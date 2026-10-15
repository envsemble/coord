// Each window shows the projects of one computer: this one, or another computer this app paired
// with. Its tabs show things of those projects side by side, each tab of one project, and the window
// follows each project's folder on that computer's Atlas host as its tabs need it. Windows and their
// tabs are kept in the home database, so they open again at the next start. Each window has its own
// in-memory session, so its `atlas:` file protocol can only ever see the projects it follows.
import { BrowserWindow, dialog, nativeTheme, screen, session as electronSession, shell, type Session } from 'electron';
import type { HomeDatabase } from '@envsemble/atlas-planning';
import type { AccessState, ClientStatus, FolderState, HostClient, Project, ProjectRepository, ProjectState } from '@envsemble/atlas-host';
import type { EventChannel, MenuCommand, WindowInfo } from '../shared/contract.ts';
import { AtlasError } from './errors.ts';
import type { Connections } from './connections.ts';
import { FolderView } from './folderView.ts';
import type { RotatingLog } from './log.ts';
import { createProtocolHandler, originOf, rendererOrigin, scheme } from './protocol.ts';
import { defaultSize, type Bounds, type DesktopState, type WindowRow } from './state.ts';

/** envUI's canvas colour in the window's theme, shown until the page paints. */
const windowBackground = () => nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#ffffff';

/** The height of the title bar the window draws itself, with its line, at 100% zoom. */
export const titleBarHeight = 40;
/**
 * The system's window buttons over the title bar the page draws: on the canvas colour, in its text
 * colour, and as tall as the bar above its line. envUI's title bar takes their height (the window
 * controls overlay's environment variables) and draws its line below them, so the line runs under
 * them too; scaled by 150%, the system's buttons reach one device pixel lower, which an odd height
 * leaves clear. Zoomed in, they grow with the bar; zoomed out, the bar keeps its height and so do
 * they.
 */
export const titleBarOverlay = (zoom = 1) => {
  const height = Math.round((titleBarHeight - 1) * Math.max(1, zoom));
  return nativeTheme.shouldUseDarkColors ? { color: '#1f1f1f', symbolColor: '#e8eaed', height } : { color: '#ffffff', symbolColor: '#202124', height };
};
/**
 * Where a person's press starts, which a page cannot fake: a mouse button, a key (one raw or cooked
 * key-down per press; not its repeats) or a touch. Releases and the characters a key types do not
 * count, so each press allows one command.
 */
const pressStarts = new Set(['mouseDown', 'rawKeyDown', 'keyDown', 'touchStart']);
/** macOS keeps its traffic lights, centred in the title bar; elsewhere the overlay draws minimize, maximize and close. */
const titleBar = () => process.platform === 'darwin'
  ? { titleBarStyle: 'hidden' as const, titleBarOverlay: true, trafficLightPosition: { x: 14, y: 13 } }
  : { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlay() };

export interface WindowContext {
  state: DesktopState;
  database: HomeDatabase;
  log: RotatingLog;
  connections: Connections;
  version: string;
  preload: string;
  icon?: string;
  /** Development renderer URL (electron-vite dev server); production uses atlas://app. */
  devUrl: string | null;
  rendererDirectory: string;
  devTools: boolean;
}

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
  /** The window's row in the home database. */
  readonly rowId: number;
  /** The computer whose projects the window shows: a paired computer's host ID, or null for this one. */
  computer: string | null;
  /** The projects' folders the window follows, by folder ID. */
  readonly views = new Map<string, FolderView>();
  /** Projects whose folder is still being followed: a request for one waits for it. */
  private readonly opening = new Map<string, Promise<void>>();
  /** The projects of the window's computer as last listed, with their rows in the home database. */
  private listed = new Map<string, { project: Project; rowId: number }>();
  /** The highest revision this window has shown: a project followed again continues above it, so the window never ignores fresh data. */
  private revisionFloor = 0;
  private readonly manager: WindowManager;
  private crashes: number[] = [];
  private boundsTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the person last pressed, typed or tapped in this window. */
  private lastActivation = 0;
  /** A question or dialog a page's command opened in this window: one at a time. */
  private asking = false;
  /** Set as the window starts closing, before it leaves the window list. */
  closing = false;

  constructor(manager: WindowManager, row: WindowRow, computer: string | null) {
    this.manager = manager;
    this.rowId = row.id;
    this.computer = computer;
    const context = manager.context;
    this.session = electronSession.fromPartition('atlas-window-' + ++partitions, { cache: false });
    this.harden();
    this.win = new BrowserWindow({
      ...defaultSize, ...visibleBounds(row.bounds),
      minWidth: 640, minHeight: 420, show: false, backgroundColor: windowBackground(), title: 'Atlas',
      icon: context.icon, ...titleBar(),
      webPreferences: {
        preload: context.preload, session: this.session,
        contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
        webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, experimentalFeatures: false,
        navigateOnDragDrop: false, spellcheck: false, safeDialogs: true, devTools: context.devTools,
      },
    });
    if (row.maximized) this.win.maximize();
    this.win.once('ready-to-show', () => { this.win.show(); context.log.info('Window ready', { computer: this.computer }); });
    this.win.on('page-title-updated', event => event.preventDefault());
    this.win.on('resize', () => this.scheduleBounds());
    this.win.on('move', () => this.scheduleBounds());
    this.guardNavigation();
    this.win.webContents.on('render-process-gone', (_event, details) => this.recover(details.reason));
    this.win.webContents.on('input-event', (_event, input) => {
      if (pressStarts.has(input.type) && !input.modifiers?.includes('isautorepeat')) this.lastActivation = performance.now();
    });
    this.win.webContents.on('unresponsive', () => context.log.warn('Window unresponsive', { computer: this.computer }));
    // The mouse's back and forward buttons over the title bar's empty space reach only the window
    // (Windows and Linux); the page, which also gets them elsewhere, ignores the repeat.
    this.win.on('app-command', (_event, command) => {
      if (command === 'browser-backward') this.send('menu:command', 'goBack');
      else if (command === 'browser-forward') this.send('menu:command', 'goForward');
    });
    this.win.on('close', () => { this.closing = true; this.saveBounds(); });
    this.win.on('closed', () => manager.closed(this));
    this.updateTitle();
  }

  get id() { return this.win.id; }
  /** The name of the computer the window shows. */
  get computerName() { return this.computer === null ? this.manager.context.connections.localName : this.manager.context.connections.name(this.computer); }
  /** The connection to the window's computer. */
  client(): HostClient {
    const { connections } = this.manager.context;
    return this.computer === null ? connections.local : connections.client(this.computer);
  }

  /** Lock this window's session down: our protocol only, no remote requests, no permissions. */
  private harden() {
    const { context } = this.manager;
    const session = this.session;
    session.protocol.handle(scheme, createProtocolHandler({ rendererDirectory: context.devUrl ? null : context.rendererDirectory, planningFile: (folderId, relative) => this.views.get(folderId)?.file(relative) ?? null }));
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
      if (external) void this.openExternal(external).catch(() => undefined);
    });
    contents.on('will-redirect', (event, url) => { if (!own(url)) event.preventDefault(); });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      const external = externalUrl(url);
      if (external) void this.openExternal(external).catch(() => undefined);
      return { action: 'deny' };
    });
  }

  load() {
    const { context } = this.manager;
    void (context.devUrl ? this.win.loadURL(context.devUrl) : this.win.loadURL(rendererOrigin + '/index.html'));
  }

  // ---- Projects --------------------------------------------------------------------------------

  /**
   * The projects of the window's computer, in their order. This computer's are its host's, rows of
   * the same database; a paired computer's order and state are this app's own rows of them.
   */
  async projects(): Promise<Project[]> {
    const { connections, database } = this.manager.context;
    const computer = this.computer;
    const listed = await this.client().request('projects.list', {}, { timeout: 20000 });
    let projects: { project: Project; rowId: number }[];
    if (computer === null) {
      projects = listed.flatMap(project => { const row = database.projectByFolder(project.path); return row ? [{ project, rowId: row.id }] : []; });
    } else {
      const connectionId = connections.idOf(computer);
      projects = listed.map(project => {
        const row = database.addProject(project.path, project.name, connectionId);
        if (row.name !== project.name) database.updateProject(row.id, { name: project.name });
        return { project, rowId: row.id };
      });
      const rows = new Map(database.projects(connectionId).map(row => [row.id, row]));
      projects = projects.map(({ project, rowId }) => ({ project: { ...project, position: rows.get(rowId)!.position, state: rows.get(rowId)!.state }, rowId }))
        .sort((a, b) => a.project.position - b.project.position);
    }
    if (computer === this.computer) this.listed = new Map(projects.map(entry => [entry.project.folderId, entry]));
    return projects.map(entry => entry.project);
  }
  /** A project's row in the home database, by its folder ID (listed again when it is not known yet). */
  async projectRow(folderId: string): Promise<number> {
    if (!this.listed.has(folderId)) await this.projects();
    const entry = this.listed.get(folderId);
    if (!entry) throw new AtlasError('not-found', `This project is not on ${this.computerName}.`);
    return entry.rowId;
  }
  /** A project's row among the projects last listed, without listing them again; null when it is not among them. */
  listedRow(folderId: string): number | null { return this.listed.get(folderId)?.rowId ?? null; }
  /** The project rows whose saved tabs the page loaded (ui:load): saving replaces only theirs. */
  readonly tabsLoaded = new Set<number>();
  /** The rows of the projects last listed. */
  listedRows(): number[] { return [...this.listed.values()].map(entry => entry.rowId); }
  /** The folder ID of a project row, among the projects last listed. */
  folderOf(rowId: number): string | null {
    for (const [folderId, entry] of this.listed) if (entry.rowId === rowId) return folderId;
    return null;
  }
  async createProject(name: string, repositories: ProjectRepository[]): Promise<Project> {
    const created = await this.client().request('projects.create', { name, workspaces: [], repositories }, { timeout: 60000 });
    return (await this.projects()).find(project => project.folderId === created.folderId) ?? created;
  }
  /**
   * Change a project: on this computer through its host, so every device sees it. On a paired
   * computer, a new name goes to its host (it is in the planning folder), while hiding, archiving
   * and the order are this app's own.
   */
  async updateProject(folderId: string, change: { name?: string; state?: ProjectState; position?: number }): Promise<Project> {
    const { database } = this.manager.context;
    if (this.computer === null) await this.client().request('projects.update', { folderId, ...change });
    else {
      if (change.name !== undefined) await this.client().request('projects.update', { folderId, name: change.name });
      const rowId = await this.projectRow(folderId);
      if (change.state !== undefined || change.position !== undefined) database.updateProject(rowId, { state: change.state, position: change.position });
      this.manager.projectsChanged(this.computer);
    }
    const project = (await this.projects()).find(entry => entry.folderId === folderId);
    if (!project) throw new AtlasError('not-found', `This project is not on ${this.computerName}.`);
    return project;
  }

  /**
   * Move a project outside its computer's Atlas home into it. It keeps its row (on a paired computer,
   * this app's row follows its new folder), so its order, state and saved tabs stay; every window
   * showing that computer follows it under its new folder ID.
   */
  async adoptProject(folderId: string): Promise<Project> {
    const rowId = await this.projectRow(folderId);
    const moved = await this.client().request('projects.adopt', { folderId }, { timeout: 120000 });
    if (this.computer !== null) this.manager.context.database.updateProject(rowId, { folder: moved.path });
    this.manager.projectMoved(this.computer, folderId, moved.folderId);
    return (await this.projects()).find(project => project.folderId === moved.folderId) ?? moved;
  }
  /**
   * A project of the window's computer moved under a new folder ID: the folder it left is no longer
   * followed, and its row (with its saved tabs) goes by the new ID until the projects are listed
   * again. The page moves its tabs and history.
   */
  projectMoved(from: string, to: string) {
    const view = this.views.get(from);
    if (view) { this.views.delete(from); this.revisionFloor = Math.max(this.revisionFloor, view.revision); view.close(); }
    const entry = this.listed.get(from);
    if (entry) { this.listed.delete(from); this.listed.set(to, { ...entry, project: { ...entry.project, folderId: to } }); }
    this.send('projects:changed', { hostId: this.computer, moved: { from, to } });
  }

  /** A project's folder, followed from now on (its changes reach the window). */
  async open(folderId: string): Promise<FolderView> {
    const known = this.views.get(folderId);
    // A request while the project is still opening waits for it, so it never asks before the host follows it.
    if (known) { await this.opening.get(folderId); return known; }
    const view = new FolderView(this.client(), folderId, this.computer === null ? null : { hostId: this.computer, hostName: this.computerName }, this.revisionFloor);
    this.views.set(folderId, view);
    const ready = (async () => {
      try { view.update(await view.client.follow(folderId)); }
      catch (error) {
        this.manager.context.log.warn('Project could not open', { folderId, message: (error as Error).message });
        view.failed((error as Error).message);
      }
    })();
    this.opening.set(folderId, ready);
    try { await ready; } finally { if (this.opening.get(folderId) === ready) this.opening.delete(folderId); }
    return view;
  }
  /**
   * Stop following a project's folder: the page shows nothing of it any more. The host keeps it while
   * another window on the same connection follows it.
   */
  closeProject(folderId: string) {
    const view = this.views.get(folderId);
    if (!view) return;
    this.views.delete(folderId);
    this.letGo(view);
  }
  private letGo(view: FolderView) {
    this.revisionFloor = Math.max(this.revisionFloor, view.revision);
    if (!this.manager.all().some(other => other !== this && other.views.get(view.folderId)?.client === view.client)) view.close();
  }
  /** A project's folder for a request: followed, and readable. */
  async readable(folderId: string): Promise<FolderView> {
    const view = await this.open(folderId);
    if (view.status === 'missing' || (view.status === 'invalid' && view.error)) throw new AtlasError(view.status === 'missing' ? 'folder-missing' : 'folder-invalid', view.error ?? 'This project cannot be read.');
    return view;
  }
  /** Let every project go (the window shows another computer, or closes); other windows keep those they follow. */
  private release() {
    for (const view of this.views.values()) this.letGo(view);
    this.views.clear();
    this.listed.clear();
    this.tabsLoaded.clear();
  }

  /** Show another computer's projects: the window lets this one's go and starts again. */
  showComputer(hostId: string | null) {
    this.release();
    this.computer = hostId;
    this.manager.context.state.updateWindow(this.rowId, { connectionId: hostId === null ? null : this.manager.context.connections.idOf(hostId) });
    if (hostId !== null) this.client();
    this.updateTitle();
    this.load();
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
   * Whether the person pressed, typed or tapped in the window just now, using that press up: each
   * press allows one command. Paste, which reads the clipboard, needs one.
   */
  takeActivation(within = 2000) {
    const fresh = this.lastActivation > 0 && performance.now() - this.lastActivation <= within;
    if (fresh) this.lastActivation = 0;
    return fresh;
  }

  /**
   * Commands a page could misuse (quitting, opening windows, remote access, leaving for the browser)
   * run at once right after a person's press. Without one (a compromised page, but also a screen
   * reader's click, which makes no input event), Atlas asks in a system dialog the page cannot
   * answer. One question or dialog at a time.
   */
  async confirm(message: string, action: string, detail?: string): Promise<boolean> {
    return this.takeActivation() || this.ask(message, action, detail);
  }

  /**
   * Asks in a system dialog the page cannot answer, press or not. Creating a pairing link, which hands
   * the computer to whoever uses it, always asks. One question or dialog at a time.
   */
  async ask(message: string, action: string, detail?: string): Promise<boolean> {
    if (this.win.isDestroyed()) return false;
    if (this.asking) throw new AtlasError('unavailable', 'Finish the dialog that is open first.');
    this.asking = true;
    try {
      const { response } = await dialog.showMessageBox(this.win, { type: 'question', title: 'Atlas', message, detail, buttons: [action, 'Cancel'], defaultId: 0, cancelId: 1, noLink: true });
      return response === 0 && !this.win.isDestroyed();
    } finally { this.asking = false; }
  }

  /** Opens a web or mail address in the system's browser, after a person's press or their answer. */
  async openExternal(address: string) {
    if (await this.confirm('Open this address in your browser?', 'Open', address)) await shell.openExternal(address);
  }

  /** Dialogs a page opens (choosing a file) come one at a time, so a page cannot pile them up. */
  async oneDialog<T>(open: () => Promise<T>): Promise<T> {
    if (this.asking) throw new AtlasError('unavailable', 'Finish the dialog that is open first.');
    this.asking = true;
    try { return await open(); } finally { this.asking = false; }
  }

  updateTitle() {
    if (this.win.isDestroyed()) return;
    this.win.setTitle(this.computer === null ? 'Atlas' : this.computerName + ' — Atlas');
  }

  info(): WindowInfo {
    return { computer: { hostId: this.computer, name: this.computerName }, version: this.manager.context.version, platform: process.platform, devTools: this.manager.context.devTools };
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
    if (this.win.isDestroyed()) return;
    this.manager.context.state.updateWindow(this.rowId, { bounds: this.win.getNormalBounds(), maximized: this.win.isMaximized() });
  }

  /** A crashed renderer reloads; its tabs come back from the saved window state. */
  private recover(reason: string) {
    const { log } = this.manager.context;
    log.error('Window renderer gone', { reason, computer: this.computer });
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

  close() { this.release(); }
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
  /** At quit, the open windows stay in the database and open again next time; closing one by hand forgets it. */
  setQuitting() { this.quitting = true; }

  /** A new window on a computer (null: this one), or one saved in the database. */
  create(hostId: string | null, saved?: WindowRow) {
    const { connections, state } = this.context;
    const row = saved ?? (() => {
      const bounds = { x: 0, y: 0, ...defaultSize };
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      bounds.x = Math.round(display.x + (display.width - bounds.width) / 2); bounds.y = Math.round(display.y + (display.height - bounds.height) / 2);
      const id = state.addWindow(hostId === null ? null : connections.idOf(hostId), bounds);
      return state.windows().find(window => window.id === id)!;
    })();
    const window = new AtlasWindow(this, row, hostId);
    this.windows.set(window.id, window);
    if (hostId !== null) { try { connections.client(hostId); } catch { /* Forgotten meanwhile: the window says so. */ } }
    window.load();
    return window;
  }

  /** The windows saved in the database (those open when Atlas quit), or one new window. */
  restore() {
    const { connections } = this.context;
    for (const row of this.context.state.windows()) {
      const hostId = row.connectionId === null ? null : connections.hostIdFor(row.connectionId);
      this.create(hostId, row);
    }
    if (!this.windows.size) this.create(null);
  }

  /** Show another computer's projects in this window, or in a new one. */
  switchComputer(window: AtlasWindow, hostId: string | null, newWindow: boolean) {
    if (newWindow) return this.create(hostId);
    if (window.computer === hostId) return window;
    const left = window.computer;
    window.showComputer(hostId);
    this.releaseUnused(left);
    return window;
  }
  /** The connection to a paired computer closes once no window shows it. */
  private releaseUnused(hostId: string | null) {
    if (hostId && !this.all().some(other => other.computer === hostId)) this.context.connections.release(hostId);
  }

  /** A computer's projects changed: the windows showing it list them again. */
  projectsChanged(hostId: string | null) {
    for (const window of this.all()) if (window.computer === hostId) window.send('projects:changed', { hostId });
  }

  /** A project of a computer moved under a new folder ID: the windows showing that computer follow it. */
  projectMoved(hostId: string | null, from: string, to: string) {
    for (const window of this.all()) if (window.computer === hostId) window.projectMoved(from, to);
  }
  /** A folder event from a host reaches the windows following that project. */
  folderChanged(client: HostClient, state: FolderState) {
    for (const window of this.all()) {
      const view = window.views.get(state.folderId);
      if (!view || view.client !== client) continue;
      view.update(state);
      window.send('planning:changed', { project: state.folderId, ...view.change() });
    }
  }
  /** A connection's status reaches the windows reading through it. */
  connectionChanged(client: HostClient, status: ClientStatus, detail: string | null) {
    const hostId = client === this.context.connections.local ? null : this.context.connections.hostIdOf(client);
    for (const window of this.all()) {
      if (window.computer !== hostId) continue;
      // Once the computer answers again, its projects are listed again.
      if (status === 'connected') window.send('projects:changed', { hostId });
      for (const view of window.views.values()) {
        if (view.client !== client) continue;
        view.connection(status, detail);
        window.send('planning:changed', { project: view.folderId, ...view.change() });
      }
    }
  }
  /** Remote access changed on a computer (devices, listening): every window may show it. */
  accessChanged(hostId: string | null, state: AccessState) {
    for (const window of this.all()) window.send('access:changed', { hostId, state });
  }

  sendMenu(command: MenuCommand, focusedOnly = false) {
    const focused = BrowserWindow.getFocusedWindow();
    const window = focusedOnly ? (focused ? this.windows.get(focused.id) : undefined) : this.focused();
    if (window) { window.focus(); window.send('menu:command', command); }
  }

  /** Pairing again replaced a computer's connection: its windows start again through the new one. */
  rebindRemote(hostId: string) {
    for (const window of this.all()) if (window.computer === hostId) window.showComputer(hostId);
  }
  /** Forget a paired computer: windows showing it show this computer instead; its rows go with it. */
  forgetComputer(hostId: string) {
    for (const window of this.all()) if (window.computer === hostId) window.showComputer(null);
    this.context.connections.forget(hostId);
  }

  closed(window: AtlasWindow) {
    const left = window.computer;
    window.close();
    this.windows.delete(window.id);
    // A window closed by hand is forgotten; at quit, and when the last one closes, the windows stay for the next start.
    if (!this.quitting && this.windows.size) this.context.state.removeWindow(window.rowId);
    this.releaseUnused(left);
  }
}
