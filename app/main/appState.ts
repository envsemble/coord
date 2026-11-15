// The app's own state in the home database (never in a planning folder): each window with its
// bounds, the computer it shows and the place it shows there (a row of the place table: something of
// one project, or the hub or statistics of one project), and the settings every window shares: the
// theme and the width the reader gave a diagram's details. Windows stay in the database when Coord
// quits, and open again at the next start; a window closed by hand is removed with its places.
import type { HomeDatabase } from '@envsemble/coord/planning';
import { type Place, type ThemePreference } from '../shared/contract.ts';
import { target as savedTarget } from '../shared/validate.ts';

export interface Bounds { x: number; y: number; width: number; height: number }
export interface WindowRow { id: number; computerId: string | null; bounds: Bounds; maximized: boolean }
/**
 * What a window showed of a project: a work item, a diagram or a file, or (`project`) the hub
 * filtered to the project, or with `{"page":"statistics"}` its statistics. The active one is what
 * the window shows; the others are what it showed of projects it cannot list now.
 */
export type PlaceKind = 'project' | 'work' | 'diagram' | 'file';
/** A saved place: the project row it is of, what it shows, and whether it is the one the window shows. */
export interface PlaceRow { projectRowId: number; kind: PlaceKind; target: string | null; active: boolean }

/**
 * A saved place as the window shows it: something of the project, or its hub or its statistics; null
 * when the row cannot be read.
 */
export function savedPlace(projectId: string, row: Pick<PlaceRow, 'kind' | 'target'>): Place | null {
  try {
    const saved = row.target ? JSON.parse(row.target) as Record<string, unknown> : {};
    if (row.kind === 'project') return { page: saved.page === 'statistics' ? 'statistics' : 'hub', projectId };
    return { projectId, target: savedTarget({ ...saved, kind: row.kind }) };
  } catch { return null; }
}
/**
 * How a place is saved: a row of its project, or none for a page of no project (which loads as the
 * hub). A ledger step the search found is not kept: it is pointed out once.
 */
export function placeRow(place: Place): { projectId: string; kind: PlaceKind; target: string | null } | null {
  if (!('page' in place)) {
    const { kind, ...rest } = place.target;
    const { step: _found, ...kept } = rest as typeof rest & { step?: string | null };
    return { projectId: place.projectId, kind, target: JSON.stringify(kept) };
  }
  // The Projects and Settings pages are no project's: after a restart the window opens on the hub.
  if ((place.page !== 'hub' && place.page !== 'statistics') || !place.projectId) return null;
  return { projectId: place.projectId, kind: 'project', target: place.page === 'statistics' ? JSON.stringify({ page: 'statistics' }) : null };
}

export const defaultSize = { width: 1280, height: 820 };
/** The rows a window keeps per computer: its place, then those of projects it could not list. */
const rowLimit = 40;
type Row = Record<string, unknown>;

export class AppState {
  private readonly database: HomeDatabase;
  constructor(database: HomeDatabase) { this.database = database; }

  /** The app's theme preference; the operating system's unless one was chosen. */
  get theme(): ThemePreference {
    const value = this.database.setting('theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  }
  setTheme(theme: ThemePreference) { this.database.setSetting('theme', theme === 'system' ? null : theme); }

  /** The starred work items, kept as one setting: a few hundred keys at most. */
  get stars(): string[] {
    try {
      const value = JSON.parse(this.database.setting('stars') ?? '[]') as unknown;
      return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : [];
    } catch { return []; }
  }
  setStar(key: string, starred: boolean): string[] {
    const stars = this.stars.filter(item => item !== key);
    if (starred) stars.unshift(key);
    const kept = stars.slice(0, 500);
    this.database.setSetting('stars', kept.length ? JSON.stringify(kept) : null);
    return kept;
  }

  /** The windows to open: those open when Coord quit, and any opened since. */
  windows(): WindowRow[] {
    return (this.database.db.prepare('SELECT * FROM "window" ORDER BY id').all() as Row[]).map(row => ({
      id: Number(row.id), computerId: (row.computer_id as string | null) ?? null, maximized: Boolean(row.maximized),
      bounds: { x: Number(row.x), y: Number(row.y), width: Number(row.width), height: Number(row.height) },
    }));
  }
  addWindow(computerId: string | null, bounds: Bounds, maximized = false): number {
    const { lastInsertRowid } = this.database.db.prepare('INSERT INTO "window" (computer_id, x, y, width, height, maximized) VALUES (?, ?, ?, ?, ?, ?)')
      .run(computerId, bounds.x, bounds.y, bounds.width, bounds.height, maximized ? 1 : 0);
    return Number(lastInsertRowid);
  }
  updateWindow(id: number, change: { computerId?: string | null; bounds?: Bounds; maximized?: boolean }) {
    const { db } = this.database;
    if (change.computerId !== undefined) db.prepare('UPDATE "window" SET computer_id = ? WHERE id = ?').run(change.computerId, id);
    if (change.bounds) db.prepare('UPDATE "window" SET x = ?, y = ?, width = ?, height = ? WHERE id = ?').run(Math.round(change.bounds.x), Math.round(change.bounds.y), Math.round(change.bounds.width), Math.round(change.bounds.height), id);
    if (change.maximized !== undefined) db.prepare('UPDATE "window" SET maximized = ? WHERE id = ?').run(change.maximized ? 1 : 0, id);
  }
  /** A window closed: it and its places go. */
  removeWindow(id: number) { this.database.db.prepare('DELETE FROM "window" WHERE id = ?').run(id); }

  /** A window's saved places of the projects of one computer (computerId null: this one), in their order. */
  places(windowId: number, computerId: string | null): PlaceRow[] {
    return (this.database.db.prepare('SELECT place.* FROM place JOIN project ON project.id = place.project_id WHERE window_id = ? AND project.computer_id IS ? ORDER BY place.position, place.id LIMIT ?').all(windowId, computerId, rowLimit) as Row[])
      .map(row => ({ projectRowId: Number(row.project_id), kind: row.kind as PlaceKind, target: (row.target as string | null) ?? null, active: Boolean(row.active) }));
  }
  /**
   * Replace a window's saved places of the projects whose places it loaded (`loaded`, project rows of
   * one computer) with what it shows now (none on a page of no project). Its places of projects it
   * could not list then (their computer did not answer, or their folder was briefly not a planning
   * folder) stay, after it, for when they are listed again; so do its places of other computers, for
   * when it shows them again.
   */
  savePlaces(windowId: number, computerId: string | null, places: PlaceRow[], loaded: number[]) {
    this.database.transaction(() => {
      const { db } = this.database;
      const shown = new Set([...loaded, ...places.map(place => place.projectRowId)]);
      const kept = this.places(windowId, computerId).filter(place => !shown.has(place.projectRowId));
      db.prepare('DELETE FROM place WHERE window_id = ? AND project_id IN (SELECT id FROM project WHERE computer_id IS ?)').run(windowId, computerId);
      const insert = db.prepare('INSERT INTO place (window_id, project_id, position, kind, target, active) VALUES (?, ?, ?, ?, ?, ?)');
      const active = places.some(place => place.active);
      [...places, ...kept.map(place => ({ ...place, active: place.active && !active }))].slice(0, rowLimit).forEach((place, index) => insert.run(windowId, place.projectRowId, index, place.kind, place.target, place.active ? 1 : 0));
    });
  }
}
