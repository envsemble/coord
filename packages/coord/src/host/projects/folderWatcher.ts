// Watches a planning folder recursively and reports coalesced changes. Bursts (a Git checkout,
// an editor's atomic save through a temporary file and rename) arrive as one change: the
// callback runs once the folder has been quiet for `debounce` ms, and at least every `maxWait` ms
// while changes keep arriving.
import { existsSync, lstatSync, readdirSync, watch, type FSWatcher, type WatchOptions as FsWatchOptions } from 'node:fs';
import path from 'node:path';

export interface FolderWatcher { close(): void }
export interface WatchOptions {
  debounce?: number;
  maxWait?: number;
  onChange(paths: string[]): void;
  onError(error: Error): void;
  presenceInterval?: number;
  /** Folders (relative paths) never watched, in place of `ignoredPath`. */
  ignore?(relative: string): boolean;
  /** Which changes count, in place of `relevantChange`. */
  relevant?(relative: string | null): boolean;
}

function samePlatformName(first: string, second: string) {
  return process.platform === 'win32' || process.platform === 'darwin' ? first.toLowerCase() === second.toLowerCase() : first === second;
}

const gitRelevant = /^\.git\/(?:HEAD|packed-refs|refs\/.*)$/;

/** Whether a changed path (relative, any separator) can change what Coord shows. */
export function relevantChange(relative: string | null): boolean {
  if (relative === null) return true;
  const normalized = relative.replaceAll('\\', '/');
  if (normalized === '.git' || normalized.startsWith('.git/')) return gitRelevant.test(normalized) && !normalized.endsWith('.lock');
  return !ignoredPath(normalized);
}

/**
 * Folders that are never watched at all. On Linux the recursive watcher walks the tree and adds an
 * inotify watch per folder, so skipping these keeps it from exhausting the watch limit on Git
 * objects or dependencies. (.git itself stays watched: HEAD and refs move on commits.)
 */
export function ignoredPath(relative: string): boolean {
  const normalized = relative.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized === '.git/objects' || normalized.startsWith('.git/objects/')) return true;
  return normalized.split('/').some(part => part === 'node_modules' || part === '__pycache__');
}

const homeIgnored = new Set(['.git', 'node_modules', '__pycache__']);
/**
 * Folders in the home's planning folder (paths `<project>/…`) never watched for the project list
 * and the search: Git's, dependencies, and a work folder's evidence
 * (`<project>/active|archive/<work>/evidence`). Diagrams are watched, for the search.
 */
export function ignoredInHome(relative: string): boolean {
  const parts = relative.replaceAll('\\', '/').split('/').filter(Boolean);
  if (parts.some(part => homeIgnored.has(part))) return true;
  return parts.length >= 4 && (parts[1] === 'active' || parts[1] === 'archive') && parts[3] === 'evidence';
}
/**
 * Whether a change in the home's planning folder (a path relative to it, `<project>/…`) can change
 * the project list's summaries: its planning.json, a plan or a ledger. A project folder, or a work
 * folder in `active/` or `archive/`, is `folders`: it counts when folders came, went or moved (some
 * systems report a folder whenever a file in it changes). Another Markdown file `maybe` does, when
 * its project registers it as a work item's plan.
 */
export function projectListChange(relative: string | null): boolean | 'folders' | 'maybe' {
  if (relative === null || relative === '') return true;
  const parts = relative.replaceAll('\\', '/').split('/').filter(Boolean);
  if (ignoredInHome(parts.join('/'))) return false;
  const name = parts.at(-1)!;
  if (parts.length === 2 && name === 'planning.json') return true;
  if (name === 'plan.md' || name === 'ledger.md') return true;
  if (parts.length === 1 || (parts.length <= 3 && (parts[1] === 'active' || parts[1] === 'archive'))) return 'folders';
  return /\.md$/i.test(name) ? 'maybe' : false;
}

export function createCoalescer(flush: (paths: string[]) => void, debounce = 200, maxWait = 1500) {
  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let first = 0;
  const run = () => {
    timer = null; first = 0;
    const paths = [...pending]; pending = new Set();
    flush(paths);
  };
  return {
    add(path: string) {
      pending.add(path);
      const now = Date.now();
      if (!first) first = now;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, now - first >= maxWait ? 0 : Math.min(debounce, maxWait - (now - first)));
    },
    cancel() { if (timer) clearTimeout(timer); timer = null; pending = new Set(); first = 0; },
  };
}

type WatchOptionsWithIgnore = FsWatchOptions & { encoding: 'utf8'; ignore(path: string): boolean };

