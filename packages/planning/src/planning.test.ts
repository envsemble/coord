import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath, rename, link } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadPlanning, readDocument, resolveDocument } from './planning.ts';
import { filesystemCaseSensitive, filesystemNormalizesUnicode } from './filesystem.ts';
import type { Document } from './types.ts';

const relativeDocumentPath = (file: Document) => file.workId ? file.key.slice(file.workId.length + 1) : file.path;

async function fixture() {
  const temporary = await mkdtemp(path.join(tmpdir(), 'planning-reader-'));
  const root = path.join(temporary, 'planning');
  await mkdir(root);
  return { root, temporary, cleanup: async () => {
    const actual = await realpath(temporary);
    assert.equal(path.dirname(actual), await realpath(tmpdir()));
    assert.ok(path.basename(actual).startsWith('planning-reader-'));
    await rm(actual, { recursive: true });
  } };
}
function header(id: string, design: string, implementation: string, completed: string | null = null) {
  return ['---', 'schema_version: 1', 'kind: plan', 'id: ' + id, 'title: Example work', 'repositories: [example]', 'created: null', 'updated: "2026-10-06"', 'design_status: ' + design, 'implementation_status: ' + implementation, 'accepted_at: null', 'completed_at: ' + (completed ? '"' + completed + '"' : 'null'), 'supersedes: []', 'superseded_by: null', '---', '# Original plan', '', 'Preserve this body.', ''].join('\n');
}

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
    for (const implementation of ['not_started', 'in_progress', 'partial', 'complete']) {
      await writeFile(path.join(setup.root, folder, 'plan.md'), header('work-0001', 'accepted', implementation));
      const work = (await loadPlanning(setup.root)).work[0];
      assert.equal(relativeDocumentPath(work.documents.find(file => file.name === 'ledger.md' && file.path.includes('/supporting/'))!), 'supporting/ledger.md');
      assert.equal(work.ledger, folder + '/ledger.md');
      assert.deepEqual(work.progress, { version: 1, current: metadata.current, next: metadata.next, blocked: null, updated: metadata.updated, steps: null });
    }
    for (const invalid of [{ ...metadata, work_id: 'work-9999' }, { ...metadata, next: 'Guess a phase' }, { ...metadata, updated: '2026-02-30' }, { ...metadata, current: '' }]) {
      await writeFile(ledgerFile, source(invalid));
      const result = await loadPlanning(setup.root);
      assert.equal(result.work[0].progress, null);
      assert.ok(result.issues.some(issue => issue.message.includes('Ledger status')));
      assert.ok((await readDocument(setup.root, folder + '/ledger.md')).body.includes('Evidence stays readable.'));
    }
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
    const ledger = (steps: string, extra = '') => ['---', 'schema_version: 2', 'kind: ledger', 'work_id: work-0001', 'updated: "2026-10-11"', 'blocked: null', extra, 'steps:', steps, '---', '', '# Original ledger', 'Evidence stays readable.'].filter(line => line !== '').join('\n');
    const steps = ['  - title: "Fix scrolling"', '    status: done', '  - title: "Ledger step list"', '    status: doing', '  - title: "Statistics: tokens and time"', '    status: todo'].join('\n');
    await writeFile(ledgerFile, ledger(steps));
    const work = (await loadPlanning(setup.root)).work[0];
    assert.deepEqual(work.progress, {
      version: 2, current: 'Ledger step list', next: ['Statistics: tokens and time'], blocked: null, updated: '2026-10-11',
      steps: [{ title: 'Fix scrolling', status: 'done' }, { title: 'Ledger step list', status: 'doing' }, { title: 'Statistics: tokens and time', status: 'todo' }],
    });
    for (const invalid of [
      ledger(steps.replace('status: todo', 'status: started')),
      ledger(steps.replace('Statistics: tokens and time', 'Fix scrolling')),
      ledger(steps, 'current: "Something"'),
      ledger(steps.replace('    status: doing\n', '')),
      ledger('').replace('steps:\n', 'steps: "all of them"\n'),
    ]) {
      await writeFile(ledgerFile, invalid);
      const result = await loadPlanning(setup.root);
      assert.equal(result.work[0].progress, null, invalid);
      assert.ok(result.issues.some(issue => issue.message.includes('Ledger status')), invalid);
    }
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

