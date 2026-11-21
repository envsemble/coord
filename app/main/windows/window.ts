// A Coord window: it shows the projects of one computer, this one or another computer this app
// paired with, one place at a time (the hub, or something of one project), and follows each project
// on that computer's Coord host as its pages need it. Each window has its own in-memory session, so
// its `coord:` file protocol can only ever see the projects it follows.
import { BrowserWindow, dialog, nativeTheme, screen, session as electronSession, shell, type Session } from 'electron';
import type { HostClient, Project } from '@envsemble/coord/host';
import type { EventChannel, ProjectChangeRequest, WindowInfo } from '../../shared/contract.ts';
import { CoordError } from '../errors.ts';
import { ProjectView } from '../computers/projectView.ts';
import { createProtocolHandler, isEntry, isPageFrameUrl, originOf, rendererOrigin, scheme } from './protocol.ts';
import { defaultSize, type Bounds, type WindowRow } from '../appState.ts';
import type { WindowManager } from './windowManager.ts';

/**
 * envUI's page colour (--env-color-bg-page) in the window's theme, which the system shows until the
 * page paints: the same as the page's own, so starting changes no colour.
 */
const windowBackground = () => nativeTheme.shouldUseDarkColors ? '#191a1b' : '#ffffff';

/** The height of the title bar the window draws itself, at 100% zoom. */
const titleBarHeight = 40;
/**
 * The system's window buttons over the title bar the page draws: on the bar's colour (envUI's
 * TopBar, --env-color-bg-default), in its text colour (--env-color-fg-default), as tall as the bar,
 * which takes their height (the window controls overlay's environment variables). Scaled by 150%,
 * the system's buttons reach one device pixel lower, which an odd height leaves clear. Zoomed in,
 * they grow with the bar; zoomed out, the bar keeps its height and so do they.
 */
