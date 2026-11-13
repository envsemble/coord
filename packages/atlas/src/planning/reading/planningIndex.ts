import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { createHash } from 'node:crypto';
import { filesystemCaseSensitive, filesystemNormalizesUnicode } from '../../platform/filesystem.ts';
import { ledgerStatus } from '../work/ledger.ts';
import { groupsOfParts, partsOf } from '../work/parts.ts';
import { workStatistics } from '../reports/reports.ts';
import { planningName, type HomeDatabase } from '../../home/database.ts';
import type { Document, DocumentContent, HistoryEntry, Issue, PlanningIndex, Work } from '../types.ts';
import { runProgram as execute, runProgramBytes } from '../../platform/run.ts';
import { headCommit, topLevel } from '../../platform/git.ts';

const textExtensions = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.puml', '.mmd', '.mermaid', '.dot', '.html', '.css', '.js', '.ts', '.tsx', '.py', '.ps1', '.sh', '.sql', '.log']);
const excludedDirectories = new Set(['node_modules', '__pycache__', 'dist', 'build']);
const designStates = new Set(['draft', 'accepted', 'superseded', 'abandoned']);
const implementationStates = new Set(['unknown', 'not_started', 'in_progress', 'partial', 'complete']);
const workIdentity = /^work-[0-9]{4,}$/;
const planFields = ['schema_version', 'kind', 'id', 'title', 'created', 'updated', 'design_status', 'implementation_status', 'accepted_at', 'completed_at', 'supersedes', 'superseded_by'];
const readableLimit = 4 * 1024 * 1024;
type HistoricalWork = Pick<Work, 'id' | 'path' | 'currentPlan'>;
const historyCache = new Map<string, { head: string; entries: HistoryEntry[]; unattributedFiles: Map<string, string[]> }>();
/** A commit's changed files and the registered work they belong to, by commit and path rules: commits never change. */
const commitCache = new Map<string, { files: string[]; workIds: string[]; unowned: string[] }>();
/** The work a commit's registry registers, by commit and path rules. */
const registrationCache = new Map<string, HistoricalWork[]>();
/** Markdown documents as last read, by file: their title and metadata (or why they could not be read) while their size and times stay the same. */
const markdownCache = new Map<string, { size: number; mtimeMs: number; ctimeMs: number; read: { title: string; metadata: Record<string, unknown> | null } | Error }>();
const cacheLimit = 50000;
function remember<T>(cache: Map<string, T>, key: string, value: T) {
  cache.delete(key);
  if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
}

