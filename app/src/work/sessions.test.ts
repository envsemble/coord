import test from 'node:test';
import assert from 'node:assert/strict';
import { excerpt, timelineLine, timelineSpan, waitingSession } from './sessions.ts';
import type { WorkSession } from '../types.ts';

const hour = 3600000, day = 24 * hour;

test('the timeline line says how long the work was planned, implemented and waited, from the host or else the plan\'s dates', () => {
  const dates = { created: '2026-10-10', accepted: '2026-10-11', completed: null };
  assert.equal(timelineLine({ plannedMs: day, implementingMs: 4 * day, waitedMs: 3 * hour, lanes: [] }, dates), 'Planned 1 day · implementing 4 days · waited on you 3 h');
  assert.equal(timelineLine(null, dates, Date.parse('2026-10-13T12:00:00')), 'Planned 1 day · implementing 2 days');
  assert.equal(timelineLine(null, { created: null, accepted: null, completed: null }), null);
});

test('a plan\'s sessions: the one waiting with its message, and its message\'s beginning', () => {
  const session = (id: string, state: WorkSession['state'], lastSeen: string, message: string | null): WorkSession => ({ session: id, harness: 'claude-code', title: null, model: null, effort: null, state, startedAt: lastSeen, lastSeen, agentMs: 0, folder: null, resume: null, message });
  assert.equal(waitingSession([session('a', 'waiting', '2026-10-19T10:00:00Z', 'Older'), session('b', 'waiting', '2026-10-19T11:00:00Z', '**Needs your decision:** which?'), session('c', 'ended', '2026-10-19T12:00:00Z', 'Done')])!.session, 'b');
  assert.deepEqual(excerpt('First paragraph.\n\nSecond.'), { text: 'First paragraph.', more: true });
  assert.deepEqual(excerpt('**Needs your decision:** merge it?'), { text: '**Needs your decision:** merge it?', more: false }, 'Markdown stays whole');
  assert.equal(excerpt('word '.repeat(100), 50).more, true, 'a long first paragraph is clamped on the page');
  // The timeline shows up to now; zoomed, the last day or week of it.
  const span = timelineSpan({ plannedMs: null, implementingMs: null, waitedMs: 0, lanes: [{ session: 'a', subagent: null, model: null, effort: null, working: [['2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z']], waiting: [] }] }, Date.parse('2026-10-19T00:00:00Z'), 'all');
  assert.deepEqual(span, { start: Date.parse('2026-10-01T00:00:00Z'), end: Date.parse('2026-10-19T00:00:00Z') });
});
