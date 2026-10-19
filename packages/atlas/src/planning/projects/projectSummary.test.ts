import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HomeDatabase } from '../home/database.ts';
import { createReport, insertReport, type ReportInput } from '../statistics/statistics.ts';
import { projectSummary } from './projectSummary.ts';
import { handoffsByWork, linkHandoffs } from './handoffLinks.ts';
import { workTimeline } from '../statistics/sessions.ts';
import { projectStatistics } from '../statistics/projectStatistics.ts';

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
    schema_version: 2, name: 'Shop', folders: [],
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
  write(path.join(root, 'active/0008/plan.md'), plan('not_started', 'title: Gift cards\ndesign_status: draft\ncontinues: [work-0001, "app:work-0002"]\n'));
  write(path.join(root, 'active/0009/plan.md'), plan('partial', 'title: Returns\ndesign_status: draft\n'));
  write(path.join(root, 'archive/0007/ledger.md'), ledger('Blocked long ago'));
}

test('a project\'s summary lists its active work with where each item stands', async t => {
  const root = path.join(temporary(t), 'shop');
  planningFolder(root);
  const none = { summary: null, steps: null, updated: null, outcome: null, step: null, completed: null, statistics: null, continues: [], continuedIn: [] };
  // The work a plan continues, as its header names it: linked to its project and title by the host's listing.
  const handoff = (project: string, workId: string) => ({ folderId: null, project, projectName: '', workId, title: null, state: null, outcome: null });
  const unstepped = { steps: { done: 0, total: 0, planning: { done: 0, total: 0 } } };
  const other = (id: string, title = id.slice(-4), more = {}) => ({ id, title, state: 'other', blocked: null, ...none, ...more });
  assert.deepEqual(await projectSummary(root), {
    active: [
      { id: 'work-0001', title: 'Saved cards', state: 'implementing', blocked: null, summary: 'Cards saved at checkout. Half done.', steps: { done: 2, total: 3, planning: { done: 1, total: 1 } }, updated: '2026-10-03', outcome: null, step: { title: 'Show', status: 'doing', phase: 'implementation' }, completed: null, statistics: null, continues: [], continuedIn: [] },
      { id: 'work-0002', title: '0002', state: 'blocked', blocked: 'Waiting for the acquirer', ...none, ...unstepped },
      { id: 'work-0003', title: '0003', state: 'blocked', blocked: 'Waiting for review', ...none, ...unstepped },
      other('work-0004', '0004', unstepped), other('work-0005'), other('work-0006'),
      { id: 'work-0008', title: 'Gift cards', state: 'draft', blocked: null, ...none, continues: [handoff('', 'work-0001'), handoff('app', 'work-0002')] },
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
  write(path.join(root, 'broken', 'planning.json'), '{ "work_items": ');
  await assert.rejects(projectSummary(path.join(root, 'broken')));
  write(path.join(root, 'list', 'planning.json'), '[]');
  await assert.rejects(projectSummary(path.join(root, 'list')), /not an object/);
  write(path.join(root, 'odd', 'planning.json'), JSON.stringify({ folders: 'shop', work_items: [null, { path: 7 }, { path: 'active/0001' }, { id: 'work-0001', path: 'active/0001', current_plan: 'C:\\plan.md' }] }));
  assert.deepEqual(await projectSummary(path.join(root, 'odd')), { active: [{ id: 'work-0001', title: '0001', state: 'other', blocked: null, summary: null, steps: null, updated: null, outcome: null, step: null, completed: null, statistics: null, continues: [], continuedIn: [] }], closed: [], updated: null });
});

test('each work item has the step being worked on or next, and what agents spent on it, from all the project\'s reports at once', async t => {
  const home = temporary(t);
  const root = path.join(home, 'planning', 'shop');
  write(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 2, name: 'Shop', folders: [], work_items: [item('active/0001'), item('active/0002'), item('active/0003'), item('archive/0004')] }));
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
    agentMs: 600_000 + 1_200_000 + 3_600_000, activeMs: 5_400_000, unmergedMs: 5_400_000, tokens: 150 + 300 + 50, primaryModel: opus, primaryEffort: null, otherModels: 1,
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

test('a plan waits for the person once while its sessions wait at once, and no longer once another session works on it', t => {
  const database = HomeDatabase.open(temporary(t));
  try {
    const shop = database.addProject('/planning/shop', 'Shop');
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 15, 12, minutes)).toISOString();
    for (const id of ['a', 'b', 'c']) database.db.prepare('INSERT INTO session (id, harness, started_at, updated_at) VALUES (?, ?, ?, ?)').run(id, 'claude-code', at(0), at(100));
    const wait = (session: string, from: number, to: number) => database.db.prepare('INSERT INTO session_wait (session_id, project_id, work_id, started_at, ended_at) VALUES (?, ?, ?, ?, ?)').run(session, shop.id, 'work-0001', at(from), at(to));
    wait('a', 0, 60);
    wait('b', 30, 90);
    // Session c works on the plan from minute 40 to 50.
    insertReport(database, shop.id, 'work-0001', createReport({ model: 'claude-opus', session: 'c', at: new Date(at(50)), measured: { since: at(40), agentMs: 600_000, models: [], intervals: [{ agent: null, start: at(40), end: at(50) }] } }));
    const timeline = workTimeline(database, shop.id, 'work-0001', { created: '2026-10-14', accepted: '2026-10-15', completed: null }, Date.parse(at(100)));
    assert.deepEqual([timeline.plannedMs, timeline.waitedMs / 60_000], [86_400_000, 40], 'minutes 0 to 40: the two waits once, ended by c\'s work');
    assert.deepEqual(timeline.lanes.map(lane => [lane.session, lane.working, lane.waiting]), [
      ['a', [], [[at(0), at(40)]]], ['b', [], [[at(30), at(40)]]], ['c', [[at(40), at(50)]], []],
    ]);
  } finally { database.close(); }
});

test('a project\'s statistics put time on the days it was worked, by model and effort, with the plans completed', async t => {
  const directory = temporary(t);
  const root = path.join(directory, 'shop');
  write(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 2, name: 'Shop', folders: [], work_items: [item('archive/0001'), item('active/0002')] }));
  write(path.join(root, 'archive/0001/plan.md'), plan('complete', 'title: Saved cards\ndesign_status: accepted\ncreated: "2026-10-11"\naccepted_at: "2026-10-12"\ncompleted_at: "2026-10-14"\n'));
  write(path.join(root, 'active/0002/plan.md'), plan('not_started', 'title: Gift cards\n'));
  const database = HomeDatabase.open(path.join(directory, 'home'));
  try {
    const shop = database.addProject(root, 'Shop');
    // Local times: worked from 22:00 on the 13th to 02:00 on the 14th, at high effort.
    const local = (day: number, hour: number) => new Date(2026, 9, day, hour);
    insertReport(database, shop.id, 'work-0001', createReport({ model: 'claude-opus', session: 's1', at: local(14, 2), measured: {
      since: local(13, 21).toISOString(), agentMs: 4 * 3_600_000, models: [{ model: 'claude-opus', agentMs: 4 * 3_600_000, input: 0, cacheRead: 0, cacheWrite: 0, output: 100 }],
      intervals: [{ agent: null, start: local(13, 22).toISOString(), end: local(14, 2).toISOString() }],
      efforts: [{ agent: null, model: 'claude-opus', effort: 'high', agentMs: 4 * 3_600_000, tokens: 100 }],
    } }));
    const statistics = await projectStatistics(database, [{ projectId: shop.id, root }], { from: local(12, 0).toISOString(), to: local(15, 0).toISOString(), unit: 'day' });
    const hours = (ms: number) => ms / 3_600_000;
    assert.deepEqual(statistics.buckets.map(bucket => [bucket.start, hours(bucket.agents.reduce((total, entry) => total + entry.agentMs, 0)), bucket.completed.map(plan => plan.id)]), [
      [local(12, 0).toISOString(), 0, []], [local(13, 0).toISOString(), 2, []], [local(14, 0).toISOString(), 2, ['work-0001']],
    ], 'the stretch split at local midnight; the plan completed on its day');
    assert.deepEqual([hours(statistics.current.agentMs), hours(statistics.current.activeMs), statistics.current.plansCompleted, statistics.current.medianImplementingMs! / 86_400_000], [4, 4, 1, 2]);
    assert.deepEqual([statistics.previous?.agentMs, statistics.previous?.plansCompleted], [0, 0], 'the three days before had nothing');
    assert.deepEqual(statistics.models, [{ model: 'claude-opus', effort: 'high', agentMs: 4 * 3_600_000, tokens: 100 }]);
    // All plans: another project's work-0001 is its own plan, and the figures add up.
    const appRoot = path.join(directory, 'app');
    write(path.join(appRoot, 'planning.json'), JSON.stringify({ schema_version: 2, name: 'App', folders: [], work_items: [item('active/0001')] }));
    write(path.join(appRoot, 'active/0001/plan.md'), plan('in_progress', 'title: Checkout app\n'));
    const app = database.addProject(appRoot, 'App');
    insertReport(database, app.id, 'work-0001', createReport({ model: 'claude-opus', session: 's2', at: local(13, 12), measured: {
      since: local(13, 11).toISOString(), agentMs: 3_600_000, models: [], intervals: [{ agent: null, start: local(13, 11).toISOString(), end: local(13, 12).toISOString() }],
    } }));
    const all = await projectStatistics(database, [{ projectId: shop.id, root }, { projectId: app.id, root: appRoot }], { from: local(12, 0).toISOString(), to: local(15, 0).toISOString(), unit: 'day' });
    assert.deepEqual([hours(all.current.agentMs), all.current.plansCompleted, all.buckets.map(bucket => hours(bucket.agents.reduce((total, entry) => total + entry.agentMs, 0)))], [5, 1, [0, 3, 2]]);
  } finally { database.close(); }
});