export class PlanningError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function within(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}
function hidden(relative: string) {
  return relative.split(path.sep).join('/').split('/').some(part => part.startsWith('.') || excludedDirectories.has(part));
}
export function normalizedLocation(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.includes(':') || path.posix.isAbsolute(value) || value.split('/').includes('..')) {
    throw new PlanningError('Work and selected plan paths must be POSIX-relative paths without parent segments.');
  }
  const normalized = path.posix.normalize(value).replace(/\/+$/, '');
  if (path.posix.isAbsolute(normalized) || /^[a-z]:/i.test(normalized)) throw new PlanningError('Work and selected plan paths must be POSIX-relative paths without drive syntax.');
  if (normalized === '.') throw new PlanningError('A work or plan path must identify a record inside the planning folder.');
  return normalized;
}
function pathIdentity(relative: string, caseSensitive: boolean, normalizesUnicode: boolean) {
  const spelling = normalizesUnicode ? relative.normalize('NFC') : relative;
  return caseSensitive ? spelling : spelling.toLowerCase();
}
function documentOwner<T extends HistoricalWork>(work: T[], relative: string, caseSensitive: boolean, normalizesUnicode: boolean): T | undefined {
  const locationIdentity = (value: string) => pathIdentity(value, caseSensitive, normalizesUnicode);
  const identity = locationIdentity(relative);
  const matches = work.filter(item => identity === locationIdentity(item.path) || identity.startsWith(locationIdentity(item.path) + '/'));
  return matches.find(item => item.currentPlan !== null && locationIdentity(item.currentPlan) === identity) ?? matches.sort((a, b) => b.path.split('/').length - a.path.split('/').length)[0];
}
function requireReadable(relative: string) {
  if (!relative || relative.includes('\0') || path.isAbsolute(relative) || /^[a-z]:/i.test(relative) || hidden(relative)) {
    throw new PlanningError('Choose a document inside the connected planning folder.', 403);
  }
}
export async function resolveDocument(root: string, relative: string) {
  requireReadable(relative);
  return resolveInside(await realpath(root), relative);
}
/** resolveDocument in a root already resolved to its real path. */
async function resolveInside(resolvedRoot: string, relative: string) {
  requireReadable(relative);
  const candidate = path.resolve(resolvedRoot, relative);
  if (!within(resolvedRoot, candidate)) throw new PlanningError('Document is outside the planning folder.', 403);
  let actual: string;
  try { actual = await realpath(candidate); } catch { throw new PlanningError('This document could not be found.', 404); }
  if (!within(resolvedRoot, actual) || hidden(path.relative(resolvedRoot, actual))) {
    throw new PlanningError('Document is outside the readable planning folder.', 403);
  }
  if (!(await stat(actual)).isFile()) throw new PlanningError('Choose a file to read.', 400);
  return actual;
}
function unpack(source: string): { body: string; metadata: Record<string, unknown> | null } {
  const normalized = source.replace(/^\uFEFF/, '');
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(normalized);
  if (!header) return { body: normalized, metadata: null };
  const metadata: unknown = parse(header[1], { schema: 'core', uniqueKeys: true, maxAliasCount: 30 });
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new PlanningError('Document metadata must be an object.');
  return { body: normalized.slice(header[0].length), metadata: metadata as Record<string, unknown> };
}
function heading(body: string, fallback: string) {
  return /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? fallback;
}
function date(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const milliseconds = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value ? value : null;
}
function format(filename: string) {
  const extension = path.extname(filename).toLowerCase();
  return extension === '.md' ? 'markdown' : textExtensions.has(extension) ? 'text' : 'attachment';
}
function category(relative: string) {
  const lower = relative.toLowerCase();
  if (/(^|\/)ledger\.md$/.test(lower)) return 'ledger';
  if (/(^|\/)context(?:-map)?\.md$/.test(lower)) return 'glossary';
  return 'document';
}
async function hashFile(filename: string) {
  const hash = createHash('sha256');
  for await (const block of createReadStream(filename)) hash.update(block);
  return hash.digest('hex');
}
export async function readDocument(root: string, relative: string): Promise<DocumentContent> {
  const filename = await resolveDocument(root, relative);
  const documentFormat = format(filename);
  if (documentFormat === 'attachment') return { path: relative, title: path.basename(filename), body: '', format: documentFormat, metadata: null, contentHash: await hashFile(filename) };
  if ((await stat(filename)).size > readableLimit) throw new PlanningError('This file is too large for the reader. Use Download instead.', 413);
  const bytes = await readFile(filename);
  const source = bytes.toString('utf8');
  const content = documentFormat === 'markdown' ? unpack(source) : { body: source, metadata: null };
  return { path: relative, title: typeof content.metadata?.title === 'string' ? content.metadata.title : heading(content.body, path.basename(filename)), format: documentFormat, contentHash: createHash('sha256').update(bytes).digest('hex'), ...content };
}
/**
 * A Markdown document's title and metadata as readDocument gives them, in a root already resolved to
 * its real path. A document whose size and times are unchanged is not read again.
 */
