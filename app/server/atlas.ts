import { existsSync, readdirSync, readFileSync, statSync, realpathSync } from 'node:fs';
import path from 'node:path';
import atlas, { type AtlasDocument, type ViewerPayload } from 'ontouml-atlas';
const { createWorkspace, prepareViewer } = atlas;
import { PlanningError } from './planning.ts';
import type { Snapshot } from '../src/types.ts';
import { samePath } from '../src/links.ts';
import { describeProvenance, type Provenance } from '../src/provenance.ts';
import { resolveRecordPath, workRelative } from '../src/modelPaths.ts';

type IndexedWork = { id: string; path?: string };
type PlanningIndex = { work: IndexedWork[]; documents: Pick<Snapshot['documents'][number], 'path' | 'workId' | 'category'>[] } & Partial<Pick<Snapshot, 'caseSensitivePaths' | 'normalizationInsensitivePaths'>>;
export type ModelSource = 'work' | 'legacy';
export interface ModelExplains { path: string | null; reference: string; section: string | null; title: string | null }
export interface AtlasEntry {
  handle: string; title: string; revision: string; profile: string; state: string; capturedAt: string | null; coverage: string | null; imported: boolean;
  source: ModelSource; provenance: Provenance; explains: ModelExplains[];
}
export interface ModelReference {
  handle: string; workId: string; title: string; elementId: string | null; elementName: string | null;
  label: string; section: string | null; provenance: Provenance;
}
interface Location { root: string; directory: string; source: ModelSource }

const modelFile = /^m-[a-f0-9]{24}\.json$/;
const handlePattern = /^m-[a-f0-9]{24}$/;
const claimLimit = 1024 * 1024;
const countLimit = 16 * 1024 * 1024;

function inside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

/** Element id → display name, for structural models and OntoUML exchange projects. */
function elementNames(model: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string' && !names.has(record.id)) {
      const name = typeof record.name === 'string' ? record.name : record.name && typeof record.name === 'object' ? Object.values(record.name as Record<string, unknown>).find(item => typeof item === 'string') : undefined;
      if (typeof name === 'string' && name.trim()) names.set(record.id, name.trim());
    }
    for (const child of Object.values(record)) if (child && typeof child === 'object') visit(child, depth + 1);
  };
  visit(model, 0);
  return names;
}

/**
 * Atlas models are discovered per work item: each work folder is an Atlas workspace
 * (`<work>/.atlas/models`). Models in the legacy planning-root workspace remain readable,
 * filtered by `workId`. A handle present in both is served from the work folder.
 */
export class AtlasCatalog {
  private cache = new Map<string, Promise<ViewerPayload>>();
  private owners = new Map<string, string | undefined>();
  private claims = new Map<string, { stamp: string; workId: string | undefined }>();
  readonly legacyRoot: string;
  constructor(readonly planningRoot: string, legacyRoot?: string) { this.legacyRoot = legacyRoot ?? planningRoot; }

