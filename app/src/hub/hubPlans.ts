// The hub's plans: every plan of every active project (or of the project it is filtered to), from the
// project list's summaries, grouped by whose turn their agents say they are: the user's first, then
// the work agents are on, then work waiting on a PR or something else (or blocked), then later (ready
// to start, drafts nobody is on, work that says nothing); closed work only when asked for. And what
// each row says of its plan.
import { parseWorkId } from '@envsemble/coord/planning/ids';
import type { Project, ProjectWork, ReferenceInput } from '../types';
import { findReferences } from '../reader/references';
import { statuses, type StatusLook, type StatusKey } from '../plan/status';
import { aiModel, type Provider } from '../ui/aiModels';
import { compactNumber, duration, plural } from '../ui/format';

/** Which plans the hub lists: open ones (the default), closed ones, or all. */
export type HubState = 'open' | 'closed' | 'all';
/** A plan in the hub: the work item, its project and its status. */
export interface HubItem { project: Project; work: ProjectWork; status: StatusLook }
type HubGroupId = 'your_turn' | 'working' | 'waiting' | 'later' | 'closed';
export interface HubGroup { id: HubGroupId; label: string; items: HubItem[] }

const groupOrder: HubGroupId[] = ['your_turn', 'working', 'waiting', 'later', 'closed'];
const groupLabels: Record<HubGroupId, string> = { your_turn: 'Your turn', working: 'Working', waiting: 'Waiting', later: 'Later', closed: 'Closed' };
const groupOfStatus: Partial<Record<StatusKey, HubGroupId>> = { your_turn: 'your_turn', working: 'working', planning: 'working', waiting: 'waiting', blocked: 'waiting', draft: 'later', ready: 'later', nostate: 'later', unknown: 'later' };
/** The group of a status as the hub gives it: whose turn it is while open, closed work together. */
const groupOf = (key: StatusKey): HubGroupId => groupOfStatus[key] ?? 'closed';

/**
 * A plan's status as the hub shows it, in the app's status vocabulary: how closed work ended (closed
 * work neither complete, superseded nor abandoned was partly done), else whose turn its plan declares,
 * else where it stands: blocked, a draft, under way with no state, or ready (the project list does not
 * tell other open work apart).
 */
export function hubStatus(work: ProjectWork): StatusLook {
  if (work.state === 'closed') return work.outcome ? statuses[work.outcome] : statuses.partial;
  if (work.turn) return statuses[work.turn.kind] ?? statuses.unknown;
  return work.state === 'blocked' ? statuses.blocked : work.state === 'implementing' ? statuses.nostate : work.state === 'draft' ? statuses.draft : statuses.ready;
}

/**
 * The plans the hub can list: those of every active project, or, filtered to a project, that
 * project's (also when it is archived). A project whose folder could not be read has none.
 */
export function hubItems(projects: Project[], filter: string | null): HubItem[] {
  return projects.filter(project => filter === null ? project.state === 'active' : project.id === filter).flatMap(project => {
    const summary = project.summary;
    if (!summary) return [];
    return [...summary.active, ...summary.closed].map(work => ({ project, work, status: hubStatus(work) }));
  });
}

/**
 * The hub's filters beyond Open, Closed and All, from its filter menu; a plan shows when it matches
 * every one that is on: the user's turn, agents working on it (or planning it), blocked,
 * changed in the last seven days.
 */
export const hubOnlyFilters = ['your_turn', 'working', 'blocked', 'recent'] as const;
export type HubOnly = typeof hubOnlyFilters[number];
export const hubOnlyLabels: Record<HubOnly, string> = { your_turn: 'Your turn', working: 'Agents working', blocked: 'Blocked', recent: 'Changed this week' };
const week = 7 * 24 * 60 * 60 * 1000;
const withinWeek = (changed: string | null, now: number) => Boolean(changed) && now - Date.parse(changed!) <= week;
export function matchesOnly(item: HubItem, only: readonly HubOnly[], now: number): boolean {
  return only.every(filter => filter === 'your_turn' ? item.status.key === 'your_turn'
    : filter === 'working' ? item.status.key === 'working' || item.status.key === 'planning'
    : filter === 'blocked' ? item.status.key === 'blocked'
    : withinWeek(lastChange(item.work), now));
}

/** Whether a plan is in the state the hub shows. */
export const inState = (item: HubItem, state: HubState) => state === 'all' || (state === 'closed') === (item.work.state === 'closed');

