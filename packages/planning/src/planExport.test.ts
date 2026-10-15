// Plan export and import: lossless round trips, identity rewrites, registry formatting and
// rejection of malformed exports before anything is written.
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, release, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import atlas, { type ViewerPayload } from '@envsemble/atlas-diagrams';
import { parse } from 'parse5';
import { validatePlanning, parseFrontmatter } from './check.ts';
import { loadPlanning } from './planning.ts';
import { DiagramCatalog } from './diagrams.ts';
import { PlanExportError, exportPlan, importPlan, planExportPathProblem, planExportTesting, planImportTarget, readPlanExport, type PlanExportErrorCode } from './planExport.ts';

const BOM = String.fromCharCode(0xfeff);
const ESC = String.fromCharCode(0x1b);

const here = path.dirname(fileURLToPath(import.meta.url));
const now = new Date('2026-10-10T12:00:00Z');

function temporary(t: TestContext, name = 'plan-export-') {
  const directory = mkdtempSync(path.join(tmpdir(), name));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function files(root: string, relative = ''): string[] {
  if (!existsSync(path.join(root, relative))) return [];
  return readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const child = relative ? relative + '/' + entry.name : entry.name;
    return entry.isDirectory() ? files(root, child) : [child];
  }).sort();
}
function snapshot(root: string) {
  return new Map(files(root).map(name => [name, readFileSync(path.join(root, name))]));
}
const plan = (id: string, title: string, extra = '') => ['---', 'schema_version: 1', 'kind: plan', `id: ${id}`, `title: "${title}"`, `summary: "What ${title} is for."`, 'repositories: [shop]', 'created: "2026-10-01"', 'updated: "2026-10-02"', 'design_status: accepted', 'implementation_status: in_progress', 'accepted_at: "2026-10-02"', 'completed_at: null', 'supersedes: []', 'superseded_by: null', '---', '', `# ${title}`, '', extra].join('\n');
const ORDERS = '@startuml\ntitle Orders\nclass Order {\n  id : integer\n}\nclass OrderLine\nOrder "1" *-- "0..*" OrderLine : lines\n@enduml\n';
/** A database capture of the orders table, as Atlas writes one. */
function captured() {
  const { diagram } = atlas.parseDiagram('@startuml\ntitle Captured orders\nentity orders {\n  *id : integer <<PK>>\n}\n@enduml\n');
  diagram!.capture = { capturedAt: '2026-10-01T10:00:00Z', adapter: { id: 'fixture', version: '1' }, source: { kind: 'sqlite', identity: 'shop', scope: ['main'] }, coverage: { status: 'complete', diagnostics: [] }, limitations: [] };
  return atlas.formatDiagram(diagram!);
}
const proposed = () => captured().replace(/^' atlas capture .*\n' atlas fingerprint .*\n/m, "' atlas proposal captured.puml\n").replace('title Captured orders', 'title Proposed orders').replace('  *id : integer <<PK>>\n', '  *id : integer <<PK>>\n  --\n  note : text\n');

