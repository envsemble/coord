import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import atlas from '@envsemble/atlas-diagrams';
import { DiagramCatalog } from './diagrams.ts';
import { diagramLinks } from './diagramLinks.ts';
import { createScopeCache } from './atlasScope.ts';
import type { PlanningIndex as Snapshot } from '../types.ts';

const CAPTURE = {
  capturedAt: '2026-09-14T08:42:00.000Z',
  adapter: { id: 'atlas-typescript', version: '1.0.0' },
  source: { kind: 'typescript', identity: 'shop', scope: ['src'] },
  coverage: { status: 'partial' as const, diagnostics: [] },
  limitations: [],
};
function capture() {
  const { diagram } = atlas.parseDiagram('@startuml\ntitle Checkout\nclass Checkout {\n  id : string\n}\nclass Payment\nCheckout --> Payment : pays with\n@enduml\n');
  diagram!.capture = CAPTURE;
  return atlas.formatDiagram(diagram!);
}
const proposal = (title: string, extra: string) => capture()
  .replace(/^' atlas capture .*\n' atlas fingerprint .*\n/m, "' atlas proposal ../captures/checkout.puml\n")
  .replace('title Checkout', 'title ' + title)
  .replace('  id : string\n', '  id : string\n' + extra);

function folder(t: test.TestContext) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atlas-diagrams-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files: Record<string, string> = {
    'active/1/captures/checkout.puml': capture(),
    'active/1/proposals/vault.puml': proposal('Vault', '  vault : string [0..1]\n'),
    'active/1/proposals/customer.puml': proposal('On the customer', '  customer : string [0..1]\n'),
    'active/1/glossary.puml': '@startuml\ntitle Glossary\nclass Order\nclass "Order line" as Line\nOrder "1" *-- "1..*" Line : lines\n@enduml\n',
    'active/1/broken.puml': '@startuml\nclass A\nclass B\nA -up-> B\n@enduml\n',
    'active/1/plan.md': '---\nkind: plan\n---\n# Checkout\n\nSee [the glossary](glossary.puml).\n\n## Data model\n\nThe [order](glossary.puml#Order) and its [lines](./glossary.puml#Line), and [`not a link`](x.md).\n\n```\n[inside code](glossary.puml)\n```\n\n## Payments\n\n[Vault](proposals/vault.puml) · [elsewhere](../2/other.puml) · [web](https://example.com/a.puml)\n',
    'active/2/other.puml': '@startuml\nclass Other\n@enduml\n',
    'notes/shop.md': '# Shop\n\n## Orders\n\n[Orders](../active/1/glossary.puml#Order)\n',
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  const owner = (name: string) => name.startsWith('active/1/') ? 'work-1' : name.startsWith('active/2/') ? 'work-2' : null;
  const snapshot = {
    work: [{ id: 'work-1', path: 'active/1' }, { id: 'work-2', path: 'active/2' }],
    documents: Object.keys(files).map(name => ({ path: name, workId: owner(name), category: 'document' })),
  } as unknown as Snapshot;
  return { root, snapshot, write: (name: string, text: string) => writeFileSync(path.join(root, name), text) };
}

