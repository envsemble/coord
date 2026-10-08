import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import atlas, { type AtlasDocument } from 'ontouml-atlas';
const { createWorkspace } = atlas;
import { AtlasCatalog } from './atlas.ts';
import { createScopeCache } from './atlasScope.ts';
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
    assert.throws(() => catalog.references(snapshot, undefined, 'active/1/plan.md'), /shared knowledge/);
    const first = await catalog.prepared(snapshot, 'work-1', handle);
    assert.equal(first, await catalog.prepared(snapshot, 'work-1', handle));
    assert.equal(first.exports.bundle, '');
    const glossary = { id: 'glossary', kind: 'glossary' as const, text: 'Shared definition', path: 'knowledge/glossary.md' };
    const document = workspace.load(handle);
    await workspace.execute('atlas_revise', { handle, expectedRevision: created.revision as string, changes: { title: 'Proposed orders', context: { records: [...document.context.records, glossary], links: [...document.context.links, { elementId: 'order', recordId: glossary.id }] }, reason: 'Plan revision' } });
    const backlinks = catalog.references(snapshot, undefined, 'knowledge/glossary.md');
    assert.equal(backlinks[0].workId, 'work-1');
    assert.equal(backlinks[0].elementId, 'order');
    const prototype = Object.getPrototypeOf(workspace) as { load: typeof workspace.load };
    const originalLoad = prototype.load;
    let reads = 0;
    prototype.load = function(handle: string) { reads++; return originalLoad.call(this, handle); };
    try {
      const manyWorks = { ...snapshot, work: [...snapshot.work, ...Array.from({length:200}, (_,i)=>({id:'other-'+i}))] } as Snapshot;
      assert.equal(catalog.references(manyWorks, undefined, 'knowledge/glossary.md').length,1);
      assert.equal(reads,1,'shared backlinks integrity-load each model once, independent of work count');
    } finally { prototype.load = originalLoad; }
    assert.equal(catalog.references({ ...snapshot, caseSensitivePaths: false }, undefined, 'KNOWLEDGE/GLOSSARY.MD')[0].workId, 'work-1');
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

test('polling reuses a coalesced planning index and refreshes changed or failed scope', async () => {
  let calls = 0, signature = 'v1', fail = false;
  const get = createScopeCache(async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); if (fail) throw new Error('Invalid scope'); return { version: signature }; }, async () => signature);
  const entries = await Promise.all([get(), get(), get()]);
  assert.equal(calls, 1);
  assert.equal(entries[0], entries[2]);
  for (let i = 0; i < 30; i++) await get();
  assert.equal(calls, 1, 'two-second polling does not repeatedly walk files or Git history');
  signature = 'v2'; assert.equal((await get()).version, 'v2'); assert.equal(calls, 2);
  signature = 'v3'; fail = true; await assert.rejects(get(), /Invalid scope/);
  await assert.rejects(get(), /Invalid scope/);
  fail = false; assert.equal((await get()).version, 'v3');
  await get(true); assert.equal(calls, 6, 'manual record refresh bypasses the cache');
});
test('scope changes during a concurrent load cannot serve the previous work index', async () => {
  let signature = 'old', calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const get = createScopeCache(async () => { calls++; const version = signature; if (calls === 1) await gate; return { version }; }, async () => signature);
  const first = get();
  await new Promise(resolve => setTimeout(resolve, 5));
  signature = 'new'; const second = get(); release();
  const results = await Promise.all([first, second]);
  assert.equal(calls, 2);
  assert(results.every(result => result.version === 'new'));
});
