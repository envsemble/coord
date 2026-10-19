// The hub's plans: every plan of every active project (or of the project it is filtered to), from the
// project list's summaries, grouped by where they stand: blocked and being implemented first, then
// drafts, then other open work; closed work only when asked for. And what each row says of its plan.
import type { Project, ProjectWork, ProjectWorkState } from '../types';
import type { WorkStatus } from '../ui/status';
import { aiModel, type Provider } from '../ui/aiModels';
import { compactNumber, duration, plural } from '../ui/format';

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
    const live = new Set(summary.activity.filter(item => item.state === 'working').map(item => item.workId));
    return [...summary.active, ...summary.closed].map(work => ({ project, work, live: live.has(work.id) }));
  });
}

/** Whether a plan is in the state the hub shows. */
export const inState = (item: HubItem, state: HubState) => state === 'all' || (state === 'closed') === (item.work.state === 'closed');

/**
 * The plans in the state asked for, in their groups (only those with plans): blocked before being
 * implemented, then the most recently changed first.
 */
export function hubGroups(items: HubItem[], state: HubState): HubGroup[] {
  const shown = items.filter(item => inState(item, state)).sort((a, b) =>
    stateOrder[a.work.state] - stateOrder[b.work.state] || (b.work.updated ?? '').localeCompare(a.work.updated ?? '')
    || a.project.position - b.project.position || b.work.id.localeCompare(a.work.id));
  return (['active', 'draft', 'other', 'closed'] as const).map(id => ({ id, label: groupLabels[id], items: shown.filter(item => groupOf[item.work.state] === id) })).filter(group => group.items.length);
}

/** How much a row says: work in progress and blocked work the most, closed work how it ended. */
export type HubRowSize = 'large' | 'standard' | 'closed';
type Phase = 'planning' | 'implementation';
/** What a hub row says of its plan, formatted as the plan page and the Statistics page do. */
export interface HubRowFacts {
  size: HubRowSize;
  /**
   * Steps done and in progress (the step worked on, as the project list names one) of all of them, the
   * planning steps among them; on a draft or other open work only the planning steps, when it has some.
   */
  progress: { done: number; doing: number; total: number; planning: { done: number; doing: number }; text: string } | null;
  /** The step being worked on (Now) or next to do (Next), on a large row that is not blocked. */
  step: { label: 'Now' | 'Next'; title: string; phase: Phase } | null;
  /** Why blocked work is blocked, in place of its step. */
  blocked: string | null;
  /** The model that did most of the work, and how many others took part. */
  model: { id: string; name: string; provider: Provider | null; others: number } | null;
  /** Agent time in all, and (on a large row) split into planning and implementation. */
  time: { total: string; planning: string | null; implementation: string | null } | null;
  tokens: string | null;
  /** Subagents that worked on it, on a large row. */
  subagents: string | null;
  /** How closed work ended (Complete, Superseded, Abandoned) and when it was completed. */
  ended: { label: string; date: string | null } | null;
  /** When it last changed: its plan's date, or the last agent report when that is the same day or later. */
  changed: string | null;
}

/** The size of a plan's row: by where it stands. */
const rowSize = (work: ProjectWork): HubRowSize => work.state === 'closed' ? 'closed' : work.state === 'blocked' || work.state === 'implementing' ? 'large' : 'standard';

/** When a plan last changed: an agent report the day of its plan's date or later says it more precisely. */
export function lastChange(work: ProjectWork): string | null {
  const report = work.statistics?.lastReport ?? null;
  if (!report) return work.updated;
  return !work.updated || report.slice(0, 10) >= work.updated ? report : work.updated;
}

export function hubRowFacts(work: ProjectWork): HubRowFacts {
  const size = rowSize(work);
  const statistics = work.statistics;
  const steps = work.steps && work.steps.total > 0 ? work.steps : null;
  let progress: HubRowFacts['progress'] = null;
  const doing = work.step?.status === 'doing' ? work.step.phase : null;
  const all = steps && { done: steps.done, doing: doing ? 1 : 0, total: steps.total, planning: { done: steps.planning.done, doing: doing === 'planning' ? 1 : 0 }, text: steps.done + ' of ' + steps.total };
  if (all && size === 'large') progress = all;
  else if (steps && size === 'standard') {
    // A draft is still being planned: its planning steps say how far, when it has them.
    const planned = steps.planning.total > 0 ? steps.planning : null;
    const early = doing === 'planning' ? 1 : 0;
    progress = planned ? { done: planned.done, doing: early, total: planned.total, planning: { done: planned.done, doing: early }, text: planned.done + ' of ' + planned.total + ' planning' } : all;
  }
  const blocked = work.state === 'blocked' ? work.blocked?.trim() || 'No reason given' : null;
  const step = size === 'large' && !blocked && work.step ? { label: work.step.status === 'doing' ? 'Now' as const : 'Next' as const, title: work.step.title, phase: work.step.phase } : null;
  const primary = statistics?.primaryModel ? aiModel(statistics.primaryModel) : null;
  const split = (agentMs: number) => size === 'large' && agentMs > 0 ? duration(agentMs) : null;
  const time = statistics && statistics.agentMs > 0 ? { total: duration(statistics.agentMs), planning: split(statistics.planning.agentMs), implementation: split(statistics.implementation.agentMs) } : null;
  return {
    size, progress, step, blocked,
    model: primary && size !== 'closed' ? { id: primary.id, name: primary.name, provider: primary.provider, others: statistics!.otherModels } : null,
    time,
    tokens: statistics?.tokens ? compactNumber(statistics.tokens) + ' tokens' : null,
    subagents: size === 'large' && statistics?.subagents ? plural(statistics.subagents, 'subagent') : null,
    ended: size === 'closed' ? { label: hubStatus(work).label, date: work.completed } : null,
    changed: lastChange(work),
  };
}
