// A work item's diagrams: every `.puml` file in its folder (outside hidden and build folders, as the
// planning index lists them), described with their roles, families and problems, and prepared for
// the viewer. A diagram is identified by its path in the work folder. Plans link diagrams with
// ordinary Markdown links (see diagramLinks.ts).
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import atlas, { type DiagramFile, type DiagramProblem, type DiagramSummary, type ViewerPayload } from '@envsemble/atlas-diagrams';
import { PlanningError, readDocument, resolveDocument } from './planning.ts';
import { describeProvenance, type CaptureSource, type Provenance } from './provenance.ts';
import { samePath, workRelative } from './paths.ts';
import type { Document, PlanningIndex as LoadedIndex } from './types.ts';

type IndexedWork = { id: string; path?: string };
type PlanningIndex = { work: IndexedWork[]; documents: Pick<Document, 'path' | 'workId' | 'category'>[] } & Partial<Pick<LoadedIndex, 'caseSensitivePaths' | 'normalizationInsensitivePaths'>>;

export interface DiagramEntry {
  /** Its path in the work folder, which identifies it. */
  path: string;
  title: string;
  kind: DiagramSummary['kind'];
  role: DiagramSummary['role'];
  profile: string | null;
  /** What it is compared with: a proposal's baseline, or the earlier capture a capture compares with. */
  baseline: string | null;
  /** The diagram its family is laid out around; the members of one family switch in place. Null for a diagram alone. */
  family: string | null;
  /** The class diagram a scenario exemplifies. */
  scenarioOf: string | null;
  capturedAt: string | null;
  coverage: string | null;
  provenance: Provenance;
  /** Its problems, each at a line and column. A diagram with errors cannot be drawn. */
  problems: DiagramProblem[];
  valid: boolean;
  /** A digest of the file, which changes whenever it does. */
  revision: string;
}
/** A diagram's payload, with the payloads of the rest of its family, laid out together. */
export type PreparedDiagram = ViewerPayload & { siblings?: { path: string; payload: ViewerPayload }[] };
/** A diagram a document links to, under its `section` heading, with the element its link names. */
export interface DiagramReference { workId: string; path: string; title: string; provenance: Provenance; section: string | null; element: string | null }
export interface DiagramIndexEntry { workId: string; path: string; title: string; provenance: Provenance }

/** Diagram files larger than this are listed with a problem and not read. */
const fileLimit = 4 * 1024 * 1024;
export const isDiagram = (file: string) => /\.puml$/i.test(file);
const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** The capture a diagram's provenance names: its own, or the nearest one its baselines lead to. */
function captureOf(summary: DiagramSummary, byPath: Map<string, DiagramSummary>): CaptureSource | null {
  const seen = new Set<string>();
  for (let at: DiagramSummary | undefined = summary; at && !seen.has(at.path); at = at.baseline ? byPath.get(at.baseline) : undefined) {
    if (at.capture) return at.capture;
    seen.add(at.path);
  }
  return null;
}

