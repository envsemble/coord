// The planning reader: work, ledgers, documents and their health. What it reads from Git history is
// in planning.slow.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, symlink, rename, link } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadPlanning, readDocument, resolveDocument } from './planning.ts';
import { filesystemCaseSensitive, filesystemNormalizesUnicode } from '../system/filesystem.ts';
import { header, readerFixture as fixture, relativeDocumentPath } from '../testing/testing.ts';

test('root ledger reports current and agreed next work; defaults follow implementation while historical status stays unknown', async () => {
  const setup = await fixture();
  try {
    const folder = 'active/0001-example';
    await mkdir(path.join(setup.root, folder, 'supporting'), { recursive: true });
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: [{ id: 'work-0001', path: folder, repositories: ['example'], current_plan: folder + '/plan.md' }] }));
    await writeFile(path.join(setup.root, folder, 'supporting/ledger.md'), '# Historical phase evidence');
    const ledgerFile = path.join(setup.root, folder, 'ledger.md');
    const metadata = { schema_version: 1, kind: 'ledger', work_id: 'work-0001', updated: '2026-10-07', current: 'Verifying tenant boundaries', next: ['Review and hand off'], blocked: null };
    const source = (values: object) => '---\n' + Object.entries(values).map(([key, value]) => key + ': ' + JSON.stringify(value)).join('\n') + '\n---\n\n# Original ledger\nEvidence stays readable.';
    await writeFile(ledgerFile, source(metadata));
    for (const implementation of ['not_started', 'complete']) {
      await writeFile(path.join(setup.root, folder, 'plan.md'), header('work-0001', 'accepted', implementation));
      const work = (await loadPlanning(setup.root)).work[0];
      assert.equal(relativeDocumentPath(work.documents.find(file => file.name === 'ledger.md' && file.path.includes('/supporting/'))!), 'supporting/ledger.md');
      assert.equal(work.ledger, folder + '/ledger.md');
      assert.deepEqual(work.progress, { version: 1, current: metadata.current, next: metadata.next, blocked: null, updated: metadata.updated, steps: null });
    }
    // An invalid header (ledger.test.ts has the rules) leaves the progress unknown and the ledger readable.
    await writeFile(ledgerFile, source({ ...metadata, work_id: 'work-9999' }));
    const invalid = await loadPlanning(setup.root);
    assert.equal(invalid.work[0].progress, null);
    assert.ok(invalid.issues.some(issue => issue.message.includes('Ledger status')));
    assert.ok((await readDocument(setup.root, folder + '/ledger.md')).body.includes('Evidence stays readable.'));
    await writeFile(ledgerFile, '# Historical ledger\nAn old in-progress statement.');
    assert.equal((await loadPlanning(setup.root)).work[0].progress, null);
    await rename(ledgerFile, path.join(setup.root, folder, 'supporting/older-ledger.md'));
    const withoutMain = (await loadPlanning(setup.root)).work[0];
    assert.equal(withoutMain.ledger, null, 'a nested historical ledger must not become the main record');
  } finally { await setup.cleanup(); }
});

test('a version-2 ledger lists the agreed steps, so progress and the work left are known', async () => {
  const setup = await fixture();
  try {
    const folder = 'active/0001-example';
    await mkdir(path.join(setup.root, folder), { recursive: true });
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: [{ id: 'work-0001', path: folder, repositories: ['example'], current_plan: folder + '/plan.md' }] }));
    await writeFile(path.join(setup.root, folder, 'plan.md'), header('work-0001', 'accepted', 'in_progress'));
    const ledgerFile = path.join(setup.root, folder, 'ledger.md');
    const ledger = (steps: string) => ['---', 'schema_version: 2', 'kind: ledger', 'work_id: work-0001', 'updated: "2026-10-11"', 'blocked: null', 'steps:', steps, '---', '', '# Original ledger', 'Evidence stays readable.'].filter(line => line !== '').join('\n');
    const steps = ['  - title: "Fix scrolling"', '    status: done', '  - title: "Ledger step list"', '    status: doing', '  - title: "Statistics: tokens and time"', '    status: todo'].join('\n');
    await writeFile(ledgerFile, ledger(steps));
    const work = (await loadPlanning(setup.root)).work[0];
    assert.deepEqual(work.progress, {
      version: 2, current: 'Ledger step list', next: ['Statistics: tokens and time'], blocked: null, updated: '2026-10-11',
      steps: [{ title: 'Fix scrolling', status: 'done' }, { title: 'Ledger step list', status: 'doing' }, { title: 'Statistics: tokens and time', status: 'todo' }],
    });
    // A step listed twice makes the header invalid (ledger.test.ts has the other rules).
    await writeFile(ledgerFile, ledger(steps.replace('Statistics: tokens and time', 'Fix scrolling')));
    const invalid = await loadPlanning(setup.root);
    assert.equal(invalid.work[0].progress, null);
    assert.ok(invalid.issues.some(issue => issue.message.includes('Ledger status')));
  } finally { await setup.cleanup(); }
});

