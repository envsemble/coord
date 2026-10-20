// Where a planning file's references lead. Atlas keeps no repositories: a reference names its
// repository in full, as `owner/repo`, and leads to GitHub. A PR or issue (`owner/repo#22`, a GitHub
// URL) leads to its page, with its title, state and checks from `gh` when it is installed and signed
// in; a commit (`owner/repo@hash`) to its page, with its subject from `gh`. A path leads to the file on
// this computer: in one of the project's folders, or in a folder directly inside one (where
// repositories are checked out), the first that has it. `repo#22`, `#22` and a bare hash lead
// nowhere. A paired device has `gh` asked only about the repositories checked out in the project's
// folders, which only the owner sets, so it learns nothing of the others the owner can see. `gh`
// runs a few at a time, with timeouts, and a device's questions are limited (`deviceBudget`). A
// call waits for it only briefly: what it has not said yet is left out, and its answer is kept for
// the next call. A commit's subject comes from a checkout of its repository in the project's
// folders when one has the commit, else from `gh`; subjects are kept, since commits never change,
// and a commit neither can tell of is asked about again after an hour. When GitHub limits the
// questions asked (HTTP 429, or a rate limit), `gh` is not asked for a while, longer each time.
import { spawn } from 'node:child_process';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { folderKey } from '../home/database.ts';
import { ProgramError, runProgram } from '../system/run.ts';
import { remoteUrls } from '../system/git.ts';
import { insideFolder, readRegistry } from './resolve.ts';
import { remoteRepository } from './remotes.ts';

export interface ReferenceItem { kind: 'pull' | 'commit' | 'path'; repository: string | null; value: string; line: number | null }
export interface PullState { title: string; state: 'open' | 'draft' | 'merged' | 'closed'; checks: 'passing' | 'failing' | 'pending' | null }
export interface ResolvedItem {
  url: string | null; file: { path: string; line: number | null } | null;
  /** The repository the reference names, `owner/repo`; null for a path. */
  repository: string | null;
  pull: PullState | null;
  /** A commit's subject, when `gh` can tell. */
  title: string | null;
}

/** How long the folders to look for files in and PR states are kept. */
const cacheMs = 60_000;
/** How long a commit neither a checkout nor `gh` could tell of is kept unknown. */
const missMs = 60 * 60_000;
/** How long one call waits for `gh`. */
const ghWaitMs = 3000;
/** At most this many `gh` processes at once. */
const parallel = 4;
const ignoredFolders = new Set(['node_modules', '__pycache__', 'dist', 'build']);
/** A repository as a reference names it: `owner/repo`, each part beginning with a letter, digit or underscore. */
const repositoryName = /^\w[\w.-]*\/\w[\w.-]*$/;
/**
 * A paired device has `gh` asked at most this many new questions in one call, and has at most
 * `devicePendingLimit` of them waiting at once across its calls; its other references are links
 * only. Answers already kept cost nothing, and the owner is not limited.
 */
const deviceBudget = 100, devicePendingLimit = 50;
let devicePending = 0;

/** Run tasks at most `parallel` at a time, in this process. */
let running = 0;
const queue: (() => void)[] = [];
async function slot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= parallel) await new Promise<void>(resolve => queue.push(resolve));
  running++;
  try { return await task(); } finally { running--; queue.shift()?.(); }
}
const program = (file: string, args: string[], timeout: number) => slot(() => runProgram(file, args, { windowsHide: true, timeout }).then(result => result.stdout, () => null));

/** Until when `gh` is not asked, after GitHub limited the questions asked; and how long the last pause was. */
let ghPausedUntil = 0, ghPauseMs = 0;
/** Run `gh`: its output, or null when it fails. A rate limit pauses `gh` for a minute, doubling while it lasts, up to half an hour. */
function gh(args: string[]): Promise<string | null> {
  if (Date.now() < ghPausedUntil) return Promise.resolve(null);
  return slot(() => runProgram('gh', args, { windowsHide: true, timeout: 15_000 })).then(result => { ghPauseMs = 0; return result.stdout; }, (error: unknown) => {
    if (error instanceof ProgramError && /rate limit|HTTP 429/i.test(error.stderr)) {
      ghPauseMs = Math.min(Math.max(ghPauseMs * 2, 60_000), 30 * 60_000);
      ghPausedUntil = Date.now() + ghPauseMs;
    }
    return null;
  });
}

