import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HomeDatabase } from '../home/database.ts';
import { createReport, insertReport, type ReportInput } from '../statistics/statistics.ts';
import { projectSummary } from './projectSummary.ts';

function temporary(t: TestContext) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-summary-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(file: string, text: string) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); }
const plan = (status: string, more = '') => `---\nkind: plan\nimplementation_status: ${status}\n${more}---\n\n# Plan\n`;
const ledger = (blocked: string | null, steps = 'steps: []\n') => `---\nschema_version: 2\nkind: ledger\nblocked: ${blocked === null ? 'null' : JSON.stringify(blocked)}\n${steps}---\n\n# Ledger\n`;
const item = (folder: string, plan = folder + '/plan.md') => ({ id: 'work-' + folder.slice(-4), path: folder, current_plan: plan });

/**
 * A planning folder: being implemented, blocked while implemented, blocked, planned, unreadable, a
 * draft, and a draft done in part; archived without an outcome, complete, and abandoned.
 */
function planningFolder(root: string) {
  write(path.join(root, 'planning.json'), '\ufeff' + JSON.stringify({
    schema_version: 1, name: 'Shop',
    repositories: [{ id: 'shop', path: '../shop' }, { id: 'planning', path: '.' }, { id: 'web' }],
    work_items: [item('active/0001'), item('active/0002'), item('active/0003'), item('active/0004'), item('active/0005'), item('active/0006', '../outside/plan.md'), item('archive/0007'), item('active/0008'), item('active/0009'), item('archive/0010'), item('archive/0011')],
  }));
  write(path.join(root, 'active/0001/plan.md'), plan('in_progress', 'title: Saved cards\nsummary: "Cards saved at checkout. Half done."\nupdated: "2026-10-03"\n'));
  write(path.join(root, 'active/0001/ledger.md'), ledger(null, 'steps:\n  - title: "Design"\n    status: done\n    phase: planning\n  - title: "Store"\n    status: done\n  - title: "Show"\n    status: doing\n'));
  write(path.join(root, 'archive/0010/plan.md'), plan('complete', 'title: Wish list\ndesign_status: accepted\nupdated: null\ncompleted_at: "2026-09-20"\n'));
  write(path.join(root, 'archive/0011/plan.md'), plan('partial', 'title: Coupons\ndesign_status: abandoned\nupdated: "2026-09-30"\n'));
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
  const none = { summary: null, steps: null, updated: null, outcome: null, step: null, completed: null, statistics: null };
  const unstepped = { steps: { done: 0, total: 0, planning: { done: 0, total: 0 } } };
  const other = (id: string, title = id.slice(-4), more = {}) => ({ id, title, state: 'other', blocked: null, ...none, ...more });
  assert.deepEqual(await projectSummary(root), {
    repositories: ['shop', 'web'],
    active: [
      { id: 'work-0001', title: 'Saved cards', state: 'implementing', blocked: null, summary: 'Cards saved at checkout. Half done.', steps: { done: 2, total: 3, planning: { done: 1, total: 1 } }, updated: '2026-10-03', outcome: null, step: { title: 'Show', status: 'doing', phase: 'implementation' }, completed: null, statistics: null },
      { id: 'work-0002', title: '0002', state: 'blocked', blocked: 'Waiting for the acquirer', ...none, ...unstepped },
      { id: 'work-0003', title: '0003', state: 'blocked', blocked: 'Waiting for review', ...none, ...unstepped },
      other('work-0004', '0004', unstepped), other('work-0005'), other('work-0006'),
      { id: 'work-0008', title: 'Gift cards', state: 'draft', blocked: null, ...none },
      other('work-0009', 'Returns'),
    ],
    closed: [
      { id: 'work-0011', title: 'Coupons', state: 'closed', blocked: null, ...none, updated: '2026-09-30', outcome: 'abandoned' },
      { id: 'work-0010', title: 'Wish list', state: 'closed', blocked: null, ...none, updated: '2026-09-20', outcome: 'complete', completed: '2026-09-20' },
      { id: 'work-0007', title: '0007', state: 'closed', blocked: null, ...none, ...unstepped },
    ],
    updated: null,
  }, 'blocked comes first, then implementing, then a draft plan (one done in part is not a draft); a blank blocker, a header that does not parse, a missing ledger and a plan outside the folder leave an item as other; closed work comes latest changed first (completed_at without updated), with how it ended and never blocked; outside Git there is no last change');
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

test('a folder without a readable registry has no summary, and odd entries in one count as nothing', async t => {
  const root = temporary(t);
  await assert.rejects(projectSummary(path.join(root, 'missing')));
  write(path.join(root, 'broken', 'planning.json'), '{ "repositories": ');
  await assert.rejects(projectSummary(path.join(root, 'broken')));
  write(path.join(root, 'list', 'planning.json'), '[]');
  await assert.rejects(projectSummary(path.join(root, 'list')), /not an object/);
  write(path.join(root, 'odd', 'planning.json'), JSON.stringify({ repositories: 'shop', work_items: [null, { path: 7 }, { path: 'active/0001' }, { id: 'work-0001', path: 'active/0001', current_plan: 'C:\\plan.md' }] }));
  assert.deepEqual(await projectSummary(path.join(root, 'odd')), { repositories: [], active: [{ id: 'work-0001', title: '0001', state: 'other', blocked: null, summary: null, steps: null, updated: null, outcome: null, step: null, completed: null, statistics: null }], closed: [], updated: null });
});

test('each work item has the step being worked on or next, and what agents spent on it, from all the project\'s reports at once', async t => {
  const home = temporary(t);
  const root = path.join(home, 'planning', 'shop');
  write(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, name: 'Shop', repositories: [], work_items: [item('active/0001'), item('active/0002'), item('active/0003'), item('archive/0004')] }));
  write(path.join(root, 'active/0001/plan.md'), plan('in_progress', 'title: Saved cards\n'));
  write(path.join(root, 'active/0001/ledger.md'), ledger(null, 'steps:\n  - title: "Design"\n    status: done\n    phase: planning\n  - title: "Store"\n    status: todo\n  - title: "Show"\n    status: doing\n'));
  write(path.join(root, 'active/0002/plan.md'), plan('not_started', 'title: Gift cards\ndesign_status: draft\n'));
  write(path.join(root, 'active/0002/ledger.md'), ledger(null, 'steps:\n  - title: "Understand the request"\n    status: done\n    phase: planning\n  - title: "Settle the design"\n    status: todo\n    phase: planning\n  - title: "Build"\n    status: todo\n'));
  write(path.join(root, 'active/0003/plan.md'), plan('in_progress'));
  write(path.join(root, 'active/0003/ledger.md'), ledger(null, 'steps:\n  - title: "Done"\n    status: done\n  - status: doing\n'));
  write(path.join(root, 'archive/0004/plan.md'), plan('complete', 'design_status: accepted\ncompleted_at: "2026-09-20"\n'));
  const database = HomeDatabase.open(home);
  try { await reported(database, home, root); } finally { database.close(); }
});