/**
 * The plans in the state asked for, in their groups (only those with plans), each group the most
 * recently changed first, by the time its Changed column shows (`lastChange`).
 */
export function hubGroups(items: HubItem[], state: HubState): HubGroup[] {
  const shown = items.filter(item => inState(item, state)).sort((a, b) =>
    (lastChange(b.work) ?? '').localeCompare(lastChange(a.work) ?? '') || a.project.position - b.project.position || b.work.id.localeCompare(a.work.id));
  return groupOrder.map(id => ({ id, label: groupLabels[id], items: shown.filter(item => groupOf(item.status.key) === id) })).filter(group => group.items.length);
}

/** How much a row says: work under way (anyone's turn, waiting or blocked) the most, closed work how it ended. */
export type HubRowSize = 'large' | 'standard' | 'closed';
type Phase = 'planning' | 'implementation';
/** What a hub row says of its plan, formatted as the plan page and the Statistics page do. */
export interface HubRowFacts {
  size: HubRowSize;
  /**
   * Steps done and in progress (the step worked on, as the project list names one) of all of them, the
   * planning steps among them; on a draft only the planning steps, when it has some.
   */
  progress: { done: number; doing: number; total: number; planning: { done: number; doing: number }; text: string } | null;
  /** The step being worked on (Now) or next to do (Next), on a large row whose state says nothing more. */
  step: { label: 'Now' | 'Next'; title: string; phase: Phase } | null;
  /** What its state says it is for (what the user is to do, what it waits on), on a large row, in place of the step. */
  note: string | null;
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
  /** Since when its state stands, on work that is the user's turn, waits or is blocked: how long it has waited. */
  since: string | null;
}

/** The size of a plan's row: by its status. */
const rowSize = (status: StatusLook): HubRowSize => groupOf(status.key) === 'closed' ? 'closed' : ['your_turn', 'working', 'planning', 'waiting', 'blocked'].includes(status.key) ? 'large' : 'standard';

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
    // A draft is still being planned: its planning steps say how far, when it has them. Work under
    // way that says nobody's turn shows all its steps, as work on its turn does.
    const planned = status.key === 'draft' && steps.planning.total > 0 ? steps.planning : null;
    const early = doing === 'planning' ? 1 : 0;
    progress = planned ? { done: planned.done, doing: early, total: planned.total, planning: { done: planned.done, doing: early }, text: planned.done + ' of ' + planned.total + ' planning' } : all;
  }
  const blocked = status.key === 'blocked' ? work.turn?.note?.trim() || work.blocked?.trim() || 'No reason given' : null;
  const note = size === 'large' && !blocked && work.turn?.note?.trim() || null;
  const step = size === 'large' && !blocked && !note && work.step ? { label: work.step.status === 'doing' ? 'Now' as const : 'Next' as const, title: work.step.title, phase: work.step.phase } : null;
  const primary = statistics?.primaryModel ? aiModel(statistics.primaryModel) : null;
  const split = (agentMs: number) => size === 'large' && agentMs > 0 ? duration(agentMs) : null;
  const time = statistics && statistics.agentMs > 0 ? { total: duration(statistics.agentMs), planning: split(statistics.planning.agentMs), implementation: split(statistics.implementation.agentMs) } : null;
  return {
    size, progress, step, note, blocked,
    model: primary && size !== 'closed' ? { id: primary.id, name: primary.name, provider: primary.provider, effort: statistics!.primaryEffort, others: statistics!.otherModels } : null,
    time,
    tokens: statistics?.tokens ? compactNumber(statistics.tokens) + ' tokens' : null,
    subagents: size === 'large' && statistics?.subagents ? plural(statistics.subagents, 'subagent') : null,
    ended: size === 'closed' ? { label: status.label, date: work.completed } : null,
    changed: lastChange(work),
    since: waits(status.key) ? work.turn?.since ?? null : null,
  };
}

/** Whether work in this status waits (on the user, on something else, or blocked): its row says since when, in place of when it changed. */
export const waits = (key: StatusKey) => { const group = groupOf(key); return group === 'your_turn' || group === 'waiting'; };

/** A part of a row's note: text, or a PR, issue or commit it names, for the host to resolve. */
export type NotePart = string | { text: string; input: ReferenceInput };
/**
 * A state's note as the hub shows it: plain text, with the PRs, issues and commits it names apart, so
 * each links to its page and a PR shows its state. Other references (files, work items) stay text:
 * the row opens the plan.
 */