test('attachment metadata retains a streamed content hash beyond the text reader size limit', async () => {
  const setup = await fixture();
  try {
    const original = Buffer.alloc(5 * 1024 * 1024, 0x9c);
    const filename = path.join(setup.root, 'evidence.png');
    await writeFile(filename, original);
    const document = await readDocument(setup.root, 'evidence.png');
    assert.equal(document.format, 'attachment');
    assert.equal(document.body, '');
    assert.equal(document.contentHash, createHash('sha256').update(original).digest('hex'));
    assert.deepEqual(await readFile(filename), original);
    await writeFile(filename, Buffer.from('Replaced attachment'));
    assert.notEqual((await readDocument(setup.root, 'evidence.png')).contentHash, document.contentHash);
  } finally { await setup.cleanup(); }
});

test('POSIX backslashes retain original filenames instead of indexing another path', { skip: process.platform === 'win32' }, async () => {
  const setup = await fixture();
  try {
    const location = 'active/0001-example';
    await mkdir(path.join(setup.root, location, 'foo'), { recursive: true });
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [], work_items: [{ id: 'work-0001', path: location, repositories: [], current_plan: null }] }));
    const originals = new Map([
      [location + '/foo\\bar.md', '# Literal backslash\n'],
      [location + '/foo/bar.md', '# Nested path\n'],
      [location + '/foo\\.retained.md', '# Visible filename\n'],
    ]);
    for (const [name, body] of originals) await writeFile(path.join(setup.root, name), body);
    const snapshot = await loadPlanning(setup.root);
    for (const [name, body] of originals) {
      const document = snapshot.documents.find(document => document.path === name);
      assert.ok(document, name);
      assert.equal(document.workId, 'work-0001');
      assert.equal(document.key, 'work-0001:' + name.slice(location.length + 1));
      assert.equal((await readDocument(setup.root, name)).body, body);
    }
  } finally { await setup.cleanup(); }
});
test('null pointers never select a file by name, and archive is not implementation completion', async () => {
  const setup = await fixture();
  try {
    await mkdir(path.join(setup.root, 'active/0001-retained'), { recursive: true });
    await mkdir(path.join(setup.root, 'archive/0002-abandoned'), { recursive: true });
    await mkdir(path.join(setup.root, 'active/0003-awaiting-delivery'), { recursive: true });
    const original = '# A tempting plan\nDo not select this implicitly.\n';
    await writeFile(path.join(setup.root, 'active/0001-retained/newest-plan.md'), original);
    await writeFile(path.join(setup.root, 'archive/0002-abandoned/plan.md'), header('work-0002', 'abandoned', 'partial'));
    await writeFile(path.join(setup.root, 'active/0003-awaiting-delivery/plan.md'), header('work-0003', 'accepted', 'complete', '2026-10-06'));
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: [
      { id: 'work-0001', path: 'active/0001-retained', repositories: ['example'], current_plan: null },
      { id: 'work-0002', path: 'archive/0002-abandoned', repositories: ['example'], current_plan: 'archive/0002-abandoned/plan.md' },
      { id: 'work-0003', path: 'active/0003-awaiting-delivery', repositories: ['example'], current_plan: 'active/0003-awaiting-delivery/plan.md' },
    ] }));
    const result = await loadPlanning(setup.root);
    assert.equal(result.work[0].currentPlan, null);
    assert.equal(result.work[0].implementation, 'unknown');
    assert.equal(result.work[0].created, null);
    assert.equal(result.work[1].location, 'archived');
    assert.equal(result.work[1].implementation, 'partial');
    assert.equal(result.work[1].durationDays, null);
    assert.equal(result.work[2].location, 'active');
    assert.equal(result.work[2].implementation, 'complete');
    assert.equal(await readFile(path.join(setup.root, 'active/0001-retained/newest-plan.md'), 'utf8'), original);
  } finally { await setup.cleanup(); }
});
test('selected legacy single files remain readable without invented metadata', async () => {
  const setup = await fixture();
  try {
    await writeFile(path.join(setup.root, 'historical.md'), '# Historical proposal\n\nOriginal text.\n');
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [], work_items: [{ id: 'work-0001', path: 'historical.md', repositories: [], current_plan: 'historical.md' }] }));
    const result = await loadPlanning(setup.root);
    assert.equal(result.work[0].title, 'Historical proposal');
    assert.equal(result.work[0].implementation, 'unknown');
    assert.equal(result.work[0].documents.length, 1);
    assert.equal(result.work[0].documents[0].key, 'work-0001:historical.md');
    assert.ok(result.issues.some(issue => issue.level === 'warning'));
    assert.equal((await readDocument(setup.root, 'historical.md')).body, '# Historical proposal\n\nOriginal text.\n');
  } finally { await setup.cleanup(); }
});
test('document reads reject traversal, hidden Git data, and links outside the root', async () => {
  const setup = await fixture();
  try {
    const outside = path.join(setup.temporary, 'outside');
    await mkdir(outside); await writeFile(path.join(outside, 'note.md'), 'Outside.');
    await mkdir(path.join(setup.root, '.git')); await writeFile(path.join(setup.root, '.git/config'), 'Private metadata.');
    await symlink(outside, path.join(setup.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(resolveDocument(setup.root, '../outside/note.md'));
    await assert.rejects(resolveDocument(setup.root, '.git/config'));
    await assert.rejects(resolveDocument(setup.root, 'linked/note.md'));
  } finally { await setup.cleanup(); }
});
test('invalid planning roots fail with a useful message', async () => {
  const setup = await fixture();
  try { await assert.rejects(loadPlanning(setup.root), /readable planning.json/); }
  finally { await setup.cleanup(); }
});

test('distinct Unicode hardlink names do not establish normalization aliases', async t => {
  const setup = await fixture();
  try {
    const retained = 'cafe\u0301.md'; const composed = 'caf\u00e9.md';
    await writeFile(path.join(setup.root, retained), 'Original retained record.');
    if (await filesystemNormalizesUnicode(setup.root, [retained])) { t.skip('Filesystem resolves these names as one entry'); return; }
    await link(path.join(setup.root, retained), path.join(setup.root, composed));
    assert.equal(await filesystemNormalizesUnicode(setup.root, [retained]), false);
  } finally { await setup.cleanup(); }
});

test('Windows BOM registries load and invalid repository records fail before reaching the UI', async () => {
  const setup = await fixture();
  try {
    await mkdir(path.join(setup.root, 'knowledge/example'), { recursive: true });
    await writeFile(path.join(setup.root, 'knowledge/example/lesson.md'), '# Scoped lesson');
    await writeFile(path.join(setup.root, 'planning.json'), '\uFEFF' + JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: [] }));
    assert.deepEqual((await loadPlanning(setup.root)).documents.find(file => file.category === 'knowledge')?.repositories, ['example']);
    for (const repositories of [[null], [{ id: '__proto__', name: 'Invalid' }], [{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }]]) {
      await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories, work_items: [] }));
      await assert.rejects(loadPlanning(setup.root), /registered repository/);
    }
  } finally { await setup.cleanup(); }
});
test('invalid non-null dates and chronology produce health errors while unknown dates remain legitimate', async () => {
  const setup = await fixture();
  try {
    await mkdir(path.join(setup.root, 'active/0001-example'), { recursive: true });
    const filename = path.join(setup.root, 'active/0001-example/plan.md');
    const original = header('work-0001', 'accepted', 'complete');
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: [{ id: 'work-0001', path: 'active/0001-example', repositories: ['example'], current_plan: 'active/0001-example/plan.md' }] }));
    await writeFile(filename, original);
    assert.equal((await loadPlanning(setup.root)).issues.filter(issue => issue.level === 'error').length, 0);
    await writeFile(filename, original.replace('accepted_at: null', 'accepted_at: yesterday'));
    assert.ok((await loadPlanning(setup.root)).issues.some(issue => issue.level === 'error' && issue.message.includes('accepted_at')));
    await writeFile(filename, original.replace('created: null', 'created: "2026-02-30"'));
    assert.ok((await loadPlanning(setup.root)).issues.some(issue => issue.message.includes('created')));
    await writeFile(filename, original.replace('accepted_at: null', 'accepted_at: "2026-10-07"').replace('completed_at: null', 'completed_at: "2026-10-06"'));
    const result = await loadPlanning(setup.root);
    assert.ok(result.issues.some(issue => issue.message.includes('out of order')));
    assert.equal(result.work[0].durationDays, null);
    await writeFile(filename, original.replace('created: null', 'created: "2026-10-07"').replace('accepted_at: null', 'accepted_at: "2026-10-05"').replace('completed_at: null', 'completed_at: "2026-10-06"'));
    assert.equal((await loadPlanning(setup.root)).work[0].durationDays, null, 'a reversed creation date must not enter duration statistics');
    await writeFile(filename, original.replace('created: null', 'created: "2026-10-07"'));
    assert.ok((await loadPlanning(setup.root)).issues.some(issue => issue.message.includes('out of order')), 'an update before creation is invalid even with unknown acceptance and completion');
    for (const { accepted, completed } of [
      { accepted: '2026-10-07', completed: null },
      { accepted: '2026-10-05', completed: '2026-10-07' },
    ]) {
      await writeFile(filename, original.replace('accepted_at: null', 'accepted_at: "' + accepted + '"').replace('completed_at: null', 'completed_at: ' + JSON.stringify(completed)));
      const staleUpdate = await loadPlanning(setup.root);
      assert.ok(staleUpdate.issues.some(issue => issue.message.includes('out of order')), 'updated must not precede acceptance or completion');
      assert.equal(staleUpdate.work[0].durationDays, null, 'a stale update must not enter duration statistics');
    }
    await writeFile(filename, original.replace('accepted_at: null', 'accepted_at: "2026-10-05"').replace('completed_at: null', 'completed_at: "2026-10-06"'));
    const alignedUpdate = await loadPlanning(setup.root);
    assert.equal(alignedUpdate.issues.filter(issue => issue.level === 'error').length, 0, 'updated may equal the latest milestone');
    assert.equal(alignedUpdate.work[0].durationDays, 1);
    const withDesign = (design: string) => writeFile(filename, original.replace('design_status: accepted', 'design_status: ' + design).replace('accepted_at: null', 'accepted_at: "2026-10-05"').replace('completed_at: null', 'completed_at: "2026-10-06"'));
    await withDesign('draft');
    const invalidAcceptance = await loadPlanning(setup.root);
    assert.ok(invalidAcceptance.issues.some(issue => issue.level === 'error'));
    assert.equal(invalidAcceptance.work[0].durationDays, null, 'an invalid acceptance/design combination must not enter duration statistics');
    await withDesign('abandoned');
    assert.equal((await loadPlanning(setup.root)).work[0].durationDays, 1, 'a later design disposition preserves a known historical acceptance');
  } finally { await setup.cleanup(); }
});
test('registry paths retain safe POSIX aliases while rejecting parent segments and duplicate locations', async () => {
  const setup = await fixture();
  try {
    await mkdir(path.join(setup.root, 'active/0002-real'), { recursive: true });
    const filename = path.join(setup.root, 'active/0002-real/plan.md');
    const original = header('work-0002', 'accepted', 'not_started');
    await writeFile(filename, original);
    const item = { id: 'work-0002', path: 'active/0002-real', repositories: ['example'], current_plan: 'active/0002-real/plan.md' };
    const writeRegistry = (items: typeof item[]) => writeFile(path.join(setup.root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: items }));
    const locations = ['active/0001-old/../0002-real', 'active\\0002-real', '/active/0002-real', 'C:/active/0002-real', './C:active/0002-real', './C:/active/0002-real'];
    for (const location of locations) {
      await writeRegistry([{ ...item, path: location }]);
      await assert.rejects(loadPlanning(setup.root), /POSIX-relative/);
    }
    await writeRegistry([{ ...item, current_plan: 'active/0002-real/../0002-real/plan.md' }]);
    await assert.rejects(loadPlanning(setup.root), /POSIX-relative/);
    await writeRegistry([item, { ...item, id: 'work-0003' }]);
    await assert.rejects(loadPlanning(setup.root), /same retained location/);
    await writeRegistry([item, { ...item, id: 'work-0003', path: './active//0002-real/' }]);
    await assert.rejects(loadPlanning(setup.root), /same retained location/);
    await writeRegistry([item, { ...item, id: 'work-0003', path: 'active/0002-real/nested' }]);
    await assert.rejects(loadPlanning(setup.root), /select the same plan/);
    for (const id of ['root', 'work-1', 'Work-0001', '', 'work-0001:shadow']) {
      await writeRegistry([{ ...item, id }]);
      await assert.rejects(loadPlanning(setup.root), /invalid or duplicate identity/);
    }
    if (!(await filesystemCaseSensitive(setup.root))) {
      await writeRegistry([item, { ...item, id: 'work-0003', path: 'Active/0002-Real', current_plan: 'Active/0002-Real/plan.md' }]);
      await assert.rejects(loadPlanning(setup.root), /same retained location/);
    }
    for (const location of ['active/./0002-real', './active/0002-real', 'active//0002-real', 'active/0002-real/']) {
      await writeRegistry([{ ...item, path: location, current_plan: './active//0002-real/./plan.md' }]);
      const registryBytes = await readFile(path.join(setup.root, 'planning.json'));
      const result = await loadPlanning(setup.root);
      assert.equal(result.work[0].path, item.path);
      assert.equal(result.work[0].currentPlan, item.current_plan);
      assert.equal(result.work[0].documents[0].key, 'work-0002:plan.md');
      assert.deepEqual(await readFile(path.join(setup.root, 'planning.json')), registryBytes);
    }
    assert.equal(await readFile(filename, 'utf8'), original);
  } finally { await setup.cleanup(); }
});



