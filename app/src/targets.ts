// What a tab shows of its project. Tabs are identified by their project and what they show, so
// opening something that already has a tab focuses that tab (and updates its position, such as a
// heading or a diagram's element). A work item's diagrams share one tab, which switches between
// them in place.
import type { Document, Target, Work } from './types';
import { workRelative } from '@envsemble/atlas-planning/paths';

/** A shown thing: what, of which project (by its folder ID). */
export interface Place { project: string; target: Target }

export function tabId(project: string, target: Target): string {
  switch (target.kind) {
    case 'project': return project + ':project';
    case 'work': return project + ':work:' + target.work;
    case 'diagram': return project + ':diagram:' + target.work;
    case 'file': return project + ':file:' + target.path;
  }
}

export const projectTarget = (): Target => ({ kind: 'project' });
export const workTarget = (work: string, anchor: string | null = null): Target => ({ kind: 'work', work, anchor });
/** A work item's diagram by its path in the work folder (null: its first), at an element. */
export const diagramTarget = (work: string, path: string | null = null, element: string | null = null): Target => ({ kind: 'diagram', work, path, element });
export const fileTarget = (path: string, anchor: string | null = null): Target => ({ kind: 'file', path, anchor });

export const isDiagramFile = (path: string) => /\.puml$/i.test(path);

/**
 * Where a link to a document goes: a work item's plan opens as the work item, its diagram files as
 * its diagrams (an anchor naming an element), anything else, the ledger too, as a file.
 */
export function documentTarget(file: Document, work: Work | undefined, anchor: string | null = null): Target {
  if (work && file.path === work.currentPlan) return workTarget(work.id, anchor);
  if (work && isDiagramFile(file.path)) return diagramTarget(work.id, workRelative(file.path, work.path), anchor || null);
  return fileTarget(file.path, anchor);
}

/** What a tab's scroll position belongs to: its project's page, a work item's plan, a diagram, or a file. */
export function scrollKey(place: Place): string {
  const { target } = place;
  return place.project + ':' + (target.kind === 'project' ? 'project' : target.kind === 'file' ? 'file:' + target.path : target.kind === 'work' ? 'work:' + target.work : 'diagram:' + target.work + ':' + (target.path ?? ''));
}
