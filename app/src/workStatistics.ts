// What the Statistics page and a work item's About sidebar show about work: the model, agent time
// and tokens from agent reports (atlas work report), by stage, with the subagents that worked, plan
// revisions from Git, and ledger steps. Pure, so it is unit-tested.
import { stepCounts } from '@envsemble/atlas-planning/ledger';
import type { StageUsage, TokenKinds, WorkStage } from '@envsemble/atlas-planning/types';
import type { ModelUsage, Snapshot, Work, WorkStatistics } from './types';
import { absoluteDate, compactNumber, duration, median, plural } from './format';

export type TrendMetric = 'tokens' | 'agentMs' | 'planRevisions' | 'steps';
export const trendMetrics: { id: TrendMetric; label: string; unit: string }[] = [
  { id: 'agentMs', label: 'Agent time', unit: 'agent time per work item' },
  { id: 'tokens', label: 'Tokens', unit: 'tokens per work item' },
  { id: 'planRevisions', label: 'Plan revisions', unit: 'plan revisions before completion' },
  { id: 'steps', label: 'Steps', unit: 'ledger steps per work item' },
];

type Timed = Pick<WorkStatistics, 'reports' | 'agentMs' | 'measuredMs' | 'estimatedMs' | 'measuredReports' | 'firstReport'>;
/** How agent time was counted: measured from session logs, estimated from report times, or both. */
export function timeSource(statistics: Timed): 'measured' | 'estimated' | 'mixed' | null {
  if (!statistics.reports) return null;
  return !statistics.measuredReports ? 'estimated' : statistics.estimatedMs > 0 ? 'mixed' : 'measured';
}
/** What agent time stands for, and since when it is counted. */
export function agentTimeNote(statistics: Timed): string {
  const since = statistics.firstReport ? ' since ' + absoluteDate(statistics.firstReport) : '';
  switch (timeSource(statistics)) {
    case 'measured': return 'Measured from the agent\'s session logs' + since + ': the time it worked, not the time it waited for a person.';
    case 'mixed': return duration(statistics.measuredMs) + ' measured from the agent\'s session logs and ' + duration(statistics.estimatedMs) + ' estimated from the time between its reports,' + since + '.';
    case 'estimated': return 'Estimated from the time between the agent\'s reports' + since + '; breaks of more than two hours are left out.';
    default: return 'No agent reports yet.';
  }
}

/** The token breakdown: cached input, cache writes, input and output as measured, then any self-reported tokens. */
export function tokenRows(usage: { tokens: number | null; tokenKinds: TokenKinds | null }): { label: string; value: number }[] {
  if (usage.tokens === null) return [];
  const kinds = usage.tokenKinds;
  const rows = kinds ? [{ label: 'Cached input', value: kinds.cacheRead }, { label: 'Cache writes', value: kinds.cacheWrite }, { label: 'Input', value: kinds.input }, { label: 'Output', value: kinds.output }] : [];
  const reported = usage.tokens - rows.reduce((sum, row) => sum + row.value, 0);
  if (reported > 0 || !kinds) rows.push({ label: 'Self-reported', value: reported });
  return rows;
}
/** The breakdown as one line, for titles and assistive technology. */
export const tokenText = (usage: { tokens: number | null; tokenKinds: TokenKinds | null }) => tokenRows(usage).map(row => row.label + ' ' + compactNumber(row.value)).join(' · ');

export type StageKey = WorkStage | 'unknown';
export const stageLabels: Record<StageKey, string> = { planning: 'Planning', implementation: 'Implementation', unknown: 'Stage not recorded' };
/** A stage's agent time and tokens, when reports of it exist. */
export function stageUsage(statistics: Pick<WorkStatistics, 'stages'> | null, stage: StageKey): StageUsage | null {
  const usage = statistics?.stages?.[stage];
  return usage?.reports ? usage : null;
}
/** The stages a work item shows: those reported, with reports from before stages beside them; none when no report has a stage. */
export function shownStages(statistics: Pick<WorkStatistics, 'stages'> | null): StageKey[] {
  const known = (['planning', 'implementation'] as const).filter(stage => stageUsage(statistics, stage));
  return known.length && stageUsage(statistics, 'unknown') ? [...known, 'unknown'] : known;
}
/** What a stage took: "1 h 30 min, 120K tokens". */
export function stageShare(usage: StageUsage) {
  return [duration(usage.agentMs), usage.tokens !== null ? compactNumber(usage.tokens) + ' tokens' : null].filter(Boolean).join(', ');
}
/** How many subagents worked and for how long, each its own time added up: "2 subagents, 18 min"; null when none was measured. */
export function subagentShare(statistics: Pick<WorkStatistics, 'subagents'> | null) {
  const subagents = statistics?.subagents;
  return subagents?.count ? plural(subagents.count, 'subagent') + ', ' + duration(subagents.agentMs) : null;
}

