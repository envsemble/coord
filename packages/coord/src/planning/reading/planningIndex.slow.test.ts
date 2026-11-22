// The planning reader over Git history: which work each commit touched, through archive moves,
// renames, nested work, work registered later and path aliases. Each test makes commits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadPlanning } from './planningIndex.ts';
import { filesystemCaseSensitive, filesystemNormalizesUnicode } from '../../platform/filesystem.ts';
import { header, readerFixture as fixture, relativeDocumentPath } from '../testing.ts';

/** A registry of these work items. */
const registryOf = (items: unknown[]) => ({ schema_version: 3, name: 'Example', folders: [], work_items: items });
const gitIn = (root: string) => {
  const git = (...arguments_: string[]) => execFileSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...arguments_], { stdio: 'pipe' });
  git('init'); git('config', 'user.name', 'Dashboard fixture'); git('config', 'user.email', 'fixture@example.test');
  return git;
};

test('native Unicode folder aliases retain ownership while distinct normalization names stay separate', async () => {
  const setup = await fixture();
  try {
    const retained = 'active/' + 'é'.repeat(12); const composed = 'active/' + 'é'.repeat(12);
    await mkdir(path.join(setup.root, retained), { recursive: true });
    await writeFile(path.join(setup.root, retained, 'plan.md'), header('work-0001', 'accepted', 'not_started'));
    const equivalent = await filesystemNormalizesUnicode(setup.root, [retained + '/plan.md']);
    const entries = [{ id: 'work-0001', path: retained, current_plan: (equivalent ? composed : retained) + '/plan.md' }];
    if (equivalent) {
      await mkdir(path.join(setup.root, retained, 'child'));
      await writeFile(path.join(setup.root, retained, 'child/plan.md'), header('work-0002', 'accepted', 'not_started'));
      await writeFile(path.join(setup.root, retained, 'child/note.md'), 'Nested retained record.');
      entries.push({ id: 'work-0002', path: composed + '/child', current_plan: composed + '/child/plan.md' });
    } else {
      await mkdir(path.join(setup.root, composed), { recursive: true });
      await writeFile(path.join(setup.root, composed, 'plan.md'), header('work-0002', 'accepted', 'not_started'));
      entries.push({ id: 'work-0002', path: composed, current_plan: composed + '/plan.md' });
    }
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify(registryOf(entries)));
    const git = gitIn(setup.root);
    git('add', '.'); git('commit', '--no-verify', '-m', 'Register Unicode work paths');
    const result = await loadPlanning(setup.root);
    assert.equal(result.normalizationInsensitivePaths, equivalent);
    assert.equal(result.work.length, 2);
    assert.equal(result.issues.filter(issue => issue.level === 'error').length, 0);
    for (const item of result.work) {
      assert.equal(item.documents.length, equivalent && item.id === 'work-0002' ? 2 : 1);
      for (const document of item.documents) assert.equal(document.key, item.id + ':' + document.name);
      assert.equal(item.documents[0].category, 'plan');
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
    await mkdir(path.join(setup.root, 'Knowledge/Example'), { recursive: true });
    await writeFile(path.join(setup.root, 'Knowledge/Example/note.md'), '# Knowledge\n');
    const registry = JSON.stringify(registryOf([{ id: 'work-0001', path: 'ACTIVE/0001-EXAMPLE', current_plan: 'Active/0001-Example/pLAN.md' }]));
    await writeFile(path.join(setup.root, 'planning.json'), registry);
    if (await filesystemCaseSensitive(setup.root)) { t.skip('Connected filesystem is case-sensitive'); return; }
    const git = gitIn(setup.root);
    git('add', '.'); git('commit', '--no-verify', '-m', 'Register differently cased paths');
    const result = await loadPlanning(setup.root);
    assert.equal(result.caseSensitivePaths, false);
    assert.equal(result.work[0].location, 'active');
    assert.equal(result.work[0].currentPlan, 'active/0001-example/Plan.md');
    assert.equal(result.work[0].documents[0].key, 'work-0001:Plan.md');
    assert.equal(result.work[0].documents[0].category, 'plan');
    assert.equal(relativeDocumentPath(result.work[0].documents.find(file => file.path.endsWith('/supporting/note.md'))!), 'supporting/note.md');
    assert.deepEqual(result.history[0].workIds, ['work-0001']);
    assert.equal(result.issues.filter(issue => issue.level === 'error').length, 0);
    assert.equal(await readFile(plan, 'utf8'), original);
    assert.equal(await readFile(path.join(setup.root, 'planning.json'), 'utf8'), registry);
  } finally { await setup.cleanup(); }
});

