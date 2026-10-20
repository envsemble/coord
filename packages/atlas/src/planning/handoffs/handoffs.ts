// Handoffs: a plan's `continues` names the work items it continues, as `work-0023` in its own
// project or `atlas:work-0023` in another project of the home, by that project's planning folder's
// name (the folder under <home>/planning, compared case-insensitively where the file system is):
// the one name of a project that is unique in the home and that a rename in the app leaves alone.
// The earlier plan stores nothing; "continued in" is found from the plans that name it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../check/check.ts';
import type { HandoffLink } from '../types.ts';

export interface HandoffReference { project: string | null; workId: string }

const reference = /^(?:([^:\\/\s][^:\\/]{0,99}):)?(work-[0-9]{4,})$/;
const caseless = process.platform === 'win32' || process.platform === 'darwin';
const same = (a: string, b: string) => caseless ? a.toLowerCase() === b.toLowerCase() : a === b;

/** A reference as a plan writes it; null for anything else. */
export function parseHandoff(value: unknown): HandoffReference | null {
  const match = typeof value === 'string' ? reference.exec(value.trim()) : null;
  return match ? { project: match[1] ?? null, workId: match[2] } : null;
}
export const handoffText = (item: HandoffReference) => (item.project ? item.project + ':' : '') + item.workId;

/** A header's `continues`: one reference or a list; the entries that are not references come back apart. */
export function handoffsOf(value: unknown): { references: HandoffReference[]; invalid: unknown[] } {
  const values = value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];
  const references: HandoffReference[] = [], invalid: unknown[] = [];
  for (const item of values) { const parsed = parseHandoff(item); if (parsed) references.push(parsed); else invalid.push(item); }
  return { references, invalid };
}

const readJson = (file: string) => { try { return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>; } catch { return null; } };
const keyOf = (folder: string) => caseless ? path.resolve(folder).toLowerCase() : path.resolve(folder);

/** A work item in a planning folder: a node of the handoff graph. */
interface HandoffNode { folder: string; workId: string; key: string }
type Entry = { current_plan?: unknown };

/**
 * The handoffs between the home's work items as one graph, read lazily and once: each planning
 * folder's registry, each plan's header and each folder's siblings are read at most once for the
 * graph's life (one check run, one tool call), and loops are found for every work item reached in
 * one pass (Tarjan's strongly connected components), so checking every plan stays linear.
 */
export class HandoffGraph {
  private registries = new Map<string, Map<string, Entry> | null>();
  private headers = new Map<string, Record<string, unknown> | null>();
  private siblings = new Map<string, string[]>();
  private edgeLists = new Map<string, HandoffNode[]>();
  private loops = new Map<string, boolean>();
  private indices = new Map<string, number>();
  private counter = 0;

