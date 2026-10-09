import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import atlas, { type AtlasDocument } from '@atlas/diagrams';
const { createWorkspace } = atlas;
import { AtlasCatalog } from './atlas.ts';
import { createScopeCache } from './atlasScope.ts';
import { selectModelHandle } from '../src/modelSelection.ts';
import { describeProvenance } from '../src/provenance.ts';
import { resolveRecordPath } from '../src/modelPaths.ts';
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
    assert.deepEqual(catalog.list(snapshot, 'work-1').invalidHandles, [handle]);
    const invalid = catalog.list(snapshot, 'work-1');
    assert.equal(selectModelHandle(invalid.models, handle, '', invalid.invalidHandles), handle);
    await assert.rejects(catalog.prepared(snapshot, 'work-1', handle), /invalid update/);
    assert.equal(next.model.title, 'Proposed orders');
    const second = await workspace.execute('atlas_create', { input: { id: 'second', workId: 'work-1', profile: 'code', model: { type: 'StructuralModel', nodes: [{ id: 'other', name: 'Other', attributes: [] }], relations: [], generalizations: [], generalizationSets: [] } } });
    const withOther = catalog.list(snapshot, 'work-1');
    assert.equal(selectModelHandle(withOther.models, handle, '', withOther.invalidHandles), handle);
    rmSync(filename);
    const removed = catalog.list(snapshot, 'work-1');
    assert.deepEqual(removed.invalidHandles, []);
    assert.equal(selectModelHandle(removed.models, handle, '', removed.invalidHandles), second.handle);
    assert.equal(selectModelHandle(removed.models, handle, handle, removed.invalidHandles), handle);
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

