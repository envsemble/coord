import test from 'node:test';
import assert from 'node:assert/strict';
import { arrived, held, hostNow, liveActiveMs, liveActivity, liveAgentMs } from './agentTime.ts';
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
  // At least one worked since the earliest of them, as no report came later.
  const agentMs = liveAgentMs(60_000, live, now);
  assert.equal(liveActiveMs(60_000, live, now, '2026-10-19T09:30:00Z', agentMs), 60_000 + 8 * 60_000);
  // A report at 10:01 (on the host) may cover 9:55 to 10:01 already: only the time since counts.
  assert.equal(liveActiveMs(60_000, live, now, '2026-10-19T10:01:00Z', agentMs), 60_000 + 2 * 60_000);
  // Waiting adds nothing, nor does a clock behind the host's report.
  assert.equal(liveAgentMs(60_000, { ...live, state: 'waiting' }, now), 60_000);
  assert.equal(liveAgentMs(60_000, live, Date.parse('2026-10-19T09:00:00Z')), 60_000);
});

test('while a report arrives, live agent time neither drops nor grows faster than its agents work', () => {
  const shown = { value: 600_000, at: 1_000, rate: 2 };
  // The listing came first: the open spans start later, the reported time is not there yet.
  assert.equal(held(540_000, shown, 2_000), 600_000);
  // The statistics came first: the report's time is counted twice for now.
  assert.equal(held(900_000, shown, 2_000), 602_000);
  assert.equal(held(601_000, shown, 2_000), 601_000);
});
