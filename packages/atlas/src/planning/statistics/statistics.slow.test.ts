// Plan revisions from Git: following archive moves, stopping at completion, and the moves Git
// pairs with other files. Each test builds a repository of several commits.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPlanning } from '../reading/planning.ts';
import { planRevisions } from './statistics.ts';

function git(root: string, date: string, ...args: string[]) {
  execFileSync('git', ['-C', root, '-c', 'user.name=Atlas test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore', windowsHide: true, env: { ...process.env, GIT_AUTHOR_DATE: date + 'T12:00:00Z', GIT_COMMITTER_DATE: date + 'T12:00:00Z' } });
}
const planText = (id: string, body: string, completed: string | null = null) => ['---', 'schema_version: 2', 'kind: plan', 'id: ' + id, 'title: "Example"', 'created: "2026-10-01"', 'updated: "2026-10-05"', 'design_status: accepted', 'implementation_status: ' + (completed ? 'complete' : 'in_progress'), 'accepted_at: "2026-10-01"', 'completed_at: ' + (completed ? '"' + completed + '"' : 'null'), 'supersedes: []', 'superseded_by: null', '---', '', '# Example', '', body, ''].join('\n');

function repository(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'atlas-statistics-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const register = (folder: string) => writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 2, name: 'Example', folders: [], work_items: [{ id: 'work-0001', path: folder, current_plan: folder + '/plan.md' }] }, null, 2) + '\n');
  return { root, register };
}

test('plan revisions follow the archive move and stop at completion', async t => {
  const { root, register } = repository(t);
  execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main'], { stdio: 'ignore' });
  mkdirSync(path.join(root, 'active/0001-example'), { recursive: true });
  register('active/0001-example');
  const planFile = (folder: string) => path.join(root, folder, 'plan.md');
  writeFileSync(planFile('active/0001-example'), planText('work-0001', 'First draft.'));
  git(root, '2026-10-01', 'add', '-A'); git(root, '2026-10-01', 'commit', '-q', '-m', 'Add the plan');
  writeFileSync(planFile('active/0001-example'), planText('work-0001', 'Second draft.'));
  git(root, '2026-10-02', 'commit', '-q', '-am', 'Revise the plan');
  writeFileSync(path.join(root, 'active/0001-example/ledger.md'), '# Ledger\n');
  git(root, '2026-10-03', 'add', '-A'); git(root, '2026-10-03', 'commit', '-q', '-m', 'A ledger is not a plan revision');
  writeFileSync(planFile('active/0001-example'), planText('work-0001', 'Accepted.', '2026-10-04'));
  git(root, '2026-10-04', 'commit', '-q', '-am', 'Complete');
  // Many files move with the folder; the plan's move alone is not a revision.
  for (let index = 0; index < 50; index++) writeFileSync(path.join(root, 'active/0001-example', `evidence-${index}.txt`), 'evidence ' + index + '\n');
  git(root, '2026-10-04', 'add', '-A'); git(root, '2026-10-04', 'commit', '-q', '-m', 'Evidence');
  mkdirSync(path.join(root, 'archive'));
  renameSync(path.join(root, 'active/0001-example'), path.join(root, 'archive/0001-example'));
  register('archive/0001-example');
  git(root, '2026-10-05', 'add', '-A'); git(root, '2026-10-05', 'commit', '-q', '-m', 'Archive');
  writeFileSync(planFile('archive/0001-example'), planText('work-0001', 'A later correction.', '2026-10-04'));
  git(root, '2026-10-06', 'commit', '-q', '-am', 'Edit after completion');

  const work = { id: 'work-0001', currentPlan: 'archive/0001-example/plan.md', completed: '2026-10-04' };
  assert.deepEqual(await planRevisions(root, [work]), { 'work-0001': 2 }, 'the revision and the completion edit; not the move or the later edit');
  assert.deepEqual(await planRevisions(root, [{ ...work, completed: null }]), { 'work-0001': 3 });
  assert.deepEqual(await planRevisions(root, [{ ...work, currentPlan: 'archive/0001-example/missing.md' }]), { 'work-0001': null });
  const loaded = await loadPlanning(root);
  assert.equal(loaded.work[0].statistics?.planRevisions, 2);
  assert.equal(loaded.work[0].statistics?.reports, 0);
});

