// Record reported planning-document consultation without requiring a running app.
// Ported from the former log_consultation.py: the same registry checks, document keys,
// SQLite schema and storage location, so the app reads what the command writes.
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { filesystemCaseSensitive, filesystemNormalizesUnicode } from './filesystem.ts';
import { normalizedLocation } from './planning.ts';
import { cacheOutsidePlanning, statisticsDirectory } from './storage.ts';
import { schema } from './telemetry.ts';
import { runProgram as execute } from './run.ts';

const hiddenNames = new Set(['node_modules', '__pycache__', 'dist', 'build']);
const failureDetail = 'A requested consultation could not be recorded.';

export interface ConsultationOptions { task?: string; session?: string; dataDir?: string }
interface Registration { id: string; path: string; current_plan?: string | null }

/** A rejected registry or document; reported as a gap, never as a failure of the caller. */
class ConsultationError extends Error {
  constructor(message: string) { super(message); this.name = 'ConsultationError'; }
}

const expandHome = (value: string) => value.replace(/^~(?=$|[\\/])/, () => homedir());
function parts(value: string) {
  const { root } = path.parse(value);
  return [root, ...value.slice(root.length).split(path.sep).filter(Boolean)];
}
async function sameFile(first: string, second: string) {
  const [one, other] = await Promise.all([stat(first, { bigint: true }), stat(second, { bigint: true })]);
  return one.dev === other.dev && one.ino === other.ino;
}

/**
 * The planning-relative spelling retained on disk. Resolution can preserve a supplied spelling
 * even when the filesystem accepts a case or Unicode-normalization alias, so candidate identities
 * are verified; normalization alone must never equate distinct files on another volume.
 */
async function retainedRelative(actual: string, root: string, caseSensitive: boolean) {
  const original = parts(actual), parent = parts(root);
  if (original.length <= parent.length || !(await sameFile(path.join(...original.slice(0, parent.length)), root))) {
    throw new ConsultationError('Document is outside the planning folder');
  }
  const remaining = original.slice(parent.length);
  const comparable = (name: string) => { const normalized = name.normalize('NFC'); return caseSensitive ? normalized : normalized.toLowerCase(); };
  let directory = root;
  for (let index = 0; index < remaining.length; index++) {
    const part = remaining[index];
    const names = await readdir(directory);
    let spelling: string | undefined = names.includes(part) ? part : undefined;
    for (const name of names) {
      if (spelling !== undefined) break;
      if (comparable(name) === comparable(part) && await sameFile(path.join(directory, name), path.join(directory, part))) spelling = name;
    }
    if (spelling === undefined) throw new ConsultationError('Document entry is no longer available');
    remaining[index] = spelling;
    directory = path.join(directory, spelling);
  }
  return remaining.join('/');
}

/** The usage key: the owning work item's ID and work-relative path, or root:<path>. */
export function documentIdentity(relative: string, workItems: Registration[], caseSensitive = true, normalizesUnicode = false) {
  const normalize = (value: string) => { const spelling = normalizesUnicode ? value.normalize('NFC') : value; return caseSensitive ? spelling : spelling.toLowerCase(); };
  const identity = normalize(relative);
  const matches = workItems.filter(work => identity === normalize(work.path) || identity.startsWith(normalize(work.path) + '/'));
  const selected = matches.find(work => work.current_plan != null && normalize(work.current_plan) === identity);
  const depth = (value: string) => value.split('/').length;
  const work = selected ?? matches.reduce<Registration | undefined>((best, item) => !best || depth(item.path) > depth(best.path) ? item : best, undefined);
  if (!work) return 'root:' + relative;
  return work.id + ':' + (identity === normalize(work.path) ? path.basename(relative) : relative.split('/').slice(depth(work.path)).join('/'));
}

/** Keep a coverage signal when the shared database cannot accept a write. */
export async function recordAgentCollectionGap(root: string, dataDir?: string) {
  try {
    const destination = await cacheOutsidePlanning(root, await statisticsDirectory(expandHome(root), dataDir));
    await mkdir(destination, { recursive: true });
    appendFileSync(path.join(destination, 'collection-gaps.jsonl'), JSON.stringify({ source: 'agent_report', timestamp: new Date().toISOString() }) + '\n');
  } catch { /* A wholly unavailable cache cannot retain its own failure; the caller still discloses it. */ }
}

async function digest(filename: string) {
  const hash = createHash('sha256');
  for await (const block of createReadStream(filename)) hash.update(block);
  return hash.digest('hex');
}

