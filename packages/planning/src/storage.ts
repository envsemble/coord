import path from 'node:path';
import { closeSync, openSync, readlinkSync } from 'node:fs';
import { appendFile, cp, mkdir, readdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir, hostname } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { filesystemCaseSensitive, filesystemNormalizesUnicode } from './filesystem.ts';

// `~/` and, on Windows, `~\` start a path in the user's home folder.
const tilde = process.platform === 'win32' ? /^~(?=$|[\\/])/ : /^~(?=$|\/)/;
const expand = (value: string, home: string) => path.resolve(value.replace(tilde, () => home));

/**
 * The Atlas home: `~/.atlas`, or ATLAS_HOME; an explicit override (such as --home) takes precedence
 * over both. Its `planning/` folder holds the planning folders (the projects), and Atlas keeps its
 * own state beside them: the home database (atlas.db) and logs. Electron's own caches stay in
 * Electron's per-user folder.
 */
export function atlasHome(override?: string, environment: NodeJS.ProcessEnv = process.env, home = homedir()) {
  const chosen = override || environment.ATLAS_HOME;
  return chosen ? expand(chosen, home) : path.join(home, '.atlas');
}

/** Where planning folders live in the home: `<home>/planning/<name>`. */
export function homePlanningDirectory(home: string) {
  return path.join(home, 'planning');
}

/**
 * The per-user folder Atlas used before the home, which Electron still uses for its own caches:
 * %APPDATA%\Atlas on Windows, ~/Library/Application Support/Atlas on macOS and
 * ${XDG_CONFIG_HOME:-~/.config}/Atlas elsewhere.
 */
export function legacyDataDirectory(environment: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()) {
  if (platform === 'win32') return path.join(environment.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Atlas');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Atlas');
  const configured = environment.XDG_CONFIG_HOME;
  return path.join(configured && path.isAbsolute(configured) ? configured : path.join(home, '.config'), 'Atlas');
}

/**
 * Whether an Atlas app runs from `folder`, its Electron data folder: it holds Chromium's
 * single-instance lock there. On Windows that is `lockfile`, open without write sharing and deleted
 * when the app exits; elsewhere `SingletonLock`, a link to `<computer>-<process id>`.
 */
export function atlasAppRunning(folder: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32') {
    try { closeSync(openSync(path.join(folder, 'lockfile'), 'r+')); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code !== 'ENOENT'; }
  }
  try {
    const [, computer, pid] = /^(.*)-([0-9]+)$/.exec(readlinkSync(path.join(folder, 'SingletonLock'))) ?? [];
    if (!pid) return false;
    // Another computer's lock (a shared home folder) cannot be checked: it counts as running.
    if (computer !== hostname()) return true;
    process.kill(Number(pid), 0);
    return true;
  } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** What Atlas itself kept in the old data folder; everything else there (Chromium's caches, Electron's files) stays. */
const legacyEntries = ['host', 'planning-roots.json', 'connections.json', 'desktop-state.json'];
const legacyLog = /^(?:atlas|host)(?:\.\d+)?\.log$/;

async function moveEntry(from: string, to: string) {
  await mkdir(path.dirname(to), { recursive: true });
  try { await rename(from, to); }
  catch (error) {
    // Another volume: copy, then remove the original.
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await rm(from, { recursive: true, force: true });
  }
}
const exists = (target: string) => stat(target).then(() => true, () => false);
/** The schema of a planning folder's usage statistics before the home database (usage/<hash>/usage.sqlite). */
export const legacyUsageSchema = 'CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, source TEXT NOT NULL, document_key TEXT NOT NULL, path TEXT NOT NULL, task_id TEXT, session_id TEXT, timestamp TEXT NOT NULL, revision TEXT, content_hash TEXT); CREATE INDEX IF NOT EXISTS event_document ON events(document_key); CREATE TABLE IF NOT EXISTS failures (timestamp TEXT NOT NULL, detail TEXT NOT NULL);';
const childNames = (folder: string, keep: (entry: { name: string; isDirectory(): boolean }) => boolean) =>
  readdir(folder, { withFileTypes: true }).then(entries => entries.filter(keep).map(entry => entry.name).sort(), () => [] as string[]);

/**
 * Add one planning folder's usage statistics (`from`, a usage/<hash> folder) to another's (`to`):
 * the events it lacks (each has its own ID), the recorded failures and collection gaps it lacks, and
 * the earlier of each "since" date. Merging the same statistics again adds nothing, so a move that
 * failed after its merge can be tried again.
 */
