// The home database: <home>/atlas.db, one SQLite database written by the app, the host, the atlas
// command and the hooks. It holds Atlas's own state (projects and their order and state, windows
// and tabs, settings, paired computers and devices, agent sessions) and its statistics (document
// use, collection gaps and work reports); plans, ledgers, diagrams and the registry stay files in
// the planning folders. Every process opens it in WAL mode with a busy timeout, so they take turns
// writing; short-lived ones (the command, a hook) open it for one operation and close it again.
// The schema's version is the database's user_version; each migration runs once, in order.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { atlasHome, guardTestHome } from './storage.ts';

export const databaseName = 'atlas.db';

/** The schema, one entry per version: entry n brings a database from version n to n + 1. */
const migrations = [
  `CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE connection (
    id TEXT PRIMARY KEY, host_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, origin TEXT NOT NULL, device_id TEXT NOT NULL,
    token BLOB NOT NULL, paired_at TEXT NOT NULL, manage_access INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE device (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, secret_hash TEXT NOT NULL UNIQUE, paired_at TEXT NOT NULL, last_seen_at TEXT,
    platform TEXT NOT NULL DEFAULT '', manage_access INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE project (
    id INTEGER PRIMARY KEY, connection_id TEXT REFERENCES connection(id) ON DELETE CASCADE, name TEXT NOT NULL, folder TEXT NOT NULL,
    position INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'hidden', 'archived')), created_at TEXT NOT NULL);
  CREATE UNIQUE INDEX project_folder ON project(ifnull(connection_id, ''), folder);
  CREATE TABLE "window" (
    id INTEGER PRIMARY KEY, connection_id TEXT REFERENCES connection(id) ON DELETE SET NULL, x INTEGER NOT NULL, y INTEGER NOT NULL,
    width INTEGER NOT NULL, height INTEGER NOT NULL, maximized INTEGER NOT NULL DEFAULT 0, sidebar_width INTEGER NOT NULL);
  CREATE TABLE tab (
    id INTEGER PRIMARY KEY, window_id INTEGER NOT NULL REFERENCES "window"(id) ON DELETE CASCADE, project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('project', 'work', 'diagram', 'file')), target TEXT, active INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX tab_window ON tab(window_id, position);
  CREATE TABLE session (id TEXT PRIMARY KEY, harness TEXT NOT NULL, transcript_path TEXT, started_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE session_work (
    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE, project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL, linked_at TEXT NOT NULL, amending INTEGER NOT NULL DEFAULT 0, amended_at TEXT, UNIQUE (session_id, project_id, work_id));
  CREATE TABLE document_use (
    id TEXT PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE, source TEXT NOT NULL CHECK (source IN ('dashboard_view', 'agent_report')),
    path TEXT NOT NULL, document_key TEXT NOT NULL, work_id TEXT, session TEXT, at TEXT NOT NULL, revision TEXT, content_hash TEXT);
  CREATE INDEX document_use_project ON document_use(project_id, document_key);
  CREATE TABLE collection_gap (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE, at TEXT NOT NULL, reason TEXT NOT NULL);
  CREATE INDEX collection_gap_project ON collection_gap(project_id);
  CREATE TABLE work_report (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE, work_id TEXT NOT NULL, at TEXT NOT NULL,
    stage TEXT CHECK (stage IN ('planning', 'implementation')), step TEXT, model TEXT, session TEXT, tokens INTEGER, measured_since TEXT, agent_ms INTEGER);
  CREATE INDEX work_report_work ON work_report(project_id, work_id, at);
  CREATE TABLE report_model (
    id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES work_report(id) ON DELETE CASCADE, model TEXT NOT NULL, agent_ms INTEGER NOT NULL,
    input INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write INTEGER NOT NULL, output INTEGER NOT NULL);
  CREATE INDEX report_model_report ON report_model(report_id);
  CREATE TABLE report_subagent (
    id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES work_report(id) ON DELETE CASCADE, agent TEXT NOT NULL, model TEXT,
    agent_ms INTEGER NOT NULL, tokens INTEGER NOT NULL);
  CREATE INDEX report_subagent_report ON report_subagent(report_id);`,
];
/** The schema version this Atlas writes. */
export const schemaVersion = migrations.length;

export class DatabaseVersionError extends Error {
  constructor(file: string, version: number) {
    super(`${file} has schema version ${version}, newer than this Atlas knows (${schemaVersion}). Update Atlas.`);
    this.name = 'DatabaseVersionError';
  }
}

export type ProjectState = 'active' | 'hidden' | 'archived';
export interface ProjectRow { id: number; connectionId: string | null; name: string; folder: string; position: number; state: ProjectState; createdAt: string }