test('a work item\'s diagrams are its .puml files, with their roles, families, provenance and problems', async t => {
  const { root, snapshot } = folder(t);
  const catalog = new DiagramCatalog(root);
  const diagrams = await catalog.list(snapshot, 'work-1');
  assert.deepEqual(diagrams.map(item => [item.path, item.title, item.role, item.profile, item.family, item.valid]), [
    ['broken.puml', 'broken', 'diagram', 'class', null, false],
    ['captures/checkout.puml', 'Checkout', 'capture', 'code', 'captures/checkout.puml', true],
    ['glossary.puml', 'Glossary', 'diagram', 'class', null, true],
    ['proposals/customer.puml', 'On the customer', 'proposal', 'code', 'captures/checkout.puml', true],
    ['proposals/vault.puml', 'Vault', 'proposal', 'code', 'captures/checkout.puml', true],
  ]);
  const [broken, checkout, glossary, , vault] = diagrams;
  assert.deepEqual(broken.problems.map(problem => [problem.line, problem.severity]), [[4, 'error']]);
  assert.equal(checkout.provenance.detail, 'TypeScript · shop · captured Sep 14, 2026 · partial coverage');
  assert.equal(checkout.capturedAt, CAPTURE.capturedAt);
  assert.equal(checkout.coverage, 'partial');
  assert.equal(vault.provenance.detail, 'Changes to source captured Sep 14, 2026');
  assert.equal(vault.baseline, 'captures/checkout.puml');
  assert.equal(glossary.provenance.detail, 'Class diagram');
  assert.deepEqual(catalog.counts(snapshot), { 'work-1': 5, 'work-2': 1 });
  assert.equal(await catalog.list(snapshot, 'work-1'), diagrams, 'unchanged files are described once');
  await assert.rejects(catalog.list(snapshot, 'work-9'), /indexed work item/);
  assert.deepEqual((await catalog.index(snapshot)).map(item => item.workId + ':' + item.path).sort(), [
    'work-1:broken.puml', 'work-1:captures/checkout.puml', 'work-1:glossary.puml', 'work-1:proposals/customer.puml', 'work-1:proposals/vault.puml', 'work-2:other.puml',
  ]);
});

test('a diagram is prepared with its family, laid out once, and an invalid one is refused', async t => {
  const { root, snapshot, write } = folder(t);
  const catalog = new DiagramCatalog(root);
  const vault = await catalog.prepared(snapshot, 'work-1', 'proposals/vault.puml');
  assert.equal(vault.family, 'captures/checkout.puml');
  assert.deepEqual(vault.siblings!.map(item => item.path).sort(), ['captures/checkout.puml', 'proposals/customer.puml']);
  assert.ok(vault.comparison, 'a proposal shows its changes');
  assert.equal(vault.exports.bundle, '');
  const again = await catalog.prepared(snapshot, 'work-1', 'captures/checkout.puml');
  assert.equal(again.siblings!.find(item => item.path === 'proposals/vault.puml')!.payload.model, vault.model, 'one layout serves the family');
  const glossary = await catalog.prepared(snapshot, 'work-1', 'glossary.puml');
  assert.equal(glossary.siblings, undefined);
  assert.equal(glossary.model.document?.path, 'glossary.puml');
  await assert.rejects(catalog.prepared(snapshot, 'work-1', 'broken.puml'), /has problems/);
  await assert.rejects(catalog.prepared(snapshot, 'work-1', 'missing.puml'), /not in the work folder/);
  await assert.rejects(catalog.prepared(snapshot, 'work-2', 'glossary.puml'), /not in the work folder/, 'another work folder is not searched');
  // A changed file is read again at once.
  write('active/1/glossary.puml', '@startuml\ntitle Renamed\nclass Order\n@enduml\n');
  assert.equal((await catalog.list(snapshot, 'work-1')).find(item => item.path === 'glossary.puml')!.title, 'Renamed');
  assert.equal((await catalog.prepared(snapshot, 'work-1', 'glossary.puml')).model.title, 'Renamed');
});

test('links in a document attach diagrams under their headings, with the elements they name', async t => {
  const { root, snapshot } = folder(t);
  const catalog = new DiagramCatalog(root);
  const references = await catalog.references(snapshot, 'work-1', 'active/1/plan.md');
  assert.deepEqual(references.map(item => [item.workId, item.path, item.title, item.section, item.element]), [
    ['work-1', 'glossary.puml', 'Glossary', 'checkout', null],
    ['work-1', 'glossary.puml', 'Glossary', 'data-model', 'Order'],
    ['work-1', 'glossary.puml', 'Glossary', 'data-model', 'Line'],
    ['work-1', 'proposals/vault.puml', 'Vault', 'payments', null],
    ['work-2', 'other.puml', 'other', 'payments', null],
  ]);
  assert.equal(references[3].provenance.kind, 'proposal');
  // A document outside every work item links to work items' diagrams too.
  assert.deepEqual((await catalog.references(snapshot, undefined, 'notes/shop.md')).map(item => [item.workId, item.path, item.section, item.element]), [['work-1', 'glossary.puml', 'orders', 'Order']]);
  await assert.rejects(catalog.references(snapshot, 'work-2', 'active/1/plan.md'), /indexed document/);
  await assert.rejects(catalog.references(snapshot, 'work-1', '../../outside.md'), /indexed document/);
  await assert.rejects(catalog.references(snapshot, undefined, 'active/1/plan.md'), /indexed document/);
  assert.deepEqual(await catalog.references({ ...snapshot, caseSensitivePaths: false }, 'work-1', 'ACTIVE/1/PLAN.MD').then(items => items.length), 5);
});

