// The planning reader over Git history: which work and repositories each commit touched, through
// archive moves, renames, nested work, adopted records and path aliases. Each test makes commits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlanning, readDocument } from './planning.ts';
import { filesystemCaseSensitive, filesystemNormalizesUnicode } from '../system/filesystem.ts';
import { header, readerFixture as fixture, relativeDocumentPath } from '../testing/testing.ts';

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

const actualRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../planning');
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
