import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, rename } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadPlanning } from '@envsemble/atlas/planning';
import { defaultDocument, stepPhase } from './work.ts';
import type { LedgerStep } from '../types.ts';

const plan = (implementation: string) => ['---', 'schema_version: 2', 'kind: plan', 'id: work-0001', 'title: Example work','created: null', 'updated: "2026-10-06"', 'design_status: accepted', 'implementation_status: ' + implementation, 'accepted_at: null', 'completed_at: null', 'supersedes: []', 'superseded_by: null', '---', '# Original plan', ''].join('\n');

test('a work item reads its plan, never its ledger, whatever its implementation', async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'planning-work-')));
  try {
    const root = path.join(temporary, 'planning');
    const folder = 'active/0001-example';
    await mkdir(path.join(root, folder, 'supporting'), { recursive: true });
    await writeFile(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 2, name: 'Example', folders: [], work_items: [{ id: 'work-0001', path: folder, current_plan: folder + '/plan.md' }] }));
    await writeFile(path.join(root, folder, 'supporting/ledger.md'), '# Historical phase evidence');
    const ledger = path.join(root, folder, 'ledger.md');
    await writeFile(ledger, '---\nschema_version: 2\nkind: ledger\nwork_id: work-0001\nupdated: "2026-10-07"\nblocked: null\nsteps:\n  - title: "Verifying"\n    status: doing\n  - title: "Review"\n    status: todo\n---\n\n# Ledger\n');
    for (const implementation of ['not_started', 'in_progress', 'partial', 'complete']) {
      await writeFile(path.join(root, folder, 'plan.md'), plan(implementation));
      const work = (await loadPlanning(root)).work[0];
      assert.ok(work.documents.some(file => file.path.endsWith('/supporting/ledger.md')));
      assert.equal(defaultDocument(work)?.path, folder + '/plan.md');
    }
    await rename(ledger, path.join(root, folder, 'supporting/older-ledger.md'));
    assert.equal(defaultDocument((await loadPlanning(root)).work[0])?.path, folder + '/plan.md');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('a ledger step is a planning step when its header says so, else an implementation step', () => {
  const step = (phase?: unknown) => ({ title: 'Settle the design', status: 'done', ...phase !== undefined && { phase } }) as LedgerStep;
  assert.equal(stepPhase(step('planning')), 'planning');
  assert.equal(stepPhase(step()), 'implementation', 'a step without a phase');
  assert.equal(stepPhase(step('implementation')), 'implementation');
  assert.equal(stepPhase(step('other')), 'implementation');
  assert.equal(stepPhase(step(null)), 'implementation');
});
