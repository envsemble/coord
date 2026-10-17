import test from 'node:test';
import assert from 'node:assert/strict';
import { designNote, workStatus } from './status.ts';

const work = (design: string, implementation: string, blocked: string | null = null) => ({ design, implementation, progress: blocked ? { version: 1 as const, current: null, next: [], blocked, updated: null, steps: null } : null });

test('each work item has one status derived from implementation, blocking and design', () => {
  assert.equal(workStatus(work('accepted', 'not_started')).label, 'Not started');
  assert.equal(workStatus(work('accepted', 'in_progress')).tone, 'open');
  assert.equal(workStatus(work('accepted', 'partial')).key, 'partial');
  assert.equal(workStatus(work('accepted', 'complete')).tone, 'done');
  assert.equal(workStatus(work('accepted', 'in_progress', 'Waiting for review')).key, 'blocked');
  assert.equal(workStatus(work('accepted', 'complete', 'Stale blocker')).key, 'complete', 'completion wins over a stale blocker');
  assert.equal(workStatus(work('draft', 'not_started')).label, 'Draft plan');
  assert.equal(workStatus(work('draft', 'in_progress')).key, 'in_progress');
  assert.equal(workStatus(work('superseded', 'complete')).label, 'Superseded');
  assert.equal(workStatus(work('abandoned', 'in_progress')).label, 'Abandoned');
  assert.equal(workStatus(work('unknown', 'unknown')).key, 'unknown');
});

test('design status is shown only when it is not implied', () => {
  assert.equal(designNote(work('accepted', 'in_progress')), null);
  assert.equal(designNote(work('draft', 'not_started')), null);
  assert.equal(designNote(work('draft', 'in_progress')), 'Draft plan');
  assert.equal(designNote(work('unknown', 'unknown')), null);
});
