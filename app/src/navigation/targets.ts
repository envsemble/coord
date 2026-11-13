// What a window shows: one place at a time. A place is one of the window's own pages (the hub, a
// project's statistics, a section of Settings) or something of one project (a plan, a plan's statistics, a
// diagram or a file).
// A work item's diagrams share one place, which switches between them in place.
import type { Document, PagePlace, Place, ProjectPlace, SettingsSection, Target, Work } from '../types';
import { workRelative } from '@envsemble/atlas/platform/paths';

export type { PagePlace, Place, ProjectPlace };

/** The hub: every plan, or one project's. */
export const hubPlace = (projectId: string | null = null): PagePlace => ({ page: 'hub', projectId });
export const statisticsPlace = (projectId: string | null): PagePlace => ({ page: 'statistics', projectId });
/** Settings, at one of its sections: the agents on this computer, or the computers. */
export const settingsPlace = (section: SettingsSection = 'agents'): PagePlace => ({ page: 'settings', section });
export const isPage = (place: Place): place is PagePlace => 'page' in place;
/** The project a place is of: its own, the hub's filter or the statistics' project; null for none. */
export const placeProject = (place: Place): string | null => !isPage(place) ? place.projectId : place.page === 'settings' ? null : place.projectId;
/** Where on a page the place is: the project of the hub or the statistics, or the section of Settings. */
export const pagePart = (place: PagePlace): string => place.page === 'settings' ? place.section : placeProject(place) ?? '';

export const workTarget = (work: string, anchor: string | null = null): Target => ({ kind: 'work', work, anchor });
/** A work item's statistics: its time and tokens by session, model and stage, and its timeline. */
export const workStatisticsTarget = (work: string): Target => ({ kind: 'work', work, anchor: null, view: 'statistics' });
/** Whether a target is a work item's statistics rather than its plan. */
const isWorkStatistics = (target: Target) => target.kind === 'work' && target.view === 'statistics';
/** A work item's plan with one of its ledger steps (by its title) pointed out in its progress. */
export const stepTarget = (work: string, step: string): Target => ({ kind: 'work', work, anchor: null, step });
/** A work item's diagram by its path in the work folder (null: its first), at an element. */
export const diagramTarget = (work: string, path: string | null = null, element: string | null = null): Target => ({ kind: 'diagram', work, path, element });
export const fileTarget = (path: string, anchor: string | null = null): Target => ({ kind: 'file', path, anchor });

export const isDiagramFile = (path: string) => /\.puml$/i.test(path);

/**
 * Where a link to a document goes: a work item's plan opens as the work item, its diagram files as
 * its diagrams (an anchor naming an element), anything else (its ledger too) as a file.
 */
export function documentTarget(file: Document, work: Work | undefined, anchor: string | null = null): Target {
  if (work && file.path === work.currentPlan) return workTarget(work.id, anchor);
  if (work && isDiagramFile(file.path)) return diagramTarget(work.id, workRelative(file.path, work.path), anchor || null);
  return fileTarget(file.path, anchor);
}

/**
 * The thing a place shows, whatever its position in it: a page (whichever project it is filtered
 * to), a work item, a work item's diagrams, or a file. Showing another
 * thing starts its page afresh.
 */
export function placeId(place: Place): string {
  if (isPage(place)) return place.page;
  const { projectId, target } = place;
  return projectId + ':' + (target.kind === 'file' ? 'file:' + target.path : target.kind === 'work' ? (isWorkStatistics(target) ? 'statistics:' : 'work:') + target.work : 'diagram:' + target.work);
}

/** What a place's scroll position belongs to: a page of a project, a work item's plan, a diagram, or a file. */
export function scrollKey(place: Place): string {
  if (isPage(place)) return place.page + ':' + pagePart(place);
  const { target } = place;
  return placeId(place) + (target.kind === 'diagram' ? ':' + (target.path ?? '') : '');
}
