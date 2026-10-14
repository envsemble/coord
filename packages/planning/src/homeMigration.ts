// Bring the files Atlas kept in its home before the home database into it: the host's identity,
// settings and paired devices (host/access.json), the computer's folder list (host/folders.json)
// and the recent folders (planning-roots.json), which become projects, the paired computers
// (connections.json), the windows and their tabs and the theme (desktop-state.json), the hooks'
// session links (sessions/), and each planning folder's document use (usage/<hash>/). Each file is
// imported in one transaction and then set aside in <home>/legacy/, so a migration that stopped
// half way runs again from where it stopped, and nothing is imported twice. A file that cannot be
// read is left where it is and reported. Only `atlas setup` and the desktop app run this, before
// the host starts; the move of the old data folder (storage.ts) comes first.
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rename, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalProjectFolder, folderKey, projectOf, type HomeDatabase, type ProjectRow } from './database.ts';
import { homePlanningFolders, statisticsDirectory } from './storage.ts';

/** What a migration did, as paths relative to the home. */
export interface HomeMigration {
  /** Imported into the database and set aside in <home>/legacy/. */
  imported: string[];
  /** Could not be read or imported: left where they are, with the reason. */
  failed: string[];
  /** Usage statistics of a planning folder Atlas does not know (yet): left where they are. */
  unmatched: string[];
}

/** The files a migration imports, relative to the home. */
const homeFiles = ['host/access.json', 'connections.json', 'host/folders.json', 'planning-roots.json', 'desktop-state.json'];

