import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { createHash } from 'node:crypto';
import { filesystemCaseSensitive, filesystemNormalizesUnicode } from './filesystem.ts';
import type { Document, DocumentContent, HistoryEntry, Issue, Repository, Work } from '../src/types.ts';

const execute = promisify(execFile);
const textExtensions = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.puml', '.mmd', '.mermaid', '.dot', '.html', '.css', '.js', '.ts', '.tsx', '.py', '.ps1', '.sh', '.sql', '.log']);
const excludedDirectories = new Set(['node_modules', '__pycache__', 'dist', 'build']);
const designStates = new Set(['draft', 'accepted', 'superseded', 'abandoned']);
const implementationStates = new Set(['unknown', 'not_started', 'in_progress', 'partial', 'complete']);
const workIdentity = /^work-[0-9]{4,}$/;
const planFields = ['schema_version', 'kind', 'id', 'title', 'repositories', 'created', 'updated', 'design_status', 'implementation_status', 'accepted_at', 'completed_at', 'supersedes', 'superseded_by'];
const readableLimit = 4 * 1024 * 1024;
type HistoricalWork = Pick<Work, 'id' | 'path' | 'repositories' | 'currentPlan'>;
const historyCache = new Map<string, { head: string; entries: HistoryEntry[]; unattributedFiles: Map<string, string[]> }>();

