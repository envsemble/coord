// One open planning folder: its reader session, the last good snapshot, and the watcher that
// keeps it current. The host keeps one FolderSession per folder that a client has open, and
// answers every request about that folder from it.
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { readDocument, recordView, usageSummary, type HomeDatabase } from '../../planning/index.ts';
import { PlanningSession } from '../../planning/reading/session.ts';
import type { Usage } from '../../planning/types.ts';
import type { DiagramEntry, DiagramIndexEntry, DiagramReference, FolderState, FolderStatus, Snapshot, ViewEventInput } from '../contract.ts';
import { HostError, type Logger } from '../errors.ts';
import { watchFolder, type FolderWatcher } from './watcher.ts';
import { runProgram as run } from '../../planning/index.ts';

const skippedFolders = new Set(['node_modules', '__pycache__', 'dist', 'build']);
const folderLimit = 20000;
const unavailableUsage: Usage = { dashboardSince: null, agentSince: null, views: 0, documentsViewed: 0, sessions: 0, reports: 0, documentsConsulted: 0, tasks: 0, unassigned: 0, failures: 0, documents: [] };

/** Every visible folder under the root, as the explorer shows it (dot folders and build output hidden). */
export async function listFolders(root: string): Promise<string[]> {
  const result: string[] = [];
  const queue = [''];
  while (queue.length && result.length < folderLimit) {
    const relative = queue.shift()!;
    let entries;
    try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') || skippedFolders.has(entry.name)) continue;
      const child = relative ? relative + '/' + entry.name : entry.name;
      result.push(child);
      queue.push(child);
    }
  }
  return result.sort();
}

async function exists(directory: string) {
  try { return (await stat(directory)).isDirectory(); } catch { return false; }
}

export interface FolderOptions { folderId: string; database: HomeDatabase | null; log: Logger; onChange(state: FolderState): void; watchDelay?: { debounce: number; maxWait: number } }

export class FolderSession {
  readonly root: string;
  readonly name: string;
  status: FolderStatus = 'loading';
  error: string | null = null;
  notice: string | null = null;
  revision = 0;
  private watchFailures: number[] = [];
  private rescanTimer: ReturnType<typeof setInterval> | null = null;
  private current: Snapshot | null = null;
  private planning: PlanningSession | null = null;
  private watcher: FolderWatcher | null = null;
  private missingTimer: ReturnType<typeof setInterval> | null = null;
  private loading: Promise<void> | null = null;
  private again = false;
  private closed = false;
  private diagramIndexCache: { revision: number; entries: Promise<DiagramIndexEntry[]> } | null = null;
  private readonly options: FolderOptions;

  constructor(root: string, options: FolderOptions) {
    this.root = root;
    this.name = path.basename(root) || root;
    this.options = options;
  }

  get folderId() { return this.options.folderId; }
  state(): FolderState {
    return { folderId: this.options.folderId, name: this.name, status: this.status, error: this.error, notice: this.notice, revision: this.revision };
  }

  async start() {
    this.planning = await PlanningSession.open(this.root, { database: this.options.database });
    await this.reload();
    if (this.status !== 'missing') this.watch();
  }

  /** Reload now; a reload requested while one runs is coalesced into one more run. */
  reload(): Promise<void> {
    if (this.loading) { this.again = true; return this.loading; }
    this.loading = (async () => {
      do { this.again = false; await this.load(); } while (this.again && !this.closed);
    })().finally(() => { this.loading = null; });
    return this.loading;
  }

  private async load() {
    const planning = this.planning;
    if (!planning || this.closed) return;
    const started = performance.now();
    try {
      const index = await planning.index(true);
      let usage: Usage = unavailableUsage;
      const usageByRepository: Record<string, Usage> = Object.create(null);
      let collectionError = planning.collectionError;
      try {
        const { database, projectId } = planning;
        if (database && projectId !== null) {
          usage = usageSummary(database, projectId);
          for (const repository of index.repositories) usageByRepository[repository.id] = usageSummary(database, projectId, index.documents.filter(document => document.repositories.includes(repository.id)).map(document => document.key));
        }
      } catch { collectionError = 'Local usage statistics could not be read. Document viewing still works; collection is incomplete.'; }
      let counts: Record<string, number> = {};
      try { counts = planning.diagrams.counts(index); } catch { /* Counts are an indicator only. */ }
      const folders = await listFolders(index.root);
      this.current = { ...index, work: index.work.map(item => ({ ...item, diagrams: counts[item.id] ?? 0 })), usage, usageByRepository, collectionError, folders };
      this.status = 'ready';
      this.error = null;
      this.options.log.info('Planning folder read', { root: this.root, work: index.work.length, documents: index.documents.length, milliseconds: Math.round(performance.now() - started) });
    } catch (error) {
      if (!(await exists(this.root))) {
        this.status = 'missing';
        this.error = 'This planning folder was moved or deleted.';
        this.stopWatching();
        this.pollForReturn();
      } else {
        const message = error instanceof Error ? error.message : 'The planning folder could not be read.';
        // Keep the last good view; the window shows the error above it.
        this.status = this.current ? 'ready' : 'invalid';
        this.error = message;
      }
      this.options.log.warn('Planning folder unreadable', { root: this.root, status: this.status, error: this.error });
    }
    this.revision++;
    this.diagramIndexCache = null;
    this.emit();
  }

