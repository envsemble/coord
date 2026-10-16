// Watches planning folders for what the project list shows, so the hub stays current without any
// window having a project open: the home's planning folder (every project in it), or one project's
// planning folder outside the home. A project's planning.json, its plans and ledgers and its work
// folders coming, going or moving between active/ and archive/ count; other files do not. A folder
// that is replaced (moved away and back, deleted and made again) is watched again, and a watch that
// fails (Linux running out of inotify watches, say) is tried again later, less often each time;
// meanwhile the home's planning folder is still watched for projects coming and going. Any other
// change it sees is told as the project it is in, for the search to look at that project again.
import { watch } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { readRegistry } from '@envsemble/atlas-planning';
import type { Logger } from './errors.ts';
import { ignoredInHome, projectListChange, watchFolder } from './watcher.ts';

export interface ProjectWatchOptions {
  log: Logger;
  /** Something the project list shows changed. */
  changed(): void;
  /** Something changed in a project's planning folder (null: in any of them). */
  touched?(folder: string | null): void;
  /** The first wait before a failed watch is tried again (5 s), doubled each time up to five minutes. */
  retryDelay?: number;
}

/** A folder's identity: the same folder until it is replaced; null while it is missing. */
async function identityOf(folder: string) {
  // NTFS file IDs exceed what a number holds exactly.
  const info = await stat(folder, { bigint: true }).catch(() => null);
  return info?.isDirectory() ? `${info.dev}:${info.ino}` : null;
}
const folderNames = async (folder: string) => (await readdir(folder, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();

export class ProjectListWatch {
  private watcher: { close(): void } | null = null;
  private identity: string | null = null;
  /** The folders whose coming and going count, as one text to compare. */
  private shape = '';
  private retry: ReturnType<typeof setTimeout> | null = null;
  private stable: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private closed = false;
  /** Each start's number: a start overtaken by a later one while it waited makes no watcher. */
  private generation = 0;

  readonly root: string;
  private readonly home: boolean;
  private readonly options: ProjectWatchOptions;
  /** `home`: the home's planning folder, whose folders are projects; otherwise one project's planning folder. */
  constructor(root: string, home: boolean, options: ProjectWatchOptions) {
    this.root = root; this.home = home; this.options = options;
    void this.start();
  }

  /** A path relative to the watched folder as the home's rules see it: `<project>/…`. */
  private inHome(relative: string) {
    return this.home ? relative : path.basename(this.root) + (relative ? '/' + relative : '');
  }
  private async folders() {
    if (!this.home) return JSON.stringify([await folderNames(path.join(this.root, 'active')), await folderNames(path.join(this.root, 'archive'))]);
    const projects = await folderNames(this.root);
    return JSON.stringify(await Promise.all(projects.map(async name => [name, await folderNames(path.join(this.root, name, 'active')), await folderNames(path.join(this.root, name, 'archive'))])));
  }

  private async start() {
    const generation = ++this.generation;
    if (this.closed) return;
    if (this.home) await mkdir(this.root, { recursive: true }).catch(() => undefined);
    const identity = await identityOf(this.root), shape = await this.folders();
    if (this.closed || generation !== this.generation) return;
    this.identity = identity;
    this.shape = shape;
    this.watcher?.close();
    this.watcher = watchFolder(this.root, {
      debounce: 300, maxWait: 5000,
      ignore: relative => ignoredInHome(this.inHome(relative)),
      relevant: relative => this.options.touched ? relative === null || !ignoredInHome(this.inHome(relative)) : projectListChange(relative === null ? null : this.inHome(relative)) !== false,
      onChange: paths => { void this.changedPaths(paths); },
      onError: error => this.failed(error),
    });
    // A watch that has held for ten minutes starts over its waits after a failure.
    if (this.stable) clearTimeout(this.stable);
    this.stable = setTimeout(() => { this.failures = 0; }, 10 * 60_000);
    this.stable.unref?.();
  }

  private failed(error: Error) {
    if (this.closed) return;
    this.watcher?.close();
    this.watcher = null;
    const delay = Math.min(5 * 60_000, (this.options.retryDelay ?? 5000) * 2 ** this.failures++);
    this.options.log.warn(this.home ? 'The projects folder is watched only for projects coming and going for now' : 'A project folder is not watched for now', { folder: this.root, message: error.message, retryIn: delay });
    if (this.home) {
      try {
        const shallow = watch(this.root, () => this.options.changed());
        shallow.on('error', () => shallow.close());
        this.watcher = { close: () => shallow.close() };
      } catch { /* Watched again after the wait. */ }
    }
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => { this.retry = null; this.restart(); }, delay);
    this.retry.unref?.();
  }

  private restart() {
    if (this.closed) return;
    this.watcher?.close();
    this.watcher = null;
    // Changes while it was not watched were missed.
    this.touch(['']);
    void this.start();
  }

  private async changedPaths(paths: string[]) {
    if (this.closed) return;
    this.touch(paths);
    // The folder was replaced: watch the one there now.
    if (await identityOf(this.root) !== this.identity) { this.restart(); this.options.changed(); return; }
    const changes = paths.map(relative => projectListChange(this.inHome(relative)));
    let changed = changes.includes(true);
    // A folder reported: only folders coming, going or moving count (the shape is kept current either way).
    if (changes.includes('folders')) {
      const shape = await this.folders();
      if (shape !== this.shape) { this.shape = shape; changed = true; }
    }
    // Another Markdown file counts when its project registers it as a work item's plan.
    for (const [index, relative] of paths.entries()) {
      if (changed) break;
      if (changes[index] !== 'maybe') continue;
      const parts = relative.replaceAll('\\', '/').split('/').filter(Boolean);
      const [project, plan] = this.home ? [path.join(this.root, parts[0]), parts.slice(1).join('/')] : [this.root, parts.join('/')];
      const registry = await readRegistry(project).catch(() => null);
      changed = registry?.work_items.some(item => typeof item?.current_plan === 'string' && item.current_plan === plan) ?? false;
    }
    if (changed && !this.closed) this.options.changed();
  }

  /** Tell which projects the changed paths are in: the home's own folder is all of them. */
  private touch(paths: string[]) {
    const touched = this.options.touched;
    if (!touched) return;
    if (!this.home) { touched(this.root); return; }
    const projects = new Set(paths.map(relative => relative.replaceAll('\\', '/').split('/').filter(Boolean)[0] ?? ''));
    if (projects.has('')) touched(null);
    else for (const name of projects) touched(path.join(this.root, name));
  }

  close() {
    this.closed = true;
    this.watcher?.close();
    this.watcher = null;
    for (const timer of [this.retry, this.stable]) if (timer) clearTimeout(timer);
  }
}