/** Describes a work folder's diagram files for the catalog. */
export function describeFiles(files: DiagramFile[], oversized: string[] = []): DiagramEntry[] {
  const summaries = atlas.describeDiagrams(files);
  const byPath = new Map(summaries.map(summary => [summary.path, summary]));
  const texts = new Map(files.map(file => [file.path, file.text]));
  const entries: DiagramEntry[] = summaries.map(summary => ({
    path: summary.path, title: summary.title, kind: summary.kind, role: summary.role, profile: summary.profile,
    baseline: summary.baseline, family: summary.family, scenarioOf: summary.scenario?.of ?? null,
    capturedAt: summary.capture?.capturedAt ?? null, coverage: summary.capture?.coverage.status ?? null,
    provenance: describeProvenance({ role: summary.role, profile: summary.profile, capture: captureOf(summary, byPath) }),
    problems: summary.problems, valid: summary.valid, revision: digest(texts.get(summary.path) ?? ''),
  }));
  for (const file of oversized) {
    entries.push({
      path: file, title: file.replace(/^.*\//, '').replace(/\.[^.]*$/, ''), kind: null, role: 'diagram', profile: null, baseline: null, family: null, scenarioOf: null,
      capturedAt: null, coverage: null, provenance: describeProvenance(null), valid: false, revision: '',
      problems: [{ line: 1, column: 1, code: 'TOO_LARGE', message: `This file is larger than ${fileLimit / 1048576} MB, too large to be a diagram.`, severity: 'error', path: file }],
    });
  }
  return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

interface Read { files: DiagramFile[]; oversized: string[]; key: string }

/** The diagrams of a planning folder's work items. Descriptions and layouts are kept per content, so a change to any file is seen at once. */
export class DiagramCatalog {
  private described = new Map<string, DiagramEntry[]>();
  private layouts = new Map<string, Promise<Map<string, ViewerPayload>>>();
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
  /** The work item's diagram files, read from inside the planning folder. */
  private async read(snapshot: PlanningIndex, work: IndexedWork): Promise<Read> {
    const files: DiagramFile[] = [], oversized: string[] = [];
    for (const document of snapshot.documents) {
      if (document.workId !== work.id || !isDiagram(document.path)) continue;
      const relative = workRelative(document.path, work.path);
      try {
        const filename = await resolveDocument(this.planningRoot, document.path);
        if ((await stat(filename)).size > fileLimit) { oversized.push(relative); continue; }
        files.push({ path: relative, text: await readFile(filename, 'utf8') });
      } catch { /* A file removed since the index was read is no longer listed. */ }
    }
    const key = work.id + '\0' + [...files.map(file => file.path + ':' + digest(file.text)), ...oversized].join('\0');
    return { files, oversized, key };
  }
  private describe(read: Read) {
    let entries = this.described.get(read.key);
    if (!entries) {
      entries = describeFiles(read.files, read.oversized);
      this.described.set(read.key, entries);
      if (this.described.size > 32) this.described.delete(this.described.keys().next().value!);
    }
    return entries;
  }

  /** A work item's diagrams, by path. */
  async list(snapshot: PlanningIndex, workId: string): Promise<DiagramEntry[]> {
    return this.describe(await this.read(snapshot, this.work(snapshot, workId)));
  }

  /**
   * A diagram's viewer payload. A member of a family comes with the payloads of the others, from one
   * layout, so a client switches among them without asking again.
   */
  async prepared(snapshot: PlanningIndex, workId: string, diagram: string): Promise<PreparedDiagram> {
    const read = await this.read(snapshot, this.work(snapshot, workId));
    const entry = this.describe(read).find(item => item.path === diagram);
    if (!entry) throw new PlanningError('This diagram is not in the work folder.', 404);
    if (!entry.valid) throw new PlanningError('This diagram has problems and cannot be drawn.', 409);
    const root = entry.family ?? entry.path;
    const key = read.key + '\0' + root;
    let pending = this.layouts.get(key);
    if (!pending) {
      pending = atlas.prepareDiagrams({ files: read.files, paths: [root] })
        .then(({ prepared }) => new Map([...prepared].map(([path, viewer]) => [path, viewer.payload])));
      this.layouts.set(key, pending);
      if (this.layouts.size > 8) this.layouts.delete(this.layouts.keys().next().value!);
      pending.catch(() => this.layouts.delete(key));
    }
    let payloads: Map<string, ViewerPayload>;
    try { payloads = await pending; }
    catch (error) { throw new PlanningError('This diagram cannot be drawn: ' + (error instanceof Error ? error.message.split('\n')[0] : 'unknown error'), 409); }
    const own = payloads.get(diagram);
    if (!own) throw new PlanningError('This diagram cannot be drawn.', 409);
    const siblings = [...payloads].filter(([path]) => path !== diagram).map(([path, payload]) => ({ path, payload }));
    return siblings.length ? { ...own, siblings } : own;
  }

  /** The diagrams a document links to, each under the heading its link sits under. */
  async references(snapshot: PlanningIndex, workId: string | undefined, filename: string): Promise<DiagramReference[]> {
    const same = this.same(snapshot);
    const document = snapshot.documents.find(file => same(file.path, filename));
    if (!workId) {
      if (document?.category !== 'knowledge') throw new PlanningError('Choose an indexed shared knowledge document.', 403);
    } else {
      this.work(snapshot, workId);
      if (!document || (document.workId !== workId && document.category !== 'knowledge')) throw new PlanningError('Choose an indexed work or knowledge document.', 403);
    }
    if (!/\.md$/i.test(document.path)) return [];
    const content = await readDocument(this.planningRoot, document.path);
    // The Markdown parser loads when first needed: this module comes with plan export, which every command loads.
    const { diagramLinks } = await import('./diagramLinks.ts');
    const listed = new Map<string, Promise<DiagramEntry[]>>();
    const results: DiagramReference[] = [];
    for (const link of diagramLinks(content.body, document.path)) {
      const target = snapshot.documents.find(file => same(file.path, link.target) && file.workId);
      const work = target && snapshot.work.find(item => item.id === target.workId);
      if (!target || !work) continue;
      if (!listed.has(work.id)) listed.set(work.id, this.list(snapshot, work.id));
      const entry = (await listed.get(work.id)!).find(item => item.path === workRelative(target.path, work.path));
      if (entry) results.push({ workId: work.id, path: entry.path, title: entry.title, provenance: entry.provenance, section: link.section, element: link.element });
    }
    return results;
  }

  /** Every diagram of the planning folder, for quick open. */
  async index(snapshot: PlanningIndex): Promise<DiagramIndexEntry[]> {
    const counts = this.counts(snapshot);
    const entries: DiagramIndexEntry[] = [];
    for (const work of snapshot.work) {
      if (!counts[work.id]) continue;
      try { for (const entry of await this.list(snapshot, work.id)) entries.push({ workId: work.id, path: entry.path, title: entry.title, provenance: entry.provenance }); }
      catch { /* A work item whose diagrams cannot be read offers none. */ }
    }
    return entries;
  }

  /** Diagram files per work item, for list indicators. */
  counts(snapshot: PlanningIndex): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const document of snapshot.documents) if (document.workId && isDiagram(document.path)) counts[document.workId] = (counts[document.workId] ?? 0) + 1;
    return counts;
  }
}
