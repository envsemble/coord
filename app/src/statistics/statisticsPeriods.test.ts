import test from 'node:test';
import assert from 'node:assert/strict';
import { change, periodStart, workBars } from './statisticsPeriods.ts';

test('a project\'s statistics: the period chosen, how each figure changed against the period before, and the bars of work over time', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  assert.equal(periodStart('month', now), '2026-09-21T12:00:00.000Z');
  assert.equal(periodStart('all', now), null);
  assert.deepEqual(change(6, 4), { by: 2, percent: 50, direction: 'up' });
  assert.deepEqual(change(3, 0), { by: 3, percent: null, direction: 'up' }, 'no percent from nothing');
  assert.equal(change(3, null), null, 'nothing to compare all time with');
  const { bars, top } = workBars({
    models: [{ model: 'claude-opus-5-5', effort: 'high', agentMs: 5, tokens: null }, { model: null, effort: null, agentMs: 1, tokens: null }],
    buckets: [{ start: '2026-10-19T00:00:00', agents: [{ model: null, effort: null, agentMs: 1 }, { model: 'claude-opus-5-5', effort: 'high', agentMs: 5 }], activeMs: 4, completed: [] }],
  });
  assert.deepEqual(bars[0].parts.map(part => part.model), ['claude-opus-5-5', null], 'stacked in the legend\'s order of models');
  assert.equal(top, 6);
});
