// The hub's plans: every plan of every active project (or of the project it is filtered to), from the
// project list's summaries, grouped by their status: those waiting for the person first, then those
// agents work on, blocked and paused work, then drafts and ready plans; closed work only when asked
// for. And what each row says of its plan.
import type { Project, ProjectWork } from '../types';
import { statuses, type ActivityState, type StatusLook, type StatusKey } from '../plan/status';
import { liveActivity, type LiveActivity } from '../plan/agentTime';
import { aiModel, type Provider } from '../ui/aiModels';
import { compactNumber, duration, plural } from '../ui/format';

/** Which plans the hub lists: open ones (the default), closed ones, or all. */
export type HubState = 'open' | 'closed' | 'all';
/** A plan in the hub: the work item, its project, what agents do on it now, and its status. */
export interface HubItem { project: Project; work: ProjectWork; activity: LiveActivity | null; status: StatusLook }
type HubGroupId = 'waiting' | 'working' | 'blocked' | 'paused' | 'draft' | 'ready' | 'closed';
export interface HubGroup { id: HubGroupId; label: string; items: HubItem[] }

const groupOrder: HubGroupId[] = ['waiting', 'working', 'blocked', 'paused', 'draft', 'ready', 'closed'];
const groupLabels: Record<HubGroupId, string> = { waiting: 'Needs you', working: 'Working', blocked: 'Blocked', paused: 'Paused', draft: 'Drafts', ready: 'Ready', closed: 'Closed' };
/** The group of a status as the hub gives it: its own while open, closed work together. */
const groupOf = (key: StatusKey): HubGroupId => (groupOrder as string[]).includes(key) ? key as HubGroupId : 'closed';

/**
 * A plan's status as the hub shows it, in the app's status vocabulary: how closed work ended (closed
 * work neither complete, superseded nor abandoned was partly done), else what agents do on it, else
 * where it stands. Other open work (not a draft, not started or partly done) shows as ready: the
 * project list does not tell them apart.
 */
export function hubStatus(work: ProjectWork, activity: ActivityState = null): StatusLook {
  if (work.state === 'closed') return work.outcome ? statuses[work.outcome] : statuses.partial;
  if (activity) return statuses[activity];
  return work.state === 'blocked' ? statuses.blocked : work.state === 'implementing' ? statuses.paused : work.state === 'draft' ? statuses.draft : statuses.ready;
}

/**
 * The plans the hub can list: those of every active project, or, filtered to a project, that
 * project's (also when it is archived). A project whose folder could not be read has none.
 */
export function hubItems(projects: Project[], filter: string | null): HubItem[] {
  return projects.filter(project => filter === null ? project.state === 'active' : project.id === filter).flatMap(project => {
    const summary = project.summary;
    if (!summary) return [];
    return [...summary.active, ...summary.closed].map(work => {
      const activity = work.state === 'closed' ? null : liveActivity(summary, work.id);
      return { project, work, activity, status: hubStatus(work, activity?.state ?? null) };
    });
  });
}

/** Whether a plan is in the state the hub shows. */
export const inState = (item: HubItem, state: HubState) => state === 'all' || (state === 'closed') === (item.work.state === 'closed');

/**
 * The plans in the state asked for, in their groups (only those with plans), each the most recently
 * changed first.
 */
export function hubGroups(items: HubItem[], state: HubState): HubGroup[] {
  const shown = items.filter(item => inState(item, state)).sort((a, b) =>
    (b.work.updated ?? '').localeCompare(a.work.updated ?? '') || a.project.position - b.project.position || b.work.id.localeCompare(a.work.id));
  return groupOrder.map(id => ({ id, label: groupLabels[id], items: shown.filter(item => groupOf(item.status.key) === id) })).filter(group => group.items.length);
}

/** How much a row says: work under way (agents on it, blocked or paused) the most, closed work how it ended. */
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
  /** The model that did most of the work, the reasoning effort it worked at most, and how many others took part. */
  model: { id: string; name: string; provider: Provider | null; effort: string | null; others: number } | null;
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

/** The size of a plan's row: by its status. */
const rowSize = (status: StatusLook): HubRowSize => groupOf(status.key) === 'closed' ? 'closed' : ['working', 'waiting', 'blocked', 'paused'].includes(status.key) ? 'large' : 'standard';

/** When a plan last changed: an agent report the day of its plan's date or later says it more precisely. */
export function lastChange(work: ProjectWork): string | null {
  const report = work.statistics?.lastReport ?? null;
  if (!report) return work.updated;
  return !work.updated || report.slice(0, 10) >= work.updated ? report : work.updated;
}

export function hubRowFacts(work: ProjectWork, status = hubStatus(work)): HubRowFacts {
  const size = rowSize(status);
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
  const blocked = status.key === 'blocked' ? work.blocked?.trim() || 'No reason given' : null;
  const step = size === 'large' && !blocked && work.step ? { label: work.step.status === 'doing' ? 'Now' as const : 'Next' as const, title: work.step.title, phase: work.step.phase } : null;
  const primary = statistics?.primaryModel ? aiModel(statistics.primaryModel) : null;
  const split = (agentMs: number) => size === 'large' && agentMs > 0 ? duration(agentMs) : null;
  const time = statistics && statistics.agentMs > 0 ? { total: duration(statistics.agentMs), planning: split(statistics.planning.agentMs), implementation: split(statistics.implementation.agentMs) } : null;
  return {
    size, progress, step, blocked,
    model: primary && size !== 'closed' ? { id: primary.id, name: primary.name, provider: primary.provider, effort: statistics!.primaryEffort, others: statistics!.otherModels } : null,
    time,
    tokens: statistics?.tokens ? compactNumber(statistics.tokens) + ' tokens' : null,
    subagents: size === 'large' && statistics?.subagents ? plural(statistics.subagents, 'subagent') : null,
    ended: size === 'closed' ? { label: status.label, date: work.completed } : null,
    changed: lastChange(work),
  };
}

/**
 * Where a plan stands among parts, as its row says it: a part is "Part 2 of #0005" (its place in its
 * group's order, of how many); a group says how many parts it has and how many of them are closed.
 */
export type PartsFacts = { kind: 'part'; group: string; index: number; count: number } | { kind: 'group'; count: number; closed: number };
export function partsFacts(work: ProjectWork, project: Project): PartsFacts | null {
  const all = project.summary ? [...project.summary.active, ...project.summary.closed] : [];
  if (work.partOf) {
    const group = all.find(item => item.id === work.partOf);
    const parts = group?.parts ?? [];
    const index = parts.indexOf(work.id);
    return group && index >= 0 ? { kind: 'part', group: group.id, index: index + 1, count: parts.length } : null;
  }
  if (work.parts?.length) {
    const known = new Map(all.map(item => [item.id, item]));
    return { kind: 'group', count: work.parts.length, closed: work.parts.filter(id => known.get(id)?.state === 'closed').length };
  }
  return null;
}
