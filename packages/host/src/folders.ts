// The planning folders the host has open. Each folder has a stable ID derived from its canonical
// path, one FolderSession while any client uses it, and closes a while after the last one leaves.
import { createHmac } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { FolderState } from './contract.ts';
import { HostError, type Logger } from './errors.ts';
import { FolderSession } from './folder.ts';

/** Compare paths the way the platform does. */
export function pathKey(value: string, platform: NodeJS.Platform = process.platform) {
  return platform === 'win32' || platform === 'darwin' ? value.toLowerCase() : value;
}
/**
 * A folder's ID: the same for the same canonical path on this host, keyed with the host's secret so
 * a device cannot confirm a guessed path (such as one with a user name in it) from an ID.
 */
export function folderIdOf(canonical: string, key: string) {
  return 'f-' + createHmac('sha256', key).update('atlas-folder:' + pathKey(canonical)).digest('hex').slice(0, 32);
}
/** The canonical path of a folder; a missing folder keeps its absolute spelling. */
export async function canonicalFolder(input: string) {
  return realpath(input).catch(() => path.resolve(input));
}

export interface FolderRegistryOptions {
  /** The host's folder-ID key (AccessStore.folderKey). */
  key: string;
  dataBase?: string;
  log: Logger;
  onChange(state: FolderState): void;
  /** How long a folder stays open after its last user leaves. */
  idleClose?: number;
  watchDelay?: { debounce: number; maxWait: number };
}
interface Entry { session: FolderSession; users: number; started: Promise<void>; timer: ReturnType<typeof setTimeout> | null }

export class FolderRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly closing = new Set<FolderSession>();
  /** Every folder opened by path in this process, so its ID can open it again after it closed. */
  private readonly known = new Map<string, string>();
  private readonly options: FolderRegistryOptions;
  constructor(options: FolderRegistryOptions) { this.options = options; }

  /** Open (or find) a folder by path and wait for its first read. */
  async open(input: string): Promise<FolderSession> {
    const root = await canonicalFolder(input);
    const folderId = this.idOf(root);
    this.known.set(folderId, root);
    let entry = this.entries.get(folderId);
    if (!entry) {
      const session = new FolderSession(root, { folderId, dataBase: this.options.dataBase, log: this.options.log, watchDelay: this.options.watchDelay, onChange: state => this.options.onChange(state) });
      const created: Entry = { session, users: 0, timer: null, started: Promise.resolve() };
      // The idle timer starts once the first read is done, so a slow start cannot close the folder under its first user.
      created.started = session.start().catch(error => this.options.log.error('Folder could not start', error)).then(() => this.scheduleClose(folderId, created));
      entry = created;
      this.entries.set(folderId, entry);
    }
    await entry.started;
    return entry.session;
  }

  /** The ID of a canonical folder path on this host. */
  idOf(canonical: string) { return folderIdOf(canonical, this.options.key); }
  /** The path of a folder opened by path before, if any. */
  pathOf(folderId: string) { return this.known.get(folderId) ?? null; }
  /** Every folder path this host has opened, for keeping them out of what devices see. */
  knownRoots() { return [...this.known.values()]; }

  /** A folder that is open, for a client that may use it. */
  get(folderId: string): FolderSession {
    const entry = this.entries.get(folderId);
    if (!entry) throw new HostError('not-found', 'This planning folder is not open on the host.');
    return entry.session;
  }
  has(folderId: string) { return this.entries.has(folderId); }

  /** A client starts using a folder: it stays open until every user has released it. */
  acquire(folderId: string) {
    const entry = this.entries.get(folderId);
    if (!entry) throw new HostError('not-found', 'This planning folder is not open on the host.');
    entry.users++;
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
  }
  release(folderId: string) {
    const entry = this.entries.get(folderId);
    if (!entry) return;
    entry.users = Math.max(0, entry.users - 1);
    this.scheduleClose(folderId, entry);
  }
  private scheduleClose(folderId: string, entry: Entry) {
    if (entry.users || entry.timer || this.entries.get(folderId) !== entry) return;
    entry.timer = setTimeout(() => {
      if (entry.users) return;
      this.entries.delete(folderId);
      entry.session.close();
      // Its usage store closes a moment later; a stopping host closes it at once.
      this.closing.add(entry.session);
      setTimeout(() => this.closing.delete(entry.session), 2500).unref?.();
      this.options.log.info('Planning folder closed', { root: entry.session.root });
    }, this.options.idleClose ?? 30000);
    entry.timer.unref?.();
  }

  /** Close every folder now (the host is stopping). */
  closeAll() {
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.session.close(true);
    }
    for (const session of this.closing) session.close(true);
    this.entries.clear();
    this.closing.clear();
  }
}
