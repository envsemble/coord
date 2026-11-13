// One open planning folder: its reader, the last good snapshot, and the watcher that
// keeps it current. The host keeps one OpenProject per folder that a client has open, and
// answers every request about that folder from it.
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { readDocument, readText, workStatistics, writeDocument, type HomeDatabase } from '../../planning/index.ts';
import { buildPage } from '../../planning/pages/pages.ts';
import { callTool } from '../../cli/commands/mcp.ts';
import { PlanningReader } from '../../planning/reading/reader.ts';
import type { DiagramEntry, DiagramIndexEntry, DiagramReference, OpenProjectState, PageBuild, ProjectStatus, Snapshot, ToolOutcome } from '../contract.ts';
import { HostError, type Logger } from '../errors.ts';
import { watchFolder, type FolderWatcher } from './folderWatcher.ts';

const skippedFolders = new Set(['node_modules', '__pycache__', 'dist', 'build']);
const folderLimit = 20000;

/** Every visible folder under the root, as the explorer shows it (dot folders and build output hidden). */
async function listFolders(root: string): Promise<string[]> {
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

export interface OpenProjectOptions { projectId: string; database: HomeDatabase | null; log: Logger; onChange(state: OpenProjectState): void; watchDelay?: { debounce: number; maxWait: number } }

export class OpenProject {
  readonly root: string;
  readonly name: string;
  status: ProjectStatus = 'loading';
  error: string | null = null;
  notice: string | null = null;
  revision = 0;
  /** The revision at which the folder's files were last read; a later revision changed only statistics or handoffs. */
  files = 0;
  private watchFailures: number[] = [];
  private rescanTimer: ReturnType<typeof setInterval> | null = null;
  private current: Snapshot | null = null;
  private planningReader: PlanningReader | null = null;
  private watcher: FolderWatcher | null = null;
  private missingTimer: ReturnType<typeof setInterval> | null = null;
  private loading: Promise<void> | null = null;
  private again = false;
  private closed = false;
  private diagramIndexCache: { revision: number; entries: Promise<DiagramIndexEntry[]> } | null = null;
  private readonly options: OpenProjectOptions;

  constructor(root: string, options: OpenProjectOptions) {
    this.root = root;
    this.name = path.basename(root) || root;
    this.options = options;
  }

  get projectId() { return this.options.projectId; }
  state(): OpenProjectState {
    return { projectId: this.options.projectId, name: this.name, status: this.status, error: this.error, notice: this.notice, revision: this.revision, files: this.files };
  }

  async start() {
    this.planningReader = await PlanningReader.open(this.root, { database: this.options.database });
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
    const planning = this.planningReader;
    if (!planning || this.closed) return;
    const started = performance.now();
    try {
      // The folders are listed while the index is read: they are the same through the root's real path.
      const listing = listFolders(this.root);
      const index = await planning.index(true);
      let counts: Record<string, number> = {};
      try { counts = planning.diagrams.counts(index); } catch { /* Counts are an indicator only. */ }
      const folders = await listing;
      this.current = { ...index, work: index.work.map(item => ({ ...item, diagrams: counts[item.id] ?? 0 })), folders };
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
    this.files = ++this.revision;
    this.diagramIndexCache = null;
    this.emit();
  }

  /**
   * Reports were recorded: the work's statistics from the home database, without
   * reading the folder again. A read under way reads them anyway.
   */
  async refreshStatistics() {
    const current = this.current, database = this.planningReader?.database;
    if (!current || !database || this.loading || this.closed) return;
    try {
      const statistics = await workStatistics(this.root, current.work, { database });
      if (this.current !== current || this.closed) return;
      // Reports of other projects change nothing here: no event.
      if (JSON.stringify(current.work.map(item => statistics[item.id])) === JSON.stringify(current.work.map(item => item.statistics))) return;
      this.current = { ...current, work: current.work.map(item => ({ ...item, statistics: statistics[item.id] })) };
      this.revision++;
      this.emit();
    } catch (error) { this.options.log.warn('Work statistics unreadable', { root: this.root, error: error instanceof Error ? error.message : String(error) }); }
  }

  /** What the snapshot shows besides the folder changed (its work's handoffs elsewhere): clients read it again. */
  touch() {
    if (!this.current || this.closed) return;
    this.revision++;
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
  private reader() {
    if (!this.planningReader) throw new HostError('unavailable', 'The planning folder is still loading.');
    return this.planningReader;
  }

  document(relative: string) { return readDocument(this.root, relative); }
  /** Build a page, by its folder in the planning folder. */
  async page(relative: string): Promise<PageBuild> {
    const folder = path.resolve(this.root, relative);
    if (!(await exists(folder))) throw new HostError('not-found', 'This page is not in the planning folder any more.');
    return buildPage(this.root, folder);
  }
  /** A file as text, for a page. */
  readText(relative: string) { return readText(this.root, relative); }
  /** Write a file a page asked for (its choices, its data). The watcher then reports the change. */
  write(relative: string, content: string) { return writeDocument(this.root, relative, content); }
  /** Run an Atlas tool for a page, in this planning folder. */
  async tool(name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
    const result = await callTool(name, { ...input, planningFolder: this.root, cwd: this.root });
    const text = result.content.map(item => item.text).join('\n');
    return 'isError' in result && result.isError ? { ok: false, error: text } : { ok: true, value: 'structuredContent' in result ? result.structuredContent : text };
  }
  diagrams(work: string): Promise<DiagramEntry[]> { return this.reader().diagrams.list(this.snapshot(), work); }
  diagram(work: string, file: string) { return this.reader().diagrams.prepared(this.snapshot(), work, file); }
  arrangement(work: string, file: string) { return this.reader().diagrams.arrangement(this.snapshot(), work, file); }
  arrange(work: string, file: string, positions: Record<string, [number, number]> | null) { return this.reader().diagrams.arrange(this.snapshot(), work, file, positions); }
  references(work: string | null, relative: string): Promise<DiagramReference[]> { return this.reader().diagrams.references(this.snapshot(), work ?? undefined, relative); }

  /** Every diagram in the folder, for quick open. Computed on demand and reused until the folder changes. */
  diagramIndex(): Promise<DiagramIndexEntry[]> {
    if (this.diagramIndexCache?.revision === this.files) return this.diagramIndexCache.entries;
    const entries = this.reader().diagrams.index(this.snapshot());
    this.diagramIndexCache = { revision: this.files, entries };
    return entries;
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
