// Workspace folders: the folders on this computer a project covers (planning.json's `workspaces`).
// A new project registers the Git checkouts found in them: the folder itself when it is one, and the
// folders directly inside it, never deeper. Worktrees and clones of one repository count once, by
// their remote (the remote `origin` when there are several); a checkout without a remote is
// registered by its absolute path, as the registry's path hints allow.
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { folderKey } from './database.ts';
import { normalizeRemote, remoteWithoutCredentials } from './resolve.ts';
import { runProgram } from './run.ts';
import { slugOf, WorkError } from './work.ts';

/** A repository a project covers: its ID in planning.json, its name, its Git remote, and, without one, its checkout's absolute path. */
export interface ProjectRepository { id: string; name: string; remote: string | null; path?: string }
/** The Git checkouts found in a workspace folder. */
export interface WorkspaceScan { folder: string; repositories: ProjectRepository[] }

/** The most workspace folders a project lists. */
export const workspaceLimit = 20;
const skipped = new Set(['node_modules', '__pycache__', 'dist', 'build']);

/** Workspace folders as a project lists them: absolute, without trailing separators, each once. */
export function checkedWorkspaces(folders: unknown): string[] {
  if (!Array.isArray(folders) || folders.length > workspaceLimit) throw new WorkError(`List at most ${workspaceLimit} workspace folders.`);
  const seen = new Set<string>(), checked: string[] = [];
  for (const folder of folders) {
    if (typeof folder !== 'string' || !folder.trim() || !path.isAbsolute(folder.trim())) throw new WorkError(`A workspace folder is an absolute path on this computer: ${String(folder)}`);
    const resolved = path.resolve(folder.trim());
    if (seen.has(folderKey(resolved))) continue;
    seen.add(folderKey(resolved));
    checked.push(resolved);
  }
  return checked;
}

const git = (folder: string, args: string[]) => runProgram('git', ['-C', folder, ...args], { windowsHide: true, timeout: 15000 }).then(result => result.stdout, () => null);

interface Checkout { folder: string; worktree: boolean; common: string; remote: string | null }
/** The checkout at `folder` (it has a `.git`), with the repository it belongs to and its preferred remote; null when Git does not take it for one. */
async function checkoutAt(folder: string): Promise<Checkout | null> {
  const entry = await stat(path.join(folder, '.git')).catch(() => null);
  if (!entry) return null;
  const common = await git(folder, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (common === null || !common.trim()) return null;
  const urls = (await git(folder, ['config', '--get-regexp', '^remote\\..*\\.url$']) ?? '').split(/\r?\n/)
    .map(line => /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim())).filter((match): match is RegExpExecArray => match !== null);
  const preferred = urls.find(match => match[1] === 'origin') ?? urls[0];
  return { folder, worktree: entry.isFile(), common: path.resolve(common.trim()), remote: preferred ? remoteWithoutCredentials(preferred[2].trim()) : null };
}

/**
 * Add `found` to `existing` repositories, leaving out those already there (the same remote, or for
 * one without a remote the same path) and giving each new one an ID no other has. Returns the new ones.
 */
export function newRepositories(existing: { id?: unknown; remote?: unknown; path?: unknown }[], found: ProjectRepository[]): ProjectRepository[] {
  const ids = new Set(existing.flatMap(item => typeof item?.id === 'string' ? [item.id] : []));
  const remotes = new Set(existing.flatMap(item => typeof item?.remote === 'string' ? [normalizeRemote(item.remote)] : []));
  const paths = new Set(existing.flatMap(item => typeof item?.path === 'string' && path.isAbsolute(item.path) ? [folderKey(path.resolve(item.path))] : []));
  const added: ProjectRepository[] = [];
  for (const repository of found) {
    const remote = repository.remote === null ? null : normalizeRemote(repository.remote);
    if (remote ? remotes.has(remote) : repository.path !== undefined && paths.has(folderKey(repository.path))) continue;
    if (remote) remotes.add(remote);
    else if (repository.path !== undefined) paths.add(folderKey(repository.path));
    let id = repository.id;
    for (let number = 2; ids.has(id); number++) id = repository.id.slice(0, 60) + '-' + number;
    ids.add(id);
    added.push({ ...repository, id });
  }
  return added;
}

/** A repository's ID: its remote's repository name, else its folder's name, in lowercase words joined by hyphens. */
function identityOf(checkout: Checkout) {
  const name = (checkout.remote ? normalizeRemote(checkout.remote)?.split('/').at(-1) : null) || path.basename(checkout.folder);
  const slug = slugOf(name);
  return slug === 'work' && !/work/i.test(name) ? 'repository' : slug;
}

/**
 * The Git checkouts in a folder: the folder itself if it is one, and the folders directly inside it.
 * A missing or unreadable folder is refused with the reason.
 */
export async function scanWorkspace(folder: string): Promise<WorkspaceScan> {
  const [resolved] = checkedWorkspaces([folder]);
  const info = await stat(resolved).catch(() => null);
  if (!info) throw new WorkError(`The folder ${resolved} does not exist.`);
  if (!info.isDirectory()) throw new WorkError(`${resolved} is not a folder.`);
  let entries;
  try { entries = await readdir(resolved, { withFileTypes: true }); } catch (error) { throw new WorkError(`The folder ${resolved} cannot be read: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}.`); }
  const folders = [resolved, ...entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !skipped.has(entry.name)).map(entry => path.join(resolved, entry.name)).sort((a, b) => a.localeCompare(b))];
  const checkouts = (await Promise.all(folders.map(checkoutAt))).filter((checkout): checkout is Checkout => checkout !== null);
  // The repository's own checkout names it rather than one of its worktrees; the folder itself comes first.
  checkouts.sort((a, b) => Number(a.folder !== resolved) - Number(b.folder !== resolved) || Number(a.worktree) - Number(b.worktree));
  const repositories = new Set<string>(), found: ProjectRepository[] = [];
  for (const checkout of checkouts) {
    const common = folderKey(await realpath(checkout.common).catch(() => checkout.common));
    if (repositories.has(common)) continue;
    repositories.add(common);
    found.push({ id: identityOf(checkout), name: path.basename(checkout.folder) || checkout.folder, remote: checkout.remote, ...checkout.remote === null && { path: checkout.folder } });
  }
  return { folder: resolved, repositories: newRepositories([], found) };
}

/** The repositories in several workspace folders, each once. */
export async function scanWorkspaces(folders: string[]): Promise<ProjectRepository[]> {
  const repositories: ProjectRepository[] = [];
  for (const scan of await Promise.all(folders.map(scanWorkspace))) repositories.push(...newRepositories(repositories, scan.repositories));
  return repositories;
}
