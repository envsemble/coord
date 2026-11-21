import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HomeDatabase } from '../../home/database.ts';
import { validatePlanning } from '../check/check.ts';
import { loadPlanning } from '../reading/planningIndex.ts';
import { git, plan, planningFolder, read, temporary, write } from '../testing.ts';
import { planningLedger, workStatus } from '../work/work.ts';
import { moveForward } from './moveForward.ts';

/** The folder as registry version 2 wrote it: work-0001 a group whose plan lists its parts, each with a number of its own. */
function earlier(root: string, parts: string) {
  // A part's own list counted for nothing, and an empty one was written by taking the parts out: both lines go.
  write(path.join(root, 'active/0004-late/plan.md'), plan('work-0004', { parts: '[]' }));
  write(path.join(root, 'active/0002-other/plan.md'), plan('work-0002').replace('supersedes: []', 'parts:\n- work-0001\nsupersedes: []'));
  write(path.join(root, 'active/0004-late/ledger.md'), planningLedger('work-0004', '2026-10-02', []));
  write(path.join(root, 'active/0001-existing/plan.md'), plan('work-0001', { parts }));
  const registry = JSON.parse(read(root, 'planning.json'));
  registry.schema_version = 2;
  registry.work_items.push({ id: 'work-0004', path: 'active/0004-late', current_plan: 'active/0004-late/plan.md' });
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify(registry, null, 2) + '\n');
}
const ids = (root: string) => JSON.parse(read(root, 'planning.json')).work_items.map((item: { id: string }) => item.id);

test('a version 2 planning folder moves forward once: parts take their work item\'s number, their old IDs still name them, and the home\'s rows follow', async t => {
  const directory = temporary(t), root = planningFolder(directory), home = path.join(directory, 'home');
  earlier(root, '["work-0004", "work-0002", "work-0009"]');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'As version 2 wrote it');
  mkdirSync(home, { recursive: true });
  const database = HomeDatabase.open(home);
  const project = database.addProject(root, 'Planning');
  const report = (workId: string) => database.db.prepare("INSERT INTO work_report (project_id, work_id, at, stage, model) VALUES (?, ?, '2026-10-02T10:00:00.000Z', 'planning', 'a-model')").run(project.id, workId);
  report('work-0004'); report('work-0001');
  database.close();

  assert.equal(await moveForward(root, { home }), true);
  // The group's own plan is the first part and keeps its ID; its parts follow in the order it listed them.
  assert.deepEqual(ids(root), ['work-0001', 'work-0001-3', 'work-0001-2']);
  const registry = JSON.parse(read(root, 'planning.json'));
  assert.deepEqual([registry.schema_version, registry.former_ids], [3, { 'work-0004': 'work-0001-2', 'work-0002': 'work-0001-3' }]);
  assert.match(read(root, 'active/0004-late/plan.md'), /^id: work-0001-2$/m);
  assert.match(read(root, 'active/0004-late/ledger.md'), /^work_id: work-0001-2$/m);
  for (const item of ['0001-existing', '0002-other', '0004-late']) assert.doesNotMatch(read(root, `active/${item}/plan.md`), /^parts:|^- work/m, item);
  assert.deepEqual(validatePlanning(root).errors, []);
  // An old ID still names its work, and the home's rows about it are under the new one.
  assert.equal((await workStatus(root, 'work-0004')).workId, 'work-0001-2');
  const after = HomeDatabase.open(home);
  assert.deepEqual(after.db.prepare('SELECT work_id FROM work_report ORDER BY work_id').all().map(row => row.work_id), ['work-0001', 'work-0001-2']);
  after.close();
  // Its own commit, of what it changed, since those files had nothing uncommitted; nothing is left behind.
  assert.match(git(root, 'log', '-1', '--format=%s'), /version 3/);
  assert.equal(git(root, 'status', '--porcelain').trim(), '');
  assert.ok(!existsSync(path.join(root, '.coord-move')));
  assert.equal(await moveForward(root, { home }), false, 'once');
});

test('a reader moves an earlier folder forward by itself, and a move that was cut short is finished from its record', async t => {
  // No groups: only the version changes, and uncommitted files are left for whoever commits there.
  const plain = planningFolder(path.join(temporary(t), 'plain'));
  writeFileSync(path.join(plain, 'planning.json'), read(plain, 'planning.json').replace('"schema_version": 3', '"schema_version": 2'));
  const before = git(plain, 'log', '-1', '--format=%H');
  assert.deepEqual((await loadPlanning(plain, { home: path.join(plain, '..', 'no-home') })).work.map(item => item.id), ['work-0001', 'work-0002']);
  assert.equal(JSON.parse(read(plain, 'planning.json')).schema_version, 3);
  assert.equal(git(plain, 'log', '-1', '--format=%H'), before, 'the registry had an uncommitted change, so nothing is committed');

  // Cut short after the plans were rewritten: the record says what the move maps, though the group's plan no longer lists its parts.
  const root = planningFolder(path.join(temporary(t), 'cut'));
  earlier(root, '["work-0004"]');
  write(path.join(root, 'active/0001-existing/plan.md'), plan('work-0001'));
  write(path.join(root, 'active/0004-late/plan.md'), plan('work-0001-2'));
  mkdirSync(path.join(root, '.coord-move'));
  writeFileSync(path.join(root, '.coord-move', 'renames.json'), JSON.stringify({ renames: [['work-0004', 'work-0001-2']], listed: ['work-0001', 'work-0002', 'work-0004'] }));
  const old = new Date(Date.now() - 5 * 60_000);
  utimesSync(path.join(root, '.coord-move'), old, old);
  assert.equal(await moveForward(root, { home: path.join(root, '..', 'no-home') }), true);
  assert.deepEqual(ids(root), ['work-0001', 'work-0002', 'work-0001-2']);
  assert.match(read(root, 'active/0004-late/ledger.md'), /^work_id: work-0001-2$/m);
  assert.deepEqual(validatePlanning(root).errors, []);
});
