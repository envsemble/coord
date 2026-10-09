import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, rename } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadPlanning } from '@envsemble/atlas-planning';
import { defaultDocument, relativeDocumentPath } from './work.ts';

const plan = (implementation: string) => ['---', 'schema_version: 1', 'kind: plan', 'id: work-0001', 'title: Example work', 'repositories: [example]', 'created: null', 'updated: "2026-10-06"', 'design_status: accepted', 'implementation_status: ' + implementation, 'accepted_at: null', 'completed_at: null', 'supersedes: []', 'superseded_by: null', '---', '# Original plan', ''].join('\n');

test('the default record follows implementation, and a nested historical ledger never becomes the main record', async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'planning-work-')));
  try {
    const root = path.join(temporary, 'planning');
    const folder = 'active/0001-example';
    await mkdir(path.join(root, folder, 'supporting'), { recursive: true });
    await writeFile(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: [{ id: 'work-0001', path: folder, repositories: ['example'], current_plan: folder + '/plan.md' }] }));
    await writeFile(path.join(root, folder, 'supporting/ledger.md'), '# Historical phase evidence');
    const ledger = path.join(root, folder, 'ledger.md');
    await writeFile(ledger, '---\nschema_version: 1\nkind: ledger\nwork_id: work-0001\nupdated: "2026-10-07"\ncurrent: "Verifying"\nnext: ["Review"]\nblocked: null\n---\n\n# Ledger\n');
    for (const implementation of ['not_started', 'in_progress', 'partial', 'complete']) {
      await writeFile(path.join(root, folder, 'plan.md'), plan(implementation));
      const work = (await loadPlanning(root)).work[0];
      assert.equal(relativeDocumentPath(work.documents.find(file => file.path.endsWith('/supporting/ledger.md'))!), 'supporting/ledger.md');
      assert.equal(defaultDocument(work)?.path, folder + (implementation === 'not_started' ? '/plan.md' : '/ledger.md'));
    }
    await rename(ledger, path.join(root, folder, 'supporting/older-ledger.md'));
    assert.equal(defaultDocument((await loadPlanning(root)).work[0])?.path, folder + '/plan.md');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
