// The projects the host has open. Each project has a stable ID derived from its planning folder's
// canonical path, one OpenProject while any client uses it, and closes a while after the last one leaves.
import { createHmac } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { HomeDatabase } from '../../planning/index.ts';
import type { OpenProjectState } from '../contract.ts';
import { HostError, type Logger } from '../errors.ts';
import { OpenProject } from './openProject.ts';

/** Compare paths the way the platform does. */
export function pathKey(value: string, platform: NodeJS.Platform = process.platform) {
  return platform === 'win32' || platform === 'darwin' ? value.toLowerCase() : value;
}
/**
 * A project's ID: the same for the same canonical planning folder path on this host, keyed with the
 * host's secret so a device cannot confirm a guessed path (such as one with a user name in it) from an
 * ID. The hashed text keeps its `coord-folder:` prefix, so IDs stay as they were.
 */
export function projectIdOf(canonical: string, key: string) {
  return 'f-' + createHmac('sha256', key).update('coord-folder:' + pathKey(canonical)).digest('hex').slice(0, 32);
}
/** The canonical path of a folder; a missing folder keeps its absolute spelling. */
async function canonicalFolder(input: string) {
  return realpath(input).catch(() => path.resolve(input));
}

export interface OpenProjectsOptions {
  /** The host's project ID key (AccessStore.projectIdKey), read when an ID is needed. */
  key(): string;
  /** The home database, where document use is recorded. */
  database: HomeDatabase | null;
  log: Logger;
  onChange(state: OpenProjectState): void;
  /** How long a folder stays open after its last user leaves. */
  idleClose?: number;
  watchDelay?: { debounce: number; maxWait: number };
}
interface Entry { project: OpenProject; users: number; started: Promise<void>; timer: ReturnType<typeof setTimeout> | null }

export class OpenProjects {
  private readonly entries = new Map<string, Entry>();
  /** Every folder opened by path in this process, so its ID can open it again after it closed. */
  private readonly known = new Map<string, string>();
  private readonly options: OpenProjectsOptions;
  constructor(options: OpenProjectsOptions) { this.options = options; }

  /** Open (or find) a folder by path and wait for its first read. */
  async open(input: string): Promise<OpenProject> {
    const root = await canonicalFolder(input);
    const projectId = this.idOf(root);
    this.known.set(projectId, root);
    let entry = this.entries.get(projectId);
    if (!entry) {
      const project = new OpenProject(root, { projectId, database: this.options.database, log: this.options.log, watchDelay: this.options.watchDelay, onChange: state => this.options.onChange(state) });
      const created: Entry = { project, users: 0, timer: null, started: Promise.resolve() };
      // The idle timer starts once the first read is done, so a slow start cannot close the folder under its first user.
      created.started = project.start().catch(error => this.options.log.error('Folder could not start', error)).then(() => this.scheduleClose(projectId, created));
      entry = created;
      this.entries.set(projectId, entry);
    }
    await entry.started;
    return entry.project;
  }

  /** The project ID of a canonical planning folder path on this host. */
  idOf(canonical: string) { return projectIdOf(canonical, this.options.key()); }
  /** The path of a folder opened by path before, if any. */
  pathOf(projectId: string) { return this.known.get(projectId) ?? null; }
  /** Every folder path this host has opened, for keeping them out of what devices see. */
  knownRoots() { return [...this.known.values()]; }

  /** A folder that is open, for a client that may use it. */
  get(projectId: string): OpenProject {
    const entry = this.entries.get(projectId);
    if (!entry) throw new HostError('not-found', 'This planning folder is not open on the host.');
    return entry.project;
  }
  has(projectId: string) { return this.entries.has(projectId); }

  /** A client starts using a folder: it stays open until every user has released it. */
  acquire(projectId: string) {
    const entry = this.entries.get(projectId);
    if (!entry) throw new HostError('not-found', 'This planning folder is not open on the host.');
    entry.users++;
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
  }
  release(projectId: string) {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    entry.users = Math.max(0, entry.users - 1);
    this.scheduleClose(projectId, entry);
  }
  private scheduleClose(projectId: string, entry: Entry) {
    if (entry.users || entry.timer || this.entries.get(projectId) !== entry) return;
    entry.timer = setTimeout(() => {
      if (entry.users) return;
      this.entries.delete(projectId);
      entry.project.close();
      this.options.log.info('Planning folder closed', { root: entry.project.root });
    }, this.options.idleClose ?? 30000);
    entry.timer.unref?.();
  }

  /** Close a folder now and forget its path (it moved): its ID no longer opens anything. */
  forget(projectId: string) {
    const entry = this.entries.get(projectId);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      this.entries.delete(projectId);
      entry.project.close();
    }
    this.known.delete(projectId);
  }

  /** Reports were recorded: every open folder reads its work's statistics again. */
  refreshStatistics() {
    for (const entry of this.entries.values()) void entry.started.then(() => entry.project.refreshStatistics());
  }

  /** Close every folder now (the host is stopping). */
  closeAll() {
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.project.close();
    }
    this.entries.clear();
  }
}