/** Compare folders as the platform does: case-insensitively on Windows and macOS. */
export const folderKey = (value: string, platform: NodeJS.Platform = process.platform) => platform === 'win32' || platform === 'darwin' ? value.toLowerCase() : value;

type Row = Record<string, unknown>;

/**
 * The database holds secrets (the host's, device hashes, connection tokens), so on POSIX the home is
 * created 0700 and the database 0600 before SQLite opens it; its -wal and -shm files take the
 * database's mode, and files an earlier Atlas left readable are tightened. On Windows the home is in
 * the user's profile, whose permissions suffice.
 */
function ownerOnly(home: string, file: string) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') return;
  if (!existsSync(file)) closeSync(openSync(file, 'a', 0o600));
  for (const name of [file, file + '-wal', file + '-shm']) {
    try { chmodSync(name, 0o600); } catch { /* Not there. */ }
  }
}
const projectRow = (row: Row): ProjectRow => ({
  id: Number(row.id), connectionId: (row.connection_id as string | null) ?? null, name: String(row.name), folder: String(row.folder),
  position: Number(row.position), state: row.state as ProjectState, createdAt: String(row.created_at),
});

/** A planning folder's display name: its registry's `name`, else the folder's own name. */
export async function planningName(folder: string): Promise<string> {
  try {
    const registry = JSON.parse((await readFile(path.join(folder, 'planning.json'), 'utf8')).replace(/^﻿/, '')) as { name?: unknown };
    if (typeof registry.name === 'string' && registry.name.trim()) return registry.name.trim().slice(0, 100);
  } catch { /* The folder's own name. */ }
  return path.basename(folder) || folder;
}

export class HomeDatabase {
  readonly home: string;
  readonly file: string;
  readonly db: DatabaseSync;

  private constructor(home: string) {
    guardTestHome(home);
    this.home = home;
    this.file = path.join(home, databaseName);
    ownerOnly(home, this.file);
    this.db = new DatabaseSync(this.file, { timeout: 10000 });
    try {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
      this.migrate();
    } catch (error) { this.db.close(); throw error; }
  }

  /** Open the home's database (ATLAS_HOME, else ~/.atlas, unless given), creating or updating its schema. Close it when done. */
  static open(home: string = atlasHome()): HomeDatabase { return new HomeDatabase(home); }