export function noteParts(note: string): NotePart[] {
  const parts: NotePart[] = [];
  let at = 0;
  for (const { start, end, found } of findReferences(note)) {
    if (found.kind !== 'host' || found.input.kind === 'path') continue;
    if (start > at) parts.push(note.slice(at, start));
    parts.push({ text: note.slice(start, end), input: found.input });
    at = end;
  }
  if (at < note.length) parts.push(note.slice(at));
  return parts;
}

// ---- Entries: a plan on its own, or a group with its parts ---------------------------------------

/**
 * An entry of the hub: a plan on its own (a work item of one part), or a work item of several parts:
 * `item` then stands for the whole (`wholeOf`: what its parts add up to) and `parts` are its parts in
 * their numbers' order, the first included, closed ones too.
 */
export interface HubEntry { item: HubItem; parts: HubItem[] }
export interface HubEntryGroup { id: HubGroupId; label: string; entries: HubEntry[] }

/** An entry's plans: its parts, or itself when it is one. */
export const members = (entry: HubEntry): HubItem[] => entry.parts.length ? entry.parts : [entry.item];

/**
 * The projects a plan is in, by their IDs: those its plan lists that the listing has, else the
 * project that keeps it (also when none it lists is listed, so it stays in sight).
 */
export function projectsOf(item: HubItem): string[] {
  const listed = (item.work.projects ?? []).flatMap(project => project.projectId ? [project.projectId] : []);
  return listed.length ? [...new Set(listed)] : [item.project.id];
}

/** The most pressing of a work item's parts: an open one in the first group there is (the user's turn before work under way, before waiting, before later), the longest in its state first. */
function pressing(parts: HubItem[]): HubItem {
  const open = parts.filter(part => part.work.state !== 'closed');
  const group = groupOrder.find(id => open.some(part => groupOf(part.status.key) === id));
  const among = open.filter(part => groupOf(part.status.key) === group);
  return [...among].sort((a, b) => (a.work.turn?.since ?? '\uffff').localeCompare(b.work.turn?.since ?? '\uffff'))[0] ?? parts[0];
}

/**
 * A work item of several parts as one row: its first part's title, summary and tags; whose turn it
 * is as its most pressing part says, without that part's note (the part's own row says it); and its
 * parts' steps, agents, time and projects added up. It keeps the first part's ID, which stands for
 * the whole, so opening it opens the first part.
 */
export function wholeOf(parts: HubItem[]): HubItem {
  const first = parts[0], lead = pressing(parts), closed = parts.every(part => part.work.state === 'closed');
  const sum = (pick: (part: HubItem) => number) => parts.reduce((total, part) => total + pick(part), 0);
  const stepped = parts.filter(part => part.work.steps);
  const steps = stepped.length ? {
    done: sum(part => part.work.steps?.done ?? 0), total: sum(part => part.work.steps?.total ?? 0),
    planning: { done: sum(part => part.work.steps?.planning.done ?? 0), total: sum(part => part.work.steps?.planning.total ?? 0) },
  } : null;
  const measured = parts.flatMap(part => part.work.statistics ? [part.work.statistics] : []);
  const most = [...measured].sort((a, b) => b.agentMs - a.agentMs)[0];
  const tokens = measured.some(item => item.tokens !== null) ? measured.reduce((total, item) => total + (item.tokens ?? 0), 0) : null;
  const stage = (pick: (item: typeof measured[number]) => { agentMs: number; tokens: number | null }) => ({
    agentMs: measured.reduce((total, item) => total + pick(item).agentMs, 0),
    tokens: measured.some(item => pick(item).tokens !== null) ? measured.reduce((total, item) => total + (pick(item).tokens ?? 0), 0) : null,
  });
  const statistics = most ? {
    agentMs: measured.reduce((total, item) => total + item.agentMs, 0), activeMs: measured.reduce((total, item) => total + item.activeMs, 0),
    unmergedMs: measured.reduce((total, item) => total + item.unmergedMs, 0), tokens, primaryModel: most.primaryModel, primaryEffort: most.primaryEffort,
    // At least the other parts' main models, and no fewer than any one part counted.
    otherModels: Math.max(new Set(measured.map(item => item.primaryModel).filter(Boolean)).size - 1, ...measured.map(item => item.otherModels)),
    planning: stage(item => item.planning), implementation: stage(item => item.implementation),
    subagents: measured.reduce((total, item) => total + item.subagents, 0),
    lastReport: measured.map(item => item.lastReport ?? '').sort().at(-1) || null,
  } : null;
  const dates = (pick: (work: ProjectWork) => string | null) => parts.map(part => pick(part.work) ?? '').sort().at(-1) || null;
  const turn = lead.work.turn;
  // Every project a part is in, each once: the row shows them all.
  const projects = [...new Set(parts.flatMap(projectsOf))].map(projectId => ({ projectId, project: '', projectName: '' }));
  const work: ProjectWork = {
    ...first.work, state: closed ? 'closed' : lead.work.state, blocked: null, steps, step: null, statistics,
    updated: dates(item => item.updated), completed: closed ? dates(item => item.completed) : null,
    outcome: closed ? parts.every(part => part.work.outcome === 'complete') ? 'complete' : first.work.outcome : null,
    parts: [], partOf: null, projects,
  };
  delete work.turn;
  if (!closed && turn) work.turn = { kind: turn.kind, note: null, since: turn.since };
  return { project: first.project, work, status: closed ? hubStatus(work) : lead.status };
}