async function markdownSummary(resolvedRoot: string, relative: string): Promise<{ title: string; metadata: Record<string, unknown> | null }> {
  const filename = await resolveInside(resolvedRoot, relative);
  if (format(filename) !== 'markdown') return readDocument(resolvedRoot, relative);
  const information = await stat(filename);
  if (information.size > readableLimit) throw new PlanningError('This file is too large for the reader. Use Download instead.', 413);
  return markdownRead(filename, information);
}
/** A Markdown file's title and metadata, from the last reading while its size and times are unchanged. */
async function markdownRead(filename: string, information: { size: number; mtimeMs: number; ctimeMs: number }) {
  const known = markdownCache.get(filename);
  let read = known && known.size === information.size && known.mtimeMs === information.mtimeMs && known.ctimeMs === information.ctimeMs ? known.read : null;
  if (!read) {
    const source = await readFile(filename, 'utf8');
    try {
      const content = unpack(source);
      read = { title: typeof content.metadata?.title === 'string' ? content.metadata.title : heading(content.body, path.basename(filename)), metadata: content.metadata };
    } catch (error) { read = error instanceof Error ? error : new Error(String(error)); }
    remember(markdownCache, filename, { size: information.size, mtimeMs: information.mtimeMs, ctimeMs: information.ctimeMs, read });
  }
  if (read instanceof Error) throw read;
  return read;
}
async function files(root: string, directory = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || excludedDirectories.has(entry.name) || entry.isSymbolicLink()) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(root, filename));
    else if (entry.isFile()) result.push(path.relative(root, filename).split(path.sep).join('/'));
  }
  return result;
}
/** The work a registry (planning.json's text) registers; none for one that is missing, invalid or not schema version 2. */
function registrationsIn(source: string | null, locationIdentity: (value: string) => string): HistoricalWork[] {
  if (source === null) return [];
  try {
    const registry = JSON.parse(source.replace(/^﻿/, ''));
    if (registry?.schema_version !== 2 || !Array.isArray(registry.work_items)) return [];
    const locations = new Set<string>();
    const identities = new Set<string>();
    const selectedPlans = new Set<string>();
    const registrations: HistoricalWork[] = [];
    for (const item of registry.work_items) {
      if (!item || typeof item.id !== 'string' || !workIdentity.test(item.id) || identities.has(item.id)) return [];
      const location = normalizedLocation(item.path);
      if (locations.has(locationIdentity(location))) return [];
      const currentPlan = item.current_plan == null ? null : normalizedLocation(item.current_plan);
      if (currentPlan && selectedPlans.has(locationIdentity(currentPlan))) return [];
      if (currentPlan) selectedPlans.add(locationIdentity(currentPlan));
      locations.add(locationIdentity(location)); identities.add(item.id);
      registrations.push({ id: item.id, path: location, currentPlan });
    }
    return registrations;
  } catch { return []; /* Unregistered or invalid history has no established work identity. */ }
}
/** planning.json at each commit, in one run of Git; null where a commit has none (or one over 1 MiB, which is not read). */
async function registriesAt(root: string, commits: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>(commits.map(commit => [commit, null]));
  if (!commits.length) return result;
  const { stdout } = await runProgramBytes('git', ['-C', root, 'cat-file', '--batch'], { input: commits.map(commit => commit + ':planning.json\n').join(''), maxBuffer: 256 * 1024 * 1024 });
  let offset = 0;
  for (const commit of commits) {
    const end = stdout.indexOf(0x0a, offset);
    if (end < 0) throw new Error('Git ended its answer early.');
    // `<object> <type> <size>` and the contents, or `<name> missing`.
    const header = stdout.toString('utf8', offset, end).split(' ');
    offset = end + 1;
    if (header.length !== 3) continue;
    const size = Number(header[2]);
    if (header[1] === 'blob' && size <= 1024 * 1024) result.set(commit, stdout.toString('utf8', offset, offset + size));
    offset += size + 1;
  }
  return result;
}
export async function gitHistory(root: string, currentWork: HistoricalWork[] = [], sensitivity?: boolean, normalization?: boolean): Promise<{ history: HistoryEntry[]; available: boolean }> {
  try {
    const caseSensitive = sensitivity ?? await filesystemCaseSensitive(root);
    const normalizesUnicode = normalization ?? await filesystemNormalizesUnicode(root, await files(root));
    const locationIdentity = (value: string) => pathIdentity(value, caseSensitive, normalizesUnicode);
    const rules = '\0' + caseSensitive + '\0' + normalizesUnicode;
    const top = await topLevel(root);
    if (!top) return { history: [], available: false };
    const canonical = locationIdentity(await realpath(root));
    if (locationIdentity(await realpath(top)) !== canonical) return { history: [], available: false };
    const head = await headCommit(root);
    if (!head) return { history: [], available: false };
    const cacheKey = canonical + rules;
    let retained = historyCache.get(cacheKey);
    if (!retained || retained.head !== head) {
      // Each commit's changes against its first parent, read in the direction they were made: rename
      // detection must not alter historical ownership.
      const { stdout } = await execute('git', ['-C', root, '-c', 'log.showSignature=false', 'log', '-30', '--root', '--diff-merges=first-parent', '--no-renames', '--no-color', '--name-status', '-z', '--format=%x1e%H%x00%aI%x00%s%x00%P'], { maxBuffer: 64 * 1024 * 1024 });
      const commits = stdout.split('\x1e').slice(1).map(record => {
        const fields = record.split('\0');
        const changes: [string, string][] = [];
        for (let index = 4; index + 1 < fields.length;) {
          const status = fields[index].replace(/^\n/, '');
          if (!status) { index++; continue; }
          changes.push([status, fields[index + 1]]);
          index += 2;
        }
        return { id: fields[0], date: fields[1], title: fields[2], parent: fields[3]?.trim().split(' ')[0] || undefined, changes };
      });
      // Only commits not read before need their registries: the commit's and its first parent's.
      const unread = commits.filter(commit => !commitCache.has(commit.id + rules));
      const registryCommits = [...new Set(unread.flatMap(commit => commit.parent ? [commit.id, commit.parent] : [commit.id]))];
      const registrations = new Map<string, HistoricalWork[]>();
      for (const commit of registryCommits) { const known = registrationCache.get(commit + rules); if (known) registrations.set(commit, known); }
      const sources = await registriesAt(root, registryCommits.filter(commit => !registrations.has(commit)));
      for (const [commit, source] of sources) { const found = registrationsIn(source, locationIdentity); registrations.set(commit, found); remember(registrationCache, commit + rules, found); }
      for (const commit of unread) {
        const current = registrations.get(commit.id) ?? [], previous = commit.parent ? registrations.get(commit.parent) ?? [] : [];
        const matches: HistoricalWork[] = [];
        const unowned: string[] = [];
        for (const [status, file] of commit.changes) {
          const snapshots = status === 'D' ? [previous] : status === 'A' ? [current] : [previous, current];
          let attributed = false;
          for (const snapshot of snapshots) {
            const owner = documentOwner(snapshot, file, caseSensitive, normalizesUnicode);
            if (owner) { matches.push(owner); attributed = true; }
          }
          if (!attributed) unowned.push(file);
        }
        remember(commitCache, commit.id + rules, { files: commit.changes.map(([, file]) => file), workIds: [...new Set(matches.map(item => item.id))], unowned });
      }
      const unattributedFiles = new Map<string, string[]>();
      const entries: HistoryEntry[] = commits.map(commit => {
        const read = commitCache.get(commit.id + rules)!;
        unattributedFiles.set(commit.id, read.unowned);
        return { id: commit.id, date: commit.date, title: commit.title, files: [...read.files], workIds: read.workIds };
      });
      retained = { head, entries, unattributedFiles };
      historyCache.set(cacheKey, retained);
    }
    const kept = retained;
    return { available: true, history: kept.entries.map(entry => {
      // A newly adopted, uncommitted registration can identify previously unregistered records.
      const unowned = kept.unattributedFiles.get(entry.id) ?? [];
      const matches = unowned.map(file => documentOwner(currentWork, file, caseSensitive, normalizesUnicode)).filter((item): item is HistoricalWork => Boolean(item));
      return { ...entry, workIds: [...new Set([...entry.workIds, ...matches.map(item => item.id)])] };
    }) };
  } catch { return { history: [], available: false }; }
}
/** Read a planning folder. Work statistics come from the home database: the one given, else the home's (`home`, else ATLAS_HOME or ~/.atlas). */
export async function loadPlanning(inputRoot: string, options: { home?: string; database?: HomeDatabase | null } = {}): Promise<PlanningIndex> {
  let root: string;
  try { root = await realpath(inputRoot); } catch { throw new PlanningError('The planning folder does not exist. Check --planning-dir.'); }
  let registry: { schema_version: number; folders: string[]; work_items: { id: string; path: string; current_plan: string | null }[] };
  try { registry = JSON.parse((await readFile(path.join(root, 'planning.json'), 'utf8')).replace(/^\uFEFF/, '')); }
  catch { throw new PlanningError('The planning folder needs a readable planning.json registry.'); }
  if (!registry || registry.schema_version !== 2 || !Array.isArray(registry.folders) || !Array.isArray(registry.work_items)) {
    throw new PlanningError('The planning registry must use schema version 2 with folders and work_items.');
  }
  const caseSensitivePaths = await filesystemCaseSensitive(root);
  const retainedFiles = await files(root);
  const registeredPaths = registry.work_items.flatMap(item => [item?.path, item?.current_plan].filter((value): value is string => typeof value === 'string').map(normalizedLocation));
  const normalizationInsensitivePaths = await filesystemNormalizesUnicode(root, [...retainedFiles, ...registeredPaths]);
  const locationIdentity = (value: string) => pathIdentity(value, caseSensitivePaths, normalizationInsensitivePaths);
  const issues: Issue[] = [];
  const work: Work[] = [];
  const identities = new Set<string>();
  const registeredIds = new Set(registry.work_items.map(item => item?.id));
  const locations = new Set<string>();
  const selectedPlans = new Set<string>();
  // Each work folder and plan is looked up at once; the checks below take the answers in order.
  const settled = <T>(promise: Promise<T>) => promise.then(value => () => value, (error: unknown) => () => { throw error; });
  const lookups = registry.work_items.map(item => {
    try {
      const relative = normalizedLocation(item?.path);
      const plan = item.current_plan === null ? null : normalizedLocation(item.current_plan);
      return { folder: settled(realpath(path.resolve(root, relative))), plan: plan !== null && locationIdentity(plan) === locationIdentity(relative + '/plan.md') ? settled(markdownSummary(root, plan)) : null };
    } catch { return null; /* The checks below report it. */ }
  });
  for (const [index, item] of registry.work_items.entries()) {
    if (!item || typeof item.id !== 'string' || !workIdentity.test(item.id) || identities.has(item.id) || typeof item.path !== 'string') {
      throw new PlanningError('A work item has an invalid or duplicate identity or location.');
    }
    const relative = normalizedLocation(item.path);
    const currentPlan = item.current_plan === null ? null : normalizedLocation(item.current_plan);
    const location = locationIdentity(relative);
    if (locations.has(location)) throw new PlanningError('Two work items have the same retained location; reconcile the duplicate registration.');
    if (currentPlan && selectedPlans.has(locationIdentity(currentPlan))) throw new PlanningError('Several work items select the same plan; reconcile the conflicting pointers.');
    if (currentPlan) selectedPlans.add(locationIdentity(currentPlan));
    locations.add(location);
    identities.add(item.id);
    const folder = path.resolve(root, relative);
    if (!within(root, folder) || hidden(relative)) throw new PlanningError('A registered work item points outside the planning folder.');
    try { if (!within(root, (await lookups[index]!.folder)())) throw new Error('Outside folder'); }
    catch { issues.push({ level: 'error', workId: item.id, message: 'The work folder is missing or outside the planning folder.' }); }
    const entry: Work = {
      id: item.id, path: relative, currentPlan,
      title: path.basename(relative).replace(/^\d+-/, '').replaceAll('-', ' '),
      location: location.startsWith('active/') ? 'active' : location.startsWith('archive/') ? 'archived' : 'retained',
      design: 'unknown', implementation: 'unknown', created: null, updated: null, accepted: null,
      completed: null, durationDays: null, documents: [], parts: [], partOf: null,
    };
    if (currentPlan === null || locationIdentity(currentPlan) !== locationIdentity(relative + '/plan.md')) {
      issues.push({ level: 'error', workId: item.id, message: "The work item's main plan must be plan.md in its folder." });
    } else {
      try {
        const content = (await lookups[index]!.plan!)();
        const metadata = content.metadata;
        if (!metadata) throw new PlanningError('The plan has no metadata header.');
        if (metadata.kind !== 'plan' || metadata.schema_version !== 2 || metadata.id !== item.id) throw new PlanningError('The selected document does not have matching plan metadata (schema version 2).');
        const missing = planFields.filter(field => !Object.hasOwn(metadata, field));
        if (missing.length) issues.push({ level: 'error', workId: item.id, message: 'Missing plan metadata: ' + missing.join(', ') + '.' });
        if (typeof metadata.title !== 'string' || !metadata.title.trim()) issues.push({ level: 'error', workId: item.id, message: 'The plan title must be a nonempty string.' });
        if (!Array.isArray(metadata.supersedes) || metadata.supersedes.some(id => typeof id !== 'string' || !registeredIds.has(id) || id === item.id) || new Set(metadata.supersedes).size !== metadata.supersedes.length) issues.push({ level: 'error', workId: item.id, message: 'Supersedes must list unique other registered work IDs.' });
        if (metadata.superseded_by !== null && (typeof metadata.superseded_by !== 'string' || !registeredIds.has(metadata.superseded_by) || metadata.superseded_by === item.id)) issues.push({ level: 'error', workId: item.id, message: 'Superseded by must identify another registered work item or null.' });
        entry.title = content.title;
        entry.parts = partsOf(metadata.parts, item.id);
        if (typeof metadata.design_status === 'string' && designStates.has(metadata.design_status)) entry.design = metadata.design_status;
        else issues.push({ level: 'error', workId: item.id, message: 'The plan has an unrecognized design status.' });
        if (typeof metadata.implementation_status === 'string' && implementationStates.has(metadata.implementation_status)) entry.implementation = metadata.implementation_status;
        else issues.push({ level: 'error', workId: item.id, message: 'The plan has an unrecognized implementation status.' });
        function lifecycleDate(field: string) {
          const value = date(metadata![field]);
          if (metadata![field] !== null && !value) issues.push({ level: 'error', workId: item.id, message: 'Plan date ' + field + ' is invalid; use an ISO date or null.' });
          return value;
        }
        entry.created = lifecycleDate('created'); entry.updated = lifecycleDate('updated');
        entry.accepted = lifecycleDate('accepted_at'); entry.completed = lifecycleDate('completed_at');
        const updated = entry.updated;
        const chronologyInvalid = (updated && [entry.created, entry.accepted, entry.completed].some(milestone => milestone && updated < milestone)) || (entry.created && entry.accepted && entry.accepted < entry.created) || (entry.completed && (entry.accepted && entry.completed < entry.accepted || entry.created && entry.completed < entry.created));
        if (chronologyInvalid) issues.push({ level: 'error', workId: item.id, message: 'Recorded lifecycle dates are out of order.' });
        if (entry.completed && entry.implementation !== 'complete') issues.push({ level: 'error', workId: item.id, message: 'A completion date requires complete implementation status.' });
        if (entry.accepted && entry.design === 'draft') issues.push({ level: 'error', workId: item.id, message: 'A draft cannot claim an acceptance date.' });
        if (entry.implementation === 'complete' && designStates.has(entry.design) && entry.design !== 'draft' && entry.accepted && entry.completed && !chronologyInvalid) {
          entry.durationDays = Math.round((Date.parse(entry.completed) - Date.parse(entry.accepted)) / 86400000);
        }
      } catch (error) { issues.push({ level: 'error', workId: item.id, message: error instanceof Error ? error.message : 'The selected plan could not be read.' }); }
    }
    work.push(entry);
  }
  // A part's group is the first work item in the registry that lists it.
  const groups = groupsOfParts(work);
  for (const item of work) item.partOf = groups.get(item.id) ?? null;
  const documents: Document[] = [];
  // The listing has only files inside the root, not through links nor hidden: each is where it is
  // listed. A Markdown document unchanged since the last reading is not read again.
  const listed = await Promise.all(retainedFiles.map(async relative => {
    const filename = path.join(root, ...relative.split('/'));
    let information;
    try { information = await stat(filename); } catch { throw new PlanningError('This document could not be found.', 404); }
    if (!information.isFile()) throw new PlanningError('Choose a file to read.', 400);
    let title = path.basename(filename);
    if (format(filename) === 'markdown' && information.size <= readableLimit) {
      try { title = (await markdownRead(filename, information)).title; } catch { /* A malformed other file in the work folder remains downloadable. */ }
    }
    return { relative, filename, information, title };
  }));
  for (const { relative, filename, information, title } of listed) {
    const owner = documentOwner(work, relative, caseSensitivePaths, normalizationInsensitivePaths);
    const identity = locationIdentity(relative);
    const document: Document = {
      path: relative, name: path.basename(filename), title, size: information.size, modified: information.mtime.toISOString(),
      key: owner ? owner.id + ':' + (locationIdentity(relative) === locationIdentity(owner.path) ? path.basename(relative) : relative.split('/').slice(owner.path.split('/').length).join('/')) : 'root:' + relative,
      workId: owner?.id ?? null, category: owner?.currentPlan && locationIdentity(owner.currentPlan) === identity ? 'plan' : category(relative), format: format(filename),
    };
    documents.push(document);
    owner?.documents.push(document);
  }
  documents.sort((a, b) => a.path.localeCompare(b.path));
  const ledgers = work.map(item => {
    const ledger = item.documents.find(document => locationIdentity(document.path) === locationIdentity(item.path + '/ledger.md'));
    return ledger ? { path: ledger.path, read: settled(markdownSummary(root, ledger.path)) } : null;
  });
  for (const [index, item] of work.entries()) {
    // Return the indexed spelling for browser selection without modifying the registry.
    const selected = item.documents.find(document => document.category === 'plan');
    if (selected) item.currentPlan = selected.path;
    const ledger = ledgers[index];
    item.ledger = ledger?.path ?? null;
    item.progress = null;
    if (ledger) {
      try {
        const { metadata } = (await ledger.read)();
        if (!metadata) throw new PlanningError('The ledger has no status header; current and upcoming work remain unknown.');
        try { item.progress = ledgerStatus(metadata, item.id); }
        catch (error) { throw new PlanningError('Ledger status metadata is invalid; current and upcoming work remain unknown. ' + (error as Error).message); }
      } catch (error) { issues.push({ level: 'warning', workId: item.id, message: error instanceof Error ? error.message : 'Ledger status could not be read.' }); }
    }
    item.documents.sort((a, b) => Number(b.category === 'plan') - Number(a.category === 'plan') || a.path.localeCompare(b.path));
  }
  const [history, statistics, name] = await Promise.all([gitHistory(root, work, caseSensitivePaths, normalizationInsensitivePaths), workStatistics(root, work, options), planningName(root)]);
  for (const item of work) item.statistics = statistics[item.id];
  if (!history.available) issues.push({ level: 'warning', message: 'Local planning Git history is unavailable.' });
  return { root, name, loadedAt: new Date().toISOString(), caseSensitivePaths, normalizationInsensitivePaths, work, documents, issues, history: history.history, gitAvailable: history.available };
}
