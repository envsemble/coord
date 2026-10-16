// The app's own state in the home database (never in a planning folder): each window with its
// bounds, the computer it shows and the place it shows there (a row of the tab table: something of
// one project, or the hub or statistics of one project), and the settings every window shares: the
// theme and the width the reader gave a diagram's details. Windows stay in the database when Atlas
// quits, and open again at the next start; a window closed by hand is removed with its places.
import type { HomeDatabase } from '@envsemble/atlas-planning';
import { limits, type Place, type ThemePreference } from '../shared/contract.ts';
import { target as savedTarget } from '../shared/validate.ts';

export interface Bounds { x: number; y: number; width: number; height: number }
export interface WindowRow { id: number; connectionId: string | null; bounds: Bounds; maximized: boolean }
/**
 * What a window showed of a project: a work item, a diagram or a file, or (`project`) the hub
 * filtered to the project, or with `{"page":"statistics"}` its statistics. Before the hub a window
 * had several of these as tabs; the active one is what it showed.
 */
export type TabKind = 'project' | 'work' | 'diagram' | 'file';
/** A saved place: the project row it is of, what it shows, and whether it is the one the window shows. */
export interface TabRow { projectId: number; kind: TabKind; target: string | null; active: boolean }

/**
 * A saved place as the window shows it: something of the project, or its hub or its statistics; null
 * when the row cannot be read.
 */
export function savedPlace(project: string, row: Pick<TabRow, 'kind' | 'target'>): Place | null {
  try {
    const saved = row.target ? JSON.parse(row.target) as Record<string, unknown> : {};
    if (row.kind === 'project') return { page: saved.page === 'statistics' ? 'statistics' : 'hub', project };
    return { project, target: savedTarget({ ...saved, kind: row.kind }) };
  } catch { return null; }
}
/**
 * How a place is saved: a row of its project, or none for a page of no project (which loads as the
 * hub). A ledger step the search found is not kept: it is pointed out once.
 */
export function placeRow(place: Place): { project: string; kind: TabKind; target: string | null } | null {
  if (!('page' in place)) {
    const { kind, ...rest } = place.target;
    const { step: _found, ...kept } = rest as typeof rest & { step?: string | null };
    return { project: place.project, kind, target: JSON.stringify(kept) };
  }
  if (place.page === 'projects' || !place.project) return null;
  return { project: place.project, kind: 'project', target: place.page === 'statistics' ? JSON.stringify({ page: 'statistics' }) : null };
}

export const defaultSize = { width: 1280, height: 820 };
/** The rows a window keeps per computer: its place, then those of projects it could not list. */
const rowLimit = 40;
type Row = Record<string, unknown>;

export class DesktopState {
  private readonly database: HomeDatabase;
  constructor(database: HomeDatabase) { this.database = database; }

  /** The app's theme preference; the operating system's unless one was chosen. */
  get theme(): ThemePreference {
    const value = this.database.setting('theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  }
  setTheme(theme: ThemePreference) { this.database.setSetting('theme', theme === 'system' ? null : theme); }

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
    }));
  }
  addWindow(connectionId: string | null, bounds: Bounds, maximized = false): number {
    // The sidebar is gone; its column keeps a width for the database's schema.
    const { lastInsertRowid } = this.database.db.prepare('INSERT INTO "window" (connection_id, x, y, width, height, maximized, sidebar_width) VALUES (?, ?, ?, ?, ?, ?, 280)')
      .run(connectionId, bounds.x, bounds.y, bounds.width, bounds.height, maximized ? 1 : 0);
    return Number(lastInsertRowid);
  }
  updateWindow(id: number, change: { connectionId?: string | null; bounds?: Bounds; maximized?: boolean }) {
    const { db } = this.database;
    if (change.connectionId !== undefined) db.prepare('UPDATE "window" SET connection_id = ? WHERE id = ?').run(change.connectionId, id);
    if (change.bounds) db.prepare('UPDATE "window" SET x = ?, y = ?, width = ?, height = ? WHERE id = ?').run(Math.round(change.bounds.x), Math.round(change.bounds.y), Math.round(change.bounds.width), Math.round(change.bounds.height), id);
    if (change.maximized !== undefined) db.prepare('UPDATE "window" SET maximized = ? WHERE id = ?').run(change.maximized ? 1 : 0, id);
  }
  /** A window closed: it and its places go. */
  removeWindow(id: number) { this.database.db.prepare('DELETE FROM "window" WHERE id = ?').run(id); }

  /** A window's saved places of the projects of one computer (connectionId null: this one), in their order. */
  tabs(windowId: number, connectionId: string | null): TabRow[] {
    return (this.database.db.prepare('SELECT tab.* FROM tab JOIN project ON project.id = tab.project_id WHERE window_id = ? AND project.connection_id IS ? ORDER BY tab.position, tab.id LIMIT ?').all(windowId, connectionId, rowLimit) as Row[])
      .map(row => ({ projectId: Number(row.project_id), kind: row.kind as TabKind, target: (row.target as string | null) ?? null, active: Boolean(row.active) }));
  }
  /**
   * Replace a window's saved places of the projects whose places it loaded (`loaded`, project rows of
   * one computer) with what it shows now (none on a page of no project). Its places of projects it
   * could not list then (their computer did not answer, or their folder was briefly not a planning
   * folder) stay, after it, for when they are listed again; so do its places of other computers, for
   * when it shows them again.
   */
  saveTabs(windowId: number, connectionId: string | null, tabs: TabRow[], loaded: number[]) {
    this.database.transaction(() => {
      const { db } = this.database;
      const shown = new Set([...loaded, ...tabs.map(tab => tab.projectId)]);
      const kept = this.tabs(windowId, connectionId).filter(tab => !shown.has(tab.projectId));
      db.prepare('DELETE FROM tab WHERE window_id = ? AND project_id IN (SELECT id FROM project WHERE connection_id IS ?)').run(windowId, connectionId);
      const insert = db.prepare('INSERT INTO tab (window_id, project_id, position, kind, target, active) VALUES (?, ?, ?, ?, ?, ?)');
      const active = tabs.some(tab => tab.active);
      [...tabs, ...kept.map(tab => ({ ...tab, active: tab.active && !active }))].slice(0, rowLimit).forEach((tab, index) => insert.run(windowId, tab.projectId, index, tab.kind, tab.target, tab.active ? 1 : 0));
    });
  }
}