test('native Unicode folder aliases retain ownership while distinct normalization names stay separate', async () => {
  const setup = await fixture();
  try {
    const retained = 'active/' + 'e\u0301'.repeat(12); const composed = 'active/' + '\u00e9'.repeat(12);
    await mkdir(path.join(setup.root, retained), { recursive: true });
    await writeFile(path.join(setup.root, retained, 'plan.md'), header('work-0001', 'accepted', 'not_started'));
    const equivalent = await filesystemNormalizesUnicode(setup.root, [retained + '/plan.md']);
    const entries = [{ id: 'work-0001', path: retained, repositories: ['example'], current_plan: (equivalent ? composed : retained) + '/plan.md' }];
    if (equivalent) {
      await mkdir(path.join(setup.root, retained, 'child'));
      await writeFile(path.join(setup.root, retained, 'child/plan.md'), header('work-0002', 'accepted', 'not_started'));
      await writeFile(path.join(setup.root, retained, 'child/note.md'), 'Nested retained record.');
      entries.push({ id: 'work-0002', path: composed + '/child', repositories: ['example'], current_plan: composed + '/child/plan.md' });
    } else {
      await mkdir(path.join(setup.root, composed), { recursive: true });
      await writeFile(path.join(setup.root, composed, 'plan.md'), header('work-0002', 'accepted', 'not_started'));
      entries.push({ id: 'work-0002', path: composed, repositories: ['example'], current_plan: composed + '/plan.md' });
    }
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: entries }));
    const git = (...arguments_: string[]) => execFileSync('git', ['-C', setup.root, '-c', 'commit.gpgsign=false', ...arguments_], { stdio: 'pipe' });
    git('init'); git('config', 'user.name', 'Dashboard fixture'); git('config', 'user.email', 'fixture@example.test');
    git('add', '.'); git('commit', '--no-verify', '-m', 'Register Unicode work paths');
    const result = await loadPlanning(setup.root);
    assert.equal(result.normalizationInsensitivePaths, equivalent);
    assert.equal(result.work.length, 2);
    assert.equal(result.issues.filter(issue => issue.level === 'error').length, 0);
    for (const item of result.work) {
      assert.equal(item.documents.length, equivalent && item.id === 'work-0002' ? 2 : 1);
      for (const document of item.documents) assert.equal(document.key, item.id + ':' + document.name);
      assert.equal(item.documents[0].category, 'plan');
      assert.deepEqual(item.documents[0].repositories, ['example']);
      assert.equal(item.currentPlan, item.documents[0].path);
      assert.ok(result.history[0].workIds.includes(item.id));
    }
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
    for (const design of ['draft', 'invalid']) {
      await writeFile(filename, original.replace('design_status: accepted', 'design_status: ' + design).replace('accepted_at: null', 'accepted_at: "2026-10-05"').replace('completed_at: null', 'completed_at: "2026-10-06"'));
      const invalidAcceptance = await loadPlanning(setup.root);
      assert.ok(invalidAcceptance.issues.some(issue => issue.level === 'error'));
      assert.equal(invalidAcceptance.work[0].durationDays, null, 'an invalid acceptance/design combination must not enter duration statistics');
    }
    for (const design of ['superseded', 'abandoned']) {
      await writeFile(filename, original.replace('design_status: accepted', 'design_status: ' + design).replace('accepted_at: null', 'accepted_at: "2026-10-05"').replace('completed_at: null', 'completed_at: "2026-10-06"'));
      assert.equal((await loadPlanning(setup.root)).work[0].durationDays, 1, 'a later design disposition preserves a known historical acceptance');
    }
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
test('case-insensitive filesystem paths preserve selected plans, ownership, and Git attribution', async t => {
  const setup = await fixture();
  try {
    await mkdir(path.join(setup.root, 'active/0001-example'), { recursive: true });
    const plan = path.join(setup.root, 'active/0001-example/Plan.md');
    const original = header('work-0001', 'accepted', 'not_started');
    await writeFile(plan, original);
    await mkdir(path.join(setup.root, 'active/0001-example/supporting'));
    await writeFile(path.join(setup.root, 'active/0001-example/supporting/note.md'), '# Retained phase contract');
    await writeFile(path.join(setup.root, 'legacy.md'), header('work-0002', 'accepted', 'not_started'));
    await mkdir(path.join(setup.root, 'Knowledge/Example'), { recursive: true });
    await writeFile(path.join(setup.root, 'Knowledge/Example/note.md'), '# Scoped knowledge\n');
    const registry = JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: [{ id: 'work-0001', path: 'ACTIVE/0001-EXAMPLE', repositories: ['example'], current_plan: 'Active/0001-Example/pLAN.md' }, { id: 'work-0002', path: 'LEGACY.MD', repositories: ['example'], current_plan: 'Legacy.md' }] });
    await writeFile(path.join(setup.root, 'planning.json'), registry);
    if (await filesystemCaseSensitive(setup.root)) { t.skip('Connected filesystem is case-sensitive'); return; }
    const git = (...arguments_: string[]) => execFileSync('git', ['-C', setup.root, '-c', 'commit.gpgsign=false', ...arguments_], { stdio: 'pipe' });
    git('init'); git('config', 'user.name', 'Dashboard fixture'); git('config', 'user.email', 'fixture@example.test');
    git('add', '.'); git('commit', '--no-verify', '-m', 'Register differently cased paths');
    const result = await loadPlanning(setup.root);
    assert.equal(result.caseSensitivePaths, false);
    const knowledge = result.documents.find(document => document.path === 'Knowledge/Example/note.md');
    assert.equal(knowledge?.category, 'knowledge');
    assert.deepEqual(knowledge?.repositories, ['example']);
    assert.equal(result.work[0].location, 'active');
    assert.equal(result.work[0].currentPlan, 'active/0001-example/Plan.md');
    assert.equal(result.work[0].documents[0].key, 'work-0001:Plan.md');
    assert.equal(result.work[0].documents[0].category, 'plan');
    assert.equal(relativeDocumentPath(result.work[0].documents.find(file => file.path.endsWith('/supporting/note.md'))!), 'supporting/note.md');
    assert.deepEqual(result.work[0].documents[0].repositories, ['example']);
    assert.equal(result.work[1].documents[0].key, 'work-0002:legacy.md');
    assert.equal(result.work[1].currentPlan, 'legacy.md');
    assert.deepEqual(result.history[0].workIds, ['work-0001', 'work-0002']);
    assert.equal(result.issues.filter(issue => issue.level === 'error').length, 0);
    assert.equal(await readFile(plan, 'utf8'), original);
    assert.equal(await readFile(path.join(setup.root, 'planning.json'), 'utf8'), registry);
  } finally { await setup.cleanup(); }
});

