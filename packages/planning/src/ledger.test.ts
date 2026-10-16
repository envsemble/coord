import test from 'node:test';
import assert from 'node:assert/strict';
import { LedgerStatusError, ledgerStatus, stepCounts } from './ledger.ts';

const base = { schema_version: 2, kind: 'ledger', work_id: 'work-0007', updated: '2026-10-11', blocked: null };

test('steps give the current focus, the next steps and the work left', () => {
  const steps = [{ title: 'One', status: 'done' }, { title: 'Two', status: 'doing' }, { title: 'Three', status: 'doing' }, { title: 'Four', status: 'todo' }];
  const progress = ledgerStatus({ ...base, steps }, 'work-0007');
  assert.equal(progress.version, 2);
  assert.equal(progress.current, 'Two; Three');
  assert.deepEqual(progress.next, ['Four']);
  assert.deepEqual(stepCounts(progress.steps!), { total: 4, done: 1, doing: 2, todo: 1, remaining: 3 });
  assert.deepEqual(stepCounts([]), { total: 0, done: 0, doing: 0, todo: 0, remaining: 0 });
  assert.equal(ledgerStatus({ ...base, steps: [{ title: 'Only', status: 'done' }] }, 'work-0007').current, null);
});

test('titles are trimmed and compared for uniqueness after trimming', () => {
  assert.deepEqual(ledgerStatus({ ...base, steps: [{ title: '  Padded  ', status: 'todo' }] }, 'work-0007').steps, [{ title: 'Padded', status: 'todo' }]);
  assert.throws(() => ledgerStatus({ ...base, steps: [{ title: 'Same', status: 'todo' }, { title: ' Same', status: 'done' }] }, 'work-0007'), LedgerStatusError);
});

test('version 1 stays readable with its extra fields; version 2 is exact', () => {
  const version1 = { schema_version: 1, kind: 'ledger', work_id: 'work-0007', updated: null, current: 'Focus', next: ['Later'], blocked: null };
  const legacy = ledgerStatus({ ...version1, note: 'kept' }, 'work-0007');
  assert.deepEqual(legacy, { version: 1, current: 'Focus', next: ['Later'], blocked: null, updated: null, steps: null });
  assert.throws(() => ledgerStatus({ ...version1, next: 'Guess a phase' }, 'work-0007'), /next/);
  assert.throws(() => ledgerStatus({ ...version1, current: '' }, 'work-0007'), /current/);
  assert.throws(() => ledgerStatus({ ...base, steps: [], next: [] }, 'work-0007'), /steps replace current and next/);
  assert.throws(() => ledgerStatus({ ...base, steps: [] }, 'work-0008'), /work_id/);
  assert.throws(() => ledgerStatus({ ...base, updated: '2026-02-30', steps: [] }, 'work-0007'), /updated/);
  assert.throws(() => ledgerStatus({ ...base, blocked: '', steps: [] }, 'work-0007'), /blocked/);
  assert.throws(() => ledgerStatus({ ...base, steps: [['Not a step']] }, 'work-0007'), /title and a status/);
  assert.throws(() => ledgerStatus({ ...base, steps: [{ title: 'One', status: 'started' }] }, 'work-0007'), /status must be todo, doing or done/);
  assert.throws(() => ledgerStatus({ ...base, steps: [{ title: 'One' }] }, 'work-0007'), /status must be todo, doing or done/);
  assert.throws(() => ledgerStatus({ ...base, steps: 'all of them' }, 'work-0007'), /steps must be a list/);
});