/** The test above, with its home database open (closed before the folder is removed). */
async function reported(database: HomeDatabase, home: string, root: string) {
  const shop = database.addProject(root, 'Shop');
  const other = database.addProject(path.join(home, 'planning', 'other'), 'Other');
  const opus = 'claude-opus', haiku = 'claude-haiku';
  const tokens = (input: number, output: number) => ({ input, cacheRead: 0, cacheWrite: 0, output });
  const report = (project: number, work: string, at: string, more: Partial<ReportInput>) => insertReport(database, project, work, createReport({ model: opus, session: 's1', at: new Date(at), ...more }));
  // Measured planning, measured implementation with a second model and two subagents, then an hour estimated before stages were recorded.
  report(shop.id, 'work-0001', '2026-10-01T10:00:00Z', { stage: 'planning', measured: { since: '2026-10-01T09:50:00.000Z', agentMs: 600_000, models: [{ model: opus, agentMs: 600_000, ...tokens(100, 50) }] } });
  report(shop.id, 'work-0001', '2026-10-01T11:00:00Z', {
    stage: 'implementation', measured: {
      since: '2026-10-01T10:00:00.000Z', agentMs: 1_200_000, models: [{ model: opus, agentMs: 900_000, ...tokens(200, 100) }, { model: haiku, agentMs: 300_000, ...tokens(40, 10) }],
      subagents: { count: 2, agentMs: 400_000, tokens: 30, agents: [{ id: 'a1', model: haiku, agentMs: 300_000, tokens: 20 }, { id: 'a2', model: null, agentMs: 100_000, tokens: 10 }] },
    },
  });
  report(shop.id, 'work-0001', '2026-10-01T12:00:00Z', {});
  // Another project's report for the same work ID is not this one's.
  report(other.id, 'work-0002', '2026-10-01T12:00:00Z', {});
  const summary = await projectSummary(root, { database, projectId: shop.id });
  const brief = (id: string) => [...summary.active, ...summary.closed].find(work => work.id === id)!;
  assert.deepEqual(brief('work-0001').step, { title: 'Show', status: 'doing', phase: 'implementation' }, 'the step being worked on before the next');
  assert.deepEqual(brief('work-0002').step, { title: 'Settle the design', status: 'todo', phase: 'planning' }, 'else the next, with its phase');
  assert.equal(brief('work-0003').step, null, 'a step without a title is none');
  assert.deepEqual([brief('work-0004').step, brief('work-0004').completed], [null, '2026-09-20']);
  assert.deepEqual(brief('work-0001').statistics, {
    agentMs: 600_000 + 1_200_000 + 3_600_000, activeMs: 5_400_000, unmergedMs: 5_400_000, tokens: 150 + 300 + 50, primaryModel: opus, otherModels: 1,
    planning: { agentMs: 600_000, tokens: 150 }, implementation: { agentMs: 1_200_000, tokens: 350 },
    subagents: 2, lastReport: '2026-10-01T12:00:00.000Z',
  }, 'counted as the plan page counts them; the hour without a stage is in the totals only');
  assert.deepEqual(['work-0002', 'work-0003', 'work-0004'].map(id => brief(id).statistics), [null, null, null], 'work without reports has none');
  assert.equal((await projectSummary(root)).active[0].statistics, null, 'without the database, none');
}

