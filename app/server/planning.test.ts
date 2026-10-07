import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadPlanning, readDocument, resolveDocument } from './planning.ts';

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
const actualRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../planning');
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