  private emit() {
    if (!this.closed) this.options.onChange(this.state());
  }

  private watch() {
    this.stopWatching();
    if (this.rescanTimer) return;
    const delay = this.options.watchDelay ?? { debounce: 200, maxWait: 1500 };
    this.watcher = watchFolder(this.root, {
      ...delay,
      onChange: () => { void this.reload(); },
      onError: error => {
        this.options.log.warn('Folder watcher stopped', { root: this.root, error: error.message });
        this.stopWatching();
        const now = Date.now();
        this.watchFailures = [...this.watchFailures.filter(time => now - time < 60000), now];
        // A watcher that fails again soon (for example, the inotify watch limit) gives way to rescanning.
        if (this.watchFailures.length > 1) this.rescan(error);
        void this.reload().then(() => { if (this.status !== 'missing' && !this.closed) this.watch(); });
      },
    });
  }
  private rescan(error: Error) {
    if (this.rescanTimer || this.closed) return;
    this.notice = 'Atlas cannot watch this folder for changes (' + error.message + '), so it checks for changes every 10 seconds instead.';
    this.options.log.error('Watching failed; rescanning every 10 seconds', { root: this.root, error: error.message });
    this.rescanTimer = setInterval(() => { void this.reload(); }, 10000);
    this.emit();
  }
  private stopWatching() {
    this.watcher?.close();
    this.watcher = null;
  }
  /** While the folder is missing, check cheaply whether it came back (for example after a checkout of its parent). */
  private pollForReturn() {
    if (this.missingTimer || this.closed) return;
    this.missingTimer = setInterval(() => {
      void exists(this.root).then(back => {
        if (!back || this.closed || !this.missingTimer) return;
        clearInterval(this.missingTimer); this.missingTimer = null;
        void this.reload().then(() => { if (this.status !== 'missing') this.watch(); });
      });
    }, 2000);
  }

  snapshot(): Snapshot {
    if (this.current) return this.current;
    if (this.status === 'missing') throw new HostError('folder-missing', this.error ?? 'This planning folder was moved or deleted.');
    if (this.status === 'loading') throw new HostError('unavailable', 'The planning folder is still loading.');
    throw new HostError('folder-invalid', this.error ?? 'This planning folder cannot be read.');
  }
  private session() {
    if (!this.planning) throw new HostError('unavailable', 'The planning folder is still loading.');
    return this.planning;
  }

  document(relative: string) { return readDocument(this.root, relative); }
  diagrams(work: string): Promise<DiagramEntry[]> { return this.session().diagrams.list(this.snapshot(), work); }
  diagram(work: string, file: string) { return this.session().diagrams.prepared(this.snapshot(), work, file); }
  references(work: string | null, relative: string): Promise<DiagramReference[]> { return this.session().diagrams.references(this.snapshot(), work ?? undefined, relative); }

  /** Every diagram in the folder, for quick open. Computed on demand and reused until the folder changes. */
  diagramIndex(): Promise<DiagramIndexEntry[]> {
    if (this.diagramIndexCache?.revision === this.revision) return this.diagramIndexCache.entries;
    const entries = this.session().diagrams.index(this.snapshot());
    this.diagramIndexCache = { revision: this.revision, entries };
    return entries;
  }

  async recordView(event: ViewEventInput) {
    const planning = this.session();
    const snapshot = this.snapshot();
    const document = snapshot.documents.find(file => file.path === event.path);
    if (!document) throw new HostError('forbidden', 'This document is not in the open planning folder.');
    let revision: string | null = null;
    try { if (snapshot.gitAvailable) revision = (await run('git', ['-C', this.root, 'rev-parse', 'HEAD'], { windowsHide: true })).stdout.trim(); } catch { /* Unknown revision remains null. */ }
    const content = await readDocument(this.root, event.path);
    if (event.contentHash && content.contentHash !== event.contentHash) return;
    if (!planning.database || planning.projectId === null) return;
    recordView(planning.database, planning.projectId, { ...event, key: document.key, revision, contentHash: content.contentHash || null });
  }

  /** Stop watching. */
  close() {
    this.closed = true;
    this.stopWatching();
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    this.rescanTimer = null;
    if (this.missingTimer) clearInterval(this.missingTimer);
    this.missingTimer = null;
  }
}