test('what agents do now: sessions in a turn, seen lately, and those waiting for the person until someone works on it, each on the work it touched last', t => {
  const home = temporary(t);
  const database = HomeDatabase.open(home);
  try {
    const shop = database.addProject(path.join(home, 'planning', 'shop'), 'Shop');
    const coord = database.addProject(path.join(home, 'planning', 'coord'), 'Coord');
    const now = Date.parse('2026-10-15T12:00:00Z');
    const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
    /** A session as the hooks leave it: seen, in a turn since, or waiting since, its time not yet reported counting from; linked to work it touched minutes ago. */
    const session = (id: string, seen: number, state: ({ turn: number } | { waiting: number }) & { counts?: number } | null, links: [number, string, number][]) => {
      database.db.prepare('INSERT INTO session (id, harness, transcript_path, started_at, updated_at, working, turn_at, waiting_at, counts_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)')
        .run(id, 'claude-code', ago(600), ago(seen), state && 'turn' in state ? 1 : 0, state && 'turn' in state ? ago(state.turn) : null, state && 'waiting' in state ? ago(state.waiting) : null, state?.counts === undefined ? null : ago(state.counts));
      for (const [project, work, touched] of links) database.db.prepare('INSERT INTO session_work (session_id, project_id, work_id, linked_at, touched_at) VALUES (?, ?, ?, ?, ?)').run(id, project, work, ago(600), ago(touched));
    };
    // One conversation on two plans counts for the one it touched last.
    session('a', 2, { turn: 10 }, [[shop.id, 'work-0001', 30], [coord.id, 'work-0003', 5]]);
    session('b', 5, { turn: 8 }, [[shop.id, 'work-0001', 6], [shop.id, 'work-0002', 7]]);
    database.db.prepare('INSERT INTO work_report (project_id, work_id, at, model, session) VALUES (?, ?, ?, ?, ?)').run(shop.id, 'work-0001', ago(3), 'claude-opus', 'b');
    session('c', 1, { waiting: 1 }, [[shop.id, 'work-0001', 4]]);
    // Its turn ended five minutes after its last report: those count until its report is in.
    session('stopped', 1, { waiting: 40, counts: 45 }, [[shop.id, 'work-0004', 50]]);
    // Waiting since before another session worked on the plan: nothing waits for the person there.
    session('answered', 1, { waiting: 20 }, [[shop.id, 'work-0002', 25]]);
    session('gone', 20, { turn: 30 }, [[coord.id, 'work-0005', 30]]);
    session('left', 25 * 60, { waiting: 25 * 60 }, [[coord.id, 'work-0006', 25 * 60]]);
    session('ended', 1, null, [[coord.id, 'work-0007', 1]]);
    const activity = database.workActivity(now);
    assert.deepEqual(activity.get(shop.id), [
      { workId: 'work-0001', state: 'working', since: ago(8), sessions: [
        { session: 'b', harness: 'claude-code', state: 'working', since: ago(8), countsFrom: ago(3) },
        { session: 'c', harness: 'claude-code', state: 'waiting', since: ago(1), countsFrom: null },
      ] },
      { workId: 'work-0004', state: 'waiting', since: ago(40), sessions: [{ session: 'stopped', harness: 'claude-code', state: 'waiting', since: ago(40), countsFrom: ago(45) }] },
    ], 'working while any session works, its time counting from its last report; else waiting');
    assert.deepEqual(activity.get(coord.id), [{ workId: 'work-0003', state: 'working', since: ago(10), sessions: [{ session: 'a', harness: 'claude-code', state: 'working', since: ago(10), countsFrom: ago(10) }] }],
      'a session not seen for 15 minutes, one waiting for a day and one that ended are not listed');
  } finally { database.close(); }
});
