import test from 'node:test';
import assert from 'node:assert/strict';
import { workStatus } from './status.ts';

const work = (design: string, implementation: string, blocked: string | null = null) => ({ design, implementation, progress: blocked ? { version: 1 as const, current: null, next: [], blocked, updated: null, steps: null } : null });

test('each work item has one status derived from implementation, blocking and design', () => {
  assert.equal(workStatus(work('accepted', 'not_started')).label, 'Ready');
  assert.equal(workStatus(work('accepted', 'in_progress')).key, 'paused');
  assert.equal(workStatus(work('accepted', 'partial')).key, 'partial');
  assert.equal(workStatus(work('accepted', 'complete')).tone, 'done');
  assert.equal(workStatus(work('accepted', 'in_progress', 'Waiting for review')).key, 'blocked');
  assert.equal(workStatus(work('accepted', 'complete', 'Stale blocker')).key, 'complete', 'completion wins over a stale blocker');
  assert.equal(workStatus(work('draft', 'not_started')).label, 'Draft');
  assert.equal(workStatus(work('draft', 'in_progress')).key, 'paused');
  assert.equal(workStatus(work('superseded', 'complete')).label, 'Superseded');
  assert.equal(workStatus(work('abandoned', 'in_progress')).label, 'Abandoned');
  assert.equal(workStatus(work('unknown', 'unknown')).key, 'unknown');
});

test('what agents do on a work item comes first, before a blocker; closed work keeps how it ended', () => {
  assert.equal(workStatus(work('accepted', 'in_progress', 'Waiting for review'), 'working').key, 'working');
  assert.equal(workStatus(work('draft', 'not_started'), 'waiting').label, 'Needs you');
  assert.equal(workStatus(work('accepted', 'complete'), 'waiting').key, 'complete');
});
