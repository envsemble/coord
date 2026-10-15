// Find the planning folder for a checkout. Every planning folder lives in the Atlas home. A folder
// inside one of a project's workspace folders (planning.json's `workspaces`) belongs to that project,
// the deepest workspace folder winning, and to no other. Elsewhere a checkout belongs to the planning
// folders whose registry names one of its Git remotes, to the planning folder it is inside, and, for
// a repository without a remote, to the one whose absolute `path` hint is the checkout. Worktrees
// share their repository's remotes, so they resolve the same way.
// Only active projects match: hidden and archived ones (such as a folder split into others) do not.
// `where` also lists every active project of the home in brief, so an agent outside them can ask.
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from './check.ts';
import { ledgerStatus, stepCounts, stepSummary } from './ledger.ts';
import { samePlatformPath } from './planningRoots.ts';
import { runProgram } from './run.ts';
import { atlasHome, homePlanningFolders } from './storage.ts';
import { folderKey, inactiveProjectFolders, planningName } from './database.ts';
import type { LedgerStep } from './types.ts';

export interface ActiveWork {
  workId: string; title: string; path: string; plan: string | null;
  /** The plan's `summary` header. */
  summary: string | null;
  designStatus: string | null; implementationStatus: string | null;
  steps: LedgerStep[]; progress: string | null; blocked: string | null;
  /** Why the plan or ledger could not be read, when it could not. */
  problem?: string;
}
export interface PlanningMatch {
  planningFolder: string;
  /** The project's name: its registry's `name`, else the folder's own name. */
  project: string;
  /**
   * How the checkout matched: by being in one of the project's workspace folders, by Git remote, by
   * an absolute path hint, or by being inside the planning folder.
   */
  via: ('workspace' | 'remote' | 'path' | 'inside')[];
  /** The registered repositories the checkout is. */
  repositories: string[];
  /** Active work for those repositories (all active work when the checkout is the planning folder and no repository matched). */
  work: ActiveWork[];
}
/** One active work item in brief: its title and states, without its steps. */
export interface WorkBrief {
  workId: string; title: string; summary: string | null; designStatus: string | null; implementationStatus: string | null;
  progress: string | null; blocked: string | null; problem?: string;
}
/** An active project of the home, whether or not it registers the checkout. */
export interface ProjectBrief {
  planningFolder: string;
  project: string;
  /** Its registered repositories' IDs. */
  repositories: string[];
  /** The workspace folders it covers (planning.json's `workspaces`). */
  workspaces: string[];
  /** Whether the checkout belongs to it (it is then in `matches` too, with its work in full). */
  match: boolean;
  /** All of its active work. */
  work: WorkBrief[];
}
export interface Whereabouts {
  cwd: string; checkout: string | null; remotes: string[]; home: string;
  /** The projects the checkout belongs to, with their active work for its repositories in full. */
  matches: PlanningMatch[];
  /** Every active project in the home (hidden and archived ones never), matching or not. */
  projects: ProjectBrief[];
}

export class PlanningNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = 'PlanningNotFoundError'; }
}

/**
 * A Git remote as `host/owner/repo`, lowercase, whatever its spelling: `git@host:owner/repo.git`,
 * `ssh://git@host:22/owner/repo`, `https://user@host/owner/repo.git/`. Null for an empty value.
 */
export function normalizeRemote(url: string): string | null {
  let value = url.trim();
  if (!value) return null;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(value);
  if (scp && !/^[a-z]:[\\/]/i.test(value)) value = scp[1] + '/' + scp[2];
  else {
    const parsed = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?(\/.*)?$/i.exec(value);
    if (parsed) value = parsed[1] + (parsed[2] ?? '');
    else value = value.replace(/\\/g, '/');
  }
  return value.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/').toLowerCase() || null;
}

async function git(cwd: string, args: string[]) {
  try { return (await runProgram('git', ['-C', cwd, ...args], { timeout: 15000 })).stdout; } catch { return null; }
}

/** A remote URL without its user information (`https://user:token@host/…`), which can hold a credential. */
export function remoteWithoutCredentials(url: string) {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1');
}

