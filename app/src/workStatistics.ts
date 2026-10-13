// What the Statistics page shows about work: agent-reported model, tokens and active time
// (atlas work report), plan revisions from Git, and ledger steps. Pure, so it is unit-tested.
import { stepCounts } from '@envsemble/atlas-planning/ledger';
import type { Snapshot, Work, WorkStatistics } from './types';
import { median } from './format';

export type TrendMetric = 'tokens' | 'agentMs' | 'planRevisions' | 'steps';
export const trendMetrics: { id: TrendMetric; label: string; unit: string }[] = [
  { id: 'tokens', label: 'Tokens', unit: 'tokens per work item' },
  { id: 'agentMs', label: 'Active time', unit: 'active time per work item' },
  { id: 'planRevisions', label: 'Plan revisions', unit: 'plan revisions before completion' },
  { id: 'steps', label: 'Steps', unit: 'ledger steps per work item' },
];

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