test('nested work owns its own folder in either registry order, in documents and in history', async () => {
  const setup = await fixture();
  try {
    const parent = 'active/0001-parent'; const child = parent + '/nested';
    await mkdir(path.join(setup.root, child), { recursive: true });
    await writeFile(path.join(setup.root, parent, 'plan.md'), header('work-0001', 'accepted', 'not_started'));
    await writeFile(path.join(setup.root, child, 'plan.md'), header('work-0002', 'accepted', 'not_started'));
    const parentItem = { id: 'work-0001', path: parent, current_plan: parent + '/plan.md' };
    const childItem = { id: 'work-0002', path: child, current_plan: child + '/plan.md' };
    for (const items of [[parentItem, childItem], [childItem, parentItem]]) {
      await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify(registryOf(items)));
      const result = await loadPlanning(setup.root);
      assert.equal(result.work.find(item => item.id === 'work-0001')?.documents.length, 1);
      assert.equal(result.work.find(item => item.id === 'work-0001')?.documents[0].key, 'work-0001:plan.md');
      assert.equal(result.work.find(item => item.id === 'work-0002')?.documents[0].key, 'work-0002:plan.md');
      assert.equal(result.documents.find(document => document.path === child + '/plan.md')?.workId, 'work-0002');
    }
    const git = gitIn(setup.root);
    git('add', '.'); git('commit', '--no-verify', '-m', 'Register nested work');
    await writeFile(path.join(setup.root, child, 'plan.md'), header('work-0002', 'accepted', 'not_started') + '\nA child-only update.\n');
    git('add', '.'); git('commit', '--no-verify', '-m', 'Update child work');
    const update = (await loadPlanning(setup.root)).history.find(entry => entry.title === 'Update child work');
    assert.deepEqual(update?.workIds, ['work-0002']);
  } finally { await setup.cleanup(); }
});

test('archiving nested work does not assign its deleted paths to the remaining parent', async () => {
  const setup = await fixture();
  try {
    const parent = 'active/0001-parent'; const child = parent + '/nested'; const archived = 'archive/0002-child';
    await mkdir(path.join(setup.root, child), { recursive: true });
    await writeFile(path.join(setup.root, parent, 'plan.md'), header('work-0001', 'accepted', 'not_started'));
    await writeFile(path.join(setup.root, child, 'plan.md'), header('work-0002', 'accepted', 'complete'));
    const registry = registryOf([
      { id: 'work-0001', path: parent, current_plan: parent + '/plan.md' },
      { id: 'work-0002', path: child, current_plan: child + '/plan.md' },
    ]) as { work_items: { path: string; current_plan: string }[] };
    const git = gitIn(setup.root);
    git('config', 'diff.renames', 'false');
    const commit = async (title: string) => { await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify(registry)); git('add', '.'); git('commit', '--no-verify', '-m', title); };
    await commit('Register parent and child');
    await mkdir(path.join(setup.root, 'archive'));
    await rename(path.join(setup.root, child), path.join(setup.root, archived));
    registry.work_items[1].path = archived; registry.work_items[1].current_plan = archived + '/plan.md';
    await commit('Archive child only');
    const result = await loadPlanning(setup.root);
    assert.deepEqual(result.history.find(entry => entry.title === 'Archive child only')?.workIds, ['work-0002']);
    assert.equal(result.work.find(item => item.id === 'work-0001')?.documents.length, 1);
  } finally { await setup.cleanup(); }
});