test('models are discovered per work folder, legacy root models stay readable, and record paths resolve work-first', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atlas-work-'));
  const outside = mkdtempSync(path.join(os.tmpdir(), 'atlas-outside-'));
  try {
    const folder = path.join(root, 'active/0001-orders');
    mkdirSync(folder, { recursive: true });
    mkdirSync(path.join(root, 'active/0002-other'), { recursive: true });
    const snapshot = {
      work: [{ id: 'work-1', path: 'active/0001-orders' }, { id: 'work-2', path: 'active/0002-other' }],
      documents: [
        { path: 'active/0001-orders/plan.md', workId: 'work-1', category: 'plan' },
        { path: 'active/0001-orders/CONTEXT.md', workId: 'work-1', category: 'glossary' },
        { path: 'active/0002-other/plan.md', workId: 'work-2', category: 'plan' },
        { path: 'knowledge/glossary.md', workId: null, category: 'knowledge' },
      ],
    } as unknown as Snapshot;
    const catalog = new AtlasCatalog(root);
    const structural = (name: string) => ({ type: 'StructuralModel', nodes: [{ id: 'order', name, attributes: [{ id: 'total', name: 'total', type: 'number' }] }], relations: [], generalizations: [], generalizationSets: [] });
    const create = (workspaceRoot: string, input: Record<string, unknown>) => createWorkspace(workspaceRoot).execute('atlas_create', { input } as never) as Promise<{ handle: string }>;
    const own = await create(folder, { id: 'orders', title: 'Orders', profile: 'code', workId: 'work-1', model: structural('Order'),
      context: { records: [
        { id: 'plan', kind: 'plan', title: 'Data model', text: 'Orders have totals.', path: 'plan.md', section: 'Data model' },
        { id: 'glossary', kind: 'glossary', text: 'Shared', path: '../../knowledge/glossary.md' },
        { id: 'escape', kind: 'plan', text: 'Outside', path: '../../../outside.md' },
      ], links: [{ elementId: 'order', recordId: 'plan' }, { elementId: 'total', recordId: 'plan' }, { elementId: 'order', recordId: 'glossary' }] } });
    const legacy = await create(root, { id: 'legacy', title: 'Legacy orders', profile: 'code', workId: 'work-1', model: structural('Legacy order'),
      context: { records: [{ id: 'old', kind: 'plan', text: 'Older passage', path: 'active/0001-orders/plan.md', section: 'Overview' }], links: [] } });
    await create(root, { id: 'elsewhere', title: 'Other work', profile: 'code', workId: 'work-2', model: structural('Other') });

    const listed = catalog.list(snapshot, 'work-1');
    assert.deepEqual(listed.models.map(model => [model.handle, model.source]), [[own.handle, 'work'], [legacy.handle, 'legacy']]);
    const orders = listed.models[0];
    assert.equal(orders.provenance.label, 'Agent-authored');
    assert.equal(orders.provenance.detail, 'Structural model');
    assert.deepEqual(orders.explains.map(item => [item.path, item.reference, item.section]), [
      ['active/0001-orders/plan.md', 'plan.md', 'Data model'],
      ['knowledge/glossary.md', 'knowledge/glossary.md', null],
      [null, '../../../outside.md', null],
    ]);
    assert.deepEqual(listed.models[1].explains.map(item => [item.path, item.reference]), [['active/0001-orders/plan.md', 'plan.md']], 'legacy planning-root paths still resolve');
    assert.deepEqual(catalog.list(snapshot, 'work-2').models.map(model => model.source), ['legacy']);
    assert.deepEqual(catalog.counts(snapshot), { 'work-1': 2, 'work-2': 1 });

    const references = catalog.references(snapshot, 'work-1', 'active/0001-orders/plan.md');
    assert.deepEqual(references.map(item => [item.handle, item.section, item.elementName]), [[own.handle, 'Data model', 'Order'], [own.handle, 'Data model', 'total'], [legacy.handle, 'Overview', null]]);
    assert.equal(references[0].provenance.kind, 'authored');
    assert.deepEqual(catalog.references(snapshot, undefined, 'knowledge/glossary.md').map(item => [item.workId, item.elementId]), [['work-1', 'order']]);
    assert.equal((await catalog.prepared(snapshot, 'work-1', own.handle)).model.title, 'Orders');
    assert.throws(() => catalog.load(snapshot, 'work-2', own.handle), /unavailable/, 'another work folder is not searched');
    assert.throws(() => catalog.load(snapshot, 'work-1', '../m-000000000000000000000000'), /Choose an Atlas model/);

    // The same handle in the work folder and the legacy root: the work folder wins.
    const duplicate = await create(folder, { id: 'legacy', title: 'Moved orders', profile: 'code', workId: 'work-1', model: structural('Moved') });
    assert.equal(duplicate.handle, legacy.handle);
    const moved = catalog.list(snapshot, 'work-1').models.filter(model => model.handle === legacy.handle);
    assert.deepEqual(moved.map(model => [model.title, model.source]), [['Moved orders', 'work']]);
    assert.equal(catalog.load(snapshot, 'work-1', legacy.handle).title, 'Moved orders');
    assert.deepEqual(catalog.counts(snapshot), { 'work-1': 2, 'work-2': 1 });
    assert.equal(catalog.references(snapshot, 'work-1', 'active/0001-orders/plan.md').some(item => item.section === 'Overview'), false);

    // A model in a work folder that claims another work item is not served there.
    await create(folder, { id: 'misfiled', title: 'Misfiled', profile: 'code', workId: 'work-2', model: structural('X') });
    const misfiled = catalog.list(snapshot, 'work-1');
    assert.equal(misfiled.models.some(model => model.title === 'Misfiled'), false);
    assert.match(misfiled.issues.join('\n'), /assigned to work-2/);

    // A work folder whose model directory escapes the planning root is ignored.
    await create(outside, { id: 'outside', title: 'Outside', profile: 'code', workId: 'work-2', model: structural('Outside') });
    symlinkSync(path.join(outside, '.atlas'), path.join(root, 'active/0002-other/.atlas'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.deepEqual(catalog.list(snapshot, 'work-2').models.map(model => model.title), ['Other work']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('provenance labels follow the shared taxonomy', () => {
  const capture = (kind: string, identity: string) => ({ capturedAt: '2026-10-08T01:34:34.898Z', source: { kind, identity }, coverage: { status: 'complete' } });
  assert.deepEqual(describeProvenance({ state: 'snapshot', profile: 'code', baselineId: 'c', snapshots: [{ id: 'c', capture: capture('typescript', 'enrollment-code') }] }),
    { kind: 'generated', label: 'Generated from code', detail: 'TypeScript · enrollment-code · captured Oct 8, 2026 · complete coverage', tone: 'accent' });
  assert.equal(describeProvenance({ state: 'snapshot', profile: 'database', baselineId: 'c', snapshots: [{ id: 'c', capture: capture('sqlite', 'semester-demo') }] }).detail, 'SQLite · semester-demo · captured Oct 8, 2026 · complete coverage');
  assert.deepEqual(describeProvenance({ state: 'proposal', profile: 'code', baselineId: 'c', snapshots: [{ id: 'c', capture: capture('typescript', 'x') }] }),
    { kind: 'proposal', label: 'Agent proposal', detail: 'Changes to source captured Oct 8, 2026', tone: 'done' });
  assert.equal(describeProvenance({ state: 'authored', profile: 'ontouml' }).detail, 'Conceptual model');
  assert.equal(describeProvenance({ state: 'authored', profile: 'code', imported: true }).detail, 'Structural model · Imported');
  assert.equal(describeProvenance(undefined).kind, 'unknown');
});

test('dashboard provenance matches the Atlas viewer wording and tones', async () => {
  const viewer = await import('@atlas/diagrams/react');
  const capture = (kind: string, identity: string, status: 'complete' | 'partial') => ({ capturedAt: '2026-09-14T08:42:00.000Z', source: { kind, identity, scope: [] }, coverage: { status, diagnostics: [] }, adapter: { id: kind, version: '1' } });
  const documents = [
    { state: 'snapshot', profile: 'code', baselineId: 'c', snapshots: [{ id: 'c', capture: capture('typescript', 'shop', 'partial') }] },
    { state: 'snapshot', profile: 'database', baselineId: 'c', snapshots: [{ id: 'c', capture: capture('sqlite', 'inventory', 'complete') }] },
    { state: 'proposal', profile: 'code', baselineId: 'c', snapshots: [{ id: 'c', capture: capture('typescript', 'shop', 'complete') }] },
    { state: 'proposal', profile: 'code', baselineId: null, snapshots: [] },
    { state: 'authored', profile: 'ontouml' },
    { state: 'authored', profile: 'code', imported: true },
    undefined,
  ] as const;
  for (const document of documents) assert.deepEqual(describeProvenance(document as never), viewer.describeProvenance(document as never));
});

test('record paths resolve against the work folder first and never escape the planning root', () => {
  const documents = [{ path: 'active/1/plan.md' }, { path: 'plan.md' }, { path: 'knowledge/a.md' }];
  assert.equal(resolveRecordPath('plan.md', 'active/1', documents)?.path, 'active/1/plan.md');
  assert.equal(resolveRecordPath('./plan.md', 'active/1', documents)?.path, 'active/1/plan.md');
  assert.equal(resolveRecordPath('active/1/plan.md', 'active/1', documents)?.path, 'active/1/plan.md');
  assert.equal(resolveRecordPath('plan.md', null, documents)?.path, 'plan.md');
  assert.equal(resolveRecordPath('../../knowledge/a.md', 'active/1', documents)?.path, 'knowledge/a.md');
  for (const escape of ['../../../a.md', '/etc/passwd', 'C:/x.md', 'https://example.com/plan.md', '', 7]) assert.equal(resolveRecordPath(escape, 'active/1', documents), undefined);
});
