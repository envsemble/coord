import test from 'node:test';
import assert from 'node:assert/strict';
import { statusOf } from './status.ts';

const work = (design: string, implementation: string, blocked: string | null = null, location = 'active') => ({ design, implementation, location, progress: blocked ? { version: 2 as const, current: null, next: [], blocked, updated: null, steps: [] } : null });

test('each work item has one status derived from implementation, blocking and design', () => {
  assert.equal(statusOf(work('accepted', 'not_started')).label, 'Ready');
  assert.equal(statusOf(work('accepted', 'in_progress')).key, 'paused');
  assert.equal(statusOf(work('accepted', 'partial')).key, 'partial');
  assert.equal(statusOf(work('accepted', 'complete')).tone, 'done');
  assert.equal(statusOf(work('accepted', 'in_progress', 'Waiting for review')).key, 'blocked');
  assert.equal(statusOf(work('accepted', 'complete', 'Stale blocker')).key, 'complete', 'completion wins over a stale blocker');
  assert.equal(statusOf(work('draft', 'not_started')).label, 'Draft');
  assert.equal(statusOf(work('draft', 'in_progress')).key, 'paused');
  assert.equal(statusOf(work('superseded', 'complete')).label, 'Superseded');
  assert.equal(statusOf(work('abandoned', 'in_progress')).label, 'Abandoned');
  assert.equal(statusOf(work('unknown', 'unknown')).key, 'unknown');
});

test('what agents do on a work item comes first, before a blocker; closed work keeps how it ended', () => {
  assert.equal(statusOf(work('accepted', 'in_progress', 'Waiting for review'), 'working').key, 'working');
  assert.equal(statusOf(work('draft', 'not_started'), 'waiting').label, 'Needs you');
  assert.equal(statusOf(work('accepted', 'complete'), 'waiting').key, 'complete');
  assert.equal(statusOf(work('accepted', 'partial', null, 'archived'), 'working').key, 'partial');
  assert.equal(statusOf(work('accepted', 'partial'), 'working').key, 'working', 'partly done work still open is not closed');
});