  private work(snapshot: PlanningIndex, id: string) {
    const work = snapshot.work.find(item => item.id === id);
    if (!work) throw new PlanningError('Choose an indexed work item.', 404);
    return work;
  }
  private same(snapshot: PlanningIndex) {
    return (first: string, second: string) => samePath(first, second, snapshot.caseSensitivePaths ?? true, snapshot.normalizationInsensitivePaths ?? false);
  }
  /** Existing, contained model directories: the work folder first, then the legacy root. */
  private locations(work: IndexedWork | null): Location[] {
    const result: Location[] = [];
    let workFolder: string | null = null;
    if (work?.path) {
      const root = path.resolve(this.planningRoot, work.path);
      const directory = path.join(root, '.atlas', 'models');
      try {
        if (existsSync(directory)) {
          const planning = realpathSync(this.planningRoot), actualRoot = realpathSync(root), actual = realpathSync(directory);
          if (inside(planning, actualRoot) && actualRoot !== planning && inside(actualRoot, actual)) { result.push({ root, directory, source: 'work' }); workFolder = actualRoot; }
        }
      } catch { /* An unreadable work folder has no diagrams. */ }
    }
    const legacy = this.legacyLocation();
    if (legacy && legacy.real !== workFolder) result.push(legacy.location);
    return result;
  }
  private legacyLocation(): { location: Location; real: string } | null {
    const directory = path.join(this.legacyRoot, '.atlas', 'models');
    try {
      if (!existsSync(directory)) return null;
      const real = realpathSync(this.legacyRoot);
      if (!inside(real, realpathSync(directory))) return null;
      return { location: { root: this.legacyRoot, directory, source: 'legacy' }, real };
    } catch { return null; }
  }
  private handles(directory: string) {
    try { return readdirSync(directory).filter(name => modelFile.test(name)).sort().map(name => name.slice(0, -5)); }
    catch { return []; }
  }
  private belongs(document: AtlasDocument, work: IndexedWork, source: ModelSource) {
    return source === 'work' ? !document.workId || document.workId === work.id : document.workId === work.id;
  }
  /** The work ID a malformed file claims, read only from a contained, bounded file. */
  private claimedOwner(location: Location, handle: string) {
    const key = location.directory + '\0' + handle;
    let owner = this.owners.get(key);
    if (owner) return owner;
    try {
      const filename = path.join(location.directory, handle + '.json');
      if (inside(realpathSync(location.root), realpathSync(filename)) && statSync(filename).size <= claimLimit) owner = JSON.parse(readFileSync(filename, 'utf8')).workId;
    } catch { /* Unattributed malformed files cannot be served. */ }
    return typeof owner === 'string' ? owner : undefined;
  }
  private explains(document: AtlasDocument, work: IndexedWork, snapshot: PlanningIndex): ModelExplains[] {
    const same = this.same(snapshot);
    const seen = new Set<string>();
    const result: ModelExplains[] = [];
    for (const record of document.context.records) {
      if (typeof record.path !== 'string') continue;
      const resolved = resolveRecordPath(record.path, work.path, snapshot.documents, same);
      const section = typeof record.section === 'string' && record.section.trim() ? record.section.trim() : null;
      const reference = resolved ? workRelative(resolved.path, work.path) : record.path;
      const key = reference + '\0' + section;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ path: resolved?.path ?? null, reference, section, title: typeof record.title === 'string' ? record.title : null });
    }
    return result;
  }
  private entry(handle: string, document: AtlasDocument, location: Location, work: IndexedWork, snapshot: PlanningIndex): AtlasEntry {
    const capture = document.snapshots.find(item => item.id === document.baselineId)?.capture;
    return {
      handle, title: document.title, revision: document.revision.id, profile: document.profile, state: document.state,
      capturedAt: capture?.capturedAt ?? null, coverage: capture?.coverage.status ?? null, imported: !!document.imported,
      source: location.source, provenance: describeProvenance(document), explains: this.explains(document, work, snapshot),
    };
  }

  list(snapshot: PlanningIndex, workId: string) {
    const work = this.work(snapshot, workId);
    const models: AtlasEntry[] = [], issues: string[] = [], invalidHandles: string[] = [];
    const seen = new Set<string>();
    for (const location of this.locations(work)) {
      let workspace: ReturnType<typeof createWorkspace> | null = null;
      for (const handle of this.handles(location.directory)) {
        if (seen.has(handle)) continue;
        try {
          workspace ??= createWorkspace(location.root);
          const document = workspace.load(handle);
          this.owners.set(location.directory + '\0' + handle, document.workId);
          if (!this.belongs(document, work, location.source)) {
            if (location.source === 'work') issues.push(`Model “${document.title}” in this work folder is assigned to ${document.workId}.`);
            continue;
          }
          seen.add(handle);
          models.push(this.entry(handle, document, location, work, snapshot));
        } catch {
          // The claimed work ID is used only to display a generic error, never to serve invalid content.
          const owner = this.claimedOwner(location, handle);
          if (owner === work.id || (location.source === 'work' && owner === undefined)) {
            seen.add(handle);
            invalidHandles.push(handle);
            issues.push(`Model ${handle} has an invalid or unrecorded update. The last valid view is retained.`);
          }
        }
      }
    }
    return { models, issues, invalidHandles };
  }

  private find(snapshot: PlanningIndex, workId: string, handle: string): { document: AtlasDocument; location: Location } {
    const work = this.work(snapshot, workId);
    if (!handlePattern.test(handle)) throw new PlanningError('Choose an Atlas model.', 400);
    for (const location of this.locations(work)) {
      if (!existsSync(path.join(location.directory, handle + '.json'))) continue;
      let document: AtlasDocument;
      try { document = createWorkspace(location.root).load(handle); }
      catch { throw new PlanningError('This model has an invalid update or is unavailable.', 409); }
      if (!this.belongs(document, work, location.source)) throw new PlanningError('This model belongs to another work item.', 403);
      return { document, location };
    }
    throw new PlanningError('This model has an invalid update or is unavailable.', 404);
  }
  load(snapshot: PlanningIndex, workId: string, handle: string): AtlasDocument {
    return this.find(snapshot, workId, handle).document;
  }
  async prepared(snapshot: PlanningIndex, workId: string, handle: string) {
    const { document, location } = this.find(snapshot, workId, handle);
    const key = location.directory + '\0' + handle + ':' + document.revision.id;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = prepareViewer({ document, includeArtifacts: false }).then(result => result.payload);
      this.cache.set(key, pending);
      if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
      pending.catch(() => this.cache.delete(key));
    }
    return pending;
  }

  /** Models whose context records resolve to an indexed document, one entry per linked element. */
  references(snapshot: PlanningIndex, workId: string | undefined, filename: string): ModelReference[] {
    const same = this.same(snapshot);
    if (!workId) {
      if (!snapshot.documents.some(file => same(file.path, filename) && file.category === 'knowledge')) throw new PlanningError('Choose an indexed shared knowledge document.', 403);
    } else {
      this.work(snapshot, workId);
      if (!snapshot.documents.some(file => same(file.path, filename) && (file.workId === workId || file.category === 'knowledge'))) throw new PlanningError('Choose an indexed work or knowledge document.', 403);
    }
    const targets = workId ? [this.work(snapshot, workId)] : snapshot.work;
    const registered = new Map(snapshot.work.map(item => [item.id, item]));
    const results: ModelReference[] = [];
    const served = new Map<string, Set<string>>();
    const collect = (handle: string, document: AtlasDocument, work: IndexedWork) => {
      const names = elementNames(document.model);
      const provenance = describeProvenance(document);
      for (const record of document.context.records) {
        const resolved = resolveRecordPath(record.path, work.path, snapshot.documents, same);
        if (!resolved || !same(resolved.path, filename)) continue;
        const links = document.context.links.filter(link => link.recordId === record.id);
        const base = { handle, workId: work.id, title: document.title, label: String(record.title || record.kind), section: typeof record.section === 'string' ? record.section : null, provenance };
        if (!links.length) results.push({ ...base, elementId: null, elementName: null });
        for (const link of links) results.push({ ...base, elementId: link.elementId, elementName: names.get(link.elementId) ?? null });
      }
    };
    for (const work of targets) {
      const location = this.locations(work).find(item => item.source === 'work');
      if (!location) continue;
      const handles = new Set<string>();
      served.set(work.id, handles);
      let workspace: ReturnType<typeof createWorkspace> | null = null;
      for (const handle of this.handles(location.directory)) {
        let document: AtlasDocument;
        try { workspace ??= createWorkspace(location.root); document = workspace.load(handle); } catch { continue; }
        if (!this.belongs(document, work, 'work')) continue;
        handles.add(handle);
        collect(handle, document, work);
      }
    }
    const legacy = this.legacyLocation()?.location;
    if (legacy) {
      let workspace: ReturnType<typeof createWorkspace> | null = null;
      for (const handle of this.handles(legacy.directory)) {
        let document: AtlasDocument;
        try { workspace ??= createWorkspace(legacy.root); document = workspace.load(handle); } catch { continue; }
        const owner = document.workId ? registered.get(document.workId) : undefined;
        // The work folder's copy of a handle wins over the legacy one.
        if (!owner || (workId && owner.id !== workId) || served.get(owner.id)?.has(handle)) continue;
        collect(handle, document, owner);
      }
    }
    return results;
  }

  /** Model counts per work item for list indicators. Reads only the claimed workId of legacy files. */
  counts(snapshot: PlanningIndex): Record<string, number> {
    const counts: Record<string, number> = {};
    const workHandles = new Map<string, Set<string>>();
    for (const work of snapshot.work) {
      const location = this.locations(work).find(item => item.source === 'work');
      const handles = new Set(location ? this.handles(location.directory) : []);
      workHandles.set(work.id, handles);
      if (handles.size) counts[work.id] = handles.size;
    }
    const legacy = this.legacyLocation()?.location;
    if (legacy) {
      for (const handle of this.handles(legacy.directory)) {
        const owner = this.legacyClaim(legacy, handle);
        if (!owner || !workHandles.has(owner) || workHandles.get(owner)!.has(handle)) continue;
        counts[owner] = (counts[owner] ?? 0) + 1;
      }
    }
    return counts;
  }
  private legacyClaim(location: Location, handle: string) {
    const filename = path.join(location.directory, handle + '.json');
    try {
      const information = statSync(filename);
      const stamp = information.mtimeMs + ':' + information.size;
      const cached = this.claims.get(filename);
      if (cached?.stamp === stamp) return cached.workId;
      let workId: string | undefined;
      if (information.size <= countLimit && inside(realpathSync(location.root), realpathSync(filename))) {
        const value = JSON.parse(readFileSync(filename, 'utf8')).workId;
        workId = typeof value === 'string' ? value : undefined;
      }
      this.claims.set(filename, { stamp, workId });
      return workId;
    } catch { return undefined; }
  }
}