test('selected plans take precedence over nested locations in either registry order', async () => {
  const setup = await fixture();
  try {
    const parent = 'active/0001-parent'; const child = parent + '/nested';
    await mkdir(path.join(setup.root, child), { recursive: true });
    await writeFile(path.join(setup.root, child, 'parent-plan.md'), header('work-0001', 'accepted', 'not_started'));
    await writeFile(path.join(setup.root, child, 'child-plan.md'), header('work-0002', 'accepted', 'not_started').replace('[example]', '[child]'));
    const parentItem = { id: 'work-0001', path: parent, repositories: ['example'], current_plan: child + '/parent-plan.md' };
    const childItem = { id: 'work-0002', path: child, repositories: ['child'], current_plan: child + '/child-plan.md' };
    for (const items of [[parentItem, childItem], [childItem, parentItem]]) {
      await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }, { id: 'child', name: 'Child' }], work_items: items }));
      const result = await loadPlanning(setup.root);
      assert.equal(result.work.find(item => item.id === 'work-0001')?.documents.length, 1);
      assert.equal(result.work.find(item => item.id === 'work-0001')?.documents[0].key, 'work-0001:nested/parent-plan.md');
      assert.equal(result.work.find(item => item.id === 'work-0001')?.documents[0].category, 'plan');
      assert.equal(result.work.find(item => item.id === 'work-0002')?.documents[0].key, 'work-0002:child-plan.md');
      assert.deepEqual(result.documents.find(document => document.path === child + '/parent-plan.md')?.repositories, ['example']);
      assert.deepEqual(result.documents.find(document => document.path === child + '/child-plan.md')?.repositories, ['child']);
    }
    const git = (...arguments_: string[]) => execFileSync('git', ['-C', setup.root, '-c', 'commit.gpgsign=false', ...arguments_], { stdio: 'pipe' });
    git('init'); git('config', 'user.name', 'Dashboard fixture'); git('config', 'user.email', 'fixture@example.test');
    git('add', '.'); git('commit', '--no-verify', '-m', 'Register nested work');
    await writeFile(path.join(setup.root, child, 'child-plan.md'), header('work-0002', 'accepted', 'not_started').replace('[example]', '[child]') + '\nA child-only update.\n');
    git('add', '.'); git('commit', '--no-verify', '-m', 'Update child work');
    const update = (await loadPlanning(setup.root)).history.find(entry => entry.title === 'Update child work');
    assert.deepEqual(update?.workIds, ['work-0002']); assert.deepEqual(update?.repositories, ['child']);
  } finally { await setup.cleanup(); }
});