/**
 * The hub's entries: every plan of every active project, a work item of several parts once (its
 * parts under it, in their numbers' order, and not on their own), or, filtered to a project, the
 * entries with a plan in that project: a work item of several parts shows whole when any of its
 * parts is in it. A part whose first part is not listed is an entry on its own. An archived project,
 * seen only when filtered to, shows the plans it keeps.
 */
export function hubEntries(projects: Project[], filter: string | null): HubEntry[] {
  const archived = filter !== null && projects.some(project => project.id === filter && project.state !== 'active');
  const items = archived ? hubItems(projects, filter) : hubItems(projects, null);
  const byKey = new Map(items.map(item => [item.project.id + ':' + item.work.id, item]));
  const firstOf = (item: HubItem) => item.work.partOf ? byKey.get(item.project.id + ':' + item.work.partOf) : undefined;
  const othersOf = (item: HubItem) => (item.work.parts ?? []).flatMap(id => byKey.get(item.project.id + ':' + id) ?? []);
  const entries = items.filter(item => !firstOf(item)).map(item => {
    const others = othersOf(item);
    return others.length ? { item: wholeOf([item, ...others]), parts: [item, ...others] } : { item, parts: [] };
  });
  return filter === null || archived ? entries : entries.filter(entry => members(entry).some(member => projectsOf(member).includes(filter)));
}

/** Whether an entry is in the state the hub shows: open while it or any of its parts is. */
export const entryInState = (entry: HubEntry, state: HubState) => state === 'all' || (state === 'closed') === members(entry).every(member => member.work.state === 'closed');

/** Whether an entry matches the filter menu's filters: one of its plans matches every one that is on. */
export const entryMatchesOnly = (entry: HubEntry, only: readonly HubOnly[], now: number) => members(entry).some(member => matchesOnly(member, only, now));

/** When an entry last changed: the latest change of its plans. */
export const entryChange = (entry: HubEntry): string | null => members(entry).map(member => lastChange(member.work) ?? '').sort().at(-1) || null;

/** The group an entry is in: where its most pressing open plan is (the user's turn before work under way, before waiting, before later); closed once all of it is. */
function entryGroup(entry: HubEntry): HubGroupId {
  const groups = members(entry).filter(member => member.work.state !== 'closed').map(member => groupOf(member.status.key));
  return groupOrder.find(id => groups.includes(id)) ?? 'closed';
}

/** The entries in the state asked for, in their groups (only those with entries), each group the most recently changed first. */
export function hubEntryGroups(entries: HubEntry[], state: HubState): HubEntryGroup[] {
  const shown = entries.filter(entry => entryInState(entry, state)).sort((a, b) =>
    (entryChange(b) ?? '').localeCompare(entryChange(a) ?? '') || a.item.project.position - b.item.project.position || b.item.work.id.localeCompare(a.item.work.id));
  return groupOrder.map(id => ({ id, label: groupLabels[id], entries: shown.filter(entry => entryGroup(entry) === id) })).filter(group => group.entries.length);
}

/** What a group says of its parts while they are folded away: how many, and how many of them are the user's turn. */
export function groupFacts(entry: HubEntry): { count: number; turn: number } | null {
  if (!entry.parts.length) return null;
  return { count: entry.parts.length, turn: entry.parts.filter(part => part.status.key === 'your_turn').length };
}
