// What a project's statistics page works out from the host's figures: the period chosen and its unit,
// how a figure changed against the period before, and the bars of the work over time. Pure, so it is
// unit-tested.
import type { ProjectStatistics } from '../types';
import { orderModels } from '../ui/modelColours';

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

export const modelKey = (model: string | null, effort: string | null) => (model ?? '') + '\u0000' + (effort ?? '');

/**
 * The bars of the work over time: each bucket's agent time by model and effort, stacked in the order
 * the legend lists the period's models (`models`), and the tallest.
 */
export function workBars(statistics: Pick<ProjectStatistics, 'buckets' | 'models'>) {
  const models = orderModels(statistics.models);
  const order = models.map(item => modelKey(item.model, item.effort));
  const rank = (key: string) => { const at = order.indexOf(key); return at < 0 ? order.length : at; };
  const bars = statistics.buckets.map(bucket => ({
    start: bucket.start, activeMs: bucket.activeMs, completed: bucket.completed,
    total: bucket.agents.reduce((sum, item) => sum + item.agentMs, 0),
    parts: [...bucket.agents].sort((a, b) => rank(modelKey(a.model, a.effort)) - rank(modelKey(b.model, b.effort))),
  }));
  return { bars, models, top: Math.max(1, ...bars.map(bar => Math.max(bar.total, bar.activeMs))) };
}