/** Record the consulted documents. Returns recorded and unrecorded counts; throws when the store is unavailable. */
export async function reportConsultation(inputRoot: string, files: string[], options: ConsultationOptions = {}) {
  const root = await realpath(expandHome(inputRoot));
  const caseSensitive = await filesystemCaseSensitive(root);
  const registry: unknown = JSON.parse((await readFile(path.join(root, 'planning.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (!registry || typeof registry !== 'object' || Array.isArray(registry) || (registry as { schema_version?: unknown }).schema_version !== 1) {
    throw new ConsultationError('Unrecognized planning registry');
  }
  const items = (registry as { work_items?: unknown }).work_items;
  if (!Array.isArray(items) || items.some(work => !work || typeof work !== 'object' || Array.isArray(work) || typeof work.id !== 'string' || !/^work-[0-9]{4,}$/.test(work.id) || typeof work.path !== 'string')) {
    throw new ConsultationError('Invalid planning work identities');
  }
  const workItems = items as Registration[];
  const paths = workItems.flatMap(work => [work.path, work.current_plan].filter(value => value !== null && value !== undefined).map(normalizedLocation));
  const normalizesUnicode = await filesystemNormalizesUnicode(root, paths);
  const normalize = (value: string) => { const spelling = normalizesUnicode ? value.normalize('NFC') : value; return caseSensitive ? spelling : spelling.toLowerCase(); };
  const identities = new Set<string>(), locations = new Set<string>(), selectedPlans = new Set<string>();
  const registrations: Registration[] = [];
  for (const work of workItems) {
    const location = normalizedLocation(work.path);
    const identity = normalize(location);
    if (identities.has(work.id) || locations.has(identity)) throw new ConsultationError('Duplicate planning work identity or retained location');
    let currentPlan: string | null = null;
    if (work.current_plan !== null && work.current_plan !== undefined) {
      currentPlan = normalizedLocation(work.current_plan);
      const selected = normalize(currentPlan);
      if (selectedPlans.has(selected)) throw new ConsultationError('Conflicting selected plan pointers');
      selectedPlans.add(selected);
    }
    identities.add(work.id); locations.add(identity);
    registrations.push({ id: work.id, path: location, current_plan: currentPlan });
  }
  const destination = await cacheOutsidePlanning(root, await statisticsDirectory(root, options.dataDir));
  await mkdir(destination, { recursive: true });
  let revision: string | null = null;
  try {
    const { stdout: top } = await execute('git', ['-C', root, 'rev-parse', '--show-toplevel'], { timeout: 3000, windowsHide: true });
    const topParts = parts(await realpath(top.trim())).map(normalize), rootParts = parts(root).map(normalize);
    if (topParts.length === rootParts.length && topParts.every((part, index) => part === rootParts[index])) {
      const { stdout } = await execute('git', ['-C', root, 'rev-parse', 'HEAD'], { timeout: 3000, windowsHide: true });
      revision = stdout.trim() || null;
    }
  } catch { /* An unknown revision remains null. */ }
  const timestamp = new Date().toISOString();
  let recorded = 0, failed = 0;
  const seen = new Set<string>();
  const database = new DatabaseSync(path.join(destination, 'usage.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL;' + schema);
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('INSERT OR IGNORE INTO metadata VALUES (?, ?)').run('agent_since', timestamp);
      const insert = database.prepare('INSERT INTO events (id, source, document_key, path, task_id, session_id, timestamp, revision, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const failure = database.prepare('INSERT INTO failures VALUES (?, ?)');
      for (const supplied of files) {
        let event: { relative: string; hash: string } | null = null;
        try {
          const actual = await realpath(path.resolve(root, supplied));
          const relative = await retainedRelative(actual, root, caseSensitive);
          if (!(await stat(actual)).isFile() || relative.split('/').some(part => part.startsWith('.') || hiddenNames.has(part))) throw new ConsultationError('Unreadable planning document');
          if (seen.has(relative)) continue;
          seen.add(relative);
          event = { relative, hash: await digest(actual) };
        } catch {
          failure.run(timestamp, failureDetail);
          failed++;
          continue;
        }
        insert.run(randomUUID(), 'agent_report', documentIdentity(event.relative, registrations, caseSensitive, normalizesUnicode), event.relative, options.task || null, options.session || null, timestamp, revision, event.hash);
        recorded++;
      }
      database.exec('COMMIT');
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* The failed transaction is already closed. */ }
      throw error;
    }
  } finally { database.close(); }
  return { recorded, failed };
}

/**
 * Log consultation the way the atlas command does: never throw. When the store is unavailable,
 * leave a lasting coverage gap and return the error kind for a brief disclosure.
 */
export async function logConsultation(root: string, files: string[], options: ConsultationOptions = {}): Promise<{ recorded: number; failed: number; unavailable: null } | { recorded: 0; failed: 0; unavailable: string }> {
  try {
    return { ...await reportConsultation(root, files, options), unavailable: null };
  } catch (error) {
    await recordAgentCollectionGap(root, options.dataDir);
    const kind = (error as { code?: unknown } | null)?.code ?? (error as Error | null)?.name ?? 'Error';
    return { recorded: 0, failed: 0, unavailable: String(kind) };
  }
}
