import { existsSync, readdirSync, readFileSync, statSync, realpathSync } from 'node:fs';
import path from 'node:path';
import atlas, { type AtlasDocument, type ViewerPayload } from 'ontouml-atlas';
const { createWorkspace, prepareViewer } = atlas;
import { PlanningError } from './planning.ts';
import type { Snapshot } from '../src/types.ts';
import { samePath } from '../src/links.ts';
type PlanningIndex = Pick<Snapshot, 'work' | 'documents'> & Partial<Pick<Snapshot, 'caseSensitivePaths' | 'normalizationInsensitivePaths'>>;

export interface AtlasEntry { handle: string; title: string; revision: string; profile: string; state: string; capturedAt: string | null; coverage: string | null; imported: boolean }
export class AtlasCatalog {
  private cache = new Map<string, Promise<ViewerPayload>>();
  private owners = new Map<string, string | undefined>();
  constructor(readonly root: string) {}
  private workspace() {
    if (!existsSync(path.join(this.root, '.atlas/models'))) throw new PlanningError('No Atlas models in this workspace.', 404);
    return createWorkspace(this.root);
  }
  private work(snapshot: PlanningIndex, work: string) {
    if (!snapshot.work.some(item => item.id === work)) throw new PlanningError('Choose an indexed work item.', 404);
  }
  list(snapshot: PlanningIndex, work: string) {
    this.work(snapshot, work);
    const directory = path.join(this.root, '.atlas/models');
    if (!existsSync(directory)) return { models: [] as AtlasEntry[], issues: [] as string[] };
    const workspace = this.workspace();
    const models: AtlasEntry[] = [], issues: string[] = [];
    for (const name of readdirSync(directory).filter(name => /^m-[a-f0-9]{24}\.json$/.test(name)).sort()) {
      const handle = name.slice(0, -5);
      try {
        const document = workspace.load(handle);
        this.owners.set(handle, document.workId);
        if (document.workId !== work) continue;
        const capture = document.snapshots.find(item => item.id === document.baselineId)?.capture;
        models.push({ handle, title: document.title, revision: document.revision.id, profile: document.profile, state: document.state, capturedAt: capture?.capturedAt ?? null, coverage: capture?.coverage.status ?? null, imported: !!document.imported });
      } catch {
        // The claimed work ID is used only to display a generic error, never to serve invalid content.
        let owner = this.owners.get(handle);
        try {
          const filename = path.join(directory, name);
          const relative = path.relative(realpathSync(this.root), realpathSync(filename));
          if (!owner && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep) && statSync(filename).size <= 1024 * 1024) owner = JSON.parse(readFileSync(filename, 'utf8')).workId;
        } catch { /* Unattributed malformed files cannot be served. */ }
        if (owner === work) issues.push(`Model ${handle} has an invalid or unrecorded update. The last valid view is retained.`);
      }
    }
    return { models, issues };
  }
  load(snapshot: PlanningIndex, work: string, handle: string): AtlasDocument {
    this.work(snapshot, work);
    let document: AtlasDocument;
    try { document = this.workspace().load(handle); }
    catch { throw new PlanningError('This model has an invalid update or is unavailable.', 409); }
    if (document.workId !== work) throw new PlanningError('This model belongs to another work item.', 403);
    return document;
  }
  async prepared(snapshot: PlanningIndex, work: string, handle: string) {
    const document = this.load(snapshot, work, handle);
    const key = handle + ':' + document.revision.id;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = prepareViewer({ document, includeArtifacts: false }).then(result => result.payload);
      this.cache.set(key, pending);
      if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
      pending.catch(() => this.cache.delete(key));
    }
    return pending;
  }
  references(snapshot: PlanningIndex, work: string, filename: string) {
    this.work(snapshot, work);
    const same = (first: string, second: string) => samePath(first, second, snapshot.caseSensitivePaths ?? true, snapshot.normalizationInsensitivePaths ?? false);
    if (!snapshot.documents.some(file => same(file.path, filename) && (file.workId === work || file.category === 'knowledge'))) throw new PlanningError('Choose an indexed work or knowledge document.', 403);
    return this.list(snapshot, work).models.flatMap(entry => {
      const document = this.load(snapshot, work, entry.handle);
      const records = document.context.records.filter(record => typeof record.path === 'string' && same(record.path, filename));
      return records.flatMap(record => document.context.links.filter(link => link.recordId === record.id).map(link => ({ handle: entry.handle, title: entry.title, elementId: link.elementId, label: String(record.title || record.kind), section: typeof record.section === 'string' ? record.section : null })));
    });
  }
}