test('normalized plan health reports missing or contradictory metadata while keeping original bodies readable', async () => {
  const setup = await fixture();
  try {
    await mkdir(path.join(setup.root, 'active/0001-example'), { recursive: true });
    await writeFile(path.join(setup.root, 'retained.md'), '# Other retained work');
    const filename = path.join(setup.root, 'active/0001-example/plan.md');
    const original = header('work-0001', 'accepted', 'not_started');
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: [{ id: 'work-0001', path: 'active/0001-example', repositories: ['example'], current_plan: 'active/0001-example/plan.md' }, { id: 'work-0002', path: 'retained.md', repositories: [], current_plan: null }] }));
    const scenarios = [
      [original.replace('title: Example work', 'title: 123'), 'title'],
      [original.replace('supersedes: []\n', ''), 'Missing plan metadata'],
      [original.replace('supersedes: []', 'supersedes: [work-0001]'), 'Supersedes'],
      [original.replace('supersedes: []', 'supersedes: [work-0002, work-0002]'), 'Supersedes'],
      [original.replace('superseded_by: null', 'superseded_by: work-9999'), 'Superseded by'],
      [original.replace('design_status: accepted', 'design_status: draft').replace('accepted_at: null', 'accepted_at: "2026-10-06"'), 'draft'],
    ];
    for (const [source, message] of scenarios) {
      await writeFile(filename, source);
      const result = await loadPlanning(setup.root);
      assert.ok(result.issues.some(issue => issue.level === 'error' && issue.message.includes(message)), message);
      assert.ok((await readDocument(setup.root, 'active/0001-example/plan.md')).body.includes('Preserve this body.'));
      assert.equal(await readFile(filename, 'utf8'), source);
    }
    await writeFile(filename, original.replace('supersedes: []', 'supersedes: [work-0002]'));
    assert.equal((await loadPlanning(setup.root)).issues.filter(issue => issue.level === 'error').length, 0);
  } finally { await setup.cleanup(); }
});