export async function mergeUsage(from: string, to: string) {
  await mkdir(to, { recursive: true });
  const source = path.join(from, 'usage.sqlite');
  if (await exists(source)) {
    const store = new DatabaseSync(path.join(to, 'usage.sqlite'));
    try {
      store.exec('PRAGMA busy_timeout = 2000;' + legacyUsageSchema);
      store.prepare('ATTACH DATABASE ? AS old').run(source);
      store.exec(`BEGIN;
        INSERT OR IGNORE INTO events (id, source, document_key, path, task_id, session_id, timestamp, revision, content_hash)
          SELECT id, source, document_key, path, task_id, session_id, timestamp, revision, content_hash FROM old.events ORDER BY sequence;
        INSERT INTO failures (timestamp, detail) SELECT DISTINCT timestamp, detail FROM old.failures AS o
          WHERE NOT EXISTS (SELECT 1 FROM main.failures AS f WHERE f.timestamp = o.timestamp AND f.detail = o.detail);
        INSERT INTO metadata (key, value) SELECT key, value FROM old.metadata WHERE true ON CONFLICT (key) DO UPDATE SET value = min(value, excluded.value);
        COMMIT;
        DETACH DATABASE old;`);
    } finally { store.close(); }
  }
  const gaps = (await readFile(path.join(from, 'collection-gaps.jsonl'), 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean);
  const target = path.join(to, 'collection-gaps.jsonl');
  const existing = await readFile(target, 'utf8').catch(() => '');
  const known = new Set(existing.split(/\r?\n/));
  const added = [...new Set(gaps.filter(line => !known.has(line)))];
  if (added.length) await appendFile(target, (existing && !existing.endsWith('\n') ? '\n' : '') + added.join('\n') + '\n');
}

/** Atlas's own files in the old data folder, as paths relative to it: what migrateLegacyData moves. */
export async function legacyData(legacy: string): Promise<string[]> {
  const units = [
    ...legacyEntries,
    ...(await childNames(path.join(legacy, 'logs'), entry => legacyLog.test(entry.name))).map(name => 'logs/' + name),
    ...(await childNames(path.join(legacy, 'usage'), entry => entry.isDirectory())).map(name => 'usage/' + name),
  ];
  const present = await Promise.all(units.map(name => exists(path.join(legacy, ...name.split('/')))));
  return units.filter((_, index) => present[index]);
}

/**
 * The old data folder's settings that have not moved into the home: what a home's own fresh settings
 * would shadow. Logs and usage statistics are left out, as the move merges or sets them aside safely.
 */
export async function legacySettings(legacy: string): Promise<string[]> {
  return (await legacyData(legacy)).filter(name => legacyEntries.includes(name));
}

/** What a move of the old data folder did, as paths relative to it. */
export interface LegacyMigration {
  /** Moved into the home. */
  moved: string[];
  /** A planning folder's usage statistics the home had too: added to the home's, the old copy set aside. */
  merged: string[];
  /** The home had its own: the old copy is in <home>/legacy/ instead. */
  setAside: string[];
  /** Left where it was, with the reason; the next migration tries again. */
  failed: string[];
}

/**
 * Move Atlas's own files from the old data folder into the home, leaving Electron's caches where they
 * are. Run it only while no Atlas app uses that folder: from the desktop app once it holds the
 * single-instance lock it shares with older versions, or from `atlas setup` after checking
 * atlasAppRunning. Usage statistics move per planning folder (usage/<hash>), merged into the home's
 * when it has that folder's too. Nothing the home has is overwritten: the old copy goes to
 * <home>/legacy/. What moved is gone from the old folder, so running it again does nothing. Never throws.
 */
export async function migrateLegacyData(home: string, legacy: string): Promise<LegacyMigration> {
  const result: LegacyMigration = { moved: [], merged: [], setAside: [], failed: [] };
  if (path.resolve(home) === path.resolve(legacy)) return result;
  for (const name of await legacyData(legacy)) {
    const parts = name.split('/'), from = path.join(legacy, ...parts), to = path.join(home, ...parts);
    try {
      if (!await exists(to)) { await moveEntry(from, to); result.moved.push(name); continue; }
      // An earlier move may have set aside a copy of the same name: number this one.
      let aside = path.join(home, 'legacy', ...parts);
      for (let copy = 2; await exists(aside); copy++) aside = path.join(home, 'legacy', ...parts.slice(0, -1), parts.at(-1) + '.' + copy);
      if (parts[0] === 'usage') await mergeUsage(from, to);
      await moveEntry(from, aside);
      result[parts[0] === 'usage' ? 'merged' : 'setAside'].push(name);
    } catch (error) { result.failed.push(name + ': ' + (error as Error).message); }
  }
  return result;
}

/** Create the home and its planning folder. Never throws: an unwritable home shows up where it is used. */
export async function prepareHome(options: { override?: string; environment?: NodeJS.ProcessEnv; home?: string } = {}) {
  const home = atlasHome(options.override, options.environment ?? process.env, options.home);
  await mkdir(homePlanningDirectory(home), { recursive: true }).catch(() => undefined);
  return { home };
}

/** The planning folders in the home: each folder of `<home>/planning` with a planning.json. */
export async function homePlanningFolders(home: string): Promise<string[]> {
  const base = homePlanningDirectory(home);
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  const folders: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folder = path.join(base, entry.name);
    if (await stat(path.join(folder, 'planning.json')).then(info => info.isFile(), () => false)) folders.push(folder);
  }
  return folders;
}

/** Where a planning folder's usage statistics were kept before the home database: <home>/usage/<canonical-path hash>. */
export async function statisticsDirectory(root: string, base?: string) {
  const canonical = await realpath(root).catch(() => path.resolve(root));
  const unicode = await filesystemNormalizesUnicode(canonical) ? canonical.normalize('NFC') : canonical;
  const normalized = (await filesystemCaseSensitive(canonical) ? unicode : unicode.toLowerCase()).split(path.sep).join('/');
  const identity = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return path.join(atlasHome(base), 'usage', identity);
}