test('archiving nested work does not assign its deleted paths to the remaining parent', async () => {
  const setup = await fixture();
  try {
    const parent = 'active/0001-parent'; const child = parent + '/nested'; const archived = 'archive/0002-child';
    await mkdir(path.join(setup.root, child), { recursive: true });
    await writeFile(path.join(setup.root, parent, 'plan.md'), header('work-0001', 'accepted', 'not_started'));
    await writeFile(path.join(setup.root, child, 'plan.md'), header('work-0002', 'accepted', 'complete').replace('[example]', '[child]'));
    const registry = { schema_version: 1, repositories: [{ id: 'example', name: 'Example' }, { id: 'child', name: 'Child' }], work_items: [
      { id: 'work-0001', path: parent, repositories: ['example'], current_plan: parent + '/plan.md' },
      { id: 'work-0002', path: child, repositories: ['child'], current_plan: child + '/plan.md' },
    ] };
    const git = (...arguments_: string[]) => execFileSync('git', ['-C', setup.root, '-c', 'commit.gpgsign=false', ...arguments_], { stdio: 'pipe' });
    git('init'); git('config', 'user.name', 'Dashboard fixture'); git('config', 'user.email', 'fixture@example.test'); git('config', 'diff.renames', 'false');
    const commit = async (title: string) => { await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify(registry)); git('add', '.'); git('commit', '--no-verify', '-m', title); };
    await commit('Register parent and child');
    await mkdir(path.join(setup.root, 'archive'));
    await rename(path.join(setup.root, child), path.join(setup.root, archived));
    registry.work_items[1].path = archived; registry.work_items[1].current_plan = archived + '/plan.md';
    await commit('Archive child only');
    const result = await loadPlanning(setup.root);
    const archive = result.history.find(entry => entry.title === 'Archive child only');
    assert.deepEqual(archive?.workIds, ['work-0002']); assert.deepEqual(archive?.repositories, ['child']);
    assert.equal(result.work.find(item => item.id === 'work-0001')?.documents.length, 1);
  } finally { await setup.cleanup(); }
});

