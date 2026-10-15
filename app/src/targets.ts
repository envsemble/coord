// What a window shows: one place at a time. A place is one of the window's own pages (the hub, the
// Projects page, a project's statistics) or something of one project (a plan, a diagram or a file).
// A work item's diagrams share one place, which switches between them in place.
import type { Document, PagePlace, Place, ProjectPlace, Target, Work } from './types';
import { workRelative } from '@envsemble/atlas-planning/paths';

export type { PagePlace, Place, ProjectPlace };

/** The hub: every plan, or one project's. */
export const hubPlace = (project: string | null = null): PagePlace => ({ page: 'hub', project });
export const projectsPlace = (): PagePlace => ({ page: 'projects' });
export const statisticsPlace = (project: string | null): PagePlace => ({ page: 'statistics', project });
export const isPage = (place: Place): place is PagePlace => 'page' in place;
/** The project a place is of: its own, the hub's filter or the statistics' project; null for none. */
export const placeProject = (place: Place): string | null => !isPage(place) ? place.project : place.page === 'projects' ? null : place.project;

export const workTarget = (work: string, anchor: string | null = null): Target => ({ kind: 'work', work, anchor });
/** A work item's ledger, shown in place of the plan. */
export const ledgerTarget = (work: string, anchor: string | null = null): Target => ({ kind: 'work', work, anchor, view: 'ledger' });
/** A work item's diagram by its path in the work folder (null: its first), at an element. */
export const diagramTarget = (work: string, path: string | null = null, element: string | null = null): Target => ({ kind: 'diagram', work, path, element });
export const fileTarget = (path: string, anchor: string | null = null): Target => ({ kind: 'file', path, anchor });

export const isDiagramFile = (path: string) => /\.puml$/i.test(path);

/**
 * Where a link to a document goes: a work item's plan opens as the work item, its ledger in the work
 * item in place of the plan, its diagram files as its diagrams (an anchor naming an element),
 * anything else as a file.
 */
export function documentTarget(file: Document, work: Work | undefined, anchor: string | null = null): Target {
  if (work && file.path === work.currentPlan) return workTarget(work.id, anchor);
  if (work && file.path === work.ledger) return ledgerTarget(work.id, anchor);
  if (work && isDiagramFile(file.path)) return diagramTarget(work.id, workRelative(file.path, work.path), anchor || null);
  return fileTarget(file.path, anchor);
}

/**
 * The thing a place shows, whatever its position in it: a page (whichever project it is filtered
 * to), a work item (its plan or its ledger), a work item's diagrams, or a file. Showing another
 * thing starts its page afresh.
 */
export function placeId(place: Place): string {
  if (isPage(place)) return place.page;
  const { project, target } = place;
  return project + ':' + (target.kind === 'file' ? 'file:' + target.path : target.kind === 'work' ? 'work:' + target.work : 'diagram:' + target.work);
}

/** What a place's scroll position belongs to: a page of a project, a work item's plan or ledger, a diagram, or a file. */
export function scrollKey(place: Place): string {
  if (isPage(place)) return place.page + ':' + (placeProject(place) ?? '');
  const { target } = place;
  return placeId(place) + (target.kind === 'work' && target.view ? ':' + target.view : target.kind === 'diagram' ? ':' + (target.path ?? '') : '');
}
