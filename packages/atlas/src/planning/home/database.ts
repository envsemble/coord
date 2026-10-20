// The home database: <home>/atlas.db, one SQLite database written by the app, the host, the atlas
// command and the hooks. It holds Atlas's own state (projects and their order and state, windows
// and the places they show, settings, paired computers and devices, agent sessions) and the work
// reports; plans, ledgers, diagrams and the registry stay files in the planning folders. Every
// process opens it in WAL mode with a busy timeout, so they take turns writing; short-lived ones (the
// command, a hook) open it for one operation and close it again. Its user_version is the schema
// version: a new database gets the schema, and one of another version is refused.
import { closeSync, existsSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { atlasHome, guardTestHome } from './homePath.ts';

export const databaseName = 'atlas.db';

/** The schema. */
const schema = `CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE connection (
    id TEXT PRIMARY KEY, host_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, origin TEXT NOT NULL, device_id TEXT NOT NULL,
    token BLOB NOT NULL, paired_at TEXT NOT NULL, manage_access INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE device (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, secret_hash TEXT NOT NULL UNIQUE, paired_at TEXT NOT NULL, last_seen_at TEXT,
    platform TEXT NOT NULL DEFAULT '', manage_access INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE project (
    id INTEGER PRIMARY KEY, connection_id TEXT REFERENCES connection(id) ON DELETE CASCADE, name TEXT NOT NULL, folder TEXT NOT NULL,
    position INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'archived')), created_at TEXT NOT NULL);
  CREATE UNIQUE INDEX project_folder ON project(ifnull(connection_id, ''), folder);
  CREATE TABLE "window" (
    id INTEGER PRIMARY KEY, connection_id TEXT REFERENCES connection(id) ON DELETE SET NULL, x INTEGER NOT NULL, y INTEGER NOT NULL,
    width INTEGER NOT NULL, height INTEGER NOT NULL, maximized INTEGER NOT NULL DEFAULT 0);
  -- What a window shows of a project (active), and what it showed of other computers' projects or of projects it could not list.
  CREATE TABLE place (
    id INTEGER PRIMARY KEY, window_id INTEGER NOT NULL REFERENCES "window"(id) ON DELETE CASCADE, project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('project', 'work', 'diagram', 'file')), target TEXT, active INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX place_window ON place(window_id, position);
  -- An agent session: whether its agent is in a turn, when the turn started (null once it ended),
  -- when it began to wait for the person (null unless it waits), where its time not yet reported
  -- counts from, the time of the hook event that last changed its state (so a late one changes
  -- nothing), the session_work row it is on, the folder it runs in, the last message of its turn
  -- while it waits, and its title as its harness names it.
  CREATE TABLE session (
    id TEXT PRIMARY KEY, harness TEXT NOT NULL, transcript_path TEXT, started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    working INTEGER NOT NULL DEFAULT 0, turn_at TEXT, waiting_at TEXT, counts_at TEXT, state_at TEXT, focus INTEGER, cwd TEXT, message TEXT, title TEXT);
  -- The work items a session touched: when it linked to each, last touched it and last came to it.
  CREATE TABLE session_work (
    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE, project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL, linked_at TEXT NOT NULL, amending INTEGER NOT NULL DEFAULT 0, amended_at TEXT, touched_at TEXT NOT NULL, focused_at TEXT,
    UNIQUE (session_id, project_id, work_id));
  -- A work item a session left whose report is not measured yet: from since to when it left (at), as
  -- planning when it was amending the accepted plan; the session's next turn end, prompt or end measures it, retrying for a day.
  CREATE TABLE session_leave (
    id INTEGER PRIMARY KEY, link INTEGER NOT NULL REFERENCES session_work(id) ON DELETE CASCADE, since TEXT NOT NULL, at TEXT NOT NULL,
    amending INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX session_leave_link ON session_leave(link);
  -- A session's waits for the person, each with the work item it was on (ended_at null while it waits).
  CREATE TABLE session_wait (
    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE, project_id INTEGER REFERENCES project(id) ON DELETE CASCADE,
    work_id TEXT, started_at TEXT NOT NULL, ended_at TEXT);
  CREATE INDEX session_wait_session ON session_wait(session_id, ended_at);
  CREATE INDEX session_wait_work ON session_wait(project_id, work_id);
  -- The commits and PRs a session made for a work item.
  CREATE TABLE session_product (
    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE, project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('commit', 'pull')), at TEXT NOT NULL, repository TEXT, ident TEXT NOT NULL, title TEXT, url TEXT, branch TEXT,
    UNIQUE (project_id, work_id, kind, repository, ident));
  CREATE INDEX session_product_work ON session_product(project_id, work_id, at);
  -- A session's subagents at work: when each started and was last seen, and when it stopped (null while it works).
  CREATE TABLE session_agent (
    session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE, agent_id TEXT NOT NULL, agent_type TEXT,
    started_at TEXT NOT NULL, seen_at TEXT NOT NULL, stopped_at TEXT, PRIMARY KEY (session_id, agent_id));
  -- A work report, with its time and tokens by model and by reasoning effort, its subagents and its
  -- working intervals, per agent (agent null: the session's own); intervals is 1 when it has them.
  CREATE TABLE work_report (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE, work_id TEXT NOT NULL, at TEXT NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN ('planning', 'implementation')), step TEXT, model TEXT NOT NULL, session TEXT, tokens INTEGER, measured_since TEXT, agent_ms INTEGER,
    intervals INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX work_report_work ON work_report(project_id, work_id, at);
  CREATE TABLE report_model (
    id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES work_report(id) ON DELETE CASCADE, model TEXT NOT NULL, agent_ms INTEGER NOT NULL,
    input INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write INTEGER NOT NULL, output INTEGER NOT NULL);
  CREATE INDEX report_model_report ON report_model(report_id);
  CREATE TABLE report_effort (
    id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES work_report(id) ON DELETE CASCADE, agent TEXT, model TEXT NOT NULL, effort TEXT NOT NULL,
    agent_ms INTEGER NOT NULL, tokens INTEGER NOT NULL);
  CREATE INDEX report_effort_report ON report_effort(report_id);
  CREATE TABLE report_subagent (
    id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES work_report(id) ON DELETE CASCADE, agent TEXT NOT NULL, model TEXT,
    agent_ms INTEGER NOT NULL, tokens INTEGER NOT NULL);
  CREATE INDEX report_subagent_report ON report_subagent(report_id);
  CREATE TABLE report_interval (
    id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES work_report(id) ON DELETE CASCADE, agent TEXT,
    started_at TEXT NOT NULL, ended_at TEXT NOT NULL);
  CREATE INDEX report_interval_report ON report_interval(report_id);`;
/** How long a working session counts as live without being seen again: a long tool call can be quiet this long. */
export const liveWindowMs = 15 * 60_000;
/** How long a session waiting for the person counts as waiting: after a day it was most likely left. */
export const waitingWindowMs = 24 * 60 * 60_000;
/** The schema version this Atlas writes and reads. */
export const schemaVersion = 10;

/**
 * Put the database in WAL mode once; later openings find it there and leave it. Switching takes the
 * whole file for a moment, which processes opening it at once (hooks of one session) may refuse
 * without waiting: try again for a few seconds.
 */
function walMode(db: DatabaseSync) {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; ; attempt++) {
    try {
      if ((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode === 'wal') return;
      db.exec('PRAGMA journal_mode = WAL');
      return;
    } catch (error) {
      if (!/database is locked|SQLITE_BUSY/i.test((error as Error).message) || attempt >= 100) throw error;
      Atomics.wait(pause, 0, 0, 50);
    }
  }
}

export class DatabaseVersionError extends Error {
  constructor(file: string, version: number) {
    super(`${file} has schema version ${version}; this Atlas uses version ${schemaVersion}. Use the Atlas that made it, or move the file away to start afresh.`);
    this.name = 'DatabaseVersionError';
  }
}

export type ProjectState = 'active' | 'archived';
export interface ProjectRow { id: number; connectionId: string | null; name: string; folder: string; position: number; state: ProjectState; createdAt: string }

/** Compare folders as the platform does: case-insensitively on Windows and macOS. */
export const folderKey = (value: string, platform: NodeJS.Platform = process.platform) => platform === 'win32' || platform === 'darwin' ? value.toLowerCase() : value;

type Row = Record<string, unknown>;
/** A session on a work item now, as the host's contract describes it (SessionActivity). */
export interface SessionActivityRow { session: string; harness: 'claude-code' | 'codex' | 'unknown'; state: 'working' | 'waiting'; since: string; countsFrom: string | null }
/** What agents do on a work item now, as the host's contract describes it (WorkActivity). */
export interface WorkActivityRow { workId: string; state: 'working' | 'waiting'; since: string; sessions: SessionActivityRow[] }

/**
 * The database holds secrets (the host's, device hashes, connection tokens), so on POSIX the home is
 * created 0700 and the database 0600 before SQLite opens it; its -wal and -shm files take the
 * database's mode. On Windows the home is in the user's profile, whose permissions suffice.
 */
function ownerOnly(home: string, file: string) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') return;
  if (!existsSync(file)) closeSync(openSync(file, 'a', 0o600));
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
      walMode(this.db);
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
      this.prepareSchema();
    } catch (error) { this.db.close(); throw error; }
  }

  /** Open the home's database (ATLAS_HOME, else ~/.atlas, unless given), creating or updating its schema. Close it when done. */
  static open(home: string = atlasHome()): HomeDatabase { return new HomeDatabase(home); }

  /** Give a new database the schema; refuse one of another version. */
  private prepareSchema() {
    const version = () => Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version);
    if (version() === schemaVersion) return;
    this.transaction(() => {
      // Another process may have created it meanwhile.
      const current = version();
      if (current === schemaVersion) return;
      if (current !== 0) throw new DatabaseVersionError(this.file, current);
      this.db.exec(schema);
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
  /**
   * What agents do on each project's work now, as the hooks record it: work items with a session in
   * a turn and seen within `liveWindowMs` (working), or waiting for the person for at most
   * `waitingWindowMs` (waiting), unless another session worked on the work item since it began to
   * wait. A session counts only for the work item it is on (`session.focus`). Its time not yet reported counts from the latest of `counts_at` (its turn's start, moved
   * on past its waits and reports), when it came to the work item and its last report there; a
   * waiting session's stops when it began to wait, and is gone once its report is in. Each of its
   * subagents at work (seen within `liveWindowMs`, not stopped) is listed as working too, as
   * `<session>/<subagent>`, so the work item works while they do, whatever its main agent does.
   */
  workActivity(now = Date.now()): Map<number, WorkActivityRow[]> {
    const rows = this.db.prepare(`SELECT session.id, session.harness, session.working, session.turn_at, session.waiting_at, session.updated_at, session.counts_at, session.focus,
        session_work.id AS link, session_work.project_id, session_work.work_id, ifnull(session_work.focused_at, session_work.linked_at) AS came,
        (SELECT max(at) FROM work_report WHERE work_report.project_id = session_work.project_id AND work_report.work_id = session_work.work_id AND work_report.session = session.id) AS reported
      FROM session JOIN session_work ON session_work.session_id = session.id
      WHERE (session.working = 1 AND session.updated_at >= $live) OR (session.working = 0 AND session.waiting_at >= $day)
        OR session.id IN (SELECT session_id FROM session_agent WHERE stopped_at IS NULL AND seen_at >= $live)`)
      .all({ live: new Date(now - liveWindowMs).toISOString(), day: new Date(now - waitingWindowMs).toISOString() }) as Row[];
    // Subagents at work: started or seen within the live window, and not stopped.
    const agents = new Map<string, Row[]>();
    for (const agent of this.db.prepare('SELECT * FROM session_agent WHERE stopped_at IS NULL AND seen_at >= ? ORDER BY started_at').all(new Date(now - liveWindowMs).toISOString()) as Row[]) {
      agents.set(String(agent.session_id), [...agents.get(String(agent.session_id)) ?? [], agent]);
    }
    const on = new Map<string, Row>();
    for (const row of rows) if (Number(row.link) === Number(row.focus)) on.set(String(row.id), row);
    // Another session's touch, report or turn on the work item since a session began to wait.
    const later = this.db.prepare(`SELECT 1 FROM session_work WHERE project_id = ? AND work_id = ? AND session_id != ? AND max(ifnull(focused_at, ''), touched_at) > ?
      UNION ALL SELECT 1 FROM work_report WHERE project_id = ? AND work_id = ? AND ifnull(session, '') != ? AND at > ? LIMIT 1`);
    const latest = (...values: (string | null)[]) => values.filter((value): value is string => value !== null).sort().at(-1) ?? null;
    const work = new Map<string, { projectId: number; workId: string; sessions: SessionActivityRow[] }>();
    const liveFrom = new Date(now - liveWindowMs).toISOString(), dayFrom = new Date(now - waitingWindowMs).toISOString();
    for (const row of on.values()) {
      const id = String(row.id), waiting = row.waiting_at as string | null;
      const working = Number(row.working) === 1 && String(row.updated_at) >= liveFrom;
      const harness = row.harness === 'claude-code' || row.harness === 'codex' ? row.harness : 'unknown';
      const key = row.project_id + '\0' + row.work_id;
      const sessions = () => {
        let entry = work.get(key);
        if (!entry) work.set(key, entry = { projectId: Number(row.project_id), workId: String(row.work_id), sessions: [] });
        return entry.sessions;
      };
      // Each subagent at work counts for the work item its session is on, its time from its start
      // (or the session's last report there, or when the session came to it).
      for (const agent of agents.get(id) ?? []) {
        sessions().push({ session: id + '/' + String(agent.agent_id), harness, state: 'working', since: String(agent.started_at), countsFrom: latest(String(agent.started_at), row.came as string, row.reported as string | null) });
      }
      // The main agent: in a turn, or waiting for the person; not when it has done neither lately.
      const waits = !working && Number(row.working) !== 1 && waiting !== null && waiting >= dayFrom;
      if (!working && !waits) continue;
      if (waits && ([...on.values()].some(other => other !== row && other.project_id === row.project_id && other.work_id === row.work_id && String(other.turn_at ?? '') > waiting)
        || later.get(Number(row.project_id), String(row.work_id), id, waiting, Number(row.project_id), String(row.work_id), id, waiting))) continue;
      const turn = String(row.turn_at ?? row.updated_at);
      const counted = latest(row.counts_at as string | null ?? (working ? turn : null), row.came as string, row.reported as string | null);
      sessions().push(working ? { session: id, harness, state: 'working', since: turn, countsFrom: counted }
        : { session: id, harness, state: 'waiting', since: waiting!, countsFrom: row.counts_at !== null && counted! < waiting! ? counted : null });
    }
    const order = (a: { state: string; since: string }, b: { state: string; since: string }) => Number(b.state === 'working') - Number(a.state === 'working') || b.since.localeCompare(a.since);
    const activity = new Map<number, WorkActivityRow[]>();
    for (const { projectId, workId, sessions } of work.values()) {
      sessions.sort(order);
      const working = sessions.filter(session => session.state === 'working');
      // Working: since the earliest working session's turn began; waiting: since the latest began to wait.
      const item: WorkActivityRow = working.length ? { workId, state: 'working', since: working.map(session => session.since).sort()[0], sessions } : { workId, state: 'waiting', since: sessions[0].since, sessions };
      activity.set(projectId, [...activity.get(projectId) ?? [], item].sort(order));
    }
    return activity;
  }
  /**
   * Forget the last messages of sessions no longer waiting for the person: those whose wait passed
   * `waitingWindowMs`, when Needs you ends for them too (a wait that ends otherwise clears it then).
   */
  clearExpiredMessages(now = Date.now()) {
    this.db.prepare('UPDATE session SET message = NULL WHERE message IS NOT NULL AND (waiting_at IS NULL OR waiting_at < ?)').run(new Date(now - waitingWindowMs).toISOString());
  }
  /** What changes whenever a work report is recorded or removed: how many there are and the newest's row. */
  reportsMark(): string {
    const row = this.db.prepare('SELECT count(*) AS reports, ifnull(max(id), 0) AS newest FROM work_report').get() as Row;
    return row.reports + ':' + row.newest;
  }
  /** Change a project's cached name, state or position; a new position moves the others along. */
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
 * The folders (as folderKey) of this computer's projects that are archived, read from the
 * home's database when it has one: they do not match checkouts. A folder without a row is active.
 * A database still busy after its timeout is tried once more; it, or one that cannot be read (such
 * as one from a newer Atlas), is an error, as archived projects would otherwise match.
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