test('mixed commits include newly adopted records without overriding established historical ownership', async () => {
  const setup = await fixture();
  try {
    await mkdir(path.join(setup.root, 'active/0001-first'), { recursive: true });
    await writeFile(path.join(setup.root, 'active/0001-first/plan.md'), header('work-0001', 'accepted', 'not_started'));
    await writeFile(path.join(setup.root, 'legacy.md'), '# Later adopted work\n');
    const registry = { schema_version: 1, repositories: [{ id: 'example', name: 'Example' }, { id: 'adopted', name: 'Adopted' }], work_items: [
      { id: 'work-0001', path: 'active/0001-first', repositories: ['example'], current_plan: 'active/0001-first/plan.md' },
    ] };
    const git = (...arguments_: string[]) => execFileSync('git', ['-C', setup.root, '-c', 'commit.gpgsign=false', ...arguments_], { stdio: 'pipe' });
    git('init'); git('config', 'user.name', 'Dashboard fixture'); git('config', 'user.email', 'fixture@example.test');
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify(registry));
    git('add', '.'); git('commit', '--no-verify', '-m', 'Mixed registered and legacy work');
    assert.deepEqual((await loadPlanning(setup.root)).history[0].workIds, ['work-0001']);
    registry.work_items.push({ id: 'work-0002', path: 'legacy.md', repositories: ['adopted'], current_plan: 'legacy.md' });
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify(registry));
    const mixed = (await loadPlanning(setup.root)).history.find(entry => entry.title === 'Mixed registered and legacy work');
    assert.deepEqual(mixed?.workIds, ['work-0001', 'work-0002']); assert.deepEqual(mixed?.repositories, ['example', 'adopted']);
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
test('work activity follows stable registry identity through archive and folder renames', async () => {
  const setup = await fixture();
  try {
    const git = (...arguments_: string[]) => execFileSync('git', ['-C', setup.root, '-c', 'commit.gpgsign=false', ...arguments_], { stdio: 'pipe' });
    git('init'); git('config', 'user.name', 'Dashboard fixture'); git('config', 'user.email', 'fixture@example.test');
    const initial = 'active/0001-original-title';
    const archived = 'archive/0001-renamed-title';
    await mkdir(path.join(setup.root, initial), { recursive: true });
    await writeFile(path.join(setup.root, initial, 'plan.md'), header('work-0001', 'accepted', 'complete'));
    const registry = { schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: [{ id: 'work-0001', path: initial, repositories: ['example'], current_plan: initial + '/plan.md' }] };
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify(registry));
    git('add', '.'); git('commit', '--no-verify', '-m', 'Start registered work');
    assert.ok((await loadPlanning(setup.root)).history.some(entry => entry.title === 'Start registered work' && entry.workIds.includes('work-0001')));
    await mkdir(path.join(setup.root, 'archive'));
    await rename(path.join(setup.root, initial), path.join(setup.root, archived));
    registry.work_items[0].path = archived; registry.work_items[0].current_plan = archived + '/plan.md';
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify(registry));
    git('add', '.'); git('commit', '--no-verify', '-m', 'Archive registered work');
    const result = await loadPlanning(setup.root);
    assert.equal(result.work[0].location, 'archived');
    const activity = result.history.filter(entry => entry.workIds.includes('work-0001'));
    assert.deepEqual(activity.map(entry => entry.title), ['Archive registered work', 'Start registered work']);
    assert.ok(activity.every(entry => entry.repositories.includes('example')));
  } finally { await setup.cleanup(); }
});
const actualRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../planning');