/** A self-contained planning folder with binary evidence and diagrams with history. */
function fixture(root: string) {
  const work = path.join(root, 'active/0001-checkout');
  mkdirSync(path.join(work, 'evidence'), { recursive: true });
  mkdirSync(path.join(work, 'docs/adr'), { recursive: true });
  mkdirSync(path.join(root, 'archive/0002-legacy'), { recursive: true });
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'shop', name: 'Shop', path: '../shop' }, { id: 'planning', name: 'Planning', path: '.' }], work_items: [
    { id: 'work-0001', path: 'active/0001-checkout', repositories: ['shop'], current_plan: 'active/0001-checkout/plan.md' },
    { id: 'work-0002', path: 'archive/0002-legacy', repositories: [], current_plan: null },
  ] }, null, 2).replace(/\[\n\s+"shop"\n\s+\]/g, '["shop"]').replace(/\[\]/g, '[]') + '\n');
  writeFileSync(path.join(work, 'plan.md'), BOM + plan('work-0001', 'Checkout', '## Data model\n\nSee the [glossary](CONTEXT.md#orders), the [orders](diagrams/orders.puml#Order) and ![photo](evidence/photo.png).\n'));
  writeFileSync(path.join(work, 'ledger.md'), BOM + '---\r\nschema_version: 1\r\nkind: ledger\r\nwork_id: "work-0001"\r\nupdated: "2026-10-02"\r\ncurrent: "Building it"\r\nnext: []\r\nblocked: null\r\n---\r\n\r\n# Ledger\r\n');
  writeFileSync(path.join(work, 'CONTEXT.md'), '# Glossary\n\n## Orders\n\n**Order**: what a customer buys.\n');
  writeFileSync(path.join(work, 'docs/adr/0001-orders.md'), '# Keep orders\n');
  writeFileSync(path.join(work, 'evidence/photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0xff, 0xfe]));
  writeFileSync(path.join(work, 'evidence/bytes.bin'), Buffer.from(Array.from({ length: 512 }, (_, index) => index % 256)));
  writeFileSync(path.join(work, 'evidence/notes.txt'), 'line one\r\nline two\r\n\u00e9\u4e2d\r\n');
  writeFileSync(path.join(root, 'archive/0002-legacy/README.md'), '# Legacy notes\n');
  // Diagrams: an authored class diagram, a database capture and a proposal over it.
  mkdirSync(path.join(work, 'diagrams'));
  writeFileSync(path.join(work, 'diagrams/orders.puml'), ORDERS);
  writeFileSync(path.join(work, 'diagrams/captured.puml'), captured());
  writeFileSync(path.join(work, 'diagrams/proposed.puml'), proposed());
  return work;
}

function payloadOf(html: string) {
  const match = /<script id="atlas-plan-export" type="application\/json">([\s\S]*?)<\/script>/.exec(html)!;
  return { payload: JSON.parse(match[1]), replace: (value: unknown) => html.replace(match[0], () => `<script id="atlas-plan-export" type="application/json">${JSON.stringify(value).replaceAll('<', '\\u003c')}</script>`) };
}

function assertRoundTrip(sourceWork: string, targetWork: string, from: string, to: string, currentPlan: string | null) {
  const source = snapshot(sourceWork), target = snapshot(targetWork);
  for (const [name, bytes] of source) {
    if (/^\.atlas\/(?:results|prepared|exports)\//.test(name) || name === '.atlas/statistics.jsonl') continue;
    assert.ok(target.has(name), `${name} was imported`);
    const imported = target.get(name)!;
    if (name === currentPlan || name === 'ledger.md') {
      const field = name === 'ledger.md' ? 'work_id' : 'id';
      assert.equal(parseFrontmatter(imported.toString('utf8'))?.[field], to, `${name} ${field} is rewritten`);
      assert.equal(imported.toString('utf8').replace(to, from), bytes.toString('utf8'), `${name} differs only in its identity`);
    } else assert.deepEqual(imported, bytes, `${name} is byte-for-byte identical`);
  }
  assert.deepEqual([...target.keys()].filter(name => !source.has(name)), ['evidence/import-provenance.json']);
}

test('exports the whole work folder and imports it losslessly as new work', async t => {
  const directory = temporary(t);
  const source = path.join(directory, 'source'), target = path.join(directory, 'target');
  mkdirSync(source); const work = fixture(source);
  cpSync(source, target, { recursive: true });
  // Transient Atlas output is not part of the plan.
  mkdirSync(path.join(work, '.atlas/results'), { recursive: true });
  writeFileSync(path.join(work, '.atlas/results/x.json'), '{}');

  const exported = await exportPlan(source, 'work-0001', { now });
  assert.deepEqual(exported.warnings, []);
  assert.equal(exported.bytes, Buffer.byteLength(exported.html));
  assert.equal((await exportPlan(source, 'active/0001-checkout/', { now })).html, exported.html, 'exports are deterministic, by ID or folder');
  assert.equal(exported.manifest.source.location, 'active');
  assert.deepEqual(exported.manifest.source.repositories, [{ id: 'shop', name: 'Shop' }]);
  assert.ok(!exported.manifest.files.some(file => file.path.startsWith('.atlas/results')));
  assert.equal(exported.manifest.exportedAt, now.toISOString());

  const preview = readPlanExport(Buffer.from(exported.html));
  assert.equal(preview.manifest.source.workId, 'work-0001');
  assert.equal(preview.files.length, exported.manifest.files.length);
  assert.equal(preview.totalBytes, exported.manifest.files.reduce((sum, file) => sum + file.size, 0));
  assert.deepEqual(preview.diagrams.map(item => [item.path, item.title, item.provenance.kind]), [['diagrams/captured.puml', 'Captured orders', 'generated'], ['diagrams/orders.puml', 'Orders', 'authored'], ['diagrams/proposed.puml', 'Proposed orders', 'proposal']]);

  const registry = readFileSync(path.join(target, 'planning.json'), 'utf8');
  assert.deepEqual(await planImportTarget(target, preview.manifest), { workId: 'work-0003', path: 'active/0003-checkout' });
  const imported = await importPlan(target, exported.html);
  assert.deepEqual({ workId: imported.workId, path: imported.path }, { workId: 'work-0003', path: 'active/0003-checkout' });
  assert.ok(imported.notes.some(note => /README/.test(note)), 'the README is left to the user');
  assert.ok(imported.notes.some(note => /Nothing was committed/.test(note)));
  assertRoundTrip(work, path.join(target, 'active/0003-checkout'), 'work-0001', 'work-0003', 'plan.md');

  // Registry: one textual insertion in the file's own style, nothing else changed.
  const after = readFileSync(path.join(target, 'planning.json'), 'utf8');
  let prefix = 0; while (registry[prefix] === after[prefix]) prefix++;
  let suffix = 0; while (suffix < registry.length - prefix && registry.at(-1 - suffix) === after.at(-1 - suffix)) suffix++;
  assert.equal(prefix + suffix, registry.length, 'the registry change is a pure insertion');
  assert.match(after.slice(prefix, after.length - suffix), /^,\n {4}\{\n {6}"id": "work-0003",\n {6}"path": "active\/0003-checkout",\n {6}"repositories": \["shop"\],\n {6}"current_plan": "active\/0003-checkout\/plan.md"\n {4}\}$/);
  assert.deepEqual(validatePlanning(target), { errors: [], warnings: ['work_items[1]: legacy repository scope is unknown', 'work_items[1]: main plan is unidentified'] });

  const provenance = JSON.parse(readFileSync(path.join(target, 'active/0003-checkout/evidence/import-provenance.json'), 'utf8'));
  assert.deepEqual(provenance.source, { planningFolder: 'source', workId: 'work-0001', title: 'Checkout', location: 'active', path: 'active/0001-checkout' });
  assert.deepEqual(provenance.export, { exportedAt: now.toISOString(), atlasVersion: exported.manifest.atlasVersion, importedWith: exported.manifest.atlasVersion });
  assert.ok(readFileSync(path.join(target, 'active/0003-checkout/plan.md')).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), 'the plan keeps its byte order mark');
  assert.ok(readFileSync(path.join(target, 'active/0003-checkout/ledger.md')).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), 'the ledger keeps its byte order mark');
  assert.deepEqual(provenance.identityRewrites.map((item: { field: string }) => item.field), ['id', 'work_id']);

  // The app's reader shows the imported work and its diagrams.
  const index = await loadPlanning(target);
  const work3 = index.work.find(item => item.id === 'work-0003')!;
  assert.equal(work3.title, 'Checkout');
  assert.equal(work3.progress?.current, 'Building it');
  const listed = await new DiagramCatalog(target).list(index, 'work-0003');
  assert.deepEqual(listed.map(diagram => [diagram.path, diagram.valid]), [['diagrams/captured.puml', true], ['diagrams/orders.puml', true], ['diagrams/proposed.puml', true]]);
  assert.equal((await new DiagramCatalog(target).references(index, 'work-0003', 'active/0003-checkout/plan.md'))[0].element, 'Order');
});

