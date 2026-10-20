import test from 'node:test';
import assert from 'node:assert/strict';
import { agentTimeNote, effortRows, modelShare, otherModels, timeSource } from './workStatistics.ts';
import { absoluteDate, compactNumber, duration, median } from '../ui/format.ts';
import type { WorkStatistics } from '../types.ts';

const statistics = (model: string | null, tokens: number | null, agentMs: number, _revisions: number | null, lastReport: string | null = null): WorkStatistics => ({
  reports: model ? 2 : 0, models: model ? [{ model, reports: 2, sessions: 1, agentMs, tokens, tokenKinds: null, efforts: [] }] : [], primaryModel: model, primaryEffort: null, tokens, tokenKinds: null,
  agentMs, activeMs: agentMs, unmergedMs: agentMs, agents: [], measuredMs: 0, estimatedMs: agentMs, measuredReports: 0, firstReport: lastReport, lastReport, planRevisions: null,
  stages: { planning: none, implementation: { reports: model ? 2 : 0, agentMs, tokens, tokenKinds: null } }, subagents: { count: 0, agentMs: 0 },
});
const none = { reports: 0, agentMs: 0, tokens: null, tokenKinds: null };

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

test('the other models are those that did something besides the primary one', () => {
  const usage = (model: string, agentMs: number, tokens: number | null, reports = 0) => ({ model, reports, sessions: 1, agentMs, tokens, tokenKinds: null, efforts: [] });
  const models = [usage('claude-opus-5-5', 9480000, 13243850, 3), usage('claude-sonnet-4-5', 5400000, 120000, 2), usage('claude-haiku-5-5', 1080000, 451650), usage('idle-model', 0, 0)];
  assert.deepEqual(otherModels({ models, primaryModel: 'claude-opus-5-5' }).map(model => model.model), ['claude-sonnet-4-5', 'claude-haiku-5-5']);
  assert.equal(modelShare(models[2]), '18 min, ' + compactNumber(451650) + ' tokens');
  assert.equal(modelShare(usage('model-a', 0, null, 1)), '', 'a model that only reported did nothing to show');
});

test('formats', () => {
  assert.equal(duration(0), '0 min'); assert.equal(duration(20000), '< 1 min'); assert.equal(duration(45 * 60000), '45 min');
  assert.equal(duration(200 * 60000), '3 h 20 min'); assert.equal(duration(50 * 3600000), '2 d 2 h');
  assert.equal(median([]), null); assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(compactNumber(1234567), new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(1234567));
});

test('time and tokens by model and effort add up to each model’s totals, the rest without an effort', () => {
  const opus = { model: 'claude-opus-5-5', reports: 3, sessions: 1, agentMs: 10 * 3600000, tokens: 1000, tokenKinds: null, efforts: [{ effort: 'high', agentMs: 2 * 3600000, tokens: 300 }] };
  const sonnet = { model: 'claude-sonnet-4-5', reports: 1, sessions: 1, agentMs: 600000, tokens: null, tokenKinds: null, efforts: [] };
  assert.deepEqual(effortRows([opus, sonnet]), [
    { model: 'claude-opus-5-5', effort: 'high', agentMs: 2 * 3600000, tokens: 300 },
    { model: 'claude-opus-5-5', effort: null, agentMs: 8 * 3600000, tokens: 700 },
    { model: 'claude-sonnet-4-5', effort: null, agentMs: 600000, tokens: null },
  ]);
});
