// The app's windows: each shows the projects of one computer. Windows and their places are kept in
// the home database, so they open again at the next start; the manager creates and restores them,
// and passes each host's events to the windows they concern.
import { BrowserWindow, screen } from 'electron';
import type { HomeDatabase } from '@envsemble/coord/planning';
import type { AccessState, ClientStatus, OpenProjectState, HostClient, Project } from '@envsemble/coord/host';
import type { MenuCommand, UpdateState } from '../../shared/contract.ts';
import type { Computers } from '../computers/computers.ts';
import type { RotatingLog } from '../log.ts';
import { defaultSize, type AppState, type WindowRow } from '../appState.ts';
import { CoordWindow } from './window.ts';

/**
 * What the windows work with: the home database and the app's state in it, the log, the computers,
 * and how a window loads its page.
 */
interface WindowContext {
  state: AppState;
  database: HomeDatabase;
  log: RotatingLog;
  computers: Computers;
  version: string;
  preload: string;
  icon?: string;
  /** Development renderer URL (electron-vite dev server); production uses coord://app. */
  devUrl: string | null;
  rendererDirectory: string;
  devTools: boolean;
  /** Coord Dev (main/dev.ts). */
  dev: boolean;
}

export class WindowManager {
  readonly context: WindowContext;
  private readonly windows = new Map<number, CoordWindow>();
  private quitting = false;

  constructor(context: WindowContext) { this.context = context; }

  all() { return [...this.windows.values()]; }
  fromId(id: number) { return this.windows.get(id); }
  focused() { const win = BrowserWindow.getFocusedWindow(); return win ? this.windows.get(win.id) : this.all().at(-1); }
  /** At quit, the open windows stay in the database and open again next time; closing one by hand forgets it. */
  setQuitting() { this.quitting = true; }

  /** A new window on a computer (null: this one), or one saved in the database. */
  create(hostId: string | null, saved?: WindowRow) {
    const { computers, state } = this.context;
    const row = saved ?? (() => {
      const bounds = { x: 0, y: 0, ...defaultSize };
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      bounds.x = Math.round(display.x + (display.width - bounds.width) / 2); bounds.y = Math.round(display.y + (display.height - bounds.height) / 2);
      const id = state.addWindow(hostId === null ? null : computers.idOf(hostId), bounds);
      return state.windows().find(window => window.id === id)!;
    })();
    const window = new CoordWindow(this, row, hostId);
    this.windows.set(window.id, window);
    if (hostId !== null) { try { computers.client(hostId); } catch { /* Forgotten meanwhile: the window says so. */ } }
    window.load();
    return window;
  }

  /** The windows saved in the database (those open when Coord quit), or one new window. */
  restore() {
    const { computers } = this.context;
    for (const row of this.context.state.windows()) {
      const hostId = row.computerId === null ? null : computers.hostIdFor(row.computerId);
      this.create(hostId, row);
    }
    if (!this.windows.size) this.create(null);
  }

  /** Show another computer's projects in this window, or in a new one. */
  switchComputer(window: CoordWindow, hostId: string | null, newWindow: boolean) {
    if (newWindow) return this.create(hostId);
    if (window.computer === hostId) return window;
    const left = window.computer;
    window.showComputer(hostId);
    this.releaseUnused(left);
    return window;
  }
  /** The connection to a paired computer closes once no window shows it. */
  private releaseUnused(hostId: string | null) {
    if (hostId && !this.all().some(other => other.computer === hostId)) this.context.computers.release(hostId);
  }

  /**
   * A computer's projects changed: the windows showing it get them as its host listed them (`listed`,
   * when the host sent them), or list them again.
   */
  projectsChanged(hostId: string | null, listed?: Project[]) {
    for (const window of this.all()) if (window.computer === hostId) window.send('projects:changed', { hostId, ...listed && { projects: window.list(listed) } });
  }

  /** A project.changed event from a host reaches the windows following that project. */
  projectChanged(client: HostClient, state: OpenProjectState) {
    for (const window of this.all()) {
      const view = window.views.get(state.projectId);
      if (!view || view.client !== client) continue;
      view.update(state);
      window.send('project:changed', { projectId: state.projectId, ...view.change() });
    }
  }
  /** A connection's status reaches the windows reading through it. */
  connectionChanged(client: HostClient, status: ClientStatus, detail: string | null) {
    const hostId = client === this.context.computers.local ? null : this.context.computers.hostIdOf(client);
    for (const window of this.all()) {
      if (window.computer !== hostId) continue;
      // Once the computer answers again, its projects are listed again.
      if (status === 'connected') window.send('projects:changed', { hostId });
      for (const view of window.views.values()) {
        if (view.client !== client) continue;
        view.connection(status, detail);
        window.send('project:changed', { projectId: view.projectId, ...view.change() });
      }
    }
  }
  /** Remote access changed on a computer (devices, listening): every window may show it. */
  accessChanged(hostId: string | null, state: AccessState) {
    for (const window of this.all()) window.send('access:changed', { hostId, state });
  }
  /** Coord's update moved on: every window shows it. */
  updatesChanged(state: UpdateState) {
    for (const window of this.all()) window.send('updates:changed', state);
  }

  sendMenu(command: MenuCommand, focusedOnly = false) {
    const focused = BrowserWindow.getFocusedWindow();
    const window = focusedOnly ? (focused ? this.windows.get(focused.id) : undefined) : this.focused();
    if (window) { window.focus(); window.send('menu:command', command); }
  }

  /** Pairing again replaced a computer's connection: its windows start again through the new one. */
  rebindComputer(hostId: string) {
    for (const window of this.all()) if (window.computer === hostId) window.showComputer(hostId);
  }
  /** Forget a paired computer: windows showing it show this computer instead; its rows go with it. */
  forgetComputer(hostId: string) {
    for (const window of this.all()) if (window.computer === hostId) window.showComputer(null);
    this.context.computers.forget(hostId);
  }

  closed(window: CoordWindow) {
    const left = window.computer;
    window.close();
    this.windows.delete(window.id);
    // A window closed by hand is forgotten; at quit, and when the last one closes, the windows stay for the next start.
    if (!this.quitting && this.windows.size) this.context.state.removeWindow(window.rowId);
    this.releaseUnused(left);
  }
}
