import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, realpathSync, existsSync, symlinkSync, utimesSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import atlas, { type AtlasDocument } from '@envsemble/atlas-diagrams';
const { createWorkspace } = atlas;
import { AtlasCatalog, elementNames } from './atlas.ts';
import { createScopeCache } from './atlasScope.ts';
import { describeProvenance } from './provenance.ts';
import { resolveRecordPath } from './paths.ts';
import type { PlanningIndex as Snapshot } from './types.ts';

test('dashboard serves scoped native payloads, caches revisions and retains valid snapshots', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atlas-dashboard-'));
  try {
    const catalog = new AtlasCatalog(root);
    const snapshot = { work: [{ id: 'work-1', path: 'active/1' }, { id: 'work-2', path: 'active/2', location: 'archive' }], documents: [{ path: 'active/1/plan.md', workId: 'work-1' }, { path: 'knowledge/glossary.md', category: 'knowledge' }, { path: 'active/2/plan.md', workId: 'work-2' }] } as unknown as Snapshot;
    assert.deepEqual(catalog.list(snapshot, 'work-1').models, []);
    mkdirSync(path.join(root, 'active/1'), { recursive: true }); mkdirSync(path.join(root, 'active/2'), { recursive: true });
    assert.deepEqual(catalog.list(snapshot, 'work-1').models, []);
    assert.equal(existsSync(path.join(root, 'active/1/.atlas')), false, 'viewing does not create model state');
    const workspace = createWorkspace(path.join(root, 'active/1'));
    const created = await workspace.execute('atlas_create', { input: { id: 'sample', title: 'Orders', profile: 'code', workId: 'work-1', model: { type: 'StructuralModel', nodes: [{ id: 'order', name: 'Order', attributes: [{ id: 'total', name: 'total', type: 'number' }] }], relations: [], generalizations: [], generalizationSets: [] }, context: { records: [{ id: 'plan', kind: 'plan', text: 'A retained passage.', path: 'plan.md', section: 'Orders' }], links: [{ elementId: 'total', recordId: 'plan' }] } } });
    const handle = created.handle as string;
    assert.equal(catalog.list(snapshot, 'work-1').models.length, 1);
    assert.equal(catalog.list(snapshot, 'work-2').models.length, 0);
    assert.throws(() => catalog.load(snapshot, 'work-2', handle), /unavailable/, 'another work folder is not searched');
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
    const glossary = { id: 'glossary', kind: 'glossary' as const, text: 'Shared definition', path: '../../knowledge/glossary.md' };
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
    const filename = path.join(root, 'active/1/.atlas/models', handle + '.json');
    const damaged = JSON.parse(readFileSync(filename, 'utf8')) as AtlasDocument;
    damaged.title = 'Unrecorded edit'; writeFileSync(filename, JSON.stringify(damaged));
    assert.equal(catalog.list(snapshot, 'work-1').issues.length, 1);
    assert.deepEqual(catalog.list(snapshot, 'work-1').invalidHandles, [handle]);
    const invalid = catalog.list(snapshot, 'work-1');
    assert.deepEqual(invalid.models, [], 'an invalid update is listed only as an invalid handle, so selection can keep it');
    await assert.rejects(catalog.prepared(snapshot, 'work-1', handle), /invalid update/);
    assert.equal(next.model.title, 'Proposed orders');
    const second = await workspace.execute('atlas_create', { input: { id: 'second', workId: 'work-1', profile: 'code', model: { type: 'StructuralModel', nodes: [{ id: 'other', name: 'Other', attributes: [] }], relations: [], generalizations: [], generalizationSets: [] } } });
    const withOther = catalog.list(snapshot, 'work-1');
    assert.deepEqual(withOther.models.map(model => model.handle), [second.handle]);
    assert.deepEqual(withOther.invalidHandles, [handle]);
    rmSync(filename);
    const removed = catalog.list(snapshot, 'work-1');
    assert.deepEqual(removed.invalidHandles, []);
    assert.deepEqual(removed.models.map(model => model.handle), [second.handle], 'a removed model is no longer listed');
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

test('models are discovered per work folder and record paths resolve against it', async () => {
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
    const rooted = await create(folder, { id: 'rooted', title: 'Planning-root paths', profile: 'code', workId: 'work-1', model: structural('Rooted order'),
      context: { records: [{ id: 'rooted', kind: 'plan', text: 'A planning-root-relative path', path: 'active/0001-orders/plan.md', section: 'Overview' }], links: [] } });
    await create(root, { id: 'root-model', title: 'Planning-root model', profile: 'code', workId: 'work-1', model: structural('Ignored') });
    await create(path.join(root, 'active/0002-other'), { id: 'elsewhere', title: 'Other work', profile: 'code', workId: 'work-2', model: structural('Other') });

    const listed = catalog.list(snapshot, 'work-1');
    assert.deepEqual(listed.models.map(model => model.handle).sort(), [own.handle, rooted.handle].sort(), 'a planning-root .atlas folder is not read');
    const orders = listed.models.find(model => model.handle === own.handle)!;
    assert.equal(orders.provenance.label, 'Agent-authored');
    assert.equal(orders.provenance.detail, 'Structural model');
    assert.deepEqual(orders.explains.map(item => [item.path, item.reference, item.section]), [
      ['active/0001-orders/plan.md', 'plan.md', 'Data model'],
      ['knowledge/glossary.md', 'knowledge/glossary.md', null],
      [null, '../../../outside.md', null],
    ]);
    assert.deepEqual(listed.models.find(model => model.handle === rooted.handle)!.explains.map(item => [item.path, item.reference]), [[null, 'active/0001-orders/plan.md']], 'planning-root-relative record paths do not resolve');
    assert.deepEqual(catalog.list(snapshot, 'work-2').models.map(model => model.title), ['Other work']);
    assert.deepEqual(catalog.counts(snapshot), { 'work-1': 2, 'work-2': 1 });

    const references = catalog.references(snapshot, 'work-1', 'active/0001-orders/plan.md');
    const order = (handle: string) => handle === own.handle ? 0 : 1;
    assert.deepEqual(references.map(item => [item.handle, item.section, item.elementName]).sort((a, b) => order(a[0]!) - order(b[0]!)), [[own.handle, 'Data model', 'Order'], [own.handle, 'Data model', 'total']]);
    assert.equal(references.find(item => item.handle === own.handle)!.provenance.kind, 'authored');
    assert.deepEqual(catalog.references(snapshot, undefined, 'knowledge/glossary.md').map(item => [item.workId, item.elementId]), [['work-1', 'order']]);
    assert.equal((await catalog.prepared(snapshot, 'work-1', own.handle)).model.title, 'Orders');
    assert.throws(() => catalog.load(snapshot, 'work-2', own.handle), /unavailable/, 'another work folder is not searched');
    assert.throws(() => catalog.load(snapshot, 'work-1', '../m-000000000000000000000000'), /Choose an Atlas model/);

    // A model in a work folder that claims another work item is not served there.
    await create(folder, { id: 'misfiled', title: 'Misfiled', profile: 'code', workId: 'work-2', model: structural('X') });
    const misfiled = catalog.list(snapshot, 'work-1');
    assert.equal(misfiled.models.some(model => model.title === 'Misfiled'), false);
    assert.match(misfiled.issues.join('\n'), /assigned to work-2/);

    // A work folder whose model directory escapes the planning root is ignored.
    await create(outside, { id: 'outside', title: 'Outside', profile: 'code', workId: 'work-3', model: structural('Outside') });
    mkdirSync(path.join(root, 'active/0003-escape'));
    symlinkSync(path.join(outside, '.atlas'), path.join(root, 'active/0003-escape/.atlas'), process.platform === 'win32' ? 'junction' : 'dir');
    const escaping = { ...snapshot, work: [...snapshot.work, { id: 'work-3', path: 'active/0003-escape' }] } as Snapshot;
    assert.deepEqual(catalog.list(escaping, 'work-3').models, []);
    assert.equal(catalog.counts(escaping)['work-3'], undefined);
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
  const viewer = await import('@envsemble/atlas-diagrams/react');
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

test('record paths resolve against the work folder only and never escape the planning root', () => {
  const documents = [{ path: 'active/1/plan.md' }, { path: 'plan.md' }, { path: 'knowledge/a.md' }];
  assert.equal(resolveRecordPath('plan.md', 'active/1', documents)?.path, 'active/1/plan.md');
  assert.equal(resolveRecordPath('./plan.md', 'active/1', documents)?.path, 'active/1/plan.md');
  assert.equal(resolveRecordPath('active/1/plan.md', 'active/1', documents), undefined, 'planning-root-relative paths do not resolve');
  assert.equal(resolveRecordPath('plan.md', null, documents), undefined, 'a record without a work folder does not resolve');
  assert.equal(resolveRecordPath('../../knowledge/a.md', 'active/1', documents)?.path, 'knowledge/a.md');
  for (const escape of ['../../../a.md', '/etc/passwd', 'C:/x.md', 'https://example.com/plan.md', '', 7]) assert.equal(resolveRecordPath(escape, 'active/1', documents), undefined);
});

test('element chips name relations by their ends when their own name says nothing more', () => {
  const structural = {
    type: 'StructuralModel',
    nodes: [
      { id: 'checkout', name: 'CheckoutService', attributes: [{ id: 'vault-field', name: 'vault', type: 'PaymentMethodVault' }] },
      { id: 'vault', name: 'PaymentMethodVault', attributes: [] },
      { id: 'level', name: 'stock_level', attributes: [] },
      { id: 'product', name: 'product', attributes: [] },
    ],
    relations: [
      { id: 'uses', name: 'declared type use', stereotype: 'dependency', sourceId: 'checkout', targetId: 'vault' },
      { id: 'fk', name: 'sku → sku', stereotype: 'foreign key', sourceId: 'level', targetId: 'product' },
      { id: 'created', name: 'orders_created_by_fkey', stereotype: 'foreign key', sourceId: 'level', targetId: 'product' },
      { id: 'updated', name: 'orders_updated_by_fkey', stereotype: 'foreign key', sourceId: 'level', targetId: 'product' },
      { id: 'named', name: 'stores cards in', sourceId: 'checkout', targetId: 'vault' },
      { id: 'unnamed', sourceId: 'vault', targetId: 'checkout' },
    ],
    generalizations: [{ id: 'implements', specificId: 'checkout', generalId: 'vault', realization: true }],
  };
  const names = elementNames(structural);
  assert.equal(names.get('uses'), 'CheckoutService → PaymentMethodVault');
  // A foreign key's name tells it from others between the same tables, as on the diagram.
  assert.equal(names.get('fk'), 'sku → sku');
  assert.equal(names.get('created'), 'orders_created_by_fkey');
  assert.equal(names.get('updated'), 'orders_updated_by_fkey');
  assert.equal(names.get('named'), 'stores cards in');
  assert.equal(names.get('unnamed'), 'PaymentMethodVault → CheckoutService');
  assert.equal(names.get('implements'), 'CheckoutService implements PaymentMethodVault');
  assert.equal(names.get('vault-field'), 'vault', 'members keep their own names');
  const ontouml = {
    type: 'Project',
    elements: [
      { id: 'order', type: 'Class', name: { en: 'Order' } },
      { id: 'customer', type: 'Class', name: { en: 'Customer' } },
      { id: 'person', type: 'Class', name: { en: 'Person' } },
      { id: 'placed-by', type: 'BinaryRelation', name: { en: 'placed by' }, properties: ['a', 'b'] },
      { id: 'anonymous', type: 'BinaryRelation', name: null, properties: [{ id: 'c' }, { id: 'd' }] },
      { id: 'default', type: 'BinaryRelation', name: { en: 'Association' }, properties: ['b', 'a'] },
      { id: 'a', type: 'Property', propertyType: 'order' },
      { id: 'b', type: 'Property', propertyType: 'customer' },
      { id: 'c', type: 'Property', propertyType: { id: 'customer', type: 'Class' } },
      { id: 'd', type: 'Property', propertyType: 'order' },
      { id: 'is-person', type: 'Generalization', name: null, specific: 'customer', general: 'person' },
    ],
  };
  const conceptual = elementNames(ontouml);
  assert.equal(conceptual.get('placed-by'), 'placed by');
  assert.equal(conceptual.get('anonymous'), 'Customer → Order');
  assert.equal(conceptual.get('default'), 'Customer → Order');
  assert.equal(conceptual.get('is-person'), 'Customer inherits Person');
});

test('a capture and its proposals are served together, laid out once, and stand alone otherwise', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atlas-family-'));
  try {
    const folder = path.join(root, 'active/0001-orders');
    mkdirSync(folder, { recursive: true });
    const snapshot = { work: [{ id: 'work-1', path: 'active/0001-orders' }], documents: [{ path: 'active/0001-orders/plan.md', workId: 'work-1', category: 'plan' }] } as unknown as Snapshot;
    const workspace = createWorkspace(folder);
    const model = { type: 'StructuralModel' as const, nodes: [{ id: 'order', name: 'Order', attributes: [] }, { id: 'line', name: 'Line', attributes: [] }], relations: [], generalizations: [], generalizationSets: [] };
    const captured = atlas.createSnapshot({ profile: 'code', model, capture: { capturedAt: '2026-09-14T08:00:00.000Z', adapter: { id: 'test', version: '1' }, source: { kind: 'typescript', identity: 'shop', scope: ['src'] }, coverage: { status: 'complete', diagnostics: [] }, limitations: [] } });
    const capture = await workspace.execute('atlas_create', { input: { id: 'orders-capture', title: 'Orders', profile: 'code', state: 'snapshot', workId: 'work-1', model, snapshots: [captured], baselineId: captured.id } } as never) as { handle: string };
    // Two alternatives over the capture.
    const alternative = async (title: string, node: { id: string; name: string }) => {
      const branched = await workspace.execute('atlas_proposal', { handle: capture.handle, title }) as { handle: string; revision: string };
      return await workspace.execute('atlas_revise', { handle: branched.handle, expectedRevision: branched.revision, changes: { model: { ...model, nodes: [...model.nodes, { ...node, attributes: [] }] } } } as never) as { handle: string; revision: string };
    };
    const first = await alternative('Option A', { id: 'refund', name: 'Refund' });
    const second = await alternative('Option B', { id: 'credit', name: 'Credit' });
    const lone = await workspace.execute('atlas_create', { input: { id: 'sketch', title: 'Sketch', profile: 'code', workId: 'work-1', model } } as never) as { handle: string };
    const catalog = new AtlasCatalog(root);
    const families = new Map(catalog.list(snapshot, 'work-1').models.map(entry => [entry.handle, entry.family]));
    assert.equal(families.get(capture.handle), captured.id);
    assert.equal(families.get(first.handle), captured.id);
    assert.equal(families.get(second.handle), captured.id);
    assert.equal(families.get(lone.handle), null);

    // Asking for one member brings every member's payload, from one layout.
    const answer = await catalog.prepared(snapshot, 'work-1', first.handle);
    assert.equal(answer.family, captured.id);
    assert.deepEqual(answer.siblings!.map(item => item.handle).sort(), [capture.handle, second.handle].sort());
    const position = (payload: typeof answer, id: string) => {
      const scene = (payload.comparison?.changeView ?? payload).views[0].diagram;
      const node = scene.nodes.find(item => item.id === id)!;
      return [node.x, node.y];
    };
    for (const sibling of answer.siblings!) {
      assert.equal(sibling.payload.family, captured.id);
      assert.deepEqual(position(sibling.payload, 'order'), position(answer, 'order'));
    }
    // Another member comes from the same preparation.
    const again = await catalog.prepared(snapshot, 'work-1', capture.handle);
    assert.equal(again.siblings!.find(item => item.handle === first.handle)!.payload.model, answer.model);
    assert.equal((await catalog.prepared(snapshot, 'work-1', lone.handle)).siblings, undefined);

    // A revised alternative lays the family out again.
    const document = workspace.load(second.handle);
    await workspace.execute('atlas_revise', { handle: second.handle, expectedRevision: second.revision, changes: { title: 'Option B, revised' } } as never);
    const revised = await catalog.prepared(snapshot, 'work-1', first.handle);
    assert.notEqual(revised.model, answer.model);
    assert.equal(revised.siblings!.find(item => item.handle === second.handle)!.payload.model.title, 'Option B, revised');
    assert.equal(document.title, 'Option B');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * OntoUML proposals over one authored model: two add a class each, and the last a three-way
 * relation, which the viewer cannot draw. One project grows, so its stages share their IDs.
 */
function conceptualProposals(workId: string) {
  const project = new atlas.Project(), root = project.packageBuilder().root().name('Orders').build();
  const stage = () => JSON.parse(JSON.stringify(project));
  const add = (name: string) => root.classBuilder().kind().name(name).build();
  const [order, line, product] = ['Order', 'Line', 'Product'].map(add);
  const base = stage();
  add('Refund');
  const refunds = stage();
  add('Credit');
  const credits = stage();
  root.naryRelationBuilder().members(order, line, product).name('Three way').build();
  const threeWay = stage();
  const authored = atlas.createDocument({ id: 'conceptual', title: 'Orders', profile: 'ontouml', model: base, workId });
  const proposal = (id: string, title: string, model: unknown) => atlas.reviseDocument(atlas.createProposal(authored, { id, title }), { model: model as AtlasDocument['model'] });
  return [proposal('refunds', 'Refunds', refunds), proposal('credits', 'Credits', credits), proposal('three-way', 'Three-way', threeWay)];
}
function conceptualFolder(name: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), name));
  const folder = path.join(root, 'active/0001-orders');
  mkdirSync(folder, { recursive: true });
  const snapshot = { work: [{ id: 'work-1', path: 'active/0001-orders' }], documents: [] } as unknown as Snapshot;
  return { root, folder, snapshot, workspace: createWorkspace(folder) };
}

test('a member that cannot be drawn is served alone, and the rest of its family together', async () => {
  const { root, snapshot, workspace } = conceptualFolder('atlas-apart-');
  try {
    const proposals = conceptualProposals('work-1');
    for (const document of proposals) workspace.save(document);
    const catalog = new AtlasCatalog(root);
    const entries = catalog.list(snapshot, 'work-1').models;
    const [refunds, credits, threeWay] = proposals.map(document => entries.find(entry => entry.title === document.title)!.handle);
    // Listed as one family: only laying it out tells the member that cannot be drawn.
    assert.equal(entries.length, 3);
    assert(entries.every(entry => entry.family === proposals[0].baselineId));
    const answer = await catalog.prepared(snapshot, 'work-1', refunds);
    assert.equal(answer.family, proposals[0].baselineId);
    assert.deepEqual(answer.siblings!.map(item => item.handle), [credits]);
    assert.deepEqual(answer.apart, [{ handle: threeWay, revision: proposals[2].revision.id }]);
    const place = (payload: typeof answer, name: string) => {
      const node = payload.comparison!.changeView!.views[0].diagram.nodes.find(item => item.name === name)!;
      return [node.x, node.y];
    };
    assert.deepEqual(place(answer.siblings![0].payload, 'Refund'), place(answer, 'Refund'));
    await assert.rejects(catalog.prepared(snapshot, 'work-1', threeWay), /binary class relations/);
    // The other comes from the same layout, which is not tried again.
    const other = await catalog.prepared(snapshot, 'work-1', credits);
    assert.equal(other.model, answer.siblings![0].payload.model);
    assert.deepEqual(other.apart, answer.apart);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the catalog reads a model again only once its file changes', async () => {
  const { root, folder, snapshot, workspace } = conceptualFolder('atlas-reads-');
  const prototype = Object.getPrototypeOf(workspace) as { load: typeof workspace.load };
  const originalLoad = prototype.load;
  try {
    const [refunds, credits] = conceptualProposals('work-1');
    for (const document of [refunds, credits]) workspace.save(document);
    // Files written a while ago, whose times tell any later write apart.
    const models = path.join(folder, '.atlas/models');
    const past = new Date(Date.now() - 60_000);
    for (const name of readdirSync(models)) utimesSync(path.join(models, name), past, past);
    let reads = 0;
    prototype.load = function(handle: string) { reads++; return originalLoad.call(this, handle); };
    const catalog = new AtlasCatalog(root);
    const entries = catalog.list(snapshot, 'work-1').models;
    const [first, second] = entries.map(entry => entry.handle);
    assert.equal(reads, 2);
    const answer = await catalog.prepared(snapshot, 'work-1', first);
    const other = await catalog.prepared(snapshot, 'work-1', second);
    assert.equal(other.model, answer.siblings![0].payload.model);
    assert.equal(reads, 2, 'opening and switching read no model again');
    // A member changed on disk is read again, and the family laid out again.
    const changed = [refunds, credits].find(document => document.title === entries[1].title)!;
    workspace.save(atlas.reviseDocument(changed, { title: changed.title + ', revised' }), changed.revision.id);
    reads = 0;
    const revised = await catalog.prepared(snapshot, 'work-1', first);
    assert.equal(reads, 1);
    assert.equal(revised.siblings![0].payload.model.title, changed.title + ', revised');
  } finally {
    prototype.load = originalLoad;
    rmSync(root, { recursive: true, force: true });
  }
});
