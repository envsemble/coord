// Where a planning file's references lead: a PR or issue (`repo#22`, a GitHub URL) to its page, with
// its title, state and checks from `gh` when it is installed and signed in; a commit (`repo@hash`, or
// a bare hash found in the project's local checkouts) to its page, with its subject; a path to the
// file in a local checkout: one of the work item's repositories first, then the project's, then any
// checkout of the project that has it. The checkouts are the project's workspace folders' (and its
// path hints), matched to registered repositories by remote. Git and `gh` run a few at a time, with
// timeouts, and a call waits for `gh` only briefly: what it has not said yet is left out and kept for
// the next call.
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { folderKey } from '../home/database.ts';
import { runProgram } from '../system/run.ts';
import { projectRepositories, repositoryNamed, type KnownRepository } from './repositories.ts';
import { normalizeRemote, readRegistry } from './resolve.ts';
import { workspaceCheckouts } from './workspaces.ts';

export interface ReferenceItem { kind: 'pull' | 'commit' | 'path'; repository: string | null; value: string; line: number | null }
export interface PullState { title: string; state: 'open' | 'draft' | 'merged' | 'closed'; checks: 'passing' | 'failing' | 'pending' | null }
export interface ResolvedItem {
  url: string | null; file: { path: string; line: number | null } | null; repository: string | null;
  pull: PullState | null; title: string | null;
  choices: { repository: string; url: string | null; title: string | null }[];
}
interface LocalCheckout { folder: string; common: string; worktree: boolean; repository: KnownRepository | null }

/** How long checkouts and PR states are kept. */
const cacheMs = 60_000;
/** How long one call waits for `gh`. */
const ghWaitMs = 3000;
/** At most this many Git processes per call, and this many of Git's and `gh`'s at once. */
const gitBudget = 120;
const parallel = 4;

/** Run tasks at most `parallel` at a time, in this process. */
let running = 0;
const queue: (() => void)[] = [];
async function slot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= parallel) await new Promise<void>(resolve => queue.push(resolve));
  running++;
  try { return await task(); } finally { running--; queue.shift()?.(); }
}
const program = (file: string, args: string[], timeout: number) => slot(() => runProgram(file, args, { windowsHide: true, timeout }).then(result => result.stdout, () => null));

const checkouts = new Map<string, { at: number; value: Promise<LocalCheckout[]> }>();
/** The project's local checkouts, each with the registered repository it belongs to; kept for a minute. */
function projectCheckouts(root: string, repositories: KnownRepository[], workspaces: string[]): Promise<LocalCheckout[]> {
  const cached = checkouts.get(folderKey(root));
  if (cached && Date.now() - cached.at < cacheMs) return cached.value;
  const value = (async () => {
    const found = await workspaceCheckouts(workspaces);
    for (const repository of repositories) if (repository.path && !found.some(item => folderKey(item.folder) === folderKey(repository.path!))) found.push({ folder: repository.path, common: repository.path, worktree: false, remote: null });
    return found.map((item): LocalCheckout => {
      const remote = item.remote ? normalizeRemote(item.remote) : null;
      return { ...item, repository: repositories.find(entry => remote ? entry.remote === remote : entry.path !== null && folderKey(entry.path) === folderKey(item.folder)) ?? null };
    }).sort((a, b) => Number(a.worktree) - Number(b.worktree));
  })();
  checkouts.set(folderKey(root), { at: Date.now(), value });
  return value;
}

let signedIn: { at: number; value: Promise<boolean> } | null = null;
/** Whether `gh` is installed and signed in; asked again after a few minutes. */
function ghReady() {
  if (!signedIn || Date.now() - signedIn.at > 5 * cacheMs) signedIn = { at: Date.now(), value: program('gh', ['auth', 'status'], 10_000).then(output => output !== null) };
  return signedIn.value;
}
const pulls = new Map<string, { at: number; value: Promise<PullState | null> }>();
/** A PR's (or else an issue's) title, state and checks, from `gh`; kept for a minute. */
function pullState(owner: string, name: string, number: string): Promise<PullState | null> {
  const key = `${owner}/${name}#${number}`.toLowerCase();
  const cached = pulls.get(key);
  if (cached && Date.now() - cached.at < cacheMs) return cached.value;
  const value = (async (): Promise<PullState | null> => {
    if (!await ghReady()) return null;
    const pull = await program('gh', ['pr', 'view', number, '--repo', `${owner}/${name}`, '--json', 'title,state,isDraft,statusCheckRollup'], 15_000);
    if (pull) {
      const data = JSON.parse(pull) as { title?: unknown; state?: unknown; isDraft?: unknown; statusCheckRollup?: { conclusion?: unknown; state?: unknown; status?: unknown }[] };
      const state = data.state === 'MERGED' ? 'merged' : data.state === 'CLOSED' ? 'closed' : data.isDraft ? 'draft' : 'open';
      const results = (data.statusCheckRollup ?? []).map(check => String(check.conclusion || check.state || check.status || '').toUpperCase());
      const checks = !results.length ? null : results.some(result => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(result)) ? 'failing'
        : results.every(result => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(result)) ? 'passing' : 'pending';
      return { title: String(data.title ?? ''), state, checks };
    }
    const issue = await program('gh', ['issue', 'view', number, '--repo', `${owner}/${name}`, '--json', 'title,state'], 15_000);
    if (!issue) return null;
    const data = JSON.parse(issue) as { title?: unknown; state?: unknown };
    return { title: String(data.title ?? ''), state: data.state === 'CLOSED' ? 'closed' : 'open', checks: null };
  })().catch(() => null);
  pulls.set(key, { at: Date.now(), value });
  return value;
}