test('handoffs link work across the home\'s projects both ways, by planning folder name, each once, and keep a reference that names nothing', () => {
  const work = (id: string, continues: { project: string; workId: string }[] = []) => ({ id, title: 'Title ' + id, state: 'implementing', outcome: null, continues: continues.map(item => ({ folderId: null, projectName: '', title: null, state: null, outcome: null, ...item })) }) as never;
  const shop = { folderId: 'f1', folder: path.join('home', 'planning', 'shop'), name: 'Shop', summary: { active: [work('work-0001'), work('work-0002', [{ project: '', workId: 'work-0001' }])], closed: [] } };
  const app = { folderId: 'f2', folder: path.join('home', 'planning', 'app'), name: 'App', summary: { active: [work('work-0001', [{ project: 'Shop', workId: 'work-0002' }, { project: 'shop', workId: 'work-0002' }, { project: 'gone', workId: 'work-0001' }])], closed: [] } };
  // A project outside the home finds only the folders beside it: not the home's shop.
  const outside = { folderId: 'f3', folder: path.join('elsewhere', 'notes'), name: 'Notes', summary: { active: [work('work-0001', [{ project: 'shop', workId: 'work-0001' }])], closed: [] } };
  linkHandoffs([shop, app, outside]);
  const [first, second] = shop.summary.active as { continues: unknown[]; continuedIn: unknown[] }[];
  assert.deepEqual(first.continuedIn, [{ folderId: 'f1', project: 'shop', projectName: 'Shop', workId: 'work-0002', title: 'Title work-0002', state: 'implementing', outcome: null }]);
  assert.deepEqual(second.continuedIn, [{ folderId: 'f2', project: 'app', projectName: 'App', workId: 'work-0001', title: 'Title work-0001', state: 'implementing', outcome: null }]);
  const [continued] = app.summary.active as { continues: { folderId: string | null; workId: string; title: string | null }[] }[];
  assert.deepEqual(continued.continues.map(item => [item.folderId, item.workId, item.title]), [['f1', 'work-0002', 'Title work-0002'], [null, 'work-0001', null]]);
  assert.deepEqual(handoffsByWork(app).get('work-0001')!.continues, continued.continues);
  assert.deepEqual((outside.summary.active[0] as { continues: { folderId: string | null }[] }).continues.map(item => item.folderId), [null]);
});
