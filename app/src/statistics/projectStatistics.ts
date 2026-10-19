// What a project's statistics page works out from the host's figures: the period chosen and its unit,
// how a figure changed against the period before, the name and colour of a model at an effort (the
// same colour wherever Atlas shows it), and the bars of the work over time. Pure, so it is
// unit-tested.
import type { ProjectStatistics } from '../types';
import { aiModel, withEffort } from '../ui/aiModels';

export type PeriodId = 'month' | 'quarter' | 'all';
const day = 24 * 3600000;
/** The periods the page offers: the last 4 weeks by day, the last 3 months and all time by week. */
export const periods: { id: PeriodId; label: string; unit: 'day' | 'week'; days: number | null; before: string }[] = [
  { id: 'month', label: 'Last 4 weeks', unit: 'day', days: 28, before: 'the 4 weeks before' },
  { id: 'quarter', label: 'Last 3 months', unit: 'week', days: 91, before: 'the 3 months before' },
  { id: 'all', label: 'All time', unit: 'week', days: null, before: '' },
];
/** Where a period starts, as an ISO time; null for all time. */
export function periodStart(id: PeriodId, now = Date.now()): string | null {
  const days = periods.find(period => period.id === id)!.days;
  return days === null ? null : new Date(now - days * day).toISOString();
}

/** How a figure changed against the period before: by how much, by how many percent, which way; null when there is nothing to compare. */
export function change(current: number | null, previous: number | null): { by: number; percent: number | null; direction: 'up' | 'down' | 'same' } | null {
  if (current === null || previous === null) return null;
  const by = current - previous;
  return { by, percent: previous ? Math.round(by / previous * 100) : null, direction: by > 0 ? 'up' : by < 0 ? 'down' : 'same' };
}

/** A model at an effort as the page names it; "Model not recorded" where no log named one. */
export const modelLabel = (model: string | null, effort: string | null) => model ? withEffort(aiModel(model).name, effort) : 'Model not recorded';
/** The colours models at an effort take, Atlas's chart colours and envUI's tones. */
export const modelColours = ['var(--atlas-chart-1)', 'var(--atlas-chart-2)', 'var(--atlas-chart-3)', 'var(--color-tone-done)', 'var(--color-tone-accent)', 'var(--color-tone-warning)', 'var(--color-tone-success)'];
/** A model at an effort's colour, the same wherever it shows; a model not recorded is neutral. */
export function modelColour(model: string | null, effort: string | null): string {
  if (!model) return 'var(--atlas-chart-other)';
  let hash = 0;
  for (const character of model + '\u0000' + (effort ?? '')) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return modelColours[hash % modelColours.length];
}
export const modelKey = (model: string | null, effort: string | null) => (model ?? '') + '\u0000' + (effort ?? '');

/** The bars of the work over time: each bucket's agent time by model and effort, in the order of the period's models, and the tallest. */
export function workBars(statistics: Pick<ProjectStatistics, 'buckets' | 'models'>) {
  const order = statistics.models.map(item => modelKey(item.model, item.effort));
  const rank = (key: string) => { const at = order.indexOf(key); return at < 0 ? order.length : at; };
  const bars = statistics.buckets.map(bucket => ({
    start: bucket.start, activeMs: bucket.activeMs, completed: bucket.completed,
    total: bucket.agents.reduce((sum, item) => sum + item.agentMs, 0),
    parts: [...bucket.agents].sort((a, b) => rank(modelKey(a.model, a.effort)) - rank(modelKey(b.model, b.effort))),
  }));
  return { bars, top: Math.max(1, ...bars.map(bar => Math.max(bar.total, bar.activeMs))) };
}