const titleBarOverlay = (zoom = 1) => {
  const height = Math.round((titleBarHeight - 1) * Math.max(1, zoom));
  return nativeTheme.shouldUseDarkColors ? { color: '#28292b', symbolColor: '#e8eaee', height } : { color: '#f4f4f6', symbolColor: '#1f1f22', height };
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

const allowedExternal = new Set(['https:', 'http:', 'mailto:']);

export function externalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return allowedExternal.has(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

let partitions = 0;

export class CoordWindow {
  readonly win: BrowserWindow;
  readonly session: Session;
  /** The window's row in the home database. */
  readonly rowId: number;
  /** The computer whose projects the window shows: a paired computer's host ID, or null for this one. */
  computer: string | null;
  /** The projects the window follows, by their IDs. */
  readonly views = new Map<string, ProjectView>();
  /** Projects still being followed: a request for one waits for it. */
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
    this.session = electronSession.fromPartition('coord-window-' + ++partitions, { cache: false });
    this.harden();
    this.win = new BrowserWindow({
      ...defaultSize, ...visibleBounds(row.bounds),
      minWidth: 640, minHeight: 420, show: false, backgroundColor: windowBackground(), title: 'Coord',
      icon: context.icon, ...titleBar(),
      webPreferences: {
        preload: context.preload, session: this.session,
        contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
        webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, experimentalFeatures: false,
        navigateOnDragDrop: false, spellcheck: false, safeDialogs: true, devTools: context.devTools,
      },
    });
    // The window shows once its page has painted. Maximizing shows a window too, so a maximized one
    // waits as well (maximized at once, Windows drew it blank for a moment before the page). On
    // Windows it also stays transparent until the page has drawn itself at the maximized size, so it
    // never shows at its normal size first; it shows after half a second whatever happens. (Linux has
    // no window opacity, and macOS animates the zoom.)
    this.win.once('ready-to-show', () => {
      if (row.maximized && process.platform !== 'win32') this.win.maximize();
      else if (row.maximized) {
        const started = performance.now();
        this.win.setOpacity(0);
        // The resize maximizing makes (none when the window had the screen's size already), then two frames drawn at it.
        const resized = new Promise<void>(done => { this.win.once('resize', () => done()); setTimeout(done, 150); });
        this.win.maximize();
        let shown = false;
        const reveal = (how: string) => {
          if (shown || this.win.isDestroyed()) return;
          shown = true;
          this.win.setOpacity(1);
          context.log.info('Window shown maximized', { how, ms: Math.round(performance.now() - started) });
        };
        const fallback = setTimeout(() => reveal('after the longest wait'), 500);
        void resized.then(() => this.win.isDestroyed() ? undefined : this.win.webContents.executeJavaScript('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))'))
          .then(() => 'drawn', error => `without waiting: ${(error as Error).message}`).then(how => { clearTimeout(fallback); reveal(how); });
      }
      this.win.show();
      context.log.info('Window ready', { computer: this.computer });
    });
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
  get computerName() { return this.computer === null ? this.manager.context.computers.localName : this.manager.context.computers.name(this.computer); }
  /** The connection to the window's computer. */
  client(): HostClient {
    const { computers } = this.manager.context;
    return this.computer === null ? computers.local : computers.client(this.computer);
  }

  /** Lock this window's session down: our protocol only, no remote requests, no permissions. */
  private harden() {
    const { context } = this.manager;
    const session = this.session;
    session.protocol.handle(scheme, createProtocolHandler({ rendererDirectory: context.devUrl ? null : context.rendererDirectory, planningFile: (projectId, relative) => this.views.get(projectId)?.file(relative) ?? null }));
    // Copying text (the viewer's copy buttons) is the only permission a window gets.
    const allowed = (permission: string) => permission === 'clipboard-sanitized-write';
    session.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed(permission)));
    session.setPermissionCheckHandler((_contents, permission) => allowed(permission));
    session.setDevicePermissionHandler(() => false);
    const dev = context.devUrl ? new URL(context.devUrl) : null;
    session.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const local = ['coord:', 'data:', 'blob:', 'devtools:'].includes(url.protocol);
      const devServer = dev && (url.protocol === 'http:' || url.protocol === 'ws:') && url.host === dev.host;
      // A page, in its frame, reaches what its agent made it for: no guards (work-0036).
      const page = Boolean(details.frame?.parent) && isPageFrameUrl(details.frame!.url, context.devUrl);
      if (!local && !devServer && !page) context.log.warn('Blocked a request', { url: url.protocol + '//' + url.host });
      callback({ cancel: !local && !devServer && !page });
    });
    session.on('will-download', (event, item) => {
      // Only files the viewer generates itself (SVG/JSON exports) may be saved; the user picks where.
      if (!item.getURL().startsWith('blob:')) { event.preventDefault(); return; }
    });
  }

  private guardNavigation() {
    const contents = this.win.webContents;
    const own = (url: string) => originOf(url) !== null && originOf(url) === originOf(this.manager.context.devUrl ?? rendererOrigin);
    // Within its own origin a window only reloads its page; a relative link a document or message holds never takes it elsewhere.
    const page = this.manager.context.devUrl ?? rendererOrigin + '/index.html';
    contents.on('will-navigate', (event, url) => {
      if (isEntry(url, page)) return;
      event.preventDefault();
      if (own(url)) return;
      const external = externalUrl(url);
      if (external) void this.openExternal(external).catch(() => undefined);
    });
    contents.on('will-redirect', (event, url) => { if (!own(url)) event.preventDefault(); });
    // A page's frame stays on its page; a link it follows opens in the browser.
    contents.on('will-frame-navigate', event => {
      if (event.isMainFrame) return;
      if (isPageFrameUrl(event.url, this.manager.context.devUrl ?? null)) return;
      event.preventDefault();
      const external = externalUrl(event.url);
      if (external) void this.openExternal(external).catch(() => undefined);
    });
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
    const computer = this.computer;
    return this.list(await this.client().request('projects.list', {}, { timeout: 20000 }), computer);
  }
  /** The projects as the window's computer listed them (`computer`, the one asked), with this app's rows of them. */
  list(listed: Project[], computer = this.computer): Project[] {
    const { computers, database } = this.manager.context;
    let projects: { project: Project; rowId: number }[];
    if (computer === null) {
      projects = listed.flatMap(project => { const row = database.projectByFolder(project.path); return row ? [{ project, rowId: row.id }] : []; });
    } else {
      const computerId = computers.idOf(computer);
      projects = listed.map(project => {
        const row = database.addProject(project.path, project.name, computerId);
        if (row.name !== project.name) database.updateProject(row.id, { name: project.name });
        return { project, rowId: row.id };
      });
      const rows = new Map(database.projects(computerId).map(row => [row.id, row]));
      // A project this app hid before reads as archived: hiding is gone.
      projects = projects.map(({ project, rowId }) => ({ project: { ...project, position: rows.get(rowId)!.position, state: rows.get(rowId)!.state }, rowId }))
        .sort((a, b) => a.project.position - b.project.position);
    }
    if (computer === this.computer) this.listed = new Map(projects.map(entry => [entry.project.id, entry]));
    return projects.map(entry => entry.project);
  }
  /** The IDs of the window's active projects, as last listed (listed now when none were). */
  async activeProjects(): Promise<Set<string>> {
    if (!this.listed.size) await this.projects();
    return new Set([...this.listed.values()].filter(entry => entry.project.state === 'active').map(entry => entry.project.id));
  }
  /** A project's row in the home database, by its ID (listed again when it is not known yet). */
  async projectRow(projectId: string): Promise<number> {
    if (!this.listed.has(projectId)) await this.projects();
    const entry = this.listed.get(projectId);
    if (!entry) throw new CoordError('not-found', `This project is not on ${this.computerName}.`);
    return entry.rowId;
  }
  /** A project's row among the projects last listed, without listing them again; null when it is not among them. */
  listedRow(projectId: string): number | null { return this.listed.get(projectId)?.rowId ?? null; }
  /** The project rows whose saved places the page loaded (ui:load): saving replaces only theirs. */
  readonly placesLoaded = new Set<number>();
  /** The rows of the projects last listed. */
  listedRows(): number[] { return [...this.listed.values()].map(entry => entry.rowId); }
  /** The project ID of a project row, among the projects last listed. */
  projectIdOfRow(rowId: number): string | null {
    for (const [projectId, entry] of this.listed) if (entry.rowId === rowId) return projectId;
    return null;
  }
  /** A new project covering folders of the window's computer. */
  async createProject(name: string, folders: string[]): Promise<Project> {
    const created = await this.client().request('projects.create', { name, folders }, { timeout: 60000 });
    return (await this.projects()).find(project => project.id === created.id) ?? created;
  }
  /**
   * Change a project: on this computer through its host, so every device sees it. On a paired
   * computer, a new name and folders go to its host (they are in the planning folder),
   * while archiving and the order are this app's own.
   */
  async updateProject(projectId: string, change: ProjectChangeRequest): Promise<Project> {
    const { database } = this.manager.context;
    if (this.computer === null) await this.client().request('projects.update', { projectId, ...change }, { timeout: 60000 });
    else {
      if (change.name !== undefined || change.folders !== undefined) await this.client().request('projects.update', { projectId, name: change.name, folders: change.folders }, { timeout: 60000 });
      const rowId = await this.projectRow(projectId);
      if (change.state !== undefined || change.position !== undefined) database.updateProject(rowId, { state: change.state, position: change.position });
      this.manager.projectsChanged(this.computer);
    }
    const project = (await this.projects()).find(entry => entry.id === projectId);
    if (!project) throw new CoordError('not-found', `This project is not on ${this.computerName}.`);
    return project;
  }

  /** A project, followed from now on (its changes reach the window). */
  async open(projectId: string): Promise<ProjectView> {
    const known = this.views.get(projectId);
    // A request while the project is still opening waits for it, so it never asks before the host follows it.
    if (known) { await this.opening.get(projectId); return known; }
    const view = new ProjectView(this.client(), projectId, this.computer === null ? null : { hostId: this.computer, hostName: this.computerName }, this.revisionFloor);
    this.views.set(projectId, view);
    const ready = (async () => {
      try { view.update(await view.client.follow(projectId)); }
      catch (error) {
        this.manager.context.log.warn('Project could not open', { projectId, message: (error as Error).message });
        view.failed((error as Error).message);
      }
    })();
    this.opening.set(projectId, ready);
    try { await ready; } finally { if (this.opening.get(projectId) === ready) this.opening.delete(projectId); }
    return view;
  }
  /**
   * Stop following a project: the page shows nothing of it any more. The host keeps it while
   * another window on the same connection follows it.
   */
  closeProject(projectId: string) {
    const view = this.views.get(projectId);
    if (!view) return;
    this.views.delete(projectId);
    this.letGo(view);
  }
  private letGo(view: ProjectView) {
    this.revisionFloor = Math.max(this.revisionFloor, view.revision);
    if (!this.manager.all().some(other => other !== this && other.views.get(view.projectId)?.client === view.client)) view.close();
  }
  /** A project for a request: followed, and its planning folder readable. */
  async readable(projectId: string): Promise<ProjectView> {
    const view = await this.open(projectId);
    if (view.status === 'missing' || (view.status === 'invalid' && view.error)) throw new CoordError(view.status === 'missing' ? 'folder-missing' : 'folder-invalid', view.error ?? 'This project cannot be read.');
    return view;
  }
  /** Let every project go (the window shows another computer, or closes); other windows keep those they follow. */
  private release() {
    for (const view of this.views.values()) this.letGo(view);
    this.views.clear();
    this.listed.clear();
    this.placesLoaded.clear();
  }

  /** Show another computer's projects: the window lets this one's go and starts again. */
  showComputer(hostId: string | null) {
    this.release();
    this.computer = hostId;
    this.manager.context.state.updateWindow(this.rowId, { computerId: hostId === null ? null : this.manager.context.computers.idOf(hostId) });
    if (hostId !== null) this.client();
    this.updateTitle();
    this.load();
  }

  /** The window buttons follow the theme and the page zoom (macOS keeps its own traffic lights). */
  updateTitleBar() {
    if (this.win.isDestroyed()) return;
    // What the system shows while the window resizes follows the theme too.
    this.win.setBackgroundColor(windowBackground());
    if (process.platform !== 'darwin') this.win.setTitleBarOverlay(titleBarOverlay(Math.pow(1.2, this.win.webContents.getZoomLevel())));
  }

  /** Zoom: half a zoom level a step, as Chromium's own, from 25% to 471%; the title bar keeps up. */
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
   * reader's click, which makes no input event), Coord asks in a system dialog the page cannot
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
    if (this.asking) throw new CoordError('unavailable', 'Finish the dialog that is open first.');
    this.asking = true;
    try {
      const { response } = await dialog.showMessageBox(this.win, { type: 'question', title: 'Coord', message, detail, buttons: [action, 'Cancel'], defaultId: 0, cancelId: 1, noLink: true });
      return response === 0 && !this.win.isDestroyed();
    } finally { this.asking = false; }
  }

  /** Opens a web or mail address in the system's browser, after a person's press or their answer. */
  async openExternal(address: string) {
    if (await this.confirm('Open this address in your browser?', 'Open', address)) await shell.openExternal(address);
  }

  /** Dialogs a page opens (choosing a file) come one at a time, so a page cannot pile them up. */
  async oneDialog<T>(open: () => Promise<T>): Promise<T> {
    if (this.asking) throw new CoordError('unavailable', 'Finish the dialog that is open first.');
    this.asking = true;
    try { return await open(); } finally { this.asking = false; }
  }

  updateTitle() {
    if (this.win.isDestroyed()) return;
    this.win.setTitle(this.computer === null ? 'Coord' : this.computerName + ' — Coord');
  }

  info(): WindowInfo {
    return { computer: { hostId: this.computer, name: this.computerName }, version: this.manager.context.version, platform: process.platform, devTools: this.manager.context.devTools, dev: this.manager.context.dev };
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

  /** A crashed renderer reloads; its place comes back from the saved window state. */
  private recover(reason: string) {
    const { log } = this.manager.context;
    log.error('Window renderer gone', { reason, computer: this.computer });
    if (reason === 'clean-exit' || this.win.isDestroyed()) return;
    const now = Date.now();
    this.crashes = [...this.crashes.filter(time => now - time < 60000), now];
    if (this.crashes.length <= 3) { this.load(); return; }
    void dialog.showMessageBox(this.win, {
      type: 'error', title: 'Coord', message: 'This window keeps closing unexpectedly.',
      detail: 'Coord reloaded it three times in the last minute. Details are in the log (Open Logs, in the menu).',
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