const bases = new Map<string, { at: number; value: Promise<string[]> }>();
/** The folders a path may be in: each of the project's folders, then the folders directly inside it; kept for a minute. */
function projectBases(root: string): Promise<string[]> {
  const cached = bases.get(folderKey(root));
  if (cached && Date.now() - cached.at < cacheMs) return cached.value;
  const value = (async () => {
    const found: string[] = [];
    for (const folder of (await readRegistry(root).catch(() => null))?.folders ?? []) {
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => null);
      if (!entries) continue;
      found.push(folder, ...entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !ignoredFolders.has(entry.name)).map(entry => path.join(folder, entry.name)).sort((a, b) => a.localeCompare(b)));
    }
    return found;
  })();
  bases.set(folderKey(root), { at: Date.now(), value });
  return value;
}

const checkouts = new Map<string, { at: number; value: Promise<Map<string, string[]>> }>();
/**
 * The GitHub repositories checked out in a project's folders (each folder, and the folders directly
 * inside it), by their remotes, lowercased, with the folders that have each; kept for a minute. Git
 * spells each remote's URL itself (`git remote -v`; or its configuration file says it, when nothing
 * could rewrite it), applying `url.<base>.insteadOf`; an SSH host
 * alias (`Host` in ~/.ssh/config) is not followed, so a remote through one does not count. A folder
 * inside one of the project's folders that is no repository of its own (no `.git`, nor a bare
 * repository's `HEAD`) has the remotes of the folder it is in, so Git is not asked about it.
 */
function checkoutFolders(root: string): Promise<Map<string, string[]>> {
  const cached = checkouts.get(folderKey(root));
  if (cached && Date.now() - cached.at < cacheMs) return cached.value;
  const value = (async () => {
    const found = new Map<string, string[]>();
    const projectFolders = new Set(((await readRegistry(root).catch(() => null))?.folders ?? []).map(folder => folderKey(folder)));
    const own = async (folder: string) => projectFolders.has(folderKey(folder)) || Boolean(await lstat(path.join(folder, '.git')).catch(() => null)) || Boolean((await stat(path.join(folder, 'HEAD')).catch(() => null))?.isFile());
    await Promise.all((await projectBases(root)).map(async base => {
      if (!await own(base)) return;
      const urls = await remoteUrls(base).catch(() => null)
        ?? ((await program('git', ['-C', base, 'remote', '-v'], 5000))?.split(/\r?\n/) ?? []).map(line => /^\S+\t(.*) \(fetch\)$/.exec(line)?.[1] ?? null);
      for (const url of urls) {
        const repository = remoteRepository(url);
        if (!repository?.web) continue;
        const key = repository.repository.toLowerCase();
        const folders = found.get(key) ?? [];
        if (!folders.includes(base)) folders.push(base);
        found.set(key, folders);
      }
    }));
    return found;
  })();
  checkouts.set(folderKey(root), { at: Date.now(), value });
  return value;
}
/**
 * The GitHub repositories checked out in a project's folders, lowercased; kept for a minute. Only
 * the owner sets a project's folders, so a paired device cannot add to them, as it could to the
 * planning files by importing a plan.
 */
export async function checkedOutRepositories(root: string): Promise<Set<string>> {
  return new Set((await checkoutFolders(root)).keys());
}

let signedIn: { at: number; value: Promise<boolean> } | null = null;
/**
 * Whether `gh` is installed and has a token (`gh auth token` succeeds; one bad account among several
 * does not matter, as it would for `gh auth status`); asked again after a few minutes. Only its exit
 * code is read: the token is never captured.
 */