test('diagram links resolve against their document and stay inside the planning folder', () => {
  const links = (markdown: string, from = 'active/1/plan.md') => diagramLinks(markdown, from).map(link => [link.target, link.element, link.section]);
  assert.deepEqual(links('[a](a.puml)\n# One\n[b](sub/b.puml#Order%20line "title")\n## **Two** [x](y)\n![d](<d e.puml>) [e](../../notes/e.puml)'), [
    ['active/1/a.puml', null, null],
    ['active/1/sub/b.puml', 'Order line', 'one'],
    ['active/1/d e.puml', null, 'two-x'],
    ['notes/e.puml', null, 'two-x'],
  ]);
  assert.deepEqual(links('[a](../../../a.puml) [b](/b.puml) [c](https://x/c.puml) [d](#e) [f](f.md) `[g](g.puml)`\n~~~\n[h](h.puml)\n~~~'), []);
  assert.deepEqual(links('[a](a.puml) [again](a.puml)\n# A\n[a](a.puml)'), [['active/1/a.puml', null, null], ['active/1/a.puml', null, 'a']]);
  assert.deepEqual(links('[a](a.puml)', 'plan.md'), [['a.puml', null, null]]);
});

test('a link\'s section is the anchor the reader gives its heading', () => {
  const sections = (markdown: string) => diagramLinks(markdown, 'plan.md').map(link => link.section);
  // The heading's text as it reads: underscores and code keep their text, marks and link targets go.
  assert.deepEqual(sections([
    '## order_items table', '[a](a.puml)',
    '## The `ledger_status` field', '[b](b.puml)',
    '## *Emphasis* and __strong__ with [a link](https://example.com) ![an image](x.png)', '[c](c.puml)',
  ].join('\n\n')), ['order_items-table', 'the-ledger_status-field', 'emphasis-and-strong-with-a-link-']);
  // Setext headings are headings; a repeated heading is numbered as the reader numbers it.
  assert.deepEqual(sections('Orders\n======\n\n[a](a.puml)\n\nLines\n---\n\n[b](b.puml)\n\n## Orders\n\n[c](c.puml)\n\n## Orders\n\n[d](d.puml)'), ['orders', 'lines', 'orders-1', 'orders-2']);
  // A footnote reference reads as the number the reader shows: footnotes count by first reference.
  assert.deepEqual(sections('## Title[^1]\n\n[a](a.puml)\n\n[^1]: A note.'), ['title1']);
  assert.deepEqual(sections('Before[^b].\n\n## Title[^a]\n\n[a](a.puml)\n\n## Again [^b]\n\n[b](b.puml)\n\n[^a]: A.\n[^b]: B.'), ['title2', 'again-1']);
});

test('links count where they are used, not in code, comments or unused definitions', () => {
  const links = (markdown: string) => diagramLinks(markdown, 'plan.md').map(link => [link.target, link.section]);
  assert.deepEqual(links('# Defined\n\n[unused]: unused.puml\n[model]: model.puml\n\n# Used\n\nSee [the model][model] and [model].'), [['model.puml', 'used']]);
  assert.deepEqual(links('# Code\n\n    [indented](indented.puml)\n\n<!-- [hidden](hidden.puml) -->\n\n<a href="html.puml">html</a>'), []);
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