  /** The planning folder a reference leads to from `root`: its own, or a sibling by its folder's name; null when there is none. */
  folder(root: string, item: HandoffReference): string | null {
    if (item.project === null || same(item.project, path.basename(root))) return root;
    const planning = path.dirname(root);
    if (!this.siblings.has(keyOf(planning))) {
      let names: string[] = [];
      try { names = readdirSync(planning, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); } catch { /* none */ }
      this.siblings.set(keyOf(planning), names);
    }
    const name = this.siblings.get(keyOf(planning))!.find(entry => same(entry, item.project!));
    return name ? path.join(planning, name) : null;
  }
  /** A planning folder's registry entries by work ID; null when it has no registry that reads. */
  registry(folder: string) {
    const key = keyOf(folder);
    if (!this.registries.has(key)) {
      const items = readJson(path.join(folder, 'planning.json'))?.work_items;
      this.registries.set(key, Array.isArray(items) ? new Map(items.filter(item => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string').map(item => [(item as { id: string }).id, item as Entry])) : null);
    }
    return this.registries.get(key)!;
  }
  /** Whether a reference names a registered work item. */
  exists(root: string, item: HandoffReference) {
    const folder = this.folder(root, item);
    return folder !== null && this.registry(folder)?.has(item.workId) === true;
  }
  /** A registered work item's plan header; null when it has none that reads. */
  header(folder: string, workId: string): Record<string, unknown> | null {
    const key = keyOf(folder) + '\0' + workId;
    if (!this.headers.has(key)) {
      const plan = this.registry(folder)?.get(workId)?.current_plan;
      let found: Record<string, unknown> | null = null;
      if (typeof plan === 'string' && !plan.split('/').includes('..')) {
        try { found = parseFrontmatter(readFileSync(path.join(folder, ...plan.split('/')), 'utf8').replace(/^﻿/, '')) ?? null; } catch { /* unreadable */ }
      }
      this.headers.set(key, found);
    }
    return this.headers.get(key)!;
  }
  node(folder: string, workId: string): HandoffNode { return { folder, workId, key: keyOf(folder) + '\0' + workId }; }
  /** The work items a reference list leads to from `root`, each once; references to no planning folder are left out. */
  targets(root: string, references: HandoffReference[]): HandoffNode[] {
    const found = new Map<string, HandoffNode>();
    for (const item of references) {
      const folder = this.folder(root, item);
      if (folder) { const node = this.node(folder, item.workId); if (!found.has(node.key)) found.set(node.key, node); }
    }
    return [...found.values()];
  }
  private edges(node: HandoffNode): HandoffNode[] {
    if (!this.edgeLists.has(node.key)) this.edgeLists.set(node.key, this.targets(node.folder, handoffsOf(this.header(node.folder, node.workId)?.continues).references));
    return this.edgeLists.get(node.key)!;
  }
  /** Read a work item's handoffs as these references rather than as its plan has them (before writing them). */
  assume(root: string, workId: string, references: HandoffReference[]) {
    const node = this.node(root, workId);
    if (this.indices.has(node.key)) throw new Error('The handoff graph has already been searched from ' + workId + '.');
    this.edgeLists.set(node.key, this.targets(root, references));
  }
  /** Whether following `continues` from the work item comes back to it: a loop (A continues B continues A). */
  inLoop(root: string, workId: string): boolean {
    const start = this.node(root, workId);
    if (!this.indices.has(start.key)) this.components(start);
    return this.loops.get(start.key) ?? false;
  }
  /** Tarjan's strongly connected components from `start`, iteratively: marks every work item reached as in a loop or not. */
  private components(start: HandoffNode) {
    const low = new Map<string, number>(), stack: string[] = [], onStack = new Set<string>();
    const frames: { node: HandoffNode; edges: HandoffNode[]; next: number }[] = [];
    const visit = (node: HandoffNode) => {
      this.indices.set(node.key, this.counter); low.set(node.key, this.counter++);
      stack.push(node.key); onStack.add(node.key);
      frames.push({ node, edges: this.edges(node), next: 0 });
    };
    visit(start);
    while (frames.length) {
      const frame = frames.at(-1)!, key = frame.node.key;
      if (frame.next < frame.edges.length) {
        const to = frame.edges[frame.next++];
        if (!this.indices.has(to.key)) visit(to);
        else if (onStack.has(to.key)) low.set(key, Math.min(low.get(key)!, this.indices.get(to.key)!));
        continue;
      }
      frames.pop();
      const parent = frames.at(-1);
      if (parent) low.set(parent.node.key, Math.min(low.get(parent.node.key)!, low.get(key)!));
      if (low.get(key) !== this.indices.get(key)) continue;
      const component: string[] = [];
      let member: string;
      do { member = stack.pop()!; onStack.delete(member); component.push(member); } while (member !== key);
      const looped = component.length > 1 || frame.edges.some(edge => edge.key === key);
      for (const item of component) this.loops.set(item, looped);
    }
  }
}

/** The planning folder a reference leads to from `root`: its own, or another of the home's by its folder's name; null when there is none. */
export function handoffFolder(root: string, item: HandoffReference, graph = new HandoffGraph()): string | null { return graph.folder(root, item); }
/** Whether a reference names a registered work item. */
export function handoffExists(root: string, item: HandoffReference, graph = new HandoffGraph()) { return graph.exists(root, item); }
/** Whether following `continues` from these references (the work item's own, by default as its plan has them) comes back to it. */
export function handoffLoop(root: string, workId: string, references?: HandoffReference[], graph = new HandoffGraph()) {
  if (references) graph.assume(root, workId, references);
  return graph.inLoop(root, workId);
}

/**
 * A work item's handoffs read from the plans of the home's planning folders, for a plan export,
 * which has no listing to take them from: the work it continues and the work continuing it, each
 * with its title, project and outcome, and without project IDs (an export opens no other plan).
 */
export function handoffLinksAt(root: string, workId: string): { continues: HandoffLink[]; continuedIn: HandoffLink[] } {
  const graph = new HandoffGraph();
  const planning = path.dirname(root);
  let folders: string[] = [];
  try { folders = readdirSync(planning, { withFileTypes: true }).filter(entry => entry.isDirectory() && existsSync(path.join(planning, entry.name, 'planning.json'))).map(entry => path.join(planning, entry.name)).slice(0, 200); }
  catch { /* only its own folder */ }
  if (!folders.some(folder => keyOf(folder) === keyOf(root))) folders.push(root);
  const names = new Map<string, string>();
  const nameOf = (folder: string) => {
    if (!names.has(folder)) { const name = readJson(path.join(folder, 'planning.json'))?.name; names.set(folder, typeof name === 'string' && name.trim() ? name.trim() : path.basename(folder)); }
    return names.get(folder)!;
  };
  const link = (folder: string | null, project: string, id: string, header: Record<string, unknown> | null): HandoffLink => {
    const design = header?.design_status, implementation = header?.implementation_status;
    return {
      projectId: null, project, projectName: folder ? nameOf(folder) : project, workId: id, title: typeof header?.title === 'string' ? header.title : null, state: null,
      outcome: design === 'superseded' || design === 'abandoned' ? design : implementation === 'complete' ? 'complete' : null,
    };
  };
  const seen = new Set<string>();
  const continues: HandoffLink[] = [];
  for (const item of handoffsOf(graph.header(root, workId)?.continues).references) {
    const folder = graph.folder(root, item);
    const key = (folder ? keyOf(folder) : '?' + item.project) + '\0' + item.workId;
    if (seen.has(key)) continue;
    seen.add(key);
    continues.push(link(folder, folder ? path.basename(folder) : item.project!, item.workId, folder ? graph.header(folder, item.workId) : null));
  }
  const start = graph.node(root, workId).key;
  const continuedIn: HandoffLink[] = [];
  for (const folder of folders) {
    for (const id of [...graph.registry(folder)?.keys() ?? []].slice(0, 2000)) {
      const header = graph.header(folder, id);
      if (graph.targets(folder, handoffsOf(header?.continues).references).some(node => node.key === start)) continuedIn.push(link(folder, path.basename(folder), id, header));
    }
  }
  return { continues, continuedIn };
}