function ghReady() {
  if (!signedIn || Date.now() - signedIn.at > 5 * cacheMs) {
    signedIn = { at: Date.now(), value: slot(() => new Promise<boolean>(resolve => {
      const child = spawn('gh', ['auth', 'token'], { stdio: 'ignore', windowsHide: true, timeout: 10_000 });
      child.once('error', () => resolve(false)).once('exit', code => resolve(code === 0));
    })) };
  }
  return signedIn.value;
}
const pulls = new Map<string, { at: number; value: Promise<PullState | null> }>();
const pullLimit = 2000;
/** A PR's (or else an issue's) title, state and checks, from `gh`; kept for a minute. */
function pullState(repository: string, number: string): Promise<PullState | null> {
  const key = `${repository}#${number}`.toLowerCase();
  const cached = pulls.get(key);
  if (cached && Date.now() - cached.at < cacheMs) return cached.value;
  const value = (async (): Promise<PullState | null> => {
    if (!await ghReady()) return null;
    const pull = await gh(['pr', 'view', number, '--repo', repository, '--json', 'title,state,isDraft,statusCheckRollup']);
    if (pull) {
      const data = JSON.parse(pull) as { title?: unknown; state?: unknown; isDraft?: unknown; statusCheckRollup?: { conclusion?: unknown; state?: unknown; status?: unknown }[] };
      const state = data.state === 'MERGED' ? 'merged' : data.state === 'CLOSED' ? 'closed' : data.isDraft ? 'draft' : 'open';
      const results = (data.statusCheckRollup ?? []).map(check => String(check.conclusion || check.state || check.status || '').toUpperCase());
      const checks = !results.length ? null : results.some(result => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(result)) ? 'failing'
        : results.every(result => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(result)) ? 'passing' : 'pending';
      return { title: String(data.title ?? ''), state, checks };
    }
    const issue = await gh(['issue', 'view', number, '--repo', repository, '--json', 'title,state']);
    if (!issue) return null;
    const data = JSON.parse(issue) as { title?: unknown; state?: unknown };
    return { title: String(data.title ?? ''), state: data.state === 'CLOSED' ? 'closed' : 'open', checks: null };
  })().catch(() => null);
  if (pulls.size >= pullLimit) pulls.delete(pulls.keys().next().value!);
  pulls.set(key, { at: Date.now(), value });
  return value;
}
/**
 * The commit subjects found, by repository and hash, kept until `until`: for good once found; a
 * commit nothing could tell of for an hour, or while `gh` is paused.
 */
const subjects = new Map<string, { until: number; value: Promise<string | null> }>();
const subjectLimit = 5000;
/** Whether a commit's subject is kept, found or not: asking for it costs no new question. */
const subjectKept = (key: string) => { const kept = subjects.get(key); return Boolean(kept && Date.now() < kept.until); };
/** A commit's subject: from a checkout of its repository in the project's folders, else from `gh`. */
function commitSubject(root: string, repository: string, hash: string): Promise<string | null> {
  const key = `${repository}@${hash}`.toLowerCase();
  if (subjectKept(key)) return subjects.get(key)!.value;
  const entry = { until: Infinity, value: Promise.resolve<string | null>(null) };
  // Without `gh` signed in, a commit is asked about again sooner, as `gh` may be by then.
  let missKept = missMs;
  entry.value = (async () => {
    for (const folder of (await checkoutFolders(root)).get(repository.toLowerCase()) ?? []) {
      const message = await program('git', ['-C', folder, 'log', '-1', '--format=%B', hash, '--'], 5000);
      const subject = message?.trim().split(/\r?\n/)[0];
      if (subject) return subject;
    }
    if (!await ghReady()) { missKept = cacheMs; return null; }
    const message = await gh(['api', `repos/${repository}/commits/${hash}`, '--jq', '.commit.message']);
    return message?.trim().split(/\r?\n/)[0] || null;
  })().catch(() => null).then(found => {
    if (found === null) entry.until = Math.max(Date.now() + missKept, ghPausedUntil);
    return found;
  });
  if (subjects.size >= subjectLimit) subjects.delete(subjects.keys().next().value!);
  subjects.set(key, entry);
  return entry.value;
}

