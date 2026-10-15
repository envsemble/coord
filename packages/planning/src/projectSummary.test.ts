import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HomeDatabase } from './database.ts';
import { projectSummary } from './projectSummary.ts';

function temporary(t: TestContext) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-summary-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(file: string, text: string) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); }
const plan = (status: string, more = '') => `---\nkind: plan\nimplementation_status: ${status}\n${more}---\n\n# Plan\n`;
const ledger = (blocked: string | null) => `---\nschema_version: 2\nkind: ledger\nblocked: ${blocked === null ? 'null' : JSON.stringify(blocked)}\nsteps: []\n---\n\n# Ledger\n`;
const item = (folder: string, plan = folder + '/plan.md') => ({ id: 'work-' + folder.slice(-4), path: folder, current_plan: plan });

/** A planning folder: being implemented, blocked while implemented, blocked, planned, unreadable, archived, a draft, and a draft done in part. */
function planningFolder(root: string) {
  write(path.join(root, 'planning.json'), '\ufeff' + JSON.stringify({
    schema_version: 1, name: 'Shop',
    repositories: [{ id: 'shop', path: '../shop' }, { id: 'planning', path: '.' }, { id: 'web' }],
    work_items: [item('active/0001'), item('active/0002'), item('active/0003'), item('active/0004'), item('active/0005'), item('active/0006', '../outside/plan.md'), item('archive/0007'), item('active/0008'), item('active/0009')],
  }));
  write(path.join(root, 'active/0001/plan.md'), plan('in_progress', 'title: Saved cards\n'));
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
  write(path.join(root, 'active/0008/plan.md'), plan('not_started', 'title: Gift cards\ndesign_status: draft\n'));
  write(path.join(root, 'active/0009/plan.md'), plan('partial', 'title: Returns\ndesign_status: draft\n'));
  write(path.join(root, 'archive/0007/ledger.md'), ledger('Blocked long ago'));
}

test('a project\'s summary lists its active work with where each item stands, and its repositories', async t => {
  const root = path.join(temporary(t), 'shop');
  planningFolder(root);
  const other = (id: string, title = id.slice(-4)) => ({ id, title, state: 'other', blocked: null });
  assert.deepEqual(await projectSummary(root), {
    repositories: ['shop', 'web'],
    active: [
      { id: 'work-0001', title: 'Saved cards', state: 'implementing', blocked: null },
      { id: 'work-0002', title: '0002', state: 'blocked', blocked: 'Waiting for the acquirer' },
      { id: 'work-0003', title: '0003', state: 'blocked', blocked: 'Waiting for review' },
      other('work-0004'), other('work-0005'), other('work-0006'),
      { id: 'work-0008', title: 'Gift cards', state: 'draft', blocked: null },
      other('work-0009', 'Returns'),
    ],
    updated: null,
  }, 'blocked comes first, then implementing, then a draft plan (one done in part is not a draft); a blank blocker, a header that does not parse, a missing ledger and a plan outside the folder leave an item as other; outside Git there is no last change');
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
  assert.deepEqual(await projectSummary(path.join(root, 'missing')), { repositories: [], active: [], updated: null });
  write(path.join(root, 'broken', 'planning.json'), '{ "repositories": ');
  assert.deepEqual(await projectSummary(path.join(root, 'broken')), { repositories: [], active: [], updated: null });
  write(path.join(root, 'odd', 'planning.json'), JSON.stringify({ repositories: 'shop', work_items: [null, { path: 7 }, { path: 'active/0001' }, { id: 'work-0001', path: 'active/0001', current_plan: 'C:\\plan.md' }] }));
  assert.deepEqual(await projectSummary(path.join(root, 'odd')), { repositories: [], active: [{ id: 'work-0001', title: '0001', state: 'other', blocked: null }], updated: null });
});

test('live work is what sessions in a turn, seen lately, are linked to', t => {
  const home = temporary(t);
  const database = HomeDatabase.open(home);
  try {
    const shop = database.addProject(path.join(home, 'planning', 'shop'), 'Shop');
    const coord = database.addProject(path.join(home, 'planning', 'coord'), 'Coord');
    const now = Date.parse('2026-10-15T12:00:00Z');
    const session = (id: string, working: boolean, minutesAgo: number, links: [number, string][]) => {
      const seen = new Date(now - minutesAgo * 60_000).toISOString();
      database.db.prepare('INSERT INTO session (id, harness, transcript_path, started_at, updated_at, working) VALUES (?, ?, NULL, ?, ?, ?)').run(id, 'claude-code', seen, seen, working ? 1 : 0);
      for (const [project, work] of links) database.db.prepare('INSERT INTO session_work (session_id, project_id, work_id, linked_at) VALUES (?, ?, ?, ?)').run(id, project, work, seen);
    };
    session('a', true, 2, [[shop.id, 'work-0001'], [coord.id, 'work-0003']]);
    session('b', true, 5, [[shop.id, 'work-0001'], [shop.id, 'work-0002']]);
    session('stopped', false, 1, [[shop.id, 'work-0004']]);
    session('gone', true, 20, [[coord.id, 'work-0005']]);
    const live = database.liveWork(now);
    assert.deepEqual(live.get(shop.id), [{ workId: 'work-0001', since: new Date(now - 2 * 60_000).toISOString() }, { workId: 'work-0002', since: new Date(now - 5 * 60_000).toISOString() }],
      'each item once, at its latest session, the most recent first; a stopped session is not live');
    assert.deepEqual(live.get(coord.id), [{ workId: 'work-0003', since: new Date(now - 2 * 60_000).toISOString() }], 'a session not seen for 15 minutes has ended');
  } finally { database.close(); }
});
