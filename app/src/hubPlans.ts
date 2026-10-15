// The hub's plans: every plan of every active project (or of the project it is filtered to), from the
// project list's summaries, grouped by where they stand: blocked and being implemented first, then
// drafts, then other open work; closed work only when asked for.
import type { Project, ProjectWork, ProjectWorkState } from './types';
import type { WorkStatus } from './status';
import { workNumber } from './format';

/** Which plans the hub lists: open ones (the default), closed ones, or all. */
export type HubState = 'open' | 'closed' | 'all';
/** A plan in the hub: the work item, its project, and whether an agent works on it now. */
export interface HubItem { project: Project; work: ProjectWork; live: boolean }
export interface HubGroup { id: 'active' | 'draft' | 'other' | 'closed'; label: string; items: HubItem[] }

const groupOf: Record<ProjectWorkState, HubGroup['id']> = { blocked: 'active', implementing: 'active', draft: 'draft', other: 'other', closed: 'closed' };
const groupLabels: Record<HubGroup['id'], string> = { active: 'In progress', draft: 'Drafts', other: 'Other open work', closed: 'Closed' };
const stateOrder: Record<ProjectWorkState, number> = { blocked: 0, implementing: 1, draft: 2, other: 3, closed: 4 };

/** A plan's status as the hub shows it, in the app's status vocabulary. */
export function hubStatus(work: ProjectWork): WorkStatus {
  switch (work.state) {
    case 'blocked': return { key: 'blocked', label: 'Blocked', tone: 'danger' };
    case 'implementing': return { key: 'in_progress', label: 'In progress', tone: 'open' };
    case 'draft': return { key: 'draft', label: 'Draft plan', tone: 'muted' };
    case 'other': return { key: 'not_started', label: 'Open', tone: 'muted' };
    case 'closed': return work.outcome === 'superseded' ? { key: 'superseded', label: 'Superseded', tone: 'muted' }
      : work.outcome === 'abandoned' ? { key: 'abandoned', label: 'Abandoned', tone: 'muted' } : { key: 'complete', label: 'Complete', tone: 'done' };
  }
}

/**
 * The plans the hub can list: those of every active project, or, filtered to a project, that
 * project's (also when it is hidden or archived). A project whose folder could not be read has none.
 */
export function hubItems(projects: Project[], filter: string | null): HubItem[] {
  return projects.filter(project => filter === null ? project.state === 'active' : project.folderId === filter).flatMap(project => {
    const summary = project.summary;
    if (!summary) return [];
    const live = new Set(summary.live.map(item => item.workId));
    return [...summary.active, ...summary.closed].map(work => ({ project, work, live: live.has(work.id) }));
  });
}

/** Whether a plan matches the search: every word in its title, number, summary or project's name, ignoring case. */
export function hubMatches(item: HubItem, query: string) {
  const text = [item.work.title, item.work.id, workNumber(item.work.id), item.work.summary ?? '', item.project.name].join(' ').toLocaleLowerCase();
  return query.toLocaleLowerCase().split(/\s+/).filter(Boolean).every(word => text.includes(word));
}

/** Whether a plan is in the state the hub shows. */
export const inState = (item: HubItem, state: HubState) => state === 'all' || (state === 'closed') === (item.work.state === 'closed');

/**
 * The plans matching the search in the state asked for, in their groups (only those with plans):
 * blocked before being implemented, then the most recently changed first.
 */
export function hubGroups(items: HubItem[], state: HubState, query: string): HubGroup[] {
  const shown = items.filter(item => inState(item, state) && hubMatches(item, query)).sort((a, b) =>
    stateOrder[a.work.state] - stateOrder[b.work.state] || (b.work.updated ?? '').localeCompare(a.work.updated ?? '')
    || a.project.position - b.project.position || b.work.id.localeCompare(a.work.id));
  return (['active', 'draft', 'other', 'closed'] as const).map(id => ({ id, label: groupLabels[id], items: shown.filter(item => groupOf[item.work.state] === id) })).filter(group => group.items.length);
}
