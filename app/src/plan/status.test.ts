import test from 'node:test';
import assert from 'node:assert/strict';
import { statusOf } from './status.ts';
import type { WorkState } from '../types.ts';

const work = (design: string, implementation: string, blocked: string | null = null, location = 'active', state: WorkState | null = null) => ({ design, implementation, location, state, progress: blocked ? { version: 2 as const, current: null, next: [], blocked, updated: null, steps: [] } : null });
const declared = (kind: WorkState['kind'], note: string | null = null): WorkState => ({ kind, note, since: '2026-11-14T10:00:00Z' });

test('without a declared state, a work item shows what its plan says: ready, a draft, blocked, under way with no state, or how it ended', () => {
  assert.equal(statusOf(work('accepted', 'not_started')).label, 'Ready');
  assert.equal(statusOf(work('accepted', 'in_progress')).label, 'No state');
  assert.equal(statusOf(work('accepted', 'complete')).tone, 'done');
  assert.equal(statusOf(work('accepted', 'in_progress', 'Waiting for review')).key, 'blocked');
  assert.equal(statusOf(work('accepted', 'complete', 'Stale blocker')).key, 'complete', 'completion wins over a stale blocker');
  assert.equal(statusOf(work('draft', 'not_started')).label, 'Draft');
  assert.equal(statusOf(work('superseded', 'complete')).label, 'Superseded');
  assert.equal(statusOf(work('abandoned', 'in_progress')).label, 'Abandoned');
  assert.equal(statusOf(work('unknown', 'unknown')).key, 'unknown');
});

test('whose turn its agents declare comes first, before a blocker; closed work keeps how it ended', () => {
  assert.equal(statusOf(work('accepted', 'in_progress', null, 'active', declared('your_turn', 'Merge owner/repo#12'))).label, 'Your turn');
  assert.equal(statusOf(work('draft', 'not_started', null, 'active', declared('planning'))).label, 'Planning');
  assert.equal(statusOf(work('accepted', 'in_progress', 'Old blocker', 'active', declared('waiting', 'CI'))).key, 'waiting');
  assert.equal(statusOf(work('accepted', 'complete', null, 'archived', declared('working'))).key, 'complete');
  assert.equal(statusOf(work('accepted', 'partial', null, 'archived', declared('working'))).key, 'partial');
});