test('keeps the archive location, takes the next free number and imports twice as two items', async t => {
  const directory = temporary(t);
  const source = path.join(directory, 'source'), target = path.join(directory, 'target');
  mkdirSync(source); fixture(source);
  cpSync(source, target, { recursive: true });
  mkdirSync(path.join(target, 'archive/0003-unregistered'), { recursive: true });
  mkdirSync(path.join(target, 'active/2026-10-roadmap'), { recursive: true });
  const legacy = await exportPlan(source, 'work-0002', { now });
  assert.equal(legacy.manifest.source.currentPlan, null);
  assert.equal(legacy.manifest.source.location, 'archive');
  const first = await importPlan(target, legacy.html);
  assert.deepEqual([first.workId, first.path], ['work-0004', 'archive/0004-legacy']);
  assert.ok(first.notes.some(note => /no registered main plan/.test(note)));
  const second = await importPlan(target, legacy.html);
  assert.deepEqual([second.workId, second.path], ['work-0005', 'archive/0005-legacy']);
  assert.deepEqual(readFileSync(path.join(target, 'archive/0005-legacy/README.md')), readFileSync(path.join(source, 'archive/0002-legacy/README.md')));
  assert.deepEqual(validatePlanning(target).errors, []);
  // Re-exporting an imported item keeps its earlier import record.
  const again = await importPlan(target, (await exportPlan(target, 'work-0005', { now })).html);
  assert.ok(existsSync(path.join(target, again.path, 'evidence/import-provenance.json')));
  assert.equal(JSON.parse(readFileSync(path.join(target, again.path, 'evidence/import-provenance-2.json'), 'utf8')).source.workId, 'work-0005');
});

test('registers repositories the target does not know, in the registry\'s own style', async t => {
  const directory = temporary(t);
  const source = path.join(directory, 'source'), target = path.join(directory, 'target');
  mkdirSync(source); fixture(source);
  mkdirSync(target);
  const crlf = '{\r\n\t"schema_version": 1,\r\n\t"repositories": [\r\n\t\t{ "id": "other", "name": "Other" }\r\n\t],\r\n\t"work_items": []\r\n}\r\n';
  writeFileSync(path.join(target, 'planning.json'), crlf);
  const result = await importPlan(target, (await exportPlan(source, 'work-0001', { now })).html);
  assert.equal(result.workId, 'work-0001');
  const after = readFileSync(path.join(target, 'planning.json'), 'utf8');
  assert.ok(after.includes('\t\t{ "id": "other", "name": "Other" },\r\n\t\t{ "id": "shop", "name": "Shop" }\r\n\t],'));
  assert.ok(!/[^\r]\n/.test(after), 'line endings are kept');
  assert.deepEqual(validatePlanning(target).errors, []);
  assert.ok(result.notes.some(note => /repository shop/.test(note)));
});

async function assertRejected(t: TestContext, html: string | Uint8Array, code: PlanExportErrorCode, message?: RegExp) {
  const target = temporary(t, 'plan-import-target-');
  fixture(target);
  const before = snapshot(target);
  assert.throws(() => readPlanExport(html), (error: unknown) => error instanceof PlanExportError && error.code === code && (!message || message.test(error.message)));
  await assert.rejects(importPlan(target, html), (error: unknown) => error instanceof PlanExportError && error.code === code);
  assert.deepEqual(snapshot(target), before, 'nothing was written');
}

