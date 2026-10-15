// The app's own state in the home database (never in a planning folder): each window with its
// bounds, the computer it shows and its sidebar's width, its tabs (each showing something of one
// project), and the settings every window shares: the theme, whether the sidebar shows, and the
// width the reader gave a diagram's details. Windows stay in the database when Atlas quits, and
// open again at the next start; a window closed by hand is removed with its tabs.
import type { HomeDatabase } from '@envsemble/atlas-planning';
import { limits, type ThemePreference } from '../shared/contract.ts';

export interface Bounds { x: number; y: number; width: number; height: number }
export interface WindowRow { id: number; connectionId: string | null; bounds: Bounds; maximized: boolean; sidebarWidth: number }
export type TabKind = 'project' | 'work' | 'diagram' | 'file';
/** A saved tab: the project row it shows something of, what it shows, and whether it is the window's active one. */
export interface TabRow { projectId: number; kind: TabKind; target: string | null; active: boolean }

export const defaultSize = { width: 1280, height: 820 };
const sidebarWidth = 280;
type Row = Record<string, unknown>;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export class DesktopState {
  private readonly database: HomeDatabase;
  constructor(database: HomeDatabase) { this.database = database; }

  /** The app's theme preference; the operating system's unless one was chosen. */
  get theme(): ThemePreference {
    const value = this.database.setting('theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  }
  setTheme(theme: ThemePreference) { this.database.setSetting('theme', theme === 'system' ? null : theme); }

  /** Whether windows show their sidebar. */
  get sidebarVisible() { return this.database.setting('ui.sidebarVisible') !== 'false'; }
  setSidebarVisible(visible: boolean) { this.database.setSetting('ui.sidebarVisible', visible ? null : 'false'); }
  /** The width the reader gave a diagram's details, or null for the default. */
  get inspectorWidth(): number | null {
    const value = Number(this.database.setting('ui.inspectorWidth'));
    return Number.isInteger(value) && value >= limits.inspectorMin && value <= limits.inspectorMax ? value : null;
  }
  setInspectorWidth(width: number | null) { this.database.setSetting('ui.inspectorWidth', width === null ? null : String(width)); }

  /** The windows to open: those open when Atlas quit, and any opened since. */
  windows(): WindowRow[] {
    return (this.database.db.prepare('SELECT * FROM "window" ORDER BY id').all() as Row[]).map(row => ({
      id: Number(row.id), connectionId: (row.connection_id as string | null) ?? null, maximized: Boolean(row.maximized),
      bounds: { x: Number(row.x), y: Number(row.y), width: Number(row.width), height: Number(row.height) },
      sidebarWidth: clamp(Number(row.sidebar_width), limits.sidebarMin, limits.sidebarMax),
    }));
  }
  addWindow(connectionId: string | null, bounds: Bounds, maximized = false): number {
    const { lastInsertRowid } = this.database.db.prepare('INSERT INTO "window" (connection_id, x, y, width, height, maximized, sidebar_width) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(connectionId, bounds.x, bounds.y, bounds.width, bounds.height, maximized ? 1 : 0, sidebarWidth);
    return Number(lastInsertRowid);
  }
  updateWindow(id: number, change: { connectionId?: string | null; bounds?: Bounds; maximized?: boolean; sidebarWidth?: number }) {
    const { db } = this.database;
    if (change.connectionId !== undefined) db.prepare('UPDATE "window" SET connection_id = ? WHERE id = ?').run(change.connectionId, id);
    if (change.bounds) db.prepare('UPDATE "window" SET x = ?, y = ?, width = ?, height = ? WHERE id = ?').run(Math.round(change.bounds.x), Math.round(change.bounds.y), Math.round(change.bounds.width), Math.round(change.bounds.height), id);
    if (change.maximized !== undefined) db.prepare('UPDATE "window" SET maximized = ? WHERE id = ?').run(change.maximized ? 1 : 0, id);
    if (change.sidebarWidth !== undefined) db.prepare('UPDATE "window" SET sidebar_width = ? WHERE id = ?').run(clamp(Math.round(change.sidebarWidth), limits.sidebarMin, limits.sidebarMax), id);
  }
  /** A window closed: it and its tabs go. */
  removeWindow(id: number) { this.database.db.prepare('DELETE FROM "window" WHERE id = ?').run(id); }

  /** A window's tabs of the projects of one computer (connectionId null: this one), in their order, as many as a window holds. */
  tabs(windowId: number, connectionId: string | null): TabRow[] {
    return (this.database.db.prepare('SELECT tab.* FROM tab JOIN project ON project.id = tab.project_id WHERE window_id = ? AND project.connection_id IS ? ORDER BY tab.position, tab.id LIMIT ?').all(windowId, connectionId, limits.tabs) as Row[])
      .map(row => ({ projectId: Number(row.project_id), kind: row.kind as TabKind, target: (row.target as string | null) ?? null, active: Boolean(row.active) }));
  }
  /**
   * Replace a window's tabs of the projects whose saved tabs it loaded (`loaded`, project rows of one
   * computer). Its tabs of projects it could not list then (their computer did not answer, or their
   * folder was briefly not a planning folder) stay, after these, for when they are listed again, as
   * many as fit in a window; so do its tabs of other computers, for when it shows them again.
   */
  saveTabs(windowId: number, connectionId: string | null, tabs: TabRow[], loaded: number[]) {
    this.database.transaction(() => {
      const { db } = this.database;
      const shown = new Set([...loaded, ...tabs.map(tab => tab.projectId)]);
      const kept = this.tabs(windowId, connectionId).filter(tab => !shown.has(tab.projectId));
      db.prepare('DELETE FROM tab WHERE window_id = ? AND project_id IN (SELECT id FROM project WHERE connection_id IS ?)').run(windowId, connectionId);
      const insert = db.prepare('INSERT INTO tab (window_id, project_id, position, kind, target, active) VALUES (?, ?, ?, ?, ?, ?)');
      const active = tabs.some(tab => tab.active);
      [...tabs, ...kept.map(tab => ({ ...tab, active: tab.active && !active }))].slice(0, limits.tabs).forEach((tab, index) => insert.run(windowId, tab.projectId, index, tab.kind, tab.target, tab.active ? 1 : 0));
    });
  }
}