/** The models besides the primary one that did something, most agent time first. */
export function otherModels(statistics: Pick<WorkStatistics, 'models' | 'primaryModel'>): ModelUsage[] {
  return statistics.models.filter(model => model.model !== statistics.primaryModel && (model.agentMs > 0 || (model.tokens ?? 0) > 0 || model.reports > 0));
}
/** What one model did: "20 min, 1.3K tokens". */
export function modelShare(model: ModelUsage) {
  return [model.agentMs ? duration(model.agentMs) : null, model.tokens !== null ? compactNumber(model.tokens) + ' tokens' : null].filter(Boolean).join(', ');
}

export interface WorkRow { work: Work; statistics: WorkStatistics | null; steps: number | null; stepsDone: number | null; last: string | null }

/** Every work item in scope, most recently active first. */
export function workRows(snapshot: Snapshot, repository: string): WorkRow[] {
  return snapshot.work
    .filter(work => repository === 'all' || work.repositories.includes(repository))
    .map(work => {
      const counts = work.progress?.steps ? stepCounts(work.progress.steps) : null;
      const statistics = work.statistics ?? null;
      return { work, statistics, steps: counts?.total ?? null, stepsDone: counts?.done ?? null, last: statistics?.lastReport ?? work.completed ?? work.updated };
    })
    .sort((a, b) => (b.last ?? '').localeCompare(a.last ?? '') || b.work.id.localeCompare(a.work.id));
}

export function metricValue(row: WorkRow, metric: TrendMetric): number | null {
  if (metric === 'steps') return row.steps || null;
  if (metric === 'planRevisions') return row.statistics?.planRevisions ?? null;
  if (!row.statistics?.reports) return null;
  return metric === 'tokens' ? row.statistics.tokens : row.statistics.agentMs || null;
}

/** Completed work, which the trends compare: each item at its completion date. */
export function completedRows(rows: WorkRow[]) {
  return rows.filter(row => row.work.implementation === 'complete' && row.work.completed);
}

export const otherSeries = 'other';
/**
 * The models shown in their own colour: the three whose completed work is most recent, newest
 * first, so a model that has just arrived is visible. A scatter compares every pair of colours, so
 * it holds three; older models and unreported work share "Other".
 */
export function seriesModels(rows: WorkRow[]): string[] {
  const latest = new Map<string, string>();
  for (const row of rows) {
    const model = row.statistics?.primaryModel;
    const completed = row.work.completed ?? '';
    if (model && completed > (latest.get(model) ?? '')) latest.set(model, completed);
  }
  return [...latest].sort((a, b) => b[1].localeCompare(a[1]) || a[0].localeCompare(b[0])).slice(0, 3).map(([model]) => model);
}
export function seriesOf(row: WorkRow, models: string[]) {
  const model = row.statistics?.primaryModel;
  return model && models.includes(model) ? model : otherSeries;
}

/**
 * Which colour slot each shown model takes. A model prefers the slot its name hashes to, so it
 * keeps its colour while other models come and go; the most recent model chooses first.
 */
export function colourSlots(models: string[], slots = 3): Map<string, number> {
  const taken = new Map<string, number>();
  const used = new Set<number>();
  for (const model of models) {
    let hash = 0;
    for (const character of model) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
    let slot = hash % slots;
    while (used.has(slot)) slot = (slot + 1) % slots;
    used.add(slot);
    taken.set(model, slot);
  }
  return taken;
}

export interface ModelSummary {
  model: string | null; completed: number; tokens: number | null; agentMs: number | null; planRevisions: number | null; steps: number | null;
  first: string | null; last: string | null;
}
/** Medians per implementing model (the primary model of each completed work item), most recent first. */
export function modelSummaries(rows: WorkRow[]): ModelSummary[] {
  const groups = new Map<string | null, WorkRow[]>();
  for (const row of rows) {
    const model = row.statistics?.primaryModel ?? null;
    groups.set(model, [...(groups.get(model) ?? []), row]);
  }
  const values = (group: WorkRow[], metric: TrendMetric) => median(group.map(row => metricValue(row, metric)).filter((value): value is number => value !== null));
  return [...groups].map(([model, group]) => {
    const dates = group.map(row => row.work.completed!).sort();
    return { model, completed: group.length, tokens: values(group, 'tokens'), agentMs: values(group, 'agentMs'), planRevisions: values(group, 'planRevisions'), steps: values(group, 'steps'), first: dates[0] ?? null, last: dates.at(-1) ?? null };
  }).sort((a, b) => (b.last ?? '').localeCompare(a.last ?? '') || (a.model === null ? 1 : b.model === null ? -1 : a.model.localeCompare(b.model)));
}
