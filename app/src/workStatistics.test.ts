import test from 'node:test';
import assert from 'node:assert/strict';
import { agentTimeNote, colourSlots, completedRows, metricValue, modelShare, modelSummaries, otherModels, otherSeries, seriesModels, seriesOf, shownStages, stageShare, stageUsage, subagentShare, timeSource, tokenRows, tokenText, workRows } from './workStatistics.ts';
import { absoluteDate, compactNumber, duration, median, shortAge, shortDate } from './format.ts';
import { timeTicks, valueTicks } from './components/ScatterChart.tsx';
import type { Snapshot, Work, WorkStatistics } from './types.ts';

const statistics = (model: string | null, tokens: number | null, agentMs: number, planRevisions: number | null, lastReport: string | null = null): WorkStatistics => ({
  reports: model ? 2 : 0, invalid: 0, models: model ? [{ model, reports: 2, sessions: 1, agentMs, tokens, tokenKinds: null }] : [], primaryModel: model, tokens, tokenKinds: null,
  agentMs, measuredMs: 0, estimatedMs: agentMs, measuredReports: 0, firstReport: lastReport, lastReport, planRevisions,
  stages: { planning: none, implementation: none, unknown: { reports: model ? 2 : 0, agentMs, tokens, tokenKinds: null } }, subagents: { count: 0, agentMs: 0 },
});
const none = { reports: 0, agentMs: 0, tokens: null, tokenKinds: null };
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

test('agent time says whether it was measured or estimated, and since when', () => {
  const measured = { ...statistics('claude-opus-5-5', 5000, 3600000, 0), measuredMs: 3600000, estimatedMs: 0, measuredReports: 2, firstReport: '2026-10-08T13:00:00.000Z' };
  assert.equal(timeSource(measured), 'measured');
  assert.equal(agentTimeNote(measured), 'Measured from the agent\'s session logs since ' + absoluteDate('2026-10-08T13:00:00.000Z') + ': the time it worked, not the time it waited for a person.');
  const mixed = { ...measured, agentMs: 5400000, estimatedMs: 1800000 };
  assert.equal(timeSource(mixed), 'mixed');
  assert.match(agentTimeNote(mixed), /^1 h measured from the agent's session logs and 30 min estimated from the time between its reports, since .+\.$/);
  const estimated = statistics('model-a', null, 1800000, 0, '2026-10-08T13:00:00.000Z');
  assert.equal(timeSource(estimated), 'estimated');
  assert.match(agentTimeNote(estimated), /^Estimated from the time between the agent's reports since .+; breaks of more than two hours are left out\.$/);
  assert.equal(timeSource(statistics(null, null, 0, 1)), null, 'no reports, nothing to say');
});

test('tokens break down by kind, with any self-reported tokens apart', () => {
  const kinds = { input: 9300, cacheRead: 12959000, cacheWrite: 537800, output: 189400 };
  assert.deepEqual(tokenRows({ tokens: 13815500, tokenKinds: kinds }), [
    { label: 'Cached input', value: 12959000 }, { label: 'Cache writes', value: 537800 }, { label: 'Input', value: 9300 }, { label: 'Output', value: 189400 }, { label: 'Self-reported', value: 120000 },
  ]);
  assert.deepEqual(tokenRows({ tokens: 13695500, tokenKinds: kinds }).map(row => row.label), ['Cached input', 'Cache writes', 'Input', 'Output'], 'all measured');
  assert.deepEqual(tokenRows({ tokens: 3000, tokenKinds: null }), [{ label: 'Self-reported', value: 3000 }]);
  assert.deepEqual(tokenRows({ tokens: null, tokenKinds: null }), []);
  assert.equal(tokenText({ tokens: 3000, tokenKinds: null }), 'Self-reported ' + compactNumber(3000));
});

test('the other models are those that did something besides the primary one', () => {
  const usage = (model: string, agentMs: number, tokens: number | null, reports = 0) => ({ model, reports, sessions: 1, agentMs, tokens, tokenKinds: null });
  const models = [usage('claude-opus-5-5', 9480000, 13243850, 3), usage('claude-sonnet-4-5', 5400000, 120000, 2), usage('claude-haiku-5-5', 1080000, 451650), usage('idle-model', 0, 0)];
  assert.deepEqual(otherModels({ models, primaryModel: 'claude-opus-5-5' }).map(model => model.model), ['claude-sonnet-4-5', 'claude-haiku-5-5']);
  assert.equal(modelShare(models[2]), '18 min, ' + compactNumber(451650) + ' tokens');
  assert.equal(modelShare(usage('model-a', 0, null, 1)), '', 'a model that only reported did nothing to show');
});

test('planning and implementation show apart once reports record a stage, with reports from before stages beside them', () => {
  const older = statistics('model-a', 3000, 1800000, 0);
  assert.deepEqual(shownStages(older), [], 'only reports from before stages: no split to show');
  assert.equal(stageUsage(older, 'planning'), null);
  assert.equal(stageUsage(older, 'unknown')?.agentMs, 1800000);
  const planned = { ...older, stages: { ...older.stages, planning: { reports: 2, agentMs: 5400000, tokens: 120000, tokenKinds: null } } };
  assert.deepEqual(shownStages(planned), ['planning', 'unknown']);
  const staged = { ...planned, stages: { ...planned.stages, implementation: { reports: 3, agentMs: 9480000, tokens: null, tokenKinds: null }, unknown: none } };
  assert.deepEqual(shownStages(staged), ['planning', 'implementation']);
  assert.equal(stageShare(staged.stages.planning), '1 h 30 min, ' + compactNumber(120000) + ' tokens');
  assert.equal(stageShare(staged.stages.implementation), '2 h 38 min', 'tokens unknown');
  assert.deepEqual(shownStages(null), []);
  assert.equal(subagentShare(staged), null, 'no subagent measured');
  assert.equal(subagentShare({ subagents: { count: 1, agentMs: 1080000 } }), '1 subagent, 18 min');
  assert.equal(subagentShare({ subagents: { count: 3, agentMs: 5400000 } }), '3 subagents, 1 h 30 min');
});

test('formats and chart ticks', () => {
  assert.equal(duration(0), '0 min'); assert.equal(duration(20000), '< 1 min'); assert.equal(duration(45 * 60000), '45 min');
  assert.equal(duration(200 * 60000), '3 h 20 min'); assert.equal(duration(50 * 3600000), '2 d 2 h');
  const now = Date.parse('2026-10-15T12:00:00Z');
  const ago = (minutes: number) => new Date(now - minutes * 60000).toISOString();
  assert.deepEqual([ago(0.5), ago(-5), ago(11), ago(59), ago(60), ago(23 * 60 + 59), ago(24 * 60), ago(29 * 1440)].map(value => shortAge(value, now)), ['now', 'now', '11m', '59m', '1h', '23h', '1d', '29d'], 'a card says how long ago briefly; a clock ahead says now');
  assert.equal(shortAge(ago(30 * 1440), now), shortDate(ago(30 * 1440)), 'a month or more ago, the date');
  assert.deepEqual([shortAge(null, now), shortAge('', now), shortAge('not a date', now)], ['', '', '']);
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
