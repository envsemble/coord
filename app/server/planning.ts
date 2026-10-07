import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { createHash } from 'node:crypto';
import type { Document, DocumentContent, HistoryEntry, Issue, Repository, Work } from '../src/types.ts';

const execute = promisify(execFile);
const textExtensions = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.puml', '.mmd', '.mermaid', '.dot', '.html', '.css', '.js', '.ts', '.tsx', '.py', '.ps1', '.sh', '.sql', '.log']);
const excludedDirectories = new Set(['node_modules', '__pycache__', 'dist', 'build']);
const designStates = new Set(['draft', 'accepted', 'superseded', 'abandoned']);
const implementationStates = new Set(['unknown', 'not_started', 'in_progress', 'partial', 'complete']);
const readableLimit = 4 * 1024 * 1024;
type HistoricalWork = Pick<Work, 'id' | 'path' | 'repositories'>;
const historyCache = new Map<string, { head: string; entries: HistoryEntry[] }>();

export class PlanningError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function within(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}
function hidden(relative: string) {
  return relative.replaceAll('\\', '/').split('/').some(part => part.startsWith('.') || excludedDirectories.has(part));
}
function normalizedLocation(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value) || /^[a-z]:/i.test(value) || value.split('/').includes('..')) {
    throw new PlanningError('Work and selected plan paths must be POSIX-relative paths without parent segments.');
  }
  const normalized = path.posix.normalize(value).replace(/\/+$/, '');
  if (path.posix.isAbsolute(normalized) || /^[a-z]:/i.test(normalized)) throw new PlanningError('Work and selected plan paths must be POSIX-relative paths without drive syntax.');
  if (normalized === '.') throw new PlanningError('A work or plan path must identify a record inside the planning folder.');
  return normalized;
}
function locationIdentity(relative: string) { return process.platform === 'win32' ? relative.toLowerCase() : relative; }
export async function resolveDocument(root: string, relative: string) {
  if (!relative || relative.includes('\0') || path.isAbsolute(relative) || /^[a-z]:/i.test(relative) || hidden(relative)) {
    throw new PlanningError('Choose a document inside the connected planning folder.', 403);
  }
  const resolvedRoot = await realpath(root);
  const candidate = path.resolve(resolvedRoot, relative.replaceAll('\\', '/'));
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
    else if (entry.isFile()) result.push(path.relative(root, filename).replaceAll('\\', '/'));
  }
  return result;
}
export async function gitHistory(root: string, currentWork: HistoricalWork[] = []): Promise<{ history: HistoryEntry[]; available: boolean }> {
  try {
    const { stdout: top } = await execute('git', ['-C', root, 'rev-parse', '--show-toplevel']);
    if (await realpath(top.trim()) !== await realpath(root)) return { history: [], available: false };
    const { stdout: revision } = await execute('git', ['-C', root, 'rev-parse', 'HEAD']);
    const head = revision.trim();
    let retained = historyCache.get(root);
    if (!retained || retained.head !== head) {
      const { stdout } = await execute('git', ['-C', root, '-c', 'core.quotepath=false', 'log', '-30', '--format=%x1e%H%x00%aI%x00%s', '--name-only'], { maxBuffer: 1024 * 1024 });
      const entries: HistoryEntry[] = stdout.split('\x1e').slice(1).map(record => {
        const [header, ...changed] = record.trim().split(/\r?\n/);
        const [id, date, title] = header.split('\0');
        return { id, date, title, files: changed.filter(Boolean), workIds: [], repositories: [] };
      });
      async function registrationsAt(commit: string): Promise<HistoricalWork[]> {
        try {
          const { stdout: source } = await execute('git', ['-C', root, 'show', commit + ':planning.json'], { maxBuffer: 1024 * 1024 });
          const registry = JSON.parse(source.replace(/^\uFEFF/, ''));
          if (registry?.schema_version !== 1 || !Array.isArray(registry.work_items)) return [];
          const locations = new Set<string>();
          const identities = new Set<string>();
          const registrations: HistoricalWork[] = [];
          for (const item of registry.work_items) {
            if (!item || typeof item.id !== 'string' || identities.has(item.id) || !Array.isArray(item.repositories) || !item.repositories.every((id: unknown) => typeof id === 'string')) return [];
            const location = normalizedLocation(item.path);
            if (locations.has(locationIdentity(location))) return [];
            locations.add(locationIdentity(location)); identities.add(item.id);
            registrations.push({ id: item.id, path: location, repositories: item.repositories });
          }
          return registrations;
        } catch { return []; /* Older unregistered or invalid history has no established work identity. */ }
      }
      // Locations belong to their registry revision. The parent also owns paths removed in this commit.
      for (let offset = 0; offset < entries.length; offset += 4) {
        await Promise.all(entries.slice(offset, offset + 4).map(async entry => {
          const snapshots = await Promise.all([registrationsAt(entry.id), registrationsAt(entry.id + '^')]);
          const matches = snapshots.flat().filter(item => entry.files.some(file => file === item.path || file.startsWith(item.path + '/')));
          entry.workIds = [...new Set(matches.map(item => item.id))];
          entry.repositories = [...new Set(matches.flatMap(item => item.repositories))];
        }));
      }
      retained = { head, entries };
      historyCache.set(root, retained);
    }
    return { available: true, history: retained.entries.map(entry => {
      if (entry.workIds.length) return entry;
      // A newly adopted, uncommitted registration can identify previously unregistered records.
      const matches = currentWork.filter(item => entry.files.some(file => file === item.path || file.startsWith(item.path + '/')));
      return { ...entry, workIds: [...new Set(matches.map(item => item.id))], repositories: [...new Set(matches.flatMap(item => item.repositories))] };
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
  const locations = new Set<string>();
  for (const item of registry.work_items) {
    if (!item || typeof item.id !== 'string' || !item.id || identities.has(item.id) || typeof item.path !== 'string' || !Array.isArray(item.repositories) || !item.repositories.every(id => typeof id === 'string' && repositoryIds.has(id))) {
      throw new PlanningError('A work item has an invalid or duplicate identity, location, or repository scope.');
    }
    const relative = normalizedLocation(item.path);
    const currentPlan = item.current_plan === null ? null : normalizedLocation(item.current_plan);
    const location = locationIdentity(relative);
    if (locations.has(location)) throw new PlanningError('Two work items have the same retained location; reconcile the duplicate registration.');
    locations.add(location);
    identities.add(item.id);
    const folder = path.resolve(root, relative);
    if (!within(root, folder) || hidden(relative)) throw new PlanningError('A registered work item points outside the planning folder.');
    try { if (!within(root, await realpath(folder))) throw new Error('Outside folder'); }
    catch { issues.push({ level: 'error', workId: item.id, message: 'The work folder is missing or outside the planning repository.' }); }
    const entry: Work = {
      id: item.id, path: relative, repositories: item.repositories, currentPlan,
      title: path.basename(relative).replace(/^\d+-/, '').replaceAll('-', ' '),
      location: relative.startsWith('active/') ? 'active' : relative.startsWith('archive/') ? 'archived' : 'retained',
      design: 'unknown', implementation: 'unknown', created: null, updated: null, accepted: null,
      completed: null, durationDays: null, documents: [],
    };
    if (currentPlan === null) {
      issues.push({ level: 'warning', workId: item.id, message: 'No main plan is selected; retained documents are available.' });
    } else if (currentPlan !== relative && !currentPlan.startsWith(relative + '/')) {
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
        if (!Array.isArray(metadata.repositories) || JSON.stringify([...metadata.repositories].sort()) !== JSON.stringify([...item.repositories].sort())) issues.push({ level: 'error', workId: item.id, message: 'Plan and registry repository scopes differ.' });
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
        const chronologyInvalid = (entry.created && entry.accepted && entry.accepted < entry.created) || (entry.completed && (entry.accepted && entry.completed < entry.accepted || entry.created && entry.completed < entry.created));
        if (chronologyInvalid) issues.push({ level: 'error', workId: item.id, message: 'Recorded lifecycle dates are out of order.' });
        if (entry.completed && entry.implementation !== 'complete') issues.push({ level: 'error', workId: item.id, message: 'A completion date requires complete implementation status.' });
        if (entry.implementation === 'complete' && entry.accepted && entry.completed && !chronologyInvalid) {
          entry.durationDays = Math.round((Date.parse(entry.completed) - Date.parse(entry.accepted)) / 86400000);
        }
      } catch (error) { issues.push({ level: 'error', workId: item.id, message: error instanceof Error ? error.message : 'The selected plan could not be read.' }); }
    }
    work.push(entry);
  }
  const documents: Document[] = [];
  for (const relative of await files(root)) {
    const filename = await resolveDocument(root, relative);
    const information = await stat(filename);
    const owner = work.find(item => relative === item.path || relative.startsWith(item.path + '/'));
    let title = path.basename(filename);
    if (format(filename) === 'markdown' && information.size <= readableLimit) {
      try { title = (await readDocument(root, relative)).title; } catch { /* A malformed supporting file remains downloadable. */ }
    }
    const document: Document = {
      path: relative, name: path.basename(filename), title, size: information.size, modified: information.mtime.toISOString(),
      key: owner ? owner.id + ':' + (relative === owner.path ? path.basename(relative) : relative.slice(owner.path.length + 1)) : 'root:' + relative,
      workId: owner?.id ?? null, repositories: owner?.repositories ?? (relative.startsWith('knowledge/') && repositoryIds.has(relative.split('/')[1]) ? [relative.split('/')[1]] : []), category: owner?.currentPlan === relative ? 'plan' : category(relative), format: format(filename),
    };
    documents.push(document);
    owner?.documents.push(document);
  }
  documents.sort((a, b) => a.path.localeCompare(b.path));
  for (const item of work) item.documents.sort((a, b) => Number(b.category === 'plan') - Number(a.category === 'plan') || a.path.localeCompare(b.path));
  const history = await gitHistory(root, work);
  if (!history.available) issues.push({ level: 'warning', message: 'Local planning Git history is unavailable.' });
  return { root, loadedAt: new Date().toISOString(), repositories: registry.repositories, work, documents, issues, history: history.history, gitAvailable: history.available };
}