/** What the tree watchers need from the file system; tests replace it. */
export interface WatchSystem {
  platform: NodeJS.Platform;
  /** fs.watch: recursive (Windows, macOS) or one folder (Linux). */
  watch(path: string, options: FsWatchOptions & { ignore?(path: string): boolean }, listener: (event: string, filename: string | null) => void): Pick<FSWatcher, 'close' | 'on'>;
  /** Subfolders of a folder (names only). */
  folders(path: string): string[];
  isFolder(path: string): boolean;
}
export const nodeWatchSystem: WatchSystem = {
  platform: process.platform,
  watch: (target, options, listener) => watch(target, { ...options, encoding: 'utf8' } as WatchOptionsWithIgnore, (event, filename) => listener(event, filename === null ? null : String(filename))),
  folders: target => readdirSync(target, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => entry.name),
  isFolder: target => { try { return lstatSync(target).isDirectory(); } catch { return false; } },
};

interface TreeWatcher { close(): void }
type Changed = (relative: string | null) => void;

/** Windows and macOS: the platform's own recursive watcher. */
function recursiveTree(root: string, system: WatchSystem, changed: Changed, failed: (error: Error) => void, ignored: (relative: string) => boolean): TreeWatcher {
  // `ignore` (Node 24) keeps ignored folders' events out.
  const ignore = (candidate: string) => ignored(path.isAbsolute(candidate) ? path.relative(root, candidate) : candidate);
  const watcher = system.watch(root, { recursive: true, persistent: false, ignore }, (_event, filename) => changed(filename));
  watcher.on('error', failed);
  return { close: () => { try { watcher.close(); } catch { /* Already closed. */ } } };
}

/**
 * Linux: one inotify watch per folder, kept in step as folders appear and disappear. Node's own
 * recursive emulation does the same but ignores errors while it walks the tree (such as reaching
 * the inotify watch limit) and leaves part of the tree unwatched; here any failure ends watching
 * and is reported, so the folder is rescanned instead.
 */
function perFolderTree(root: string, system: WatchSystem, changed: Changed, failed: (error: Error) => void, ignored: (relative: string) => boolean): TreeWatcher {
  const watchers = new Map<string, Pick<FSWatcher, 'close' | 'on'>>();
  let stopped = false;
  const stop = () => {
    stopped = true;
    for (const watcher of watchers.values()) try { watcher.close(); } catch { /* Already closed. */ }
    watchers.clear();
  };
  const fail = (error: Error) => { if (stopped) return; stop(); failed(error); };
  const join = (folder: string, name: string) => folder ? folder + '/' + name : name;
  const remove = (folder: string) => {
    for (const [key, watcher] of watchers) {
      if (key !== folder && !key.startsWith(folder + '/')) continue;
      try { watcher.close(); } catch { /* Already closed. */ }
      watchers.delete(key);
    }
  };
  const add = (folder: string) => {
    if (stopped || watchers.has(folder) || (folder && ignored(folder))) return;
    const absolute = path.join(root, folder);
    const watcher = system.watch(absolute, { persistent: false }, (event, filename) => {
      if (stopped) return;
      const relative = filename === null ? null : join(folder, filename);
      changed(relative);
      if (relative === null || event !== 'rename') return;
      try {
        if (system.isFolder(path.join(root, relative))) add(relative);
        else remove(relative);
      } catch (error) { fail(error as Error); }
    });
    watcher.on('error', error => fail(error));
    watchers.set(folder, watcher);
    let names: string[] = [];
    try { names = system.folders(absolute); } catch (error) {
      // A folder removed while it is being added is not a failure.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { remove(folder); return; }
      throw error;
    }
    for (const name of names) add(join(folder, name));
  };
  try { add(''); } catch (error) { fail(error as Error); }
  return { close: stop };
}

export function watchFolder(root: string, options: WatchOptions, system: WatchSystem = nodeWatchSystem): FolderWatcher {
  const coalescer = createCoalescer(options.onChange, options.debounce, options.maxWait);
  let closed = false;
  const relevant = options.relevant ?? relevantChange;
  const changed: Changed = relative => { if (!closed && relevant(relative)) coalescer.add(relative ?? ''); };
  const failed = (error: Error) => { if (!closed) queueMicrotask(() => options.onError(error)); };
  let tree: TreeWatcher | null = null;
  try {
    tree = (system.platform === 'linux' ? perFolderTree : recursiveTree)(root, system, changed, failed, options.ignore ?? ignoredPath);
  } catch (error) {
    failed(error as Error);
  }
  // A recursive watcher does not report its own folder being renamed or deleted (on Windows it
  // keeps following the moved folder), so also watch the parent and check the folder is there.
  let parent: FSWatcher | null = null;
  try {
    parent = watch(path.dirname(root), { persistent: false }, (_event, filename) => {
      if (!closed && (filename === null || samePlatformName(filename.toString(), path.basename(root)))) coalescer.add('');
    });
    parent.on('error', () => { try { parent?.close(); } catch { /* Already closed. */ } });
  } catch { /* An unwatchable parent (a drive root, for example) leaves the presence check. */ }
  const presence = setInterval(() => {
    if (!closed && !existsSync(root)) coalescer.add('');
  }, options.presenceInterval ?? 3000);
  presence.unref?.();
  return {
    close() {
      closed = true;
      coalescer.cancel();
      clearInterval(presence);
      tree?.close();
      try { parent?.close(); } catch { /* Already closed. */ }
    },
  };
}
