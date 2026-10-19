import test from 'node:test';
import assert from 'node:assert/strict';
import { shownFile } from './shownFile.ts';
import type { Snapshot } from '../types.ts';

const work = { id: 'work-0001', path: 'active/0001-example', currentPlan: 'active/0001-example/plan.md', ledger: 'active/0001-example/ledger.md', documents: [{ path: 'active/0001-example/plan.md', name: 'plan.md' }] };
const snapshot = { work: [work] } as unknown as Snapshot;

test("Open in Editor opens what the place shows: a plan's document, a diagram's source, a file", () => {
  assert.equal(shownFile({ kind: 'work', work: 'work-0001', view: 'statistics' }, snapshot), 'active/0001-example/plan.md');
  assert.equal(shownFile({ kind: 'diagram', work: 'work-0001', path: 'diagrams/flow.puml' }, snapshot), 'active/0001-example/diagrams/flow.puml');
  assert.equal(shownFile({ kind: 'file', path: 'knowledge/a.md' }, snapshot), 'knowledge/a.md');
  assert.equal(shownFile({ kind: 'work', work: 'work-0009' }, snapshot), null);
});
