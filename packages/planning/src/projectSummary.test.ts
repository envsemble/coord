import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HomeDatabase } from './database.ts';
import { projectSummary } from './projectSummary.ts';
import { createReport, insertReport } from './statistics.ts';

function temporary(t: TestContext) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-summary-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(file: string, text: string) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); }
const plan = (status: string) => `---\nkind: plan\nimplementation_status: ${status}\n---\n\n# Plan\n`;
const ledger = (blocked: string | null) => `---\nschema_version: 2\nkind: ledger\nblocked: ${blocked === null ? 'null' : JSON.stringify(blocked)}\nsteps: []\n---\n\n# Ledger\n`;
const item = (folder: string, plan = folder + '/plan.md') => ({ id: 'work-' + folder.slice(-4), path: folder, current_plan: plan });

/** A planning folder: being implemented, blocked while implemented, blocked, planned, unreadable, and archived. */
function planningFolder(root: string) {
  write(path.join(root, 'planning.json'), '\ufeff' + JSON.stringify({
    schema_version: 1, name: 'Shop',
    repositories: [{ id: 'shop', path: '../shop' }, { id: 'planning', path: '.' }, { id: 'web' }],
    work_items: [item('active/0001'), item('active/0002'), item('active/0003'), item('active/0004'), item('active/0005'), item('active/0006', '../outside/plan.md'), item('archive/0007')],
  }));
  write(path.join(root, 'active/0001/plan.md'), plan('in_progress'));
  write(path.join(root, 'active/0001/ledger.md'), ledger(null));
  write(path.join(root, 'active/0002/plan.md'), plan('in_progress'));
  write(path.join(root, 'active/0002/ledger.md'), ledger('Waiting for the acquirer'));
  write(path.join(root, 'active/0003/plan.md'), '\ufeff' + plan('not_started'));
  write(path.join(root, 'active/0003/ledger.md'), ledger('Waiting for review'));
  write(path.join(root, 'active/0004/plan.md'), plan('not_started'));
  write(path.join(root, 'active/0004/ledger.md'), ledger('  '));
  // Its plan has no header that parses and its ledger is missing: active, and nothing else.
  write(path.join(root, 'active/0005/plan.md'), '---\nimplementation_status: [in_progress\n---\n');
  write(path.join(root, 'outside/plan.md'), plan('in_progress'));
  write(path.join(root, 'archive/0007/plan.md'), plan('in_progress'));
  write(path.join(root, 'archive/0007/ledger.md'), ledger('Blocked long ago'));
}

test('a project\'s summary counts its active work, of that the blocked and the implemented, and lists its repositories', async t => {
  const root = path.join(temporary(t), 'shop');
  planningFolder(root);
  assert.deepEqual(await projectSummary(root), { repositories: ['shop', 'web'], active: 6, blocked: 2, implementing: 1, updated: null },
    'a blocked item is not also implementing; a header that does not parse, a missing ledger and a plan outside the folder count as nothing; outside Git there is no last change');
});

test('a project\'s last change is its planning folder\'s last commit', async t => {
  const root = path.join(temporary(t), 'shop');
  planningFolder(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', 'user.name=Atlas test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore', windowsHide: true, env: { ...process.env, GIT_COMMITTER_DATE: '2026-10-01T12:00:00+02:00' } });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Planning');
  assert.equal((await projectSummary(root)).updated, '2026-10-01T12:00:00+02:00');
});

test('a folder without a readable registry has an empty summary', async t => {
  const root = temporary(t);
  assert.deepEqual(await projectSummary(path.join(root, 'missing')), { repositories: [], active: 0, blocked: 0, implementing: 0, updated: null });
  write(path.join(root, 'broken', 'planning.json'), '{ "repositories": ');
  assert.deepEqual(await projectSummary(path.join(root, 'broken')), { repositories: [], active: 0, blocked: 0, implementing: 0, updated: null });
  write(path.join(root, 'odd', 'planning.json'), JSON.stringify({ repositories: 'shop', work_items: [null, { path: 7 }, { path: 'active/0001', current_plan: 'C:\\plan.md' }] }));
  assert.deepEqual(await projectSummary(path.join(root, 'odd')), { repositories: [], active: 1, blocked: 0, implementing: 0, updated: null });
});

test('a project\'s last model is that of its latest report naming one', t => {
  const home = temporary(t);
  const database = HomeDatabase.open(home);
  try {
    const shop = database.addProject(path.join(home, 'planning', 'shop'), 'Shop');
    const coord = database.addProject(path.join(home, 'planning', 'coord'), 'Coord');
    assert.equal(database.lastModel(shop.id), null);
    const report = (model: string, at: string) => createReport({ model, at: new Date(at) });
    insertReport(database, shop.id, 'work-0001', report('claude-opus-5-5', '2026-10-14T10:00:00Z'));
    insertReport(database, shop.id, 'work-0002', report('gpt-6-codex', '2026-10-15T09:00:00Z'));
    insertReport(database, shop.id, 'work-0001', report('claude-haiku-5', '2026-10-13T09:00:00Z'));
    insertReport(database, coord.id, 'work-0001', report('claude-sonnet-5', '2026-10-16T09:00:00Z'));
    // A later report without a model (as the hooks may write) does not hide the last one named.
    database.db.prepare('INSERT INTO work_report (project_id, work_id, at, model) VALUES (?, ?, ?, NULL)').run(shop.id, 'work-0001', '2026-10-15T12:00:00.000Z');
    assert.equal(database.lastModel(shop.id), 'gpt-6-codex');
    assert.equal(database.lastModel(coord.id), 'claude-sonnet-5');
    // Two reports at the same time: the one recorded last.
    insertReport(database, shop.id, 'work-0003', report('claude-opus-5-5', '2026-10-15T09:00:00Z'));
    assert.equal(database.lastModel(shop.id), 'claude-opus-5-5');
  } finally { database.close(); }
});
