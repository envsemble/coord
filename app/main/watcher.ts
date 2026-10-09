// Watches a planning folder recursively and reports coalesced changes. Bursts (a Git checkout,
// an editor's atomic save through a temporary file and rename) arrive as one change: the
// callback runs once the folder has been quiet for `debounce` ms, and at least every `maxWait` ms
// while changes keep arriving.
import { existsSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

export interface FolderWatcher { close(): void }
export interface WatchOptions {
  debounce?: number;
  maxWait?: number;
  onChange(paths: string[]): void;
  onError(error: Error): void;
  presenceInterval?: number;
}

function samePlatformName(first: string, second: string) {
  return process.platform === 'win32' || process.platform === 'darwin' ? first.toLowerCase() === second.toLowerCase() : first === second;
}

const gitRelevant = /^\.git\/(?:HEAD|packed-refs|refs\/.*)$/;

/** Whether a changed path (relative, any separator) can change what Atlas shows. */
export function relevantChange(relative: string | null): boolean {
  if (relative === null) return true;
  const normalized = relative.replaceAll('\\', '/');
  if (normalized === '.git' || normalized.startsWith('.git/')) return gitRelevant.test(normalized) && !normalized.endsWith('.lock');
  const parts = normalized.split('/');
  return !parts.some(part => part === 'node_modules' || part === '__pycache__') && !/(?:^|\/)\.atlas\/(?:prepared|results|exports)(?:\/|$)/.test(normalized);
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

export function watchFolder(root: string, options: WatchOptions): FolderWatcher {
  const coalescer = createCoalescer(options.onChange, options.debounce, options.maxWait);
  let watcher: FSWatcher | null = null;
  let closed = false;
  try {
    watcher = watch(root, { recursive: true, persistent: false }, (_event, filename) => {
      const relative = filename === null ? null : filename.toString();
      if (!closed && relevantChange(relative)) coalescer.add(relative ?? '');
    });
    watcher.on('error', error => { if (!closed) options.onError(error); });
  } catch (error) {
    queueMicrotask(() => options.onError(error as Error));
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
      for (const item of [watcher, parent]) try { item?.close(); } catch { /* Already closed. */ }
    },
  };
}