test('a move that also edits the plan counts as a revision', async t => {
  const { root, register } = repository(t);
  execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main'], { stdio: 'ignore' });
  mkdirSync(path.join(root, 'active/0001-example'), { recursive: true });
  register('active/0001-example');
  writeFileSync(path.join(root, 'active/0001-example/plan.md'), planText('work-0001', 'A plan with enough text to stay similar after a small edit. '.repeat(10)));
  git(root, '2026-10-01', 'add', '-A'); git(root, '2026-10-01', 'commit', '-q', '-m', 'Add');
  mkdirSync(path.join(root, 'archive'));
  renameSync(path.join(root, 'active/0001-example'), path.join(root, 'archive/0001-example'));
  appendFileSync(path.join(root, 'archive/0001-example/plan.md'), 'Outcome recorded.\n');
  register('archive/0001-example');
  git(root, '2026-10-02', 'add', '-A'); git(root, '2026-10-02', 'commit', '-q', '-m', 'Archive with an edit');
  assert.deepEqual(await planRevisions(root, [{ id: 'work-0001', currentPlan: 'archive/0001-example/plan.md', completed: null }]), { 'work-0001': 1 });
});

test('a planning folder inside a larger repository, and a move that rewrote its plan, keep their revisions', async t => {
  const outer = mkdtempSync(path.join(tmpdir(), 'atlas-statistics-outer-'));
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  execFileSync('git', ['-C', outer, 'init', '-q', '-b', 'main'], { stdio: 'ignore' });
  const root = path.join(outer, 'planning');
  mkdirSync(path.join(root, 'active/0001-example'), { recursive: true });
  writeFileSync(path.join(outer, 'README.md'), 'The product.\n');
  const planFile = (folder: string) => path.join(root, folder, 'plan.md');
  writeFileSync(planFile('active/0001-example'), planText('work-0001', 'Short.'));
  git(outer, '2026-10-01', 'add', '-A'); git(outer, '2026-10-01', 'commit', '-q', '-m', 'Add');
  writeFileSync(planFile('active/0001-example'), planText('work-0001', 'Still short.'));
  git(outer, '2026-10-02', 'commit', '-q', '-am', 'Revise');
  // Archive and rewrite in one commit: Git sees a delete and an add.
  mkdirSync(path.join(root, 'archive'));
  renameSync(path.join(root, 'active/0001-example'), path.join(root, 'archive/0001-example'));
  writeFileSync(planFile('archive/0001-example'), 'Completely different text, '.repeat(40));
  git(outer, '2026-10-03', 'add', '-A'); git(outer, '2026-10-03', 'commit', '-q', '-m', 'Archive with a rewrite');
  assert.deepEqual(await planRevisions(root, [{ id: 'work-0001', currentPlan: 'archive/0001-example/plan.md', completed: null }]), { 'work-0001': 2 });
});

test('a new plan that Git pairs with another work item\'s rewritten plan does not take its history', async t => {
  const { root } = repository(t);
  execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main'], { stdio: 'ignore' });
  const template = (id: string) => planText(id, 'A shared template paragraph that every new plan starts from. '.repeat(8));
  mkdirSync(path.join(root, 'active/0002-b'), { recursive: true });
  writeFileSync(path.join(root, 'active/0002-b/plan.md'), template('work-0002'));
  git(root, '2026-10-01', 'add', '-A'); git(root, '2026-10-01', 'commit', '-q', '-m', 'Add b');
  for (const [day, text] of [['02', 'one'], ['03', 'two'], ['04', 'three']]) {
    appendFileSync(path.join(root, 'active/0002-b/plan.md'), 'Revision ' + text + '.\n');
    git(root, '2026-10-' + day, 'commit', '-q', '-am', 'Revise b ' + text);
  }
  // One commit archives b with a rewrite and creates c from the same template.
  mkdirSync(path.join(root, 'archive'));
  renameSync(path.join(root, 'active/0002-b'), path.join(root, 'archive/0002-b'));
  writeFileSync(path.join(root, 'archive/0002-b/plan.md'), 'Completely rewritten when it was archived. '.repeat(30));
  mkdirSync(path.join(root, 'active/0003-c'), { recursive: true });
  writeFileSync(path.join(root, 'active/0003-c/plan.md'), template('work-0003'));
  git(root, '2026-10-05', 'add', '-A'); git(root, '2026-10-05', 'commit', '-q', '-m', 'Archive b, add c');
  assert.deepEqual(await planRevisions(root, [
    { id: 'work-0002', currentPlan: 'archive/0002-b/plan.md', completed: null },
    { id: 'work-0003', currentPlan: 'active/0003-c/plan.md', completed: null },
  ]), { 'work-0002': 4, 'work-0003': 0 });
});