test('rejects tampered, unsafe, duplicated and unknown exports before writing anything', async t => {
  const source = temporary(t);
  fixture(source);
  const { html } = await exportPlan(source, 'work-0001', { now });
  const { payload, replace } = payloadOf(html);
  const variant = (change: (copy: typeof payload) => void) => { const copy = structuredClone(payload); change(copy); return replace(copy); };
  const plan = (copy: typeof payload) => copy.files.find((file: { path: string }) => file.path === 'plan.md');

  await assertRejected(t, variant(copy => { const file = plan(copy); file.data = Buffer.from(Buffer.from(file.data, 'base64').toString('utf8').replace('Checkout', 'Checkouts')).toString('base64'); file.size += 1; }), 'INTEGRITY', /SHA-256/);
  await assertRejected(t, variant(copy => { plan(copy).size += 1; }), 'INTEGRITY');
  await assertRejected(t, variant(copy => { plan(copy).data = '!!!!'; }), 'INTEGRITY');
  for (const unsafe of ['../escape.md', 'docs/../../escape.md', '/etc/passwd', 'C:/Windows/evil.md', '\\\\server\\share.md', 'docs\\evil.md', './plan2.md', 'a//b.md', '.git/config', 'docs/.hidden', 'evidence/CON.txt', 'evidence/trailing. ', 'evidence/a:b.md']) {
    await assertRejected(t, variant(copy => { plan(copy).path = unsafe; }), 'PATH');
  }
  await assertRejected(t, variant(copy => { copy.files.push(structuredClone(plan(copy))); }), 'DUPLICATE');
  await assertRejected(t, variant(copy => { const twin = structuredClone(plan(copy)); twin.path = 'PLAN.md'; copy.files.push(twin); }), 'DUPLICATE');
  await assertRejected(t, variant(copy => { const twin = structuredClone(plan(copy)); twin.path = 'plan.md/inner.md'; copy.files.push(twin); }), 'PATH');
  await assertRejected(t, variant(copy => { const twin = structuredClone(plan(copy)); twin.path = 'Docs/adr/other.md'; copy.files.push(twin); }), 'DUPLICATE', /merge/);
  await assertRejected(t, variant(copy => { const a = structuredClone(plan(copy)), b = structuredClone(plan(copy)); a.path = 'evidence/caf' + String.fromCharCode(0xe9) + '/a.md'; b.path = 'evidence/cafe' + String.fromCharCode(0x301) + '/b.md'; copy.files.push(a, b); }), 'DUPLICATE');
  await assertRejected(t, variant(copy => { copy.source.title = 'Harmless' + ESC + ']52;c;ZWNobw==' + String.fromCharCode(7); }), 'FORMAT', /control characters/);
  await assertRejected(t, variant(copy => { copy.source.repositories[0].name = 'Shop' + String.fromCharCode(0x85); }), 'FORMAT', /control characters/);
  await assertRejected(t, variant(copy => { copy.source.planningFolder = 'x' + ESC + '[31m'; }), 'FORMAT');
  await assertRejected(t, variant(copy => { plan(copy).path = 'evidence/' + String.fromCharCode(0x9b) + '2J.md'; }), 'PATH');
  await assertRejected(t, variant(copy => { copy.source.currentPlan = 'diagrams/orders.puml'; }), 'FORMAT', /Markdown/);
  await assertRejected(t, variant(copy => { copy.source.currentPlan = 'evidence/notes.txt'; }), 'FORMAT', /Markdown/);
  await assertRejected(t, variant(copy => { plan(copy).size = 400 * 1024 * 1024; }), 'LIMIT');
  await assertRejected(t, variant(copy => { copy.version = 2; }), 'VERSION');
  await assertRejected(t, variant(copy => { copy.format = 'atlas/other'; }), 'FORMAT');
  await assertRejected(t, variant(copy => { copy.source.currentPlan = 'missing.md'; }), 'FORMAT');
  await assertRejected(t, variant(copy => { copy.source.path = '../outside'; }), 'PATH');
  await assertRejected(t, html.replace('</body>', `<script id="atlas-plan-export" type="application/json">{}</script></body>`), 'FORMAT', /more than one/);
  await assertRejected(t, html.replace('<script id="atlas-plan-export" type="application/json">', '<script id="atlas-plan-export" type="text/javascript">'), 'FORMAT', /inert/);
  await assertRejected(t, '<!doctype html><title>x</title><script id="atlas-diagram" type="application/json">{}</script>', 'FORMAT', /one diagram, not a plan export/);
  await assertRejected(t, '<!doctype html><p>Not an export</p>', 'FORMAT');
  await assertRejected(t, new Uint8Array([0xff, 0xfe, 0x3c]), 'FORMAT');
  await assertRejected(t, html.replace('"format":"atlas/plan-export"', '"format":'), 'FORMAT');
});