/**
 * Resolve a planning file's references, in order; null for one that leads nowhere. Without `gh`
 * (`gh: false`), PRs have no state and commits no subject. Without `local` (a paired device asks),
 * only what is not of this computer: no files, and `gh` asked only about the repositories checked
 * out in the project's folders.
 */
export async function resolveReferences(root: string, items: ReferenceItem[], options: { gh?: boolean; local?: boolean } = {}): Promise<(ResolvedItem | null)[]> {
  const here = options.local ?? true;
  const allowed = here || options.gh === false ? null : await checkedOutRepositories(root);
  let budget = deviceBudget;
  const waiting: Promise<unknown>[] = [];
  /**
   * Ask `gh` (`lookup`) about a repository when this call may: always for the owner; for a paired
   * device only about the repositories checked out in the project's folders, and a new question
   * (`kept`: none kept for it) only within its budget and its limit of questions waiting.
   */
  const ask = <T>(repository: string, kept: boolean, lookup: () => Promise<T>, use: (value: T) => void) => {
    if (options.gh === false || !(here || allowed!.has(repository.toLowerCase()))) return;
    if (here || kept) { waiting.push(lookup().then(use)); return; }
    if (budget <= 0 || devicePending >= devicePendingLimit) return;
    budget--; devicePending++;
    waiting.push(lookup().finally(() => { devicePending--; }).then(use));
  };
  const resolving = new Map<string, Promise<ResolvedItem | null>>();
  const results = await Promise.all(items.map(item => {
    const key = JSON.stringify([item.kind, item.repository, item.value, item.line]);
    if (!resolving.has(key)) resolving.set(key, resolve(item));
    return resolving.get(key)!;
  }));
  // `gh` is waited for only so long; what it says later is kept for the next call.
  await Promise.race([Promise.all(waiting), new Promise(resolve => setTimeout(resolve, ghWaitMs).unref())]);
  return results.map(result => result && { ...result });

  async function resolve(item: ReferenceItem): Promise<ResolvedItem | null> {
    const none: ResolvedItem = { url: null, file: null, repository: null, pull: null, title: null };
    if (item.kind === 'pull' || item.kind === 'commit') {
      const repository = item.repository !== null && repositoryName.test(item.repository) ? item.repository : null;
      if (!repository) return null;
      const web = 'https://github.com/' + repository;
      if (item.kind === 'pull') {
        if (!/^\d{1,9}$/.test(item.value)) return null;
        const resolved: ResolvedItem = { ...none, url: web + '/pull/' + item.value, repository };
        const kept = pulls.get(`${repository}#${item.value}`.toLowerCase());
        ask(repository, Boolean(kept && Date.now() - kept.at < cacheMs), () => pullState(repository, item.value), state => { resolved.pull = state; });
        return resolved;
      }
      const hash = item.value.toLowerCase();
      if (!/^[0-9a-f]{7,40}$/.test(hash)) return null;
      const resolved: ResolvedItem = { ...none, url: web + '/commit/' + hash, repository };
      ask(repository, subjectKept(`${repository}@${hash}`.toLowerCase()), () => commitSubject(root, repository, hash), title => { resolved.title = title; });
      return resolved;
    }
    // A path inside one of the project's folders: never one that leaves it, nor through a link.
    if (!here) return null;
    const relative = item.value.replace(/\\/g, '/').replace(/^\.\//, '');
    if (path.isAbsolute(relative) || relative.split('/').includes('..')) return null;
    for (const base of await projectBases(root)) {
      const file = path.join(base, ...relative.split('/'));
      if (!(await stat(file).catch(() => null))?.isFile()) continue;
      const [real, folder] = await Promise.all([realpath(file).catch(() => null), realpath(base).catch(() => null)]);
      if (real && folder && insideFolder(folder, real)) return { ...none, file: { path: file, line: item.line } };
    }
    return null;
  }
}