/** The checkout's top folder and its remotes' URLs (without credentials), or null outside a Git checkout. */
export async function checkoutOf(cwd: string): Promise<{ checkout: string; remotes: string[] } | null> {
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (top === null || !top.trim()) return null;
  const listed = await git(cwd, ['remote', '-v']) ?? '';
  const remotes = [...new Set(listed.split(/\r?\n/).map(line => line.split(/\s+/)[1]).filter((value): value is string => Boolean(value)).map(remoteWithoutCredentials))];
  return { checkout: path.resolve(top.trim()), remotes };
}

/** Whether `child` is `parent` or inside it, case-insensitively where the file system usually is. */
export function insideFolder(parent: string, child: string) {
  const relative = path.relative(process.platform === 'win32' || process.platform === 'darwin' ? parent.toLowerCase() : parent, process.platform === 'win32' || process.platform === 'darwin' ? child.toLowerCase() : child);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}
const inside = insideFolder;

interface RegistryEntry { id?: unknown; name?: unknown; path?: unknown; remote?: unknown; repositories?: unknown; current_plan?: unknown }
export async function readRegistry(root: string): Promise<{ repositories: RegistryEntry[]; work_items: RegistryEntry[]; workspaces: string[] }> {
  const registry = JSON.parse((await readFile(path.join(root, 'planning.json'), 'utf8')).replace(/^﻿/, ''));
  return {
    repositories: Array.isArray(registry?.repositories) ? registry.repositories : [], work_items: Array.isArray(registry?.work_items) ? registry.work_items : [],
    workspaces: Array.isArray(registry?.workspaces) ? registry.workspaces.filter((item: unknown): item is string => typeof item === 'string' && path.isAbsolute(item)) : [],
  };
}

/** One work item's plan and ledger headers, read with the planning check's own rules. */
export async function activeWork(root: string, item: RegistryEntry): Promise<ActiveWork> {
  const work: ActiveWork = { workId: String(item.id), title: path.posix.basename(String(item.path)), path: String(item.path), plan: typeof item.current_plan === 'string' ? item.current_plan : null, summary: null, designStatus: null, implementationStatus: null, steps: [], progress: null, blocked: null };
  try {
    if (work.plan) {
      const plan = parseFrontmatter(await readFile(path.join(root, work.plan), 'utf8'));
      if (plan) {
        if (typeof plan.title === 'string') work.title = plan.title;
        if (typeof plan.summary === 'string' && plan.summary.trim()) work.summary = plan.summary.trim();
        work.designStatus = typeof plan.design_status === 'string' ? plan.design_status : null;
        work.implementationStatus = typeof plan.implementation_status === 'string' ? plan.implementation_status : null;
      }
    }
    const ledgerText = await readFile(path.join(root, work.path, 'ledger.md'), 'utf8').catch(() => null);
    const metadata = ledgerText === null ? null : parseFrontmatter(ledgerText, { entryLists: ['steps'] });
    if (metadata) {
      const status = ledgerStatus(metadata, work.workId);
      work.steps = status.steps ?? [];
      work.blocked = status.blocked;
      work.progress = status.steps ? stepSummary(stepCounts(status.steps)) : null;
    }
  } catch (error) { work.problem = (error as Error).message; }
  return work;
}

const brief = ({ workId, title, summary, designStatus, implementationStatus, progress, blocked, problem }: ActiveWork): WorkBrief =>
  ({ workId, title, summary, designStatus, implementationStatus, progress, blocked, ...problem ? { problem } : {} });

/**
 * The planning folders of the home that the checkout at `cwd` belongs to, with their active work,
 * and every active project of the home in brief. Outside a Git checkout only a workspace folder and
 * `inside` can match.
 */