const exists = (target: string) => stat(target).then(() => true, () => false);
const isFolder = (target: string) => stat(target).then(info => info.isDirectory(), () => false);
const isPlanningFolder = (folder: string) => stat(path.join(folder, 'planning.json')).then(info => info.isFile(), () => false);
async function readJson(file: string): Promise<unknown> { return JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')); }
const text = (value: unknown, max = 4096) => typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
const parseRemoteRoot = (root: string) => /^atlas-remote:([a-zA-Z0-9-]{8,64})\/(f-[a-f0-9]{32})$/.exec(root);

/** What is waiting to be imported into the database, relative to the home. */
export async function pendingHomeFiles(home: string): Promise<string[]> {
  const found = (await Promise.all(homeFiles.map(async name => await exists(path.join(home, ...name.split('/'))) ? name : null))).filter((name): name is string => name !== null);
  const sessions = (await readdir(path.join(home, 'sessions')).catch(() => [] as string[])).filter(name => name.endsWith('.json')).map(name => 'sessions/' + name);
  const usage = (await readdir(path.join(home, 'usage'), { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory()).map(entry => 'usage/' + entry.name);
  return [...found, ...sessions, ...usage];
}

/** Move a file or folder of the home into <home>/legacy/, numbering it when an earlier one is there. */
async function setAside(home: string, relative: string) {
  const parts = relative.split('/');
  let target = path.join(home, 'legacy', ...parts);
  for (let copy = 2; await exists(target); copy++) target = path.join(home, 'legacy', ...parts.slice(0, -1), parts.at(-1) + '.' + copy);
  await mkdir(path.dirname(target), { recursive: true });
  try { await rename(path.join(home, ...parts), target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await cp(path.join(home, ...parts), target, { recursive: true });
    await rm(path.join(home, ...parts), { recursive: true, force: true });
  }
}

/** The project of a planning folder on this computer, when it is one; listed folders that are gone are left out. */
async function localProject(database: HomeDatabase, folder: string): Promise<ProjectRow | null> {
  if (!path.isAbsolute(folder) || !await isPlanningFolder(folder)) return null;
  return projectOf(database, folder);
}

/** host/access.json: the host's identity, its remote-access settings and its paired devices. */
async function importAccess(database: HomeDatabase, value: unknown) {
  const file = value as { hostId?: unknown; name?: unknown; secret?: unknown; settings?: { network?: unknown }; devices?: unknown[] };
  const hostId = text(file?.hostId, 64), secret = text(file?.secret, 64);
  if (!hostId || !secret || !/^[a-zA-Z0-9-]{8,64}$/.test(hostId) || !/^[a-zA-Z0-9_-]{32,64}$/.test(secret)) throw new Error('it has no host identity this version can read');
  database.transaction(() => {
    // A host that already has an identity in the database keeps it.
    if (database.setting('host.id') === null) {
      database.setSetting('host.id', hostId);
      database.setSetting('host.name', text(file.name, 80) ?? 'Atlas');
      database.setSetting('host.secret', secret);
      if (file.settings?.network && typeof file.settings.network === 'object') database.setSetting('host.network', JSON.stringify(file.settings.network));
    }
    const insert = database.db.prepare('INSERT OR IGNORE INTO device (id, name, secret_hash, paired_at, last_seen_at, platform, manage_access) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const device of Array.isArray(file.devices) ? file.devices : []) {
      const entry = device as { deviceId?: unknown; name?: unknown; platform?: unknown; tokenHash?: unknown; scopes?: unknown; pairedAt?: unknown; lastSeenAt?: unknown };
      const id = text(entry?.deviceId, 64), hash = text(entry?.tokenHash, 64);
      if (!id || !hash || !/^d-[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{64}$/.test(hash)) continue;
      insert.run(id, text(entry.name, 80) ?? 'Device', hash, text(entry.pairedAt, 40) ?? new Date().toISOString(), text(entry.lastSeenAt, 40), text(entry.platform, 40) ?? '', Array.isArray(entry.scopes) && entry.scopes.includes('access:manage') ? 1 : 0);
    }
  });
}

/** connections.json: the computers this app paired with; tokens stay sealed as they were. */
function importConnections(database: HomeDatabase, value: unknown) {
  if (!Array.isArray(value)) throw new Error('it is not a list of connections');
  database.transaction(() => {
    for (const item of value.slice(0, 100)) {
      const entry = item as { hostId?: unknown; name?: unknown; origin?: unknown; deviceId?: unknown; token?: unknown; pairedAt?: unknown; manageAccess?: unknown; scopes?: unknown };
      const hostId = text(entry?.hostId, 64), origin = text(entry?.origin, 300), deviceId = text(entry?.deviceId, 64), token = text(entry?.token, 2000);
      if (!hostId || !origin || !deviceId || !token) continue;
      const manage = entry.manageAccess === true || (Array.isArray(entry.scopes) && entry.scopes.includes('access:manage'));
      database.db.prepare('INSERT OR IGNORE INTO connection (id, host_id, name, origin, device_id, token, paired_at, manage_access) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), hostId, text(entry.name, 80) ?? hostId, origin, deviceId, Buffer.from(token, 'utf8'), text(entry.pairedAt, 40) ?? new Date().toISOString(), manage ? 1 : 0);
    }
  });
}

/** host/folders.json and planning-roots.json: the folder lists become projects, in their order. */
async function importFolderList(database: HomeDatabase, folders: string[]) {
  for (const folder of folders) await localProject(database, folder).catch(() => null);
}

interface SavedTab { target?: { kind?: unknown; work?: unknown; section?: unknown; diagram?: unknown; element?: unknown; anchor?: unknown; path?: unknown } }

/** A saved tab as a tab row: its kind and target. Views went with the pages; their tabs are dropped. */
function tabRow(tab: SavedTab): { kind: string; target: string | null } | null {
  const target = tab?.target;
  if (target?.kind === 'work' && typeof target.work === 'string') {
    if (target.section === 'diagrams' && typeof target.diagram === 'string') return { kind: 'diagram', target: JSON.stringify({ work: target.work, path: target.diagram, element: text(target.element, 512) }) };
    return { kind: 'work', target: JSON.stringify({ work: target.work, anchor: text(target.anchor, 512) }) };
  }
  if (target?.kind === 'file' && typeof target.path === 'string') return { kind: 'file', target: JSON.stringify({ path: target.path, anchor: text(target.anchor, 512) }) };
  return null;
}

/** desktop-state.json: the theme, and each window open at quit with its bounds, its computer and its tabs. */
async function importDesktopState(database: HomeDatabase, value: unknown) {
  const state = value as { theme?: unknown; windows?: unknown; folders?: Record<string, { root?: unknown; bounds?: Record<string, unknown>; maximized?: unknown; ui?: { sidebar?: { width?: unknown }; tabs?: { items?: SavedTab[]; active?: unknown } }; remotePath?: unknown }> };
  if (!state || typeof state !== 'object') throw new Error('it is not desktop state');
  const records = new Map<string, NonNullable<typeof state.folders>[string]>();
  for (const record of Object.values(state.folders ?? {})) if (typeof record?.root === 'string') records.set(folderKey(record.root), record);
  // Each window's project, found before the transaction (finding a local folder reads it).
  const windows: { root: string; project: ProjectRow | null; connection: string | null; record: NonNullable<typeof state.folders>[string] | undefined }[] = [];
  for (const root of Array.isArray(state.windows) ? state.windows.filter((item): item is string => typeof item === 'string').slice(0, 20) : []) {
    const record = records.get(folderKey(root));
    const remote = parseRemoteRoot(root);
    if (remote) {
      const connection = database.db.prepare('SELECT id FROM connection WHERE host_id = ?').get(remote[1]) as { id: string } | undefined;
      const folder = text(record?.remotePath, 2048);
      if (!connection) continue;
      const project = folder ? database.addProject(folder, folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder, connection.id) : null;
      windows.push({ root, project, connection: connection.id, record });
    } else windows.push({ root, project: await localProject(database, await canonicalProjectFolder(root)), connection: null, record });
  }
  database.transaction(() => {
    if ((state.theme === 'light' || state.theme === 'dark') && database.setting('theme') === null) database.setSetting('theme', state.theme);
    // Windows saved before are already in the database: an import that ran before has nothing to add.
    if (Number((database.db.prepare('SELECT count(*) AS count FROM "window"').get() as { count: number }).count)) return;
    for (const { project, connection, record } of windows) {
      const bounds = record?.bounds ?? {};
      const whole = (value: unknown, fallback: number) => typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
      const width = record?.ui?.sidebar?.width;
      const { lastInsertRowid } = database.db.prepare('INSERT INTO "window" (connection_id, x, y, width, height, maximized, sidebar_width) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(connection, whole(bounds.x, 0), whole(bounds.y, 0), whole(bounds.width, 1280), whole(bounds.height, 820), record?.maximized === true ? 1 : 0, whole(width, 280));
      if (!project) continue;
      // The window showed its folder: its project page comes first, then the tabs it had.
      const items = Array.isArray(record?.ui?.tabs?.items) ? record.ui.tabs.items : [];
      const rows = [{ kind: 'project', target: null, active: !items.some(item => (item as { id?: unknown }).id === record?.ui?.tabs?.active) }, ...items.flatMap(item => {
        const row = tabRow(item);
        return row ? [{ ...row, active: (item as { id?: unknown }).id === record?.ui?.tabs?.active }] : [];
      })];
      const insert = database.db.prepare('INSERT INTO tab (window_id, project_id, position, kind, target, active) VALUES (?, ?, ?, ?, ?, ?)');
      rows.forEach((row, index) => insert.run(lastInsertRowid, project.id, index, row.kind, row.target, row.active ? 1 : 0));
    }
  });
}

/** sessions/<id>.json: a hook session's links to the work items it touched. */
async function importSession(database: HomeDatabase, value: unknown) {
  const links = value as { session?: unknown; transcriptPath?: unknown; updated?: unknown; work?: unknown[] };
  const id = text(links?.session, 128);
  if (!id || !Array.isArray(links.work)) throw new Error('it is not a session\'s links');
  const transcript = text(links.transcriptPath);
  const updated = text(links.updated, 40) ?? new Date().toISOString();
  const work: { project: ProjectRow; workId: string; amending: boolean; linked: string; amended: string | null }[] = [];
  for (const item of links.work) {
    const entry = item as { planningFolder?: unknown; workId?: unknown; amending?: unknown; linked?: unknown; amended?: unknown };
    const folder = text(entry?.planningFolder), workId = text(entry?.workId, 32);
    if (!folder || !workId || !/^work-[0-9]{4,}$/.test(workId)) continue;
    const project = await localProject(database, folder);
    if (project) work.push({ project, workId, amending: entry.amending === true, linked: text(entry.linked, 40) ?? updated, amended: text(entry.amended, 40) });
  }
  database.transaction(() => {
    const harness = transcript === null ? 'unknown' : /[\\/]\.codex[\\/]/.test(transcript) ? 'codex' : 'claude-code';
    database.db.prepare('INSERT OR IGNORE INTO session (id, harness, transcript_path, started_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, harness, transcript, work.map(item => item.linked).sort()[0] ?? updated, updated);
    const insert = database.db.prepare('INSERT OR IGNORE INTO session_work (session_id, project_id, work_id, linked_at, amending, amended_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const item of work) insert.run(id, item.project.id, item.workId, item.linked, item.amending ? 1 : 0, item.amended);
  });
}

/**
 * A planning folder's usage statistics from before the database (usage/<hash>: usage.sqlite and
 * collection-gaps.jsonl) as document use and collection gaps of its project. Events keep their IDs,
 * so importing them again adds nothing; failures and gaps are added once per moment and reason.
 */
export async function importLegacyUsage(database: HomeDatabase, projectId: number, folder: string) {
  const source = path.join(folder, 'usage.sqlite');
  const gaps: { at: string; reason: string }[] = [];
  let events: Record<string, unknown>[] = [], since: string | null = null;
  if (await exists(source)) {
    const old = new DatabaseSync(source, { readOnly: true });
    try {
      const tables = new Set((old.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(row => row.name));
      if (tables.has('events')) events = old.prepare('SELECT id, source, document_key, path, task_id, session_id, timestamp, revision, content_hash FROM events ORDER BY sequence').all() as Record<string, unknown>[];
      if (tables.has('failures')) for (const row of old.prepare('SELECT timestamp FROM failures').all() as { timestamp: string }[]) gaps.push({ at: row.timestamp, reason: 'agent_report' });
      if (tables.has('metadata')) since = (old.prepare("SELECT min(value) AS value FROM metadata WHERE key = 'dashboard_since'").get() as { value: string | null }).value;
    } finally { old.close(); }
  }
  for (const line of (await readFile(path.join(folder, 'collection-gaps.jsonl'), 'utf8').catch(() => '')).split(/\r?\n/)) {
    try {
      const gap = JSON.parse(line) as { source?: unknown; timestamp?: unknown };
      if ((gap.source === 'dashboard_view' || gap.source === 'agent_report') && typeof gap.timestamp === 'string') gaps.push({ at: gap.timestamp, reason: gap.source });
    } catch { /* A damaged line. */ }
  }
  database.transaction(() => {
    const insert = database.db.prepare('INSERT OR IGNORE INTO document_use (id, project_id, source, path, document_key, work_id, session, at, revision, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const event of events) {
      if (event.source !== 'dashboard_view' && event.source !== 'agent_report') continue;
      insert.run(String(event.id), projectId, event.source, String(event.path), String(event.document_key), (event.task_id as string | null) ?? null, (event.session_id as string | null) ?? null, String(event.timestamp), (event.revision as string | null) ?? null, (event.content_hash as string | null) ?? null);
    }
    const known = database.db.prepare('SELECT 1 FROM collection_gap WHERE project_id = ? AND at = ? AND reason = ?');
    const gap = database.db.prepare('INSERT INTO collection_gap (project_id, at, reason) VALUES (?, ?, ?)');
    for (const item of gaps) if (!known.get(projectId, item.at, item.reason)) gap.run(projectId, item.at, item.reason);
    // Views were counted since the old store began: the project's start goes back to then.
    if (since) database.db.prepare('UPDATE project SET created_at = min(created_at, ?) WHERE id = ?').run(since, projectId);
  });
}

/** Import what is waiting in the home into its database. Never throws; what failed is in the result. */
export async function migrateHomeFiles(database: HomeDatabase, home = database.home): Promise<HomeMigration> {
  const result: HomeMigration = { imported: [], failed: [], unmatched: [] };
  const step = async (relative: string, run: (value: unknown) => Promise<void> | void, read = true) => {
    try {
      await run(read ? await readJson(path.join(home, ...relative.split('/'))) : null);
      await setAside(home, relative);
      result.imported.push(relative);
    } catch (error) { result.failed.push(relative + ': ' + (error as Error).message); }
  };
  const pending = new Set(await pendingHomeFiles(home));
  if (pending.has('host/access.json')) await step('host/access.json', value => importAccess(database, value));
  if (pending.has('connections.json')) await step('connections.json', value => importConnections(database, value));
  // The computer's folder list (newest first), then the recent folders, then the rest of the home's planning folders.
  if (pending.has('host/folders.json')) await step('host/folders.json', value => importFolderList(database, ((value as { folders?: { path?: unknown }[] })?.folders ?? []).flatMap(entry => typeof entry?.path === 'string' ? [entry.path] : [])));
  if (pending.has('planning-roots.json')) await step('planning-roots.json', value => importFolderList(database, ((value as { recent?: unknown[] })?.recent ?? []).filter((item): item is string => typeof item === 'string')));
  await importFolderList(database, await homePlanningFolders(home));
  if (pending.has('desktop-state.json')) await step('desktop-state.json', value => importDesktopState(database, value));
  for (const name of [...pending].filter(item => item.startsWith('sessions/'))) await step(name, value => importSession(database, value));
  // The session links' lock files go with them.
  for (const name of await readdir(path.join(home, 'sessions')).catch(() => [] as string[])) if (/\.json\.lock(?:\.takeover)?$/.test(name)) await rm(path.join(home, 'sessions', name), { force: true }).catch(() => undefined);
  // Usage statistics are kept by a hash of their planning folder's path: match them to the projects' folders.
  const usage = [...pending].filter(item => item.startsWith('usage/'));
  if (usage.length) {
    const byHash = new Map<string, ProjectRow>();
    for (const project of database.projects()) byHash.set(path.basename(await statisticsDirectory(project.folder, home)), project);
    for (const name of usage) {
      const project = byHash.get(name.slice('usage/'.length));
      if (!project) { result.unmatched.push(name); continue; }
      await step(name, () => importLegacyUsage(database, project.id, path.join(home, ...name.split('/'))), false);
    }
  }
  for (const folder of ['host', 'sessions', 'usage']) if (await isFolder(path.join(home, folder))) await rmdir(path.join(home, folder)).catch(() => undefined);
  return result;
}
