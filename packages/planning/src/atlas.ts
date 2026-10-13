import { existsSync, readdirSync, readFileSync, statSync, realpathSync } from 'node:fs';
import path from 'node:path';
import atlas, { type AtlasDocument, type ViewerPayload } from '@envsemble/atlas-diagrams';
const { createWorkspace, prepareViewer, prepareFamily, familyKey } = atlas;
import { PlanningError } from './planning.ts';
import type { Document, PlanningIndex as LoadedIndex } from './types.ts';
import { describeProvenance, type Provenance } from './provenance.ts';
import { resolveRecordPath, samePath, workRelative } from './paths.ts';

type IndexedWork = { id: string; path?: string };
type PlanningIndex = { work: IndexedWork[]; documents: Pick<Document, 'path' | 'workId' | 'category'>[] } & Partial<Pick<LoadedIndex, 'caseSensitivePaths' | 'normalizationInsensitivePaths'>>;
export interface ModelExplains { path: string | null; reference: string; section: string | null; title: string | null }
export interface AtlasEntry {
  handle: string; title: string; revision: string; profile: string; state: string; capturedAt: string | null; coverage: string | null; imported: boolean;
  provenance: Provenance; explains: ModelExplains[];
  /** Models laid out together share it: a capture and the proposals over its snapshot. Null for a model alone. */
  family: string | null;
}
/** A model's payload, with the payloads of the models laid out with it, so a client can switch among them without asking again. */
export type PreparedModel = ViewerPayload & { siblings?: { handle: string; payload: ViewerPayload }[] };
type Loaded = [handle: string, document: AtlasDocument];

/**
 * Families among a work folder's documents: a capture and every proposal over its snapshot, when
 * there is at least one proposal and more than one member. Each family's members by handle.
 */
export function modelFamilies(documents: Loaded[]): Map<string, Loaded[]> {
  const groups = new Map<string, Loaded[]>();
  for (const loaded of documents) {
    const key = familyKey(loaded[1]);
    if (key) groups.set(key, [...groups.get(key) ?? [], loaded]);
  }
  for (const [key, members] of groups) if (members.length < 2 || !members.some(([, document]) => document.state === 'proposal')) groups.delete(key);
  return groups;
}
export interface ModelReference {
  handle: string; workId: string; title: string; elementId: string | null; elementName: string | null;
  label: string; section: string | null; provenance: Provenance;
}
interface Location { root: string; directory: string }

const modelFile = /^m-[a-f0-9]{24}\.json$/;
const handlePattern = /^m-[a-f0-9]{24}$/;
const claimLimit = 1024 * 1024;

function inside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

// Names that only repeat what a relation is, which the diagram leaves off its lines too: every
// captured type use has the first, and OntoUML gives the second to relations without a name.
const genericRelationNames = new Set(['declared type use', 'association']);

/**
 * Element id → display name, for structural models and OntoUML exchange projects. A relation
 * whose name says nothing more than its kind (a captured type use, or no name) reads as its two
 * ends, "CheckoutService → PaymentMethodVault"; any other name, such as a foreign key's
 * constraint name, is kept, as the diagram labels it. Unnamed inheritance reads
 * "Customer inherits Person".
 */
