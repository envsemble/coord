import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import atlas, { type AtlasDocument } from 'ontouml-atlas';
const { createWorkspace } = atlas;
import { AtlasCatalog } from './atlas.ts';
import type { Snapshot } from '../src/types.ts';

test('dashboard serves scoped native payloads, caches revisions and retains valid snapshots', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atlas-dashboard-'));
  try {
    const catalog = new AtlasCatalog(root);
    const snapshot = { work: [{ id: 'work-1' }, { id: 'work-2', location: 'archive' }], documents: [{ path: 'active/1/plan.md', workId: 'work-1' }, { path: 'knowledge/glossary.md', category: 'knowledge' }, { path: 'active/2/plan.md', workId: 'work-2' }] } as unknown as Snapshot;
    assert.deepEqual(catalog.list(snapshot, 'work-1').models, []);
    assert.equal(existsSync(path.join(root, '.atlas')), false, 'viewing does not create model state');
    const workspace = createWorkspace(root);
    const created = await workspace.execute('atlas_create', { input: { id: 'sample', title: 'Orders', profile: 'code', workId: 'work-1', model: { type: 'StructuralModel', nodes: [{ id: 'order', name: 'Order', attributes: [{ id: 'total', name: 'total', type: 'number' }] }], relations: [], generalizations: [], generalizationSets: [] }, context: { records: [{ id: 'plan', kind: 'plan', text: 'A retained passage.', path: 'active/1/plan.md', section: 'Orders' }], links: [{ elementId: 'total', recordId: 'plan' }] } } });
    const handle = created.handle as string;
    assert.equal(catalog.list(snapshot, 'work-1').models.length, 1);
    assert.equal(catalog.list(snapshot, 'work-2').models.length, 0);
    assert.throws(() => catalog.load(snapshot, 'work-2', handle), /another work/);
    assert.throws(() => catalog.load(snapshot, 'unindexed', handle), /indexed/);
    assert.throws(() => catalog.references(snapshot, 'work-1', '../../outside'), /indexed/);
    assert.throws(() => catalog.references(snapshot, 'work-1', 'active/2/plan.md'), /indexed/);
    assert.equal(catalog.references(snapshot, 'work-1', 'active/1/plan.md')[0].elementId, 'total');
    assert.equal(catalog.references({ ...snapshot, caseSensitivePaths: false }, 'work-1', 'ACTIVE/1/PLAN.MD')[0].elementId, 'total');
    assert.throws(() => catalog.references({ ...snapshot, caseSensitivePaths: true }, 'work-1', 'ACTIVE/1/PLAN.MD'), /indexed/);
    const first = await catalog.prepared(snapshot, 'work-1', handle);
    assert.equal(first, await catalog.prepared(snapshot, 'work-1', handle));
    assert.equal(first.exports.bundle, '');
    await workspace.execute('atlas_revise', { handle, expectedRevision: created.revision as string, changes: { title: 'Proposed orders', reason: 'Plan revision' } });
    const next = await catalog.prepared(snapshot, 'work-1', handle);
    assert.notEqual(first, next);
    assert.equal(next.model.title, 'Proposed orders');
    assert.equal(first.model.title, 'Orders');
    const filename = path.join(root, '.atlas/models', handle + '.json');
    const damaged = JSON.parse(readFileSync(filename, 'utf8')) as AtlasDocument;
    damaged.title = 'Unrecorded edit'; writeFileSync(filename, JSON.stringify(damaged));
    assert.equal(catalog.list(snapshot, 'work-1').issues.length, 1);
    await assert.rejects(catalog.prepared(snapshot, 'work-1', handle), /invalid update/);
    assert.equal(next.model.title, 'Proposed orders');
  } finally {
    assert.equal(path.dirname(realpathSync(root)), realpathSync(os.tmpdir()));
    rmSync(root, { recursive: true, force: true });
  }
});