  private migrate() {
    const version = Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version);
    if (version > schemaVersion) throw new DatabaseVersionError(this.file, version);
    if (version === schemaVersion) return;
    this.transaction(() => {
      // Another process may have migrated it meanwhile.
      const current = Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version);
      for (let next = current; next < schemaVersion; next++) this.db.exec(migrations[next]);
      this.db.exec(`PRAGMA user_version = ${schemaVersion}`);
    });
  }

  /** Run `action` in one write transaction (taken at once, so readers never upgrade into a deadlock). */
  transaction<T>(action: () => T): T {
    if (this.db.isTransaction) return action();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* Already rolled back. */ }
      throw error;
    }
  }

  close() { if (this.db.isOpen) this.db.close(); }

  // ---- Settings ----------------------------------------------------------------------------------

  setting(key: string): string | null {
    return (this.db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as Row | undefined)?.value as string ?? null;
  }
  setSetting(key: string, value: string | null) {
    if (value === null) this.db.prepare('DELETE FROM setting WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // ---- Projects ----------------------------------------------------------------------------------

  /** The projects of this computer (connectionId null) or the rows kept for a paired computer's, in their order. */
  projects(connectionId: string | null = null): ProjectRow[] {
    const rows = connectionId === null
      ? this.db.prepare('SELECT * FROM project WHERE connection_id IS NULL ORDER BY position, id').all()
      : this.db.prepare('SELECT * FROM project WHERE connection_id = ? ORDER BY position, id').all(connectionId);
    return (rows as Row[]).map(projectRow);
  }
  project(id: number): ProjectRow | null {
    const row = this.db.prepare('SELECT * FROM project WHERE id = ?').get(id) as Row | undefined;
    return row ? projectRow(row) : null;
  }
  /** The project of a folder (a canonical path on this computer, or a paired computer's path), if it has one. */
  projectByFolder(folder: string, connectionId: string | null = null): ProjectRow | null {
    const key = folderKey(folder);
    return this.projects(connectionId).find(project => folderKey(project.folder) === key) ?? null;
  }
  /** Add a project at the end of its computer's list, or return the one the folder has. */
  addProject(folder: string, name: string, connectionId: string | null = null, state: ProjectState = 'active', createdAt = new Date().toISOString()): ProjectRow {
    return this.transaction(() => {
      const existing = this.projectByFolder(folder, connectionId);
      if (existing) return existing;
      const position = Number((this.db.prepare('SELECT ifnull(max(position) + 1, 0) AS next FROM project WHERE connection_id IS ?').get(connectionId) as Row).next);
      const { lastInsertRowid } = this.db.prepare('INSERT INTO project (connection_id, name, folder, position, state, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(connectionId, name, folder, position, state, createdAt);
      return this.project(Number(lastInsertRowid))!;
    });
  }
  /** Change a project's cached name, state or position; a new position moves the others along. */
  /** The model of a project's latest work report that names one, or null. */
  lastModel(projectId: number): string | null {
    const row = this.db.prepare('SELECT model FROM work_report WHERE project_id = ? AND model IS NOT NULL ORDER BY at DESC, id DESC LIMIT 1').get(projectId) as { model: string } | undefined;
    return row?.model ?? null;
  }
  updateProject(id: number, change: { name?: string; state?: ProjectState; position?: number; folder?: string }) {
    this.transaction(() => {
      const project = this.project(id);
      if (!project) return;
      if (change.name !== undefined) this.db.prepare('UPDATE project SET name = ? WHERE id = ?').run(change.name, id);
      if (change.state !== undefined) this.db.prepare('UPDATE project SET state = ? WHERE id = ?').run(change.state, id);
      if (change.folder !== undefined) this.db.prepare('UPDATE project SET folder = ? WHERE id = ?').run(change.folder, id);
      if (change.position !== undefined) {
        const order = this.projects(project.connectionId).filter(other => other.id !== id);
        order.splice(Math.max(0, Math.min(change.position, order.length)), 0, project);
        const place = this.db.prepare('UPDATE project SET position = ? WHERE id = ?');
        order.forEach((other, index) => place.run(index, other.id));
      }
    });
  }
  removeProject(id: number) { this.db.prepare('DELETE FROM project WHERE id = ?').run(id); }
}

/** Open the home's database for one operation, and close it again. */
export function withDatabase<T>(home: string | undefined, action: (database: HomeDatabase) => T): T {
  const database = HomeDatabase.open(home ?? atlasHome());
  try {
    const result = action(database);
    if (result instanceof Promise) throw new Error('withDatabase takes a synchronous action; use withDatabaseAsync.');
    return result;
  } finally { database.close(); }
}
export async function withDatabaseAsync<T>(home: string | undefined, action: (database: HomeDatabase) => Promise<T>): Promise<T> {
  const database = HomeDatabase.open(home ?? atlasHome());
  try { return await action(database); } finally { database.close(); }
}

/** A planning folder on this computer as projects record it: its canonical path. */
export async function canonicalProjectFolder(folder: string) {
  return realpath(folder).catch(() => path.resolve(folder));
}
export function canonicalProjectFolderSync(folder: string) {
  try { return realpathSync.native(folder); } catch { return path.resolve(folder); }
}

/**
 * The folders (as folderKey) of this computer's projects that are hidden or archived, read from the
 * home's database when it has one: they do not match checkouts. A folder without a row is active.
 * A database still busy after its timeout is tried once more; it, or one that cannot be read (such
 * as one from a newer Atlas), is an error, as hidden and archived projects would otherwise match.
 */
export async function inactiveProjectFolders(home: string): Promise<Set<string>> {
  if (!existsSync(path.join(home, databaseName))) return new Set();
  for (let attempt = 1; ; attempt++) {
    try {
      return withDatabase(home, database => new Set(database.projects().filter(project => project.state !== 'active').map(project => folderKey(project.folder))));
    } catch (error) {
      // SQLITE_BUSY: another process held it for longer than the busy timeout.
      if (attempt >= 2 || (error as { errcode?: number }).errcode !== 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

/** Whether a folder is a planning folder: it has a planning.json. */
export const isPlanningFolder = (folder: string) => stat(path.join(folder, 'planning.json')).then(info => info.isFile(), () => false);

export class NotPlanningFolderError extends Error {
  constructor(folder: string) { super(folder + ' has no planning.json; it is not a planning folder.'); this.name = 'NotPlanningFolderError'; }
}

/**
 * The project of a planning folder on this computer, added (named from its registry) when it has
 * none yet: statistics and sessions are kept by project, wherever the folder is. A folder that is
 * not a planning folder (a mistyped or missing path) gets no project: NotPlanningFolderError.
 */
export async function projectOf(database: HomeDatabase, folder: string): Promise<ProjectRow> {
  const canonical = await canonicalProjectFolder(folder);
  const known = database.projectByFolder(canonical);
  if (known) return known;
  if (!await isPlanningFolder(canonical)) throw new NotPlanningFolderError(canonical);
  return database.addProject(canonical, await planningName(canonical));
}