test('refuses a target that is not a valid planning repository', async t => {
  const source = temporary(t);
  fixture(source);
  const { html } = await exportPlan(source, 'work-0001', { now });
  const empty = temporary(t, 'plan-import-empty-');
  await assert.rejects(importPlan(empty, html), (error: unknown) => error instanceof PlanExportError && error.code === 'TARGET' && /the atlas skill/.test(error.message));
  assert.deepEqual(readdirSync(empty), []);
  const broken = temporary(t, 'plan-import-broken-');
  writeFileSync(path.join(broken, 'planning.json'), '{"schema_version": 2}');
  await assert.rejects(importPlan(broken, html), (error: unknown) => error instanceof PlanExportError && error.code === 'TARGET');
  assert.deepEqual(readdirSync(broken), ['planning.json']);
  await assert.rejects(exportPlan(source, 'work-0099'), (error: unknown) => error instanceof PlanExportError && error.code === 'WORK');
  await assert.rejects(exportPlan(empty, 'work-0001'), (error: unknown) => error instanceof PlanExportError && error.code === 'SOURCE');
});

test('portable path rules', () => {
  for (const good of ['plan.md', 'docs/adr/0001-x.md', '.atlas/models/m-0.json', 'evidence/ünïcode.md', 'evidence/日本語 notes.md', 'evidence/' + String.fromCharCode(0x5e9, 0x5dc, 0x5d5, 0x5dd) + '.md']) assert.equal(planExportPathProblem(good), null, good);
  for (const control of [0x202e, 0x202a, 0x2066, 0x2069, 0x200e, 0x200f, 0x61c]) assert.match(planExportPathProblem('evidence/a' + String.fromCharCode(control) + 'txt.md') ?? '', /direction/, control.toString(16));
  for (const bad of ['', '/x', 'x/', '..', 'a/../b', '.atlas', '.env', 'docs/.atlas/x', 'x*.md', 'nul', 'lpt1.txt', 'a.']) assert.notEqual(planExportPathProblem(bad), null, bad);
});

