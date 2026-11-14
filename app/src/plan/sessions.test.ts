import test from 'node:test';
import assert from 'node:assert/strict';
import { panView, timelineLine, timelineSpan, zoomView } from './sessions.ts';

const hour = 3600000, day = 24 * hour;

test('the timeline line says how long the work was planned, implemented and waited, from the host or else the plan\'s dates', () => {
  const dates = { created: '2026-10-10', accepted: '2026-10-11', completed: null };
  assert.equal(timelineLine({ plannedMs: day, implementingMs: 4 * day, waitedMs: 3 * hour, lanes: [] }, dates), 'Planned 1 day · implementing 4 days · waited on you 3 h');
  assert.equal(timelineLine(null, dates, Date.parse('2026-10-13T12:00:00')), 'Planned 1 day · implementing 2 days');
  assert.equal(timelineLine(null, { created: null, accepted: null, completed: null }), null);
});

test('the timeline shows its stretches, up to now while agents are on the plan', () => {
  const timeline = { plannedMs: null, implementingMs: null, waitedMs: 0, lanes: [{ session: 'a', subagent: null, model: null, effort: null, working: [['2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z']] as [string, string][], waiting: [] }] };
  assert.deepEqual(timelineSpan(timeline, Date.parse('2026-10-19T00:00:00Z'), 'all'), { start: Date.parse('2026-10-01T00:00:00Z'), end: Date.parse('2026-10-02T00:00:00Z') });
  assert.deepEqual(timelineSpan(timeline, Date.parse('2026-10-19T00:00:00Z'), 'all', true), { start: Date.parse('2026-10-01T00:00:00Z'), end: Date.parse('2026-10-19T00:00:00Z') });
});

test('the timeline zooms around the moment under the pointer and moves along, within its whole span', () => {
  const limit = { start: 0, end: 100 * hour };
  // Zoomed in by half around 40 h: 40 h stays where it was, a fifth of the way across.
  assert.deepEqual(zoomView({ start: 20 * hour, end: 120 * hour }, 0.5, 40 * hour, limit), { start: 30 * hour, end: 80 * hour });
  // Never wider than the whole, nor past its ends.
  assert.deepEqual(zoomView({ start: 0, end: 50 * hour }, 4, 25 * hour, limit), limit);
  assert.deepEqual(panView({ start: 60 * hour, end: 90 * hour }, 20 * hour, limit), { start: 70 * hour, end: 100 * hour });
});
