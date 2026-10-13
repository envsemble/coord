import test from 'node:test';
import assert from 'node:assert/strict';
import { colourSlots, completedRows, metricValue, modelSummaries, otherSeries, seriesModels, seriesOf, workRows } from './workStatistics.ts';
import { compactNumber, duration, median } from './format.ts';
import { timeTicks, valueTicks } from './components/ScatterChart.tsx';
import type { Snapshot, Work, WorkStatistics } from './types.ts';

const statistics = (model: string | null, tokens: number | null, agentMs: number, planRevisions: number | null, lastReport: string | null = null): WorkStatistics => ({
  reports: model ? 2 : 0, invalid: 0, models: model ? [{ model, reports: 2, sessions: 1, agentMs, tokens, tokenKinds: null }] : [], primaryModel: model, tokens, tokenKinds: null,
  agentMs, measuredMs: 0, estimatedMs: agentMs, measuredReports: 0, firstReport: lastReport, lastReport, planRevisions,
});
const work = (id: string, values: Partial<Work>): Work => ({
  id, path: 'archive/' + id, repositories: ['shop'], currentPlan: null, title: id, location: 'archived', design: 'accepted', implementation: 'complete',
  created: null, updated: '2026-10-01', accepted: null, completed: '2026-10-01', durationDays: null, documents: [], ...values,
});
const snapshot = (items: Work[]) => ({ work: items } as unknown as Snapshot);

test('rows put the most recent activity first and keep the repository scope', () => {
  const rows = workRows(snapshot([
    work('work-0001', { completed: '2026-09-01', statistics: statistics('model-a', 1000, 60000, 2, '2026-09-01T10:00:00Z') }),
    work('work-0002', { implementation: 'in_progress', completed: null, updated: '2026-10-05', repositories: ['web'] }),
    work('work-0003', { completed: '2026-10-03' }),
  ]), 'shop');
  assert.deepEqual(rows.map(row => row.work.id), ['work-0003', 'work-0001']);
  assert.equal(completedRows(workRows(snapshot([work('work-0004', { implementation: 'in_progress', completed: null })]), 'all')).length, 0);
});

test('metric values are absent rather than zero when nothing was reported', () => {
  const [reported, silent] = workRows(snapshot([
    work('work-0001', { completed: '2026-10-02', statistics: statistics('model-a', 1000, 60000, 0), progress: { version: 2, current: null, next: [], blocked: null, updated: null, steps: [{ title: 'A', status: 'done' }, { title: 'B', status: 'done' }] } }),
    work('work-0002', { completed: '2026-10-01', statistics: statistics(null, null, 0, 3) }),
  ]), 'all');
  assert.deepEqual(['tokens', 'agentMs', 'planRevisions', 'steps'].map(metric => metricValue(reported, metric as never)), [1000, 60000, 0, 2]);
  assert.deepEqual(['tokens', 'agentMs', 'planRevisions', 'steps'].map(metric => metricValue(silent, metric as never)), [null, null, 3, null]);
});

test('the three models with the most recent completed work get a colour; the rest share Other', () => {
  const items = ['a', 'a', 'a', 'b', 'b', 'c', 'c', 'd'].map((model, index) => work('work-' + String(index + 1).padStart(4, '0'), { completed: '2026-10-0' + (index % 9 + 1), statistics: statistics('model-' + model, 100 * (index + 1), 60000, index) }));
  items.push(work('work-0009', { completed: '2026-10-09', statistics: statistics(null, null, 0, 1) }));
  const rows = completedRows(workRows(snapshot(items), 'all'));
  const models = seriesModels(rows);
  assert.deepEqual(models, ['model-d', 'model-c', 'model-b'], 'newest first, so a model that has just arrived has a colour');
  assert.equal(seriesOf(rows.find(row => row.work.id === 'work-0001')!, models), otherSeries);
  assert.equal(seriesOf(rows.find(row => row.work.id === 'work-0009')!, models), otherSeries);
  const summaries = modelSummaries(rows);
  const a = summaries.find(summary => summary.model === 'model-a')!;
  assert.deepEqual([a.completed, a.tokens, a.planRevisions, a.first, a.last], [3, 200, 1, '2026-10-01', '2026-10-03']);
  assert.equal(summaries.find(summary => summary.model === null)!.completed, 1);
  const before = colourSlots(['model-c', 'model-b', 'model-a']);
  const after = colourSlots(['model-d', 'model-c', 'model-b']);
  assert.equal(new Set(after.values()).size, 3, 'three different colours');
  const kept = ['model-c', 'model-b'].filter(model => before.get(model) === after.get(model));
  assert.ok(kept.length >= 1, 'models that stay shown mostly keep their colour when a new one arrives');
});

test('formats and chart ticks', () => {
  assert.equal(duration(0), '0 min'); assert.equal(duration(20000), '< 1 min'); assert.equal(duration(45 * 60000), '45 min');
  assert.equal(duration(200 * 60000), '3 h 20 min'); assert.equal(duration(50 * 3600000), '2 d 2 h');
  assert.equal(median([]), null); assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(compactNumber(1234567), new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(1234567));
  assert.deepEqual(valueTicks(0), [0, 1]);
  assert.deepEqual(valueTicks(20), [0, 5, 10, 15, 20]);
  assert.deepEqual(valueTicks(340000), [0, 100000, 200000, 300000, 400000]);
  assert.deepEqual(valueTicks(1, 'count'), [0, 1], 'counts never get fractional ticks');
  assert.deepEqual(valueTicks(3, 'count'), [0, 1, 2, 3]);
  const hour = 3600000;
  assert.deepEqual(valueTicks(5 * hour, 'duration'), [0, 2 * hour, 4 * hour, 6 * hour], 'durations tick at whole hours');
  const day = 86400000;
  const start = new Date(2026, 9, 1).getTime();
  assert.ok(timeTicks(start, start + 10 * day, 6).every(tick => new Date(tick).getHours() === 0));
  assert.ok(timeTicks(start, start + 100 * day, 6).length <= 6, 'a narrow chart gets fewer labels');
  assert.ok(timeTicks(start, start + 400 * day, 8).every(tick => new Date(tick).getDate() === 1), 'long spans tick at month starts');
});