test('deleted and transferred knowledge retains its directional historical repository scope', async () => {
  const setup = await fixture();
  try {
    const git = (...arguments_: string[]) => execFileSync('git', ['-C', setup.root, '-c', 'commit.gpgsign=false', ...arguments_], { stdio: 'pipe' });
    git('init'); git('config', 'user.name', 'Dashboard fixture'); git('config', 'user.email', 'fixture@example.test');
    const registry = { schema_version: 1, repositories: [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }], work_items: [] as unknown[] };
    const commit = async (title: string) => { await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify(registry)); git('add', '.'); git('commit', '--no-verify', '-m', title); };
    await mkdir(path.join(setup.root, 'knowledge/first'), { recursive: true });
    await writeFile(path.join(setup.root, 'knowledge/first/note.md'), '# Scoped knowledge\n');
    registry.work_items = [{ id: 'legacy-work', path: 'legacy.md', repositories: ['first'] }];
    await commit('Record first repository knowledge');
    registry.work_items = [{ id: 'work-0001', path: '../outside', repositories: ['first'] }];
    await writeFile(path.join(setup.root, 'knowledge/first/note.md'), '# Scoped knowledge\nRetained update.\n');
    await commit('Retain knowledge with invalid legacy work location');
    await mkdir(path.join(setup.root, 'knowledge/second'));
    await rename(path.join(setup.root, 'knowledge/first/note.md'), path.join(setup.root, 'knowledge/second/note.md'));
    registry.repositories = registry.repositories.filter(repository => repository.id !== 'first');
    registry.work_items = [];
    await commit('Transfer knowledge and remove first registration');
    git('rm', 'knowledge/second/note.md');
    await commit('Remove superseded knowledge');
    const snapshot = await loadPlanning(setup.root);
    assert.ok(!snapshot.documents.some(document => document.path.endsWith('/note.md')));
    assert.deepEqual(snapshot.history.find(entry => entry.title === 'Record first repository knowledge')?.repositories, ['first']);
    assert.deepEqual(snapshot.history.find(entry => entry.title === 'Retain knowledge with invalid legacy work location')?.repositories, ['first']);
    assert.deepEqual(new Set(snapshot.history.find(entry => entry.title === 'Transfer knowledge and remove first registration')?.repositories), new Set(['first', 'second']));
    assert.deepEqual(snapshot.history.find(entry => entry.title === 'Remove superseded knowledge')?.repositories, ['second']);
    assert.deepEqual(snapshot.history.filter(entry => entry.repositories.includes('second')).map(entry => entry.title), ['Remove superseded knowledge', 'Transfer knowledge and remove first registration']);
    assert.ok(snapshot.history.every(entry => entry.workIds.length === 0));
  } finally { await setup.cleanup(); }
});
test('reusing a legacy work location does not associate later edits with its previous owner', async () => {
  const setup = await fixture();
  try {
    const git = (...arguments_: string[]) => execFileSync('git', ['-C', setup.root, '-c', 'commit.gpgsign=false', ...arguments_], { stdio: 'pipe' });
    git('init'); git('config', 'user.name', 'Dashboard fixture'); git('config', 'user.email', 'fixture@example.test');
    await mkdir(path.join(setup.root, 'legacy'));
    await writeFile(path.join(setup.root, 'legacy/current.md'), '# First work\n');
    const registry = { schema_version: 1, repositories: [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }], work_items: [{ id: 'work-0001', path: 'legacy/current.md', repositories: ['first'], current_plan: 'legacy/current.md' }] };
    const commit = async (title: string) => { await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify(registry)); git('add', '.'); git('commit', '--no-verify', '-m', title); };
    await commit('Register first legacy work');
    await mkdir(path.join(setup.root, 'archive/0001-first'), { recursive: true });
    await rename(path.join(setup.root, 'legacy/current.md'), path.join(setup.root, 'archive/0001-first/plan.md'));
    registry.work_items[0].path = 'archive/0001-first'; registry.work_items[0].current_plan = 'archive/0001-first/plan.md';
    await commit('Archive first legacy work');
    registry.work_items.push({ id: 'work-0002', path: 'legacy/current.md', repositories: ['second'], current_plan: 'legacy/current.md' });
    await writeFile(path.join(setup.root, 'legacy/current.md'), '# Second work\n');
    await commit('Register second legacy work');
    await writeFile(path.join(setup.root, 'legacy/current.md'), '# Second work\nA later edit.\n');
    await commit('Edit second work');
    const history = (await loadPlanning(setup.root)).history;
    const later = history.find(entry => entry.title === 'Edit second work');
    assert.deepEqual(later?.workIds, ['work-0002']);
    assert.deepEqual(later?.repositories, ['second']);
    assert.deepEqual(history.find(entry => entry.title === 'Register first legacy work')?.workIds, ['work-0001']);
    assert.deepEqual(history.find(entry => entry.title === 'Archive first legacy work')?.workIds, ['work-0001']);
  } finally { await setup.cleanup(); }
});
test('actual workspace registry and selected plans load without modifying original records', { skip: !existsSync(path.join(actualRoot, 'planning.json')) }, async () => {
  const original = await readFile(path.join(actualRoot, 'planning.json'));
  const registry = JSON.parse(original.toString());
  const snapshot = await loadPlanning(actualRoot);
  assert.equal(snapshot.work.length, registry.work_items.length);
  assert.equal(snapshot.issues.filter(issue => issue.level === 'error').length, 0);
  for (const item of registry.work_items) {
    const actual = snapshot.work.find(work => work.id === item.id);
    assert.equal(actual?.currentPlan, item.current_plan);
    if (item.current_plan === null) assert.equal(actual?.implementation, 'unknown');
    else {
      const metadata = (await readDocument(actualRoot, item.current_plan)).metadata;
      if (metadata) {
        assert.equal(actual?.implementation, metadata.implementation_status);
        if (metadata.created === null) assert.equal(actual?.created, null);
      }
    }
  }
  assert.deepEqual(await readFile(path.join(actualRoot, 'planning.json')), original);
});