/** Resolve a planning file's references, in order; null for one that leads nowhere. Without `gh` (`gh: false`), PRs have no state. */
export async function resolveReferences(root: string, workId: string | null, items: ReferenceItem[], options: { gh?: boolean } = {}): Promise<(ResolvedItem | null)[]> {
  const registry = await readRegistry(root);
  const repositories = await projectRepositories(root);
  const named = registry.work_items.find(item => item.id === workId)?.repositories;
  const own = (Array.isArray(named) ? named : []).map(id => repositories.find(item => item.id === id)).filter((item): item is KnownRepository => item !== undefined);
  // The work item's repositories first, then the project's, then checkouts no repository registers.
  const rank = (checkout: LocalCheckout) => checkout.repository === null ? 2 : own.includes(checkout.repository) ? 0 : 1;
  const local = (await projectCheckouts(root, repositories, registry.workspaces)).slice().sort((a, b) => rank(a) - rank(b));
  let budget = gitBudget;
  const git = (folder: string, args: string[]) => budget-- > 0 ? program('git', ['-C', folder, ...args], 10_000) : Promise.resolve(null);
  /** A commit's subject in a checkout, or null when the checkout does not have it. */
  const subject = async (folder: string, hash: string) => (await git(folder, ['show', '-s', '--format=%s', hash + '^{commit}']))?.trim() ?? null;
  /** The repository a reference names, else (for a bare one) the work item's only repository. */
  const repositoryOf = (item: ReferenceItem) => item.repository !== null ? repositoryNamed(repositories, item.repository) : own.length === 1 ? own[0] : repositories.length === 1 ? repositories[0] : null;
  /** The page of a repository a reference names: registered, or `owner/name` on GitHub. */
  const webOf = (item: ReferenceItem, repository: KnownRepository | null) => repository?.web ?? (item.repository && /^[\w.-]+\/[\w.-]+$/.test(item.repository) ? 'https://github.com/' + item.repository : null);
  const waiting: Promise<unknown>[] = [];

  const results = await Promise.all(items.map(async (item): Promise<ResolvedItem | null> => {
    const none: ResolvedItem = { url: null, file: null, repository: null, pull: null, title: null, choices: [] };
    if (item.kind === 'pull') {
      if (!/^\d{1,9}$/.test(item.value)) return null;
      const repository = repositoryOf(item), web = webOf(item, repository);
      if (!web) return null;
      const resolved: ResolvedItem = { ...none, url: web + '/pull/' + item.value, repository: repository?.id ?? null };
      const [owner, name] = web.split('/').slice(-2);
      if (options.gh !== false) waiting.push(pullState(owner, name, item.value).then(state => { resolved.pull = state; }));
      return resolved;
    }
    if (item.kind === 'commit') {
      const hash = item.value.toLowerCase();
      if (!/^[0-9a-f]{7,40}$/.test(hash)) return null;
      if (item.repository !== null) {
        const repository = repositoryNamed(repositories, item.repository), web = webOf(item, repository);
        const checkout = repository && local.find(entry => entry.repository === repository);
        const title = checkout ? await subject(checkout.folder, hash) : null;
        return web || title ? { ...none, url: web && web + '/commit/' + hash, repository: repository?.id ?? null, title } : null;
      }
      // A bare hash: each repository's checkout is asked, once per repository.
      const seen = new Set<string>(), found: { repository: string; url: string | null; title: string | null }[] = [];
      for (const checkout of local) {
        const key = checkout.repository?.id ?? folderKey(checkout.common);
        if (seen.has(key)) continue;
        seen.add(key);
        const title = await subject(checkout.folder, hash);
        if (title !== null) found.push({ repository: checkout.repository?.id ?? path.basename(checkout.folder), url: checkout.repository?.web ? checkout.repository.web + '/commit/' + hash : null, title });
      }
      if (!found.length) return null;
      const [first, ...others] = found;
      return { ...none, url: first.url, repository: first.repository, title: first.title, choices: others };
    }
    // A path inside a checkout: never one that leaves it.
    const relative = item.value.replace(/\\/g, '/').replace(/^\.\//, '');
    if (path.isAbsolute(relative) || relative.split('/').includes('..')) return null;
    const repository = item.repository !== null ? repositoryNamed(repositories, item.repository) : null;
    for (const checkout of local) {
      if (item.repository !== null && checkout.repository !== repository) continue;
      const file = path.join(checkout.folder, ...relative.split('/'));
      if ((await stat(file).catch(() => null))?.isFile()) return { ...none, file: { path: file, line: item.line }, repository: checkout.repository?.id ?? null };
    }
    return null;
  }));
  // `gh` is waited for only so long; what it says later is kept for the next call.
  await Promise.race([Promise.all(waiting), new Promise(resolve => setTimeout(resolve, ghWaitMs).unref())]);
  return results.map(result => result && { ...result, pull: result.pull });
}