export async function findPlanning(cwd: string, options: { home?: string } = {}): Promise<Whereabouts> {
  const home = options.home ?? atlasHome();
  const resolvedCwd = await realpath(cwd).catch(() => path.resolve(cwd));
  const found = await checkoutOf(resolvedCwd);
  const remotes = new Set((found?.remotes ?? []).map(normalizeRemote).filter((value): value is string => value !== null));
  const candidates: (PlanningMatch & { depth: number })[] = [];
  const projects: ProjectBrief[] = [];
  const inactive = await inactiveProjectFolders(home);
  for (const folder of await homePlanningFolders(home)) {
    const root = await realpath(folder).catch(() => folder);
    if (inactive.has(folderKey(root))) continue;
    let registry;
    try { registry = await readRegistry(root); } catch { continue; }
    const via = new Set<PlanningMatch['via'][number]>();
    const repositories: string[] = [];
    // The deepest of its workspace folders the session is in (by their path segments), or 0.
    let depth = 0;
    for (const workspace of registry.workspaces) {
      const resolved = await realpath(workspace).catch(() => path.resolve(workspace));
      if (inside(resolved, resolvedCwd)) depth = Math.max(depth, resolved.split(/[\\/]+/).filter(Boolean).length);
    }
    if (depth) via.add('workspace');
    const within = inside(root, resolvedCwd);
    if (within) via.add('inside');
    // Inside the planning folder counts as a workspace folder of its own depth: a broader workspace folder around it does not win.
    const level = Math.max(depth, within ? root.split(/[\\/]+/).filter(Boolean).length : 0);
    for (const repository of registry.repositories) {
      if (typeof repository?.id !== 'string') continue;
      const remote = typeof repository.remote === 'string' ? normalizeRemote(repository.remote) : null;
      const hint = typeof repository.path === 'string' && repository.path.trim() ? repository.path.trim() : null;
      if (remote && remotes.has(remote)) { via.add('remote'); repositories.push(repository.id); }
      else if (!remote && hint && found && path.isAbsolute(hint) && samePlatformPath(path.resolve(hint), found.checkout)) { via.add('path'); repositories.push(repository.id); }
      else if (within && hint && !path.isAbsolute(hint) && samePlatformPath(path.resolve(root, hint), root)) repositories.push(repository.id);
    }
    const active = registry.work_items.filter(item => typeof item?.id === 'string' && typeof item.path === 'string' && item.path.startsWith('active/'));
    const work = await Promise.all(active.map(item => activeWork(root, item)));
    const project = await planningName(root);
    projects.push({ planningFolder: root, project, repositories: registry.repositories.flatMap(item => typeof item?.id === 'string' ? [item.id] : []), workspaces: registry.workspaces, match: false, work: work.map(brief) });
    if (!via.size) continue;
    const scope = new Set(repositories);
    const scoped = work.filter((_, index) => !scope.size || (Array.isArray(active[index].repositories) && (active[index].repositories as unknown[]).some(id => scope.has(id as string))));
    candidates.push({ planningFolder: root, project, via: [...via], repositories, work: scoped, depth: level });
  }
  // A workspace folder (or the planning folder itself) decides: only the projects with the deepest one the session is in match.
  const deepest = Math.max(0, ...candidates.map(candidate => candidate.depth));
  const matches = candidates.filter(candidate => candidate.depth === deepest).map(({ depth: _, ...match }) => match);
  for (const project of projects) project.match = matches.some(match => match.planningFolder === project.planningFolder);
  return { cwd: resolvedCwd, checkout: found?.checkout ?? null, remotes: found?.remotes ?? [], home, matches, projects };
}

/**
 * The planning folder an operation works in: the one given, else the one the checkout at `cwd`
 * resolves to. Several are narrowed to the one registering `work`; still several, or none, is an
 * error naming what to do.
 */
export async function resolvePlanningFolder(options: { planningFolder?: string | null; cwd?: string; home?: string; work?: string | null }): Promise<string> {
  if (options.planningFolder) return realpath(path.resolve(options.planningFolder)).catch(() => { throw new PlanningNotFoundError('The planning folder does not exist: ' + options.planningFolder); });
  const where = await findPlanning(options.cwd ?? process.cwd(), { home: options.home });
  let candidates = where.matches.map(match => match.planningFolder);
  if (candidates.length > 1 && options.work) {
    const registering: string[] = [];
    for (const folder of candidates) {
      const registry = await readRegistry(folder).catch(() => null);
      if (registry?.work_items.some(item => item?.id === options.work)) registering.push(folder);
    }
    candidates = registering;
  }
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) throw new PlanningNotFoundError(`No planning folder in the Atlas home (${where.home}) is registered for ${where.checkout ?? where.cwd}. Give the planning folder explicitly, or, in a project's planning.json, add a workspace folder this one is in or register this repository's remote.`);
  const named = where.matches.filter(match => candidates.includes(match.planningFolder)).map(match => `${match.project} (${match.planningFolder})`);
  throw new PlanningNotFoundError("Several projects register this checkout's repository: " + named.join(', ') + '. Ask the user which project to plan in, then give its planning folder (--planning-dir, or planningFolder in the Atlas tools).');
}
