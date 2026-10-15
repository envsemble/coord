// Find the planning folder for a checkout. Every planning folder lives in the Atlas home; a checkout
// belongs to the planning folders whose registry names one of its Git remotes, to the planning
// folder it is inside, and, for a repository without a remote, to the one whose absolute `path`
// hint is the checkout. Worktrees share their repository's remotes, so they resolve the same way.
// Only active projects match: hidden and archived ones (such as a folder split into others) do not.
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
  designStatus: string | null; implementationStatus: string | null;
  steps: LedgerStep[]; progress: string | null; blocked: string | null;
  /** Why the plan or ledger could not be read, when it could not. */
  problem?: string;
}
export interface PlanningMatch {
  planningFolder: string;
  /** The project's name: its registry's `name`, else the folder's own name. */
  project: string;
  /** How the checkout matched: by Git remote, by an absolute path hint, or by being inside the folder. */
  via: ('remote' | 'path' | 'inside')[];
  /** The registered repositories the checkout is. */
  repositories: string[];
  /** Active work for those repositories (all active work when the checkout is the planning folder and no repository matched). */
  work: ActiveWork[];
}
export interface Whereabouts { cwd: string; checkout: string | null; remotes: string[]; home: string; matches: PlanningMatch[] }

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

function inside(parent: string, child: string) {
  const relative = path.relative(process.platform === 'win32' || process.platform === 'darwin' ? parent.toLowerCase() : parent, process.platform === 'win32' || process.platform === 'darwin' ? child.toLowerCase() : child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

interface RegistryEntry { id?: unknown; path?: unknown; remote?: unknown; repositories?: unknown; current_plan?: unknown }
export async function readRegistry(root: string): Promise<{ repositories: RegistryEntry[]; work_items: RegistryEntry[] }> {
  const registry = JSON.parse((await readFile(path.join(root, 'planning.json'), 'utf8')).replace(/^﻿/, ''));
  return { repositories: Array.isArray(registry?.repositories) ? registry.repositories : [], work_items: Array.isArray(registry?.work_items) ? registry.work_items : [] };
}

/** One work item's plan and ledger headers, read with the planning check's own rules. */
export async function activeWork(root: string, item: RegistryEntry): Promise<ActiveWork> {
  const work: ActiveWork = { workId: String(item.id), title: path.posix.basename(String(item.path)), path: String(item.path), plan: typeof item.current_plan === 'string' ? item.current_plan : null, designStatus: null, implementationStatus: null, steps: [], progress: null, blocked: null };
  try {
    if (work.plan) {
      const plan = parseFrontmatter(await readFile(path.join(root, work.plan), 'utf8'));
      if (plan) {
        if (typeof plan.title === 'string') work.title = plan.title;
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

/** The planning folders of the home that the checkout at `cwd` belongs to, with their active work. */
export async function findPlanning(cwd: string, options: { home?: string } = {}): Promise<Whereabouts> {
  const home = options.home ?? atlasHome();
  const resolvedCwd = await realpath(cwd).catch(() => path.resolve(cwd));
  const found = await checkoutOf(resolvedCwd);
  const remotes = new Set((found?.remotes ?? []).map(normalizeRemote).filter((value): value is string => value !== null));
  const matches: PlanningMatch[] = [];
  const inactive = await inactiveProjectFolders(home);
  for (const folder of await homePlanningFolders(home)) {
    const root = await realpath(folder).catch(() => folder);
    if (inactive.has(folderKey(root))) continue;
    let registry;
    try { registry = await readRegistry(root); } catch { continue; }
    const via = new Set<PlanningMatch['via'][number]>();
    const repositories: string[] = [];
    const within = inside(root, resolvedCwd);
    if (within) via.add('inside');
    for (const repository of registry.repositories) {
      if (typeof repository?.id !== 'string') continue;
      const remote = typeof repository.remote === 'string' ? normalizeRemote(repository.remote) : null;
      const hint = typeof repository.path === 'string' && repository.path.trim() ? repository.path.trim() : null;
      if (remote && remotes.has(remote)) { via.add('remote'); repositories.push(repository.id); }
      else if (!remote && hint && found && path.isAbsolute(hint) && samePlatformPath(path.resolve(hint), found.checkout)) { via.add('path'); repositories.push(repository.id); }
      else if (within && hint && !path.isAbsolute(hint) && samePlatformPath(path.resolve(root, hint), root)) repositories.push(repository.id);
    }
    if (!via.size) continue;
    const scope = new Set(repositories);
    const items = registry.work_items.filter(item => typeof item?.id === 'string' && typeof item.path === 'string' && item.path.startsWith('active/')
      && (!scope.size || (Array.isArray(item.repositories) && item.repositories.some(id => scope.has(id)))));
    matches.push({ planningFolder: root, project: await planningName(root), via: [...via], repositories, work: await Promise.all(items.map(item => activeWork(root, item))) });
  }
  return { cwd: resolvedCwd, checkout: found?.checkout ?? null, remotes: found?.remotes ?? [], home, matches };
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
  if (!candidates.length) throw new PlanningNotFoundError(`No planning folder in the Atlas home (${where.home}) is registered for ${where.checkout ?? where.cwd}. Give the planning folder explicitly, or register this repository's remote in a planning folder's planning.json.`);
  const named = where.matches.filter(match => candidates.includes(match.planningFolder)).map(match => `${match.project} (${match.planningFolder})`);
  throw new PlanningNotFoundError("Several projects register this checkout's repository: " + named.join(', ') + '. Ask the user which project to plan in, then give its planning folder (--planning-dir, or planningFolder in the Atlas tools).');
}