export class PlanningError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function within(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}
function hidden(relative: string) {
  return relative.split(path.sep).join('/').split('/').some(part => part.startsWith('.') || excludedDirectories.has(part));
}
function normalizedLocation(value: unknown): string {
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
export async function resolveDocument(root: string, relative: string) {
  if (!relative || relative.includes('\0') || path.isAbsolute(relative) || /^[a-z]:/i.test(relative) || hidden(relative)) {
    throw new PlanningError('Choose a document inside the connected planning folder.', 403);
  }
  const resolvedRoot = await realpath(root);
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
  if (lower.startsWith('knowledge/')) return 'knowledge';
  if (lower.includes('/docs/adr/')) return 'decision';
  if (/(^|\/)ledger[^/]*\.md$/.test(lower)) return 'ledger';
  if (/(^|\/)context(?:-map)?\.md$/.test(lower)) return 'glossary';
  if (lower.includes('/evidence/') || lower.includes('/artifacts/')) return 'evidence';
  return 'document';
}
export async function readDocument(root: string, relative: string): Promise<DocumentContent> {
  const filename = await resolveDocument(root, relative);
  const documentFormat = format(filename);
  if (documentFormat === 'attachment') return { path: relative, title: path.basename(filename), body: '', format: documentFormat, metadata: null, contentHash: '' };
  if ((await stat(filename)).size > readableLimit) throw new PlanningError('This file is too large for the reader. Use Download instead.', 413);
  const bytes = await readFile(filename);
  const source = bytes.toString('utf8');
  const content = documentFormat === 'markdown' ? unpack(source) : { body: source, metadata: null };
  return { path: relative, title: typeof content.metadata?.title === 'string' ? content.metadata.title : heading(content.body, path.basename(filename)), format: documentFormat, contentHash: createHash('sha256').update(bytes).digest('hex'), ...content };
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
export async function gitHistory(root: string, currentWork: HistoricalWork[] = [], sensitivity?: boolean, normalization?: boolean): Promise<{ history: HistoryEntry[]; available: boolean }> {
  try {
    const caseSensitive = sensitivity ?? await filesystemCaseSensitive(root);
    const normalizesUnicode = normalization ?? await filesystemNormalizesUnicode(root, await files(root));
    const locationIdentity = (value: string) => pathIdentity(value, caseSensitive, normalizesUnicode);
    const cacheKey = root + '\0' + caseSensitive + '\0' + normalizesUnicode;
    const { stdout: top } = await execute('git', ['-C', root, 'rev-parse', '--show-toplevel']);
    if (locationIdentity(await realpath(top.trim())) !== locationIdentity(await realpath(root))) return { history: [], available: false };
    const { stdout: revision } = await execute('git', ['-C', root, 'rev-parse', 'HEAD']);
    const head = revision.trim();
    let retained = historyCache.get(cacheKey);
    if (!retained || retained.head !== head) {
      const { stdout } = await execute('git', ['-C', root, 'log', '-30', '--format=%x1e%H%x00%aI%x00%s%x00%P'], { maxBuffer: 1024 * 1024 });
      const firstParents = new Map<string, string | undefined>();
      const unattributedFiles = new Map<string, string[]>();
      const entries: HistoryEntry[] = stdout.split('\x1e').slice(1).map(record => {
        const [id, date, title, parents] = record.trim().split('\0');
        firstParents.set(id, parents?.split(' ')[0] || undefined);
        return { id, date, title, files: [], workIds: [], repositories: [] };
      });
      async function registrationsAt(commit: string): Promise<HistoricalWork[]> {
        try {
          const { stdout: source } = await execute('git', ['-C', root, 'show', commit + ':planning.json'], { maxBuffer: 1024 * 1024 });
          const registry = JSON.parse(source.replace(/^\uFEFF/, ''));
          if (registry?.schema_version !== 1 || !Array.isArray(registry.work_items)) return [];
          const locations = new Set<string>();
          const identities = new Set<string>();
          const selectedPlans = new Set<string>();
          const registrations: HistoricalWork[] = [];
          for (const item of registry.work_items) {
            if (!item || typeof item.id !== 'string' || !workIdentity.test(item.id) || identities.has(item.id) || !Array.isArray(item.repositories) || !item.repositories.every((id: unknown) => typeof id === 'string')) return [];
            const location = normalizedLocation(item.path);
            if (locations.has(locationIdentity(location))) return [];
            const currentPlan = item.current_plan == null ? null : normalizedLocation(item.current_plan);
            if (currentPlan && selectedPlans.has(locationIdentity(currentPlan))) return [];
            if (currentPlan) selectedPlans.add(locationIdentity(currentPlan));
            locations.add(locationIdentity(location)); identities.add(item.id);
            registrations.push({ id: item.id, path: location, repositories: item.repositories, currentPlan });
          }
          return registrations;
        } catch { return []; /* Older unregistered or invalid history has no established work identity. */ }
      }
      // Read change direction explicitly; rename detection must not alter historical ownership.
      for (let offset = 0; offset < entries.length; offset += 4) {
        await Promise.all(entries.slice(offset, offset + 4).map(async entry => {
          const parent = firstParents.get(entry.id);
          const [current, previous, changes] = await Promise.all([
            registrationsAt(entry.id), parent ? registrationsAt(parent) : Promise.resolve([]),
            execute('git', ['-C', root, 'diff-tree', '-r', '--no-commit-id', '--name-status', '--no-renames', '-z', ...(parent ? [parent, entry.id] : ['--root', entry.id])], { maxBuffer: 1024 * 1024 }),
          ]);
          const parts = changes.stdout.split('\0');
          const matches: HistoricalWork[] = [];
          const unowned: string[] = [];
          for (let index = 0; index + 1 < parts.length; index += 2) {
            const status = parts[index]; const file = parts[index + 1];
            entry.files.push(file);
            const snapshots = status === 'D' ? [previous] : status === 'A' ? [current] : [previous, current];
            let attributed = false;
            for (const snapshot of snapshots) {
              const owner = documentOwner(snapshot, file, caseSensitive, normalizesUnicode);
              if (owner) { matches.push(owner); attributed = true; }
            }
            if (!attributed) unowned.push(file);
          }
          unattributedFiles.set(entry.id, unowned);
          entry.workIds = [...new Set(matches.map(item => item.id))];
          entry.repositories = [...new Set(matches.flatMap(item => item.repositories))];
        }));
      }
      retained = { head, entries, unattributedFiles };
      historyCache.set(cacheKey, retained);
    }
    return { available: true, history: retained.entries.map(entry => {
      // A newly adopted, uncommitted registration can identify previously unregistered records.
      const matches = (retained.unattributedFiles.get(entry.id) ?? []).map(file => documentOwner(currentWork, file, caseSensitive, normalizesUnicode)).filter((item): item is HistoricalWork => Boolean(item));
      return { ...entry, workIds: [...new Set([...entry.workIds, ...matches.map(item => item.id)])], repositories: [...new Set([...entry.repositories, ...matches.flatMap(item => item.repositories)])] };
    }) };
  } catch { return { history: [], available: false }; }
}
export async function loadPlanning(inputRoot: string) {
  let root: string;
  try { root = await realpath(inputRoot); } catch { throw new PlanningError('The planning folder does not exist. Check --planning-dir.'); }
  let registry: { schema_version: number; repositories: Repository[]; work_items: { id: string; path: string; repositories: string[]; current_plan: string | null }[] };
  try { registry = JSON.parse((await readFile(path.join(root, 'planning.json'), 'utf8')).replace(/^\uFEFF/, '')); }
  catch { throw new PlanningError('The planning folder needs a readable planning.json registry.'); }
  if (!registry || registry.schema_version !== 1 || !Array.isArray(registry.repositories) || !Array.isArray(registry.work_items)) {
    throw new PlanningError('The planning registry must use schema version 1 with repositories and work_items.');
  }
  const caseSensitivePaths = await filesystemCaseSensitive(root);
  const retainedFiles = await files(root);
  const registeredPaths = registry.work_items.flatMap(item => [item?.path, item?.current_plan].filter((value): value is string => typeof value === 'string').map(normalizedLocation));
  const normalizationInsensitivePaths = await filesystemNormalizesUnicode(root, [...retainedFiles, ...registeredPaths]);
  const locationIdentity = (value: string) => pathIdentity(value, caseSensitivePaths, normalizationInsensitivePaths);
  const repositoryIds = new Set<string>();
  for (const repository of registry.repositories) {
    if (!repository || typeof repository.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(repository.id) || repositoryIds.has(repository.id) || typeof repository.name !== 'string' || !repository.name.trim()) {
      throw new PlanningError('A registered repository has an invalid or duplicate identity or name.');
    }
    repositoryIds.add(repository.id);
  }
  const issues: Issue[] = [];
  const work: Work[] = [];
  const identities = new Set<string>();
  const registeredIds = new Set(registry.work_items.map(item => item?.id));
  const locations = new Set<string>();
  const selectedPlans = new Set<string>();
  for (const item of registry.work_items) {
    if (!item || typeof item.id !== 'string' || !workIdentity.test(item.id) || identities.has(item.id) || typeof item.path !== 'string' || !Array.isArray(item.repositories) || new Set(item.repositories).size !== item.repositories.length || !item.repositories.every(id => typeof id === 'string' && repositoryIds.has(id))) {
      throw new PlanningError('A work item has an invalid or duplicate identity, location, or repository scope.');
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
    try { if (!within(root, await realpath(folder))) throw new Error('Outside folder'); }
    catch { issues.push({ level: 'error', workId: item.id, message: 'The work folder is missing or outside the planning repository.' }); }
    const entry: Work = {
      id: item.id, path: relative, repositories: item.repositories, currentPlan,
      title: path.basename(relative).replace(/^\d+-/, '').replaceAll('-', ' '),
      location: location.startsWith('active/') ? 'active' : location.startsWith('archive/') ? 'archived' : 'retained',
      design: 'unknown', implementation: 'unknown', created: null, updated: null, accepted: null,
      completed: null, durationDays: null, documents: [],
    };
    if (currentPlan === null) {
      issues.push({ level: 'warning', workId: item.id, message: 'No main plan is selected; retained documents are available.' });
    } else if (locationIdentity(currentPlan) !== location && !locationIdentity(currentPlan).startsWith(location + '/')) {
      issues.push({ level: 'error', workId: item.id, message: 'The selected plan does not belong to this work item.' });
    } else {
      try {
        const content = await readDocument(root, currentPlan);
        const metadata = content.metadata;
        if (!metadata) {
          entry.title = content.title;
          issues.push({ level: 'warning', workId: item.id, message: 'This retained plan has no lifecycle metadata; its original contents remain available.' });
          work.push(entry);
          continue;
        }
        if (metadata.kind !== 'plan' || metadata.schema_version !== 1 || metadata.id !== item.id) throw new PlanningError('The selected document does not have matching plan metadata.');
        const missing = planFields.filter(field => !Object.hasOwn(metadata, field));
        if (missing.length) issues.push({ level: 'error', workId: item.id, message: 'Missing plan metadata: ' + missing.join(', ') + '.' });
        if (typeof metadata.title !== 'string' || !metadata.title.trim()) issues.push({ level: 'error', workId: item.id, message: 'The plan title must be a nonempty string.' });
        if (!Array.isArray(metadata.repositories) || new Set(metadata.repositories).size !== metadata.repositories.length || JSON.stringify([...metadata.repositories].sort()) !== JSON.stringify([...item.repositories].sort())) issues.push({ level: 'error', workId: item.id, message: 'Plan and registry repository scopes differ.' });
        if (!Array.isArray(metadata.supersedes) || metadata.supersedes.some(id => typeof id !== 'string' || !registeredIds.has(id) || id === item.id) || new Set(metadata.supersedes).size !== metadata.supersedes.length) issues.push({ level: 'error', workId: item.id, message: 'Supersedes must list unique other registered work IDs.' });
        if (metadata.superseded_by !== null && (typeof metadata.superseded_by !== 'string' || !registeredIds.has(metadata.superseded_by) || metadata.superseded_by === item.id)) issues.push({ level: 'error', workId: item.id, message: 'Superseded by must identify another registered work item or null.' });
        entry.title = content.title;
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
        if (entry.implementation === 'complete' && entry.accepted && entry.completed && !chronologyInvalid) {
          entry.durationDays = Math.round((Date.parse(entry.completed) - Date.parse(entry.accepted)) / 86400000);
        }
      } catch (error) { issues.push({ level: 'error', workId: item.id, message: error instanceof Error ? error.message : 'The selected plan could not be read.' }); }
    }
    work.push(entry);
  }
  const documents: Document[] = [];
  for (const relative of retainedFiles) {
    const filename = await resolveDocument(root, relative);
    const information = await stat(filename);
    const owner = documentOwner(work, relative, caseSensitivePaths, normalizationInsensitivePaths);
    const identity = locationIdentity(relative);
    const scope = identity.startsWith('knowledge/') ? [...repositoryIds].filter(id => locationIdentity(id) === identity.split('/')[1]) : [];
    let title = path.basename(filename);
    if (format(filename) === 'markdown' && information.size <= readableLimit) {
      try { title = (await readDocument(root, relative)).title; } catch { /* A malformed supporting file remains downloadable. */ }
    }
    const document: Document = {
      path: relative, name: path.basename(filename), title, size: information.size, modified: information.mtime.toISOString(),
      key: owner ? owner.id + ':' + (locationIdentity(relative) === locationIdentity(owner.path) ? path.basename(relative) : relative.split('/').slice(owner.path.split('/').length).join('/')) : 'root:' + relative,
      workId: owner?.id ?? null, repositories: owner?.repositories ?? (scope.length === 1 ? scope : []), category: owner?.currentPlan && locationIdentity(owner.currentPlan) === identity ? 'plan' : category(relative), format: format(filename),
    };
    documents.push(document);
    owner?.documents.push(document);
  }
  documents.sort((a, b) => a.path.localeCompare(b.path));
  for (const item of work) {
    // Return the indexed spelling for browser selection without modifying the registry.
    const selected = item.documents.find(document => document.category === 'plan');
    if (selected) item.currentPlan = selected.path;
    item.documents.sort((a, b) => Number(b.category === 'plan') - Number(a.category === 'plan') || a.path.localeCompare(b.path));
  }
  const history = await gitHistory(root, work, caseSensitivePaths, normalizationInsensitivePaths);
  if (!history.available) issues.push({ level: 'warning', message: 'Local planning Git history is unavailable.' });
  return { root, loadedAt: new Date().toISOString(), caseSensitivePaths, normalizationInsensitivePaths, repositories: registry.repositories, work, documents, issues, history: history.history, gitAvailable: history.available };
}