export function elementNames(model: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const records: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string' && !names.has(record.id)) {
      records.push(record);
      const name = typeof record.name === 'string' ? record.name : record.name && typeof record.name === 'object' ? Object.values(record.name as Record<string, unknown>).find(item => typeof item === 'string') : undefined;
      if (typeof name === 'string' && name.trim()) names.set(record.id, name.trim());
    }
    for (const child of Object.values(record)) if (child && typeof child === 'object') visit(child, depth + 1);
  };
  visit(model, 0);
  // References are identities, or objects carrying one.
  const refId = (value: unknown) => typeof value === 'string' ? value : value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' ? (value as { id: string }).id : undefined;
  const nameOf = (id: unknown) => { const key = refId(id); return key ? names.get(key) : undefined; };
  // OntoUML relations list their ends as properties typed with the classes they join.
  const endTypes = new Map(records.filter(record => record.type === 'Property' && refId(record.propertyType)).map(record => [record.id as string, refId(record.propertyType)!]));
  for (const record of records) {
    const id = record.id as string, own = names.get(id);
    let ends: [unknown, unknown] | null = null, verb = '→';
    if (typeof record.sourceId === 'string' && typeof record.targetId === 'string') {
      if (!own || genericRelationNames.has(own.toLowerCase())) ends = [record.sourceId, record.targetId];
    } else if (typeof record.specificId === 'string' && typeof record.generalId === 'string') {
      if (!own) { ends = [record.specificId, record.generalId]; verb = record.realization ? 'implements' : 'inherits'; }
    } else if (record.type === 'BinaryRelation' && Array.isArray(record.properties)) {
      if (!own || genericRelationNames.has(own.toLowerCase())) ends = [endTypes.get(refId(record.properties[0]) ?? ''), endTypes.get(refId(record.properties[1]) ?? '')];
    } else if (record.type === 'Generalization') {
      if (!own) { ends = [record.specific, record.general]; verb = 'inherits'; }
    }
    const [source, target] = ends ? ends.map(nameOf) : [];
    if (source && target) names.set(id, `${source} ${verb} ${target}`);
  }
  return names;
}

/**
 * Atlas models live with their plan: each work folder is an Atlas workspace
 * (`<work>/.atlas/models`). A model without a work ID belongs to the folder it is in;
 * a model assigned to another work item is reported, never served.
 */
export class AtlasCatalog {
  private cache = new Map<string, Promise<ViewerPayload>>();
  private families = new Map<string, Promise<Map<string, ViewerPayload>>>();
  private owners = new Map<string, string | undefined>();
  readonly planningRoot: string;
  constructor(planningRoot: string) { this.planningRoot = planningRoot; }

