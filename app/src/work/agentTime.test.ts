import test from 'node:test';
import assert from 'node:assert/strict';
import { arrived, hostNow, liveActiveMs, liveActivity, liveAgentMs } from './agentTime.ts';
import type { ProjectSummary, SessionActivity } from '../types.ts';

const session = (name: string, state: SessionActivity['state'], countsFrom: string | null): SessionActivity => ({ session: name, harness: 'claude-code', state, since: countsFrom ?? '2026-10-19T09:00:00Z', countsFrom });

test('agent time counts up on the host\'s clock: each working session adds its time since its last report', () => {
  // The host's clock is two minutes ahead of this computer's.
  const summary: ProjectSummary = {
    repositories: [], active: [], closed: [], updated: null, now: '2026-10-19T10:02:00Z',
    activity: [{ workId: 'work-0023', state: 'working', since: '2026-10-19T09:50:00Z', sessions: [
      session('a', 'working', '2026-10-19T10:00:00Z'), session('b', 'working', '2026-10-19T09:55:00Z'), session('c', 'waiting', null),
    ] }],
  };
  arrived(summary, Date.parse('2026-10-19T10:00:00Z'));
  const live = liveActivity(summary, 'work-0023')!;
  assert.equal(live.skew, 120_000);
  assert.equal(liveActivity(summary, 'work-0001'), null);
  // A minute later here: 10:03 on the host.
  const now = hostNow(live, Date.parse('2026-10-19T10:01:00Z'));
  assert.equal(now, Date.parse('2026-10-19T10:03:00Z'));
  // Two working agents add their 3 and 8 minutes; the one waiting adds nothing.
  assert.equal(liveAgentMs(60_000, live, now), 60_000 + 3 * 60_000 + 8 * 60_000);
  // At least one worked since the earliest of them.
  assert.equal(liveActiveMs(60_000, live, now), 60_000 + 8 * 60_000);
  // Waiting adds nothing, nor does a clock behind the host's report.
  assert.equal(liveAgentMs(60_000, { ...live, state: 'waiting' }, now), 60_000);
  assert.equal(liveAgentMs(60_000, live, Date.parse('2026-10-19T09:00:00Z')), 60_000);
});