test('a commit\'s files of work registered later are attributed to it, without overriding established ownership', async () => {
  const setup = await fixture();
  try {
    await mkdir(path.join(setup.root, 'active/0001-first'), { recursive: true });
    await mkdir(path.join(setup.root, 'active/0002-later'), { recursive: true });
    await writeFile(path.join(setup.root, 'active/0001-first/plan.md'), header('work-0001', 'accepted', 'not_started'));
    await writeFile(path.join(setup.root, 'active/0002-later/plan.md'), header('work-0002', 'draft', 'not_started'));
    const registry = registryOf([{ id: 'work-0001', path: 'active/0001-first', current_plan: 'active/0001-first/plan.md' }]) as { work_items: unknown[] };
    const git = gitIn(setup.root);
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify(registry));
    git('add', '.'); git('commit', '--no-verify', '-m', 'Registered and unregistered work');
    assert.deepEqual((await loadPlanning(setup.root)).history[0].workIds, ['work-0001']);
    registry.work_items.push({ id: 'work-0002', path: 'active/0002-later', current_plan: 'active/0002-later/plan.md' });
    await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify(registry));
    const mixed = (await loadPlanning(setup.root)).history.find(entry => entry.title === 'Registered and unregistered work');
    assert.deepEqual(mixed?.workIds, ['work-0001', 'work-0002']);
  } finally { await setup.cleanup(); }
});

test('work activity follows stable registry identity through archive and folder renames', async () => {
  const setup = await fixture();
  try {
    const git = gitIn(setup.root);
    const initial = 'active/0001-original-title';
    const archived = 'archive/0001-renamed-title';
    await mkdir(path.join(setup.root, initial), { recursive: true });
    await writeFile(path.join(setup.root, initial, 'plan.md'), header('work-0001', 'accepted', 'complete'));
    const registry = registryOf([{ id: 'work-0001', path: initial, current_plan: initial + '/plan.md' }]) as { work_items: { path: string; current_plan: string }[] };
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
    assert.deepEqual(result.history.filter(entry => entry.workIds.includes('work-0001')).map(entry => entry.title), ['Archive registered work', 'Start registered work']);
  } finally { await setup.cleanup(); }
});

test('reusing a work location does not associate later edits with its previous owner', async () => {
  const setup = await fixture();
  try {
    const git = gitIn(setup.root);
    await mkdir(path.join(setup.root, 'active/current'), { recursive: true });
    await writeFile(path.join(setup.root, 'active/current/plan.md'), header('work-0001', 'accepted', 'complete'));
    const registry = registryOf([{ id: 'work-0001', path: 'active/current', current_plan: 'active/current/plan.md' }]) as { work_items: { id: string; path: string; current_plan: string }[] };
    const commit = async (title: string) => { await writeFile(path.join(setup.root, 'planning.json'), JSON.stringify(registry)); git('add', '.'); git('commit', '--no-verify', '-m', title); };
    await commit('Register first work');
    await mkdir(path.join(setup.root, 'archive'), { recursive: true });
    await rename(path.join(setup.root, 'active/current'), path.join(setup.root, 'archive/0001-first'));
    registry.work_items[0].path = 'archive/0001-first'; registry.work_items[0].current_plan = 'archive/0001-first/plan.md';
    await commit('Archive first work');
    registry.work_items.push({ id: 'work-0002', path: 'active/current', current_plan: 'active/current/plan.md' });
    await mkdir(path.join(setup.root, 'active/current'), { recursive: true });
    await writeFile(path.join(setup.root, 'active/current/plan.md'), header('work-0002', 'draft', 'not_started'));
    await commit('Register second work');
    await writeFile(path.join(setup.root, 'active/current/plan.md'), header('work-0002', 'draft', 'not_started') + '\nA later edit.\n');
    await commit('Edit second work');
    const history = (await loadPlanning(setup.root)).history;
    assert.deepEqual(history.find(entry => entry.title === 'Edit second work')?.workIds, ['work-0002']);
    assert.deepEqual(history.find(entry => entry.title === 'Register first work')?.workIds, ['work-0001']);
    assert.deepEqual(history.find(entry => entry.title === 'Archive first work')?.workIds, ['work-0001']);
  } finally { await setup.cleanup(); }
});