  private work(snapshot: PlanningIndex, id: string) {
    const work = snapshot.work.find(item => item.id === id);
    if (!work) throw new PlanningError('Choose an indexed work item.', 404);
    return work;
  }
  private same(snapshot: PlanningIndex) {
    return (first: string, second: string) => samePath(first, second, snapshot.caseSensitivePaths ?? true, snapshot.normalizationInsensitivePaths ?? false);
  }
  /** The work folder's model directory, when it exists inside the planning folder. */
  private location(work: IndexedWork): Location | null {
    if (!work.path) return null;
    const root = path.resolve(this.planningRoot, work.path);
    const directory = path.join(root, '.atlas', 'models');
    try {
      if (!existsSync(directory)) return null;
      const planning = realpathSync(this.planningRoot), actualRoot = realpathSync(root), actual = realpathSync(directory);
      if (inside(planning, actualRoot) && actualRoot !== planning && inside(actualRoot, actual)) return { root, directory };
    } catch { /* An unreadable work folder has no diagrams. */ }
    return null;
  }
  private handles(directory: string) {
    try { return readdirSync(directory).filter(name => modelFile.test(name)).sort().map(name => name.slice(0, -5)); }
    catch { return []; }
  }
  private belongs(document: AtlasDocument, work: IndexedWork) {
    return !document.workId || document.workId === work.id;
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
  private entry(handle: string, document: AtlasDocument, work: IndexedWork, snapshot: PlanningIndex, family: string | null): AtlasEntry {
    const capture = document.snapshots.find(item => item.id === document.baselineId)?.capture;
    return {
      handle, title: document.title, revision: document.revision.id, profile: document.profile, state: document.state,
      capturedAt: capture?.capturedAt ?? null, coverage: capture?.coverage.status ?? null, imported: !!document.imported,
      provenance: describeProvenance(document), explains: this.explains(document, work, snapshot), family,
    };
  }

  list(snapshot: PlanningIndex, workId: string) {
    const work = this.work(snapshot, workId);
    const models: AtlasEntry[] = [], issues: string[] = [], invalidHandles: string[] = [];
    const location = this.location(work);
    if (!location) return { models, issues, invalidHandles };
    const loaded: Loaded[] = [];
    let workspace: ReturnType<typeof createWorkspace> | null = null;
    for (const handle of this.handles(location.directory)) {
      try {
        workspace ??= createWorkspace(location.root);
        const document = workspace.load(handle);
        this.owners.set(location.directory + '\0' + handle, document.workId);
        if (!this.belongs(document, work)) { issues.push(`Model “${document.title}” in this work folder is assigned to ${document.workId}.`); continue; }
        loaded.push([handle, document]);
      } catch {
        // The claimed work ID is used only to display a generic error, never to serve invalid content.
        const owner = this.claimedOwner(location, handle);
        if (owner === work.id || owner === undefined) {
          invalidHandles.push(handle);
          issues.push(`Model ${handle} has an invalid or unrecorded update. The last valid view is retained.`);
        }
      }
    }
    const families = modelFamilies(loaded);
    for (const [handle, document] of loaded) {
      const family = familyKey(document);
      models.push(this.entry(handle, document, work, snapshot, family && families.has(family) ? family : null));
    }
    return { models, issues, invalidHandles };
  }

  private find(snapshot: PlanningIndex, workId: string, handle: string): { document: AtlasDocument; location: Location; work: IndexedWork } {
    const work = this.work(snapshot, workId);
    if (!handlePattern.test(handle)) throw new PlanningError('Choose an Atlas model.', 400);
    const location = this.location(work);
    if (!location || !existsSync(path.join(location.directory, handle + '.json'))) throw new PlanningError('This model has an invalid update or is unavailable.', 404);
    let document: AtlasDocument;
    try { document = createWorkspace(location.root).load(handle); }
    catch { throw new PlanningError('This model has an invalid update or is unavailable.', 409); }
    if (!this.belongs(document, work)) throw new PlanningError('This model belongs to another work item.', 403);
    return { document, location, work };
  }
  load(snapshot: PlanningIndex, workId: string, handle: string): AtlasDocument {
    return this.find(snapshot, workId, handle).document;
  }
  /** The valid models of the work item laid out with this one, itself included, by handle; null for a model alone. */
  private family(location: Location, work: IndexedWork, handle: string, document: AtlasDocument): Loaded[] | null {
    const key = familyKey(document);
    if (!key) return null;
    const workspace = createWorkspace(location.root);
    const loaded: Loaded[] = [];
    for (const other of this.handles(location.directory)) {
      if (other === handle) { loaded.push([handle, document]); continue; }
      try {
        const candidate = workspace.load(other);
        if (this.belongs(candidate, work) && familyKey(candidate) === key) loaded.push([other, candidate]);
      } catch { /* An invalid update is not served, so it lays out with no one. */ }
    }
    return modelFamilies(loaded).get(key) ?? null;
  }
  /**
   * A model's viewer payload. A capture or proposal in a family comes with its siblings' payloads,
   * all from one layout, so a client switches among them without another request.
   */
  async prepared(snapshot: PlanningIndex, workId: string, handle: string): Promise<PreparedModel> {
    const { document, location, work } = this.find(snapshot, workId, handle);
    const family = this.family(location, work, handle, document);
    if (family) {
      const key = location.directory + '\0' + family.map(([member, loaded]) => member + ':' + loaded.revision.id).join(',');
      let pending = this.families.get(key);
      if (!pending) {
        pending = prepareFamily({ documents: family.map(([, loaded]) => loaded), includeArtifacts: false })
          .then(result => new Map(family.map(([member], index) => [member, result.members[index].payload])));
        this.families.set(key, pending);
        if (this.families.size > 4) this.families.delete(this.families.keys().next().value!);
        pending.catch(() => this.families.delete(key));
      }
      const payloads = await pending;
      return { ...payloads.get(handle)!, siblings: family.filter(([member]) => member !== handle).map(([member]) => ({ handle: member, payload: payloads.get(member)! })) };
    }
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
    const results: ModelReference[] = [];
    for (const work of targets) {
      const location = this.location(work);
      if (!location) continue;
      let workspace: ReturnType<typeof createWorkspace> | null = null;
      for (const handle of this.handles(location.directory)) {
        let document: AtlasDocument;
        try { workspace ??= createWorkspace(location.root); document = workspace.load(handle); } catch { continue; }
        if (!this.belongs(document, work)) continue;
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
      }
    }
    return results;
  }

  /** Model counts per work item for list indicators. */
  counts(snapshot: PlanningIndex): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const work of snapshot.work) {
      const location = this.location(work);
      const total = location ? this.handles(location.directory).length : 0;
      if (total) counts[work.id] = total;
    }
    return counts;
  }
}
