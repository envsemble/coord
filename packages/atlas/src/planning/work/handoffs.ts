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

/** The planning folder a reference leads to from `root`: its own, or another of the home's by its folder's name; null when there is none. */
export function handoffFolder(root: string, item: HandoffReference): string | null {
  if (item.project === null || same(item.project, path.basename(root))) return root;
  const planning = path.dirname(root);
  try {
    const name = readdirSync(planning, { withFileTypes: true }).find(entry => entry.isDirectory() && same(entry.name, item.project!))?.name;
    return name ? path.join(planning, name) : null;
  } catch { return null; }
}

/** A work item's registry entry in a planning folder, if it registers it. */
function entryOf(folder: string, workId: string) {
  const items = readJson(path.join(folder, 'planning.json'))?.work_items;
  return Array.isArray(items) ? items.find(item => item && typeof item === 'object' && (item as { id?: unknown }).id === workId) as { current_plan?: unknown } | undefined : undefined;
}
/** Whether a reference names a registered work item. */
export function handoffExists(root: string, item: HandoffReference) {
  const folder = handoffFolder(root, item);
  return folder !== null && entryOf(folder, item.workId) !== undefined;
}

/** A registered work item's plan header; null when it has none that reads. */
function headerOf(folder: string, workId: string, entry = entryOf(folder, workId)): Record<string, unknown> | null {
  const plan = entry?.current_plan;
  if (typeof plan !== 'string' || plan.split('/').includes('..')) return null;
  try { return parseFrontmatter(readFileSync(path.join(folder, ...plan.split('/')), 'utf8').replace(/^﻿/, '')) ?? null; }
  catch { return null; }
}
/** The references a work item's plan continues, read from its header. */
function continuesOf(folder: string, workId: string): HandoffReference[] {
  return handoffsOf(headerOf(folder, workId)?.continues).references;
}

/**
 * A work item's handoffs read from the plans of the home's planning folders, for a plan export,
 * which has no listing to take them from: the work it continues and the work continuing it, each
 * with its title, project and outcome, and without folder IDs (an export opens no other plan).
 */
export function handoffLinksAt(root: string, workId: string): { continues: HandoffLink[]; continuedIn: HandoffLink[] } {
  const planning = path.dirname(root);
  let folders: string[] = [];
  try { folders = readdirSync(planning, { withFileTypes: true }).filter(entry => entry.isDirectory() && existsSync(path.join(planning, entry.name, 'planning.json'))).map(entry => path.join(planning, entry.name)).slice(0, 200); }
  catch { /* only its own folder */ }
  if (!folders.some(folder => same(folder, root))) folders.push(root);
  const names = new Map<string, string>();
  const nameOf = (folder: string) => {
    if (!names.has(folder)) { const name = readJson(path.join(folder, 'planning.json'))?.name; names.set(folder, typeof name === 'string' && name.trim() ? name.trim() : path.basename(folder)); }
    return names.get(folder)!;
  };
  const link = (folder: string | null, project: string, id: string, header: Record<string, unknown> | null): HandoffLink => {
    const design = header?.design_status, implementation = header?.implementation_status;
    return {
      folderId: null, project, projectName: folder ? nameOf(folder) : project, workId: id, title: typeof header?.title === 'string' ? header.title : null, state: null,
      outcome: design === 'superseded' || design === 'abandoned' ? design : implementation === 'complete' ? 'complete' : null,
    };
  };
  const continues = continuesOf(root, workId).map(item => {
    const folder = handoffFolder(root, item);
    return link(folder, folder ? path.basename(folder) : item.project!, item.workId, folder ? headerOf(folder, item.workId) : null);
  });
  const continuedIn: HandoffLink[] = [];
  for (const folder of folders) {
    const items = readJson(path.join(folder, 'planning.json'))?.work_items;
    if (!Array.isArray(items)) continue;
    for (const entry of items.slice(0, 2000)) {
      const id = (entry as { id?: unknown } | null)?.id;
      if (typeof id !== 'string') continue;
      const header = headerOf(folder, id, entry as { current_plan?: unknown });
      const found = handoffsOf(header?.continues).references.some(item => item.workId === workId && same(handoffFolder(folder, item) ?? '', root));
      if (found) continuedIn.push(link(folder, path.basename(folder), id, header));
    }
  }
  return { continues, continuedIn };
}

/** Whether following `continues` from these references comes back to the work item: a loop (A continues B continues A). */
export function handoffLoop(root: string, workId: string, references: HandoffReference[]) {
  const start = path.resolve(root) + '\0' + workId;
  const seen = new Set<string>();
  const pending = references.map(item => ({ from: root, item }));
  while (pending.length && seen.size < 500) {
    const { from, item } = pending.shift()!;
    const folder = handoffFolder(from, item);
    if (!folder) continue;
    const key = path.resolve(folder) + '\0' + item.workId;
    if (caseless ? key.toLowerCase() === start.toLowerCase() : key === start) return true;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const next of continuesOf(folder, item.workId)) pending.push({ from: folder, item: next });
  }
  return false;
}