test('the exported HTML is self-contained, inert and safe to open', async t => {
  const source = temporary(t);
  const work = fixture(source);
  writeFileSync(path.join(work, 'plan.md'), plan('work-0001', 'Checkout </script><script>alert(1)</script>', '<script>alert(2)</script>\n'));
  const { html } = await exportPlan(source, 'work-0001', { now });
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] ?? '';
  for (const directive of ["default-src 'none'", "connect-src 'none'", "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(policy.includes(directive), directive);
  // Two scripts run: envUI's theme startup script in the head, and the viewer.
  assert.match(policy, /script-src 'sha256-[A-Za-z0-9+/=]+' 'sha256-[A-Za-z0-9+/=]+'/);
  assert.ok(!policy.includes("'unsafe-eval'") && !/script-src[^;]*'unsafe-inline'/.test(policy));
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<style>'), 'the policy precedes all content');
  type Element = { tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: Element[] };
  const elements: Element[] = [];
  const pending: Element[] = [parse(html) as unknown as Element];
  while (pending.length) { const node = pending.shift()!; if (node.tagName) elements.push(node); pending.push(...node.childNodes ?? []); }
  const scripts = elements.filter(node => node.tagName === 'script').map(node => Object.fromEntries((node.attrs ?? []).map(attribute => [attribute.name, attribute.value])));
  assert.deepEqual(scripts, [{}, { id: 'atlas-plan-export', type: 'application/json' }, { id: 'atlas-plan-view', type: 'application/json' }, {}], 'only the theme startup script and the viewer run; payloads are inert');
  const themeScript = /<head>[\s\S]*?<script>([\s\S]*?)<\/script>/.exec(html)![1];
  assert.ok(policy.includes(`'sha256-${createHash('sha256').update(themeScript).digest('base64')}'`), 'the theme startup script runs by its hash');
  assert.deepEqual(elements.filter(node => ['iframe', 'object', 'embed', 'base', 'form'].includes(node.tagName!)), []);
  assert.ok(!/<script\b[^>]*\bsrc\s*=/i.test(html) && !/<link\b(?![^>]*rel="icon" href="data:)[^>]*>/i.test(html), 'no external scripts or resources');
  assert.ok(!/url\(\s*['"]?(?:https?:)?\/\//i.test(html) && !/@import/i.test(html), 'no remote styles');
  assert.equal(html.match(/<\/script>/g)!.length, 4, 'embedded text cannot close a script element');
  assert.match(html, /<title>Checkout &lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; \| Atlas plan<\/title>/);
});

// Local-only: the demo workspace next to this checkout (absent in CI). Its work items carry
// diagrams with history; binary evidence is added to the copy.
const demo = path.resolve(here, '../../../../demo/planning');
test('round-trips every work item of the demo workspace', { skip: !existsSync(path.join(demo, 'planning.json')) && 'demo workspace absent' }, async t => {
  const directory = temporary(t);
  const source = path.join(directory, 'planning'), target = path.join(directory, 'target');
  const copy = (destination: string) => cpSync(demo, destination, { recursive: true, filter: name => path.basename(name) !== '.git' });
  copy(source); copy(target);
  writeFileSync(path.join(source, 'active/0001-saved-payment-methods/evidence/screenshot.png'), Buffer.from(Array.from({ length: 2048 }, (_, index) => (index * 7919) % 256)));
  const registry = JSON.parse(readFileSync(path.join(source, 'planning.json'), 'utf8')) as { work_items: { id: string; path: string; current_plan: string | null }[] };
  let next = registry.work_items.length;
  for (const item of registry.work_items) {
    const result = await importPlan(target, (await exportPlan(source, item.id, { now })).html);
    next++;
    const expected = item.path.split('/')[0] + '/' + String(next).padStart(4, '0') + '-' + path.posix.basename(item.path).replace(/^\d+-/, '');
    assert.deepEqual([result.workId, result.path], ['work-' + String(next).padStart(4, '0'), expected]);
    assertRoundTrip(path.join(source, item.path), path.join(target, result.path), item.id, result.workId, item.current_plan ? item.current_plan.slice(item.path.length + 1) : null);
  }
  assert.deepEqual(validatePlanning(target).errors, []);
  assert.ok(statSync(path.join(target, 'archive/0008-inventory-reservations')).isDirectory());
});

test('clears references to other work so the target stays valid, and rolls back an import that would not', async t => {
  const directory = temporary(t);
  const source = path.join(directory, 'source'), target = path.join(directory, 'target');
  mkdirSync(source); fixture(source);
  mkdirSync(path.join(source, 'active/0003-successor'), { recursive: true });
  const registry = JSON.parse(readFileSync(path.join(source, 'planning.json'), 'utf8'));
  registry.work_items.push({ id: 'work-0003', path: 'active/0003-successor', repositories: ['shop'], current_plan: 'active/0003-successor/plan.md' });
  writeFileSync(path.join(source, 'planning.json'), JSON.stringify(registry, null, 2));
  const successor = plan('work-0003', 'Successor').replace('supersedes: []', 'supersedes:\n  - work-0001\n  - work-0002');
  writeFileSync(path.join(source, 'active/0003-successor/plan.md'), successor);
  writeFileSync(path.join(source, 'active/0001-checkout/plan.md'), BOM + plan('work-0001', 'Checkout').replace('superseded_by: null', 'superseded_by: "work-0003"  # replaced'));
  assert.deepEqual(validatePlanning(source).errors, [], 'the source is valid');
  mkdirSync(target); fixture(target);

  const first = await importPlan(target, (await exportPlan(source, 'work-0003', { now })).html);
  const imported = readFileSync(path.join(target, first.path, 'plan.md'), 'utf8');
  assert.equal(imported, successor.replace('id: work-0003', 'id: ' + first.workId).replace('supersedes:\n  - work-0001\n  - work-0002', 'supersedes: []'));
  assert.ok(first.notes.some(note => /Cleared supersedes in plan.md \(was \[work-0001, work-0002\]\)/.test(note)), first.notes.join('\n'));
  const second = await importPlan(target, (await exportPlan(source, 'work-0001', { now })).html);
  assert.ok(readFileSync(path.join(target, second.path, 'plan.md'), 'utf8').startsWith(BOM));
  assert.match(readFileSync(path.join(target, second.path, 'plan.md'), 'utf8'), /^superseded_by: null$/m);
  const provenance = JSON.parse(readFileSync(path.join(target, second.path, 'evidence/import-provenance.json'), 'utf8'));
  assert.deepEqual(provenance.identityRewrites.find((item: { field: string }) => item.field === 'superseded_by'), { file: 'plan.md', field: 'superseded_by', from: 'work-0003', to: null });
  assert.deepEqual(validatePlanning(target).errors, []);

  // A plan whose metadata names another work ID would leave the target invalid: nothing stays.
  writeFileSync(path.join(source, 'active/0001-checkout/plan.md'), plan('work-0099', 'Checkout'));
  const broken = (await exportPlan(source, 'work-0001', { now })).html;
  const before = snapshot(target);
  await assert.rejects(importPlan(target, broken), (error: unknown) => error instanceof PlanExportError && error.code === 'TARGET' && /id disagrees with registry/.test(error.message));
  assert.deepEqual(snapshot(target), before, 'the import was rolled back');
});

test('imports into one planning folder take turns through a lock', async t => {
  const directory = temporary(t);
  const source = path.join(directory, 'source'), target = path.join(directory, 'target');
  mkdirSync(source); fixture(source);
  mkdirSync(target); fixture(target);
  const one = (await exportPlan(source, 'work-0001', { now })).html, two = (await exportPlan(source, 'work-0002', { now })).html;
  const results = await Promise.all([importPlan(target, one), importPlan(target, two), importPlan(target, one)]);
  assert.deepEqual(results.map(result => result.workId).sort(), ['work-0003', 'work-0004', 'work-0005']);
  const registered = JSON.parse(readFileSync(path.join(target, 'planning.json'), 'utf8')).work_items.map((item: { id: string }) => item.id);
  assert.deepEqual(registered, ['work-0001', 'work-0002', 'work-0003', 'work-0004', 'work-0005'], 'each import registered its own number, in the order they held the lock');
  assert.deepEqual(validatePlanning(target).errors, []);
  assert.ok(!existsSync(path.join(target, '.atlas-import.lock')), 'the lock is released');

  // A lock left by a process that no longer runs is removed; a live one is waited for, then reported.
  writeFileSync(path.join(target, '.atlas-import.lock'), JSON.stringify({ pid: 2 ** 30, hostname: hostname(), platform: process.platform, release: release(), token: 'gone', createdAt: '2026-10-10T00:00:00Z' }));
  assert.equal((await importPlan(target, two)).workId, 'work-0006');
  writeFileSync(path.join(target, '.atlas-import.lock'), JSON.stringify({ pid: process.pid, hostname: 'elsewhere', createdAt: '2026-10-10T00:00:00Z' }));
  const before = snapshot(target);
  await assert.rejects(importPlan(target, two, { lockWaitMs: 200 }), (error: unknown) => error instanceof PlanExportError && error.code === 'CONFLICT' && /in progress.*elsewhere/s.test(error.message));
  assert.deepEqual(snapshot(target), before);
});

test('reuses a validated preview, cleans up after interrupted imports and reports repository differences', async t => {
  const directory = temporary(t);
  const source = path.join(directory, 'source'), target = path.join(directory, 'target');
  mkdirSync(source); fixture(source);
  mkdirSync(target); fixture(target);
  const registry = readFileSync(path.join(target, 'planning.json'), 'utf8').replace('"name": "Shop"', '"name": "Our shop"');
  writeFileSync(path.join(target, 'planning.json'), registry);
  const old = path.join(target, 'active/.atlas-import-0b4e8f1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b'), fresh = path.join(target, 'active/.atlas-import-1b4e8f1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b');
  const unrelated = path.join(target, 'active/.atlas-import-notes');
  mkdirSync(old); mkdirSync(fresh); mkdirSync(unrelated);
  const hourAgo = new Date(Date.now() - 2 * 3600000);
  utimesSync(old, hourAgo, hourAgo); utimesSync(unrelated, hourAgo, hourAgo);
  const preview = readPlanExport((await exportPlan(source, 'work-0001', { now })).html);
  assert.ok(Object.isFrozen(preview.manifest.source) && Object.isFrozen(preview.files), 'a preview cannot be changed before import');
  const result = await importPlan(target, preview);
  assert.equal(result.workId, 'work-0003');
  assert.ok(!existsSync(old) && existsSync(fresh) && existsSync(unrelated), 'only stale temporary folders an import names are removed');
  assert.ok(result.notes.some(note => /Removed 1 temporary folder/.test(note)));
  assert.ok(result.notes.some(note => /repository shop is already registered here, named “Our shop” here and “Shop” in the export/.test(note)), result.notes.join('\n'));
  await assert.rejects(importPlan(target, { ...preview }), (error: unknown) => error instanceof PlanExportError && error.code === 'FORMAT');
});

test('refuses to export what no import would accept', async t => {
  const source = temporary(t);
  const work = fixture(source);
  writeFileSync(path.join(work, 'plan.md'), plan('work-0001', 'Bad \\e[2J title'));
  await assert.rejects(exportPlan(source, 'work-0001'), (error: unknown) => error instanceof PlanExportError && error.code === 'FORMAT' && /control characters/.test(error.message));
  writeFileSync(path.join(work, 'plan.md'), plan('work-0001', 'Checkout'));
  const registry = JSON.parse(readFileSync(path.join(source, 'planning.json'), 'utf8'));
  registry.work_items[0].current_plan = 'active/0001-checkout/evidence/notes.txt';
  writeFileSync(path.join(source, 'planning.json'), JSON.stringify(registry));
  await assert.rejects(exportPlan(source, 'work-0001'), (error: unknown) => error instanceof PlanExportError && error.code === 'FORMAT' && /Markdown/.test(error.message));
});

test('rolls back every step of a failed import, and says what is left when it cannot', async t => {
  const directory = temporary(t);
  const source = path.join(directory, 'source'), target = path.join(directory, 'target');
  mkdirSync(source); fixture(source);
  mkdirSync(path.join(target, 'active'), { recursive: true });
  // A registry with a byte order mark and CRLF line endings, and no archive/ folder yet.
  const registry = BOM + '{\r\n  "schema_version": 1,\r\n  "repositories": [{ "id": "shop", "name": "Shop" }],\r\n  "work_items": []\r\n}\r\n';
  writeFileSync(path.join(target, 'planning.json'), registry);
  const html = (await exportPlan(source, 'work-0002', { now })).html;
  const before = snapshot(target);
  t.after(() => { delete planExportTesting.afterRegister; delete planExportTesting.removeFolder; });

  planExportTesting.afterRegister = () => { throw new Error('disk vanished'); };
  await assert.rejects(importPlan(target, html), /disk vanished/);
  assert.deepEqual(snapshot(target), before, 'the registry is restored byte for byte and the folder removed');
  assert.ok(!existsSync(path.join(target, 'archive')), 'the location folder the import created is removed');
  assert.ok(!existsSync(path.join(target, '.atlas-import.lock')));

  planExportTesting.removeFolder = async () => { throw new Error('locked by a scanner'); };
  await assert.rejects(importPlan(target, html), (error: unknown) => error instanceof PlanExportError && error.code === 'ROLLBACK'
    && /disk vanished/.test(error.message) && /could not be fully undone/.test(error.message) && /archive[\\/]0001-legacy; delete it/.test(error.message));
  assert.equal(readFileSync(path.join(target, 'planning.json'), 'utf8'), registry, 'planning.json is still restored');
});

test('records the import beside an existing record, whatever its case', async t => {
  const directory = temporary(t);
  const source = path.join(directory, 'source'), target = path.join(directory, 'target');
  mkdirSync(source); const work = fixture(source);
  writeFileSync(path.join(work, 'evidence/Import-Provenance.json'), '{"earlier": true}\n');
  mkdirSync(target); fixture(target);
  const result = await importPlan(target, (await exportPlan(source, 'work-0001', { now })).html);
  assert.equal(readFileSync(path.join(target, result.path, 'evidence/Import-Provenance.json'), 'utf8'), '{"earlier": true}\n');
  assert.equal(JSON.parse(readFileSync(path.join(target, result.path, 'evidence/import-provenance-2.json'), 'utf8')).source.workId, 'work-0001');
  assert.ok(result.notes.some(note => /import-provenance-2\.json/.test(note)));
});

test('refuses an export too large for an import to read', async t => {
  const source = temporary(t);
  fixture(source);
  const { html } = await exportPlan(source, 'work-0001', { now });
  const limit = planExportTesting.maxInputLength;
  t.after(() => { planExportTesting.maxInputLength = limit; });
  planExportTesting.maxInputLength = html.length - 1;
  await assert.rejects(exportPlan(source, 'work-0001', { now }), (error: unknown) => error instanceof PlanExportError && error.code === 'LIMIT');
  assert.throws(() => readPlanExport(html), (error: unknown) => error instanceof PlanExportError && error.code === 'LIMIT');
  assert.throws(() => readPlanExport(Buffer.from(html)), (error: unknown) => error instanceof PlanExportError && error.code === 'LIMIT');
});

test('carries the diagrams with the links to them, drawn as the app draws them', async t => {
  const source = temporary(t);
  const work = fixture(source);
  writeFileSync(path.join(work, 'CONTEXT.md'), '# Glossary\n\n## Orders\n\n**Order**: what a customer buys. [Lines](diagrams/orders.puml#OrderLine)\n');
  const { html } = await exportPlan(source, 'work-0001', { now });
  const view = JSON.parse(/<script id="atlas-plan-view" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]) as { diagrams: { path: string; title: string; payload: ViewerPayload | null; references: { path: string; section: string | null; element: string | null }[] }[] };
  const orders = view.diagrams.find(diagram => diagram.path === 'diagrams/orders.puml')!;
  assert.equal(orders.title, 'Orders');
  assert.equal(orders.payload!.model.document?.path, 'diagrams/orders.puml');
  assert.deepEqual(orders.references, [{ path: 'CONTEXT.md', section: 'orders', element: 'OrderLine' }, { path: 'plan.md', section: 'data-model', element: 'Order' }]);
});

test('lays a family out together, and exports a diagram it cannot draw undrawn', async t => {
  const source = temporary(t);
  const work = fixture(source);
  writeFileSync(path.join(work, 'diagrams/alternative.puml'), proposed().replace('title Proposed orders', 'title Alternative').replace('note : text', 'memo : text'));
  writeFileSync(path.join(work, 'diagrams/broken.puml'), '@startuml\nclass A\nclass B\nA -up-> B\n@enduml\n');
  const { html, warnings } = await exportPlan(source, 'work-0001', { now });
  const view = JSON.parse(/<script id="atlas-plan-view" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]) as { diagrams: { path: string; payload: ViewerPayload | null; error: string | null }[] };
  const diagram = (name: string) => view.diagrams.find(item => item.path === 'diagrams/' + name)!;
  // A capture and its proposals share one layout, so the viewer switches between them in place.
  for (const name of ['captured.puml', 'proposed.puml', 'alternative.puml']) assert.equal(diagram(name).payload!.family, 'diagrams/captured.puml');
  const place = (payload: ViewerPayload) => { const node = (payload.comparison?.changeView ?? payload).views[0].diagram.nodes.find(item => item.name === 'orders')!; return [node.x, node.y]; };
  assert.deepEqual(place(diagram('alternative.puml').payload!), place(diagram('proposed.puml').payload!));
  // A diagram with problems is exported, but not drawn.
  assert.equal(diagram('broken.puml').payload, null);
  assert.match(diagram('broken.puml').error!, /^Line 4: .*direction/);
  assert(warnings.includes('The diagram diagrams/broken.puml is exported but cannot be drawn in the viewer.'));
});

test('a family that cannot be laid out leaves the other diagrams drawn', async t => {
  const source = temporary(t);
  fixture(source);
  const prepare = atlas.prepareDiagrams;
  t.mock.method(atlas, 'prepareDiagrams', (options: Parameters<typeof prepare>[0]) =>
    !options?.paths || options.paths.includes('diagrams/captured.puml') ? Promise.reject(new Error('layout failed')) : prepare(options));
  const { html, warnings } = await exportPlan(source, 'work-0001', { now });
  const view = JSON.parse(/<script id="atlas-plan-view" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]) as { diagrams: { path: string; payload: ViewerPayload | null; error: string | null }[] };
  const drawn = Object.fromEntries(view.diagrams.map(item => [item.path, item.payload !== null]));
  assert.deepEqual(drawn, { 'diagrams/captured.puml': false, 'diagrams/orders.puml': true, 'diagrams/proposed.puml': false });
  assert.deepEqual(warnings.filter(warning => /cannot be drawn/.test(warning)).length, 2);
});
