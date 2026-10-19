// The work tools: creating, accepting, starting and closing work and changing its steps, atlas check
// and adopting a planning folder. Finding a checkout's planning folders is in work.slow.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validatePlanning } from '../check/check.ts';
import { checkPaths, fileCheckers } from '../check/checkPaths.ts';
import { adoptPlanningFolder } from '../projects/adopt.ts';
import { DatabaseSync } from 'node:sqlite';
import { legacyUsageSchema, statisticsDirectory } from '../home/storage.ts';
import { withDatabase } from '../home/database.ts';
import { storedReports } from '../statistics/statistics.ts';
import { normalizeRemote } from '../projects/resolve.ts';
import { acceptWork, addSteps, archiveWork, closeWork, createWork, planningLedger, removeStep, renameStep, reopenWork, setBlocked, setStepStatus, startWork, WorkError, workStatus } from './work.ts';
import { git, plan, planningFolder, read, temporary, today, write } from '../testing/testing.ts';

const errorsOf = (root: string) => validatePlanning(root).errors;

test('a work item is created under the next unused number, registered, and valid', async t => {
  const root = planningFolder(temporary(t));
  const before = read(root, 'planning.json');
  const created = await createWork(root, { title: 'Säve the "cart"', repositories: ['shop', 'tools'] }, today);
  assert.equal(created.workId, 'work-0004', 'numbers taken by registered work and unregistered folders are skipped');
  assert.equal(created.path, 'active/0004-save-the-cart');
  assert.deepEqual([created.designStatus, created.implementationStatus, created.created, created.updated, created.ledger, created.progress], ['draft', 'not_started', '2026-10-14', '2026-10-14', 'active/0004-save-the-cart/ledger.md', '0 of 4 steps done · 4 left']);
  assert.deepEqual(created.changed, ['active/0004-save-the-cart/plan.md', 'active/0004-save-the-cart/ledger.md', 'planning.json']);
  assert.ok(read(root, 'planning.json').startsWith(before.slice(0, before.lastIndexOf('}\n  ]'))), 'the registry is extended, not rewritten');
  assert.deepEqual(JSON.parse(read(root, 'planning.json')).work_items.at(-1), { id: 'work-0004', path: 'active/0004-save-the-cart', repositories: ['shop', 'tools'], current_plan: 'active/0004-save-the-cart/plan.md' });
  assert.match(read(root, created.plan), /^title: "Säve the \\"cart\\""$/m);
  assert.deepEqual(errorsOf(root), []);
  const slugged = await createWork(root, { title: 'Other', repositories: ['shop'], slug: 'custom-name' }, today);
  assert.equal(slugged.path, 'active/0005-custom-name');
  // A summary goes into the header under the title; without one, the check asks for it.
  const summarized = await createWork(root, { title: 'Refunds', repositories: ['shop'], summary: ' Refunds to the card: "partial" ones too. Not started. ' }, today);
  assert.equal(summarized.summary, 'Refunds to the card: "partial" ones too. Not started.');
  assert.match(read(root, summarized.plan), /^title: "Refunds"\nsummary: "Refunds to the card: \\"partial\\" ones too\. Not started\."\nrepositories: \["shop"\]$/m);
  assert.equal(created.summary, null);
  assert.deepEqual(validatePlanning(root).warnings.filter(warning => warning.includes('no summary')).map(warning => warning.split(':')[0]),
    ['active/0001-existing/plan.md', 'active/0002-other/plan.md', 'active/0004-save-the-cart/plan.md', 'active/0005-custom-name/plan.md']);
  await assert.rejects(createWork(root, { title: 'X', repositories: ['shop'], summary: 'One.\nTwo.' }, today), /The summary must be one line/);
  for (const [request, message] of [
    [{ title: '', repositories: ['shop'] }, /title must be nonempty/],
    [{ title: 'Two\nlines', repositories: ['shop'] }, /one line/],
    [{ title: 'X', repositories: [] }, /Name the repositories/],
    [{ title: 'X', repositories: ['nope'] }, /Not registered in planning\.json: nope/],
    [{ title: 'X', repositories: ['shop'], slug: 'Bad Slug' }, /slug/],
  ] as const) await assert.rejects(createWork(root, request as never, today), message);
});

test('new work has its planning steps from the start: added to while designing, done on acceptance, followed by the implementation\'s', async t => {
  const root = planningFolder(temporary(t));
  const created = await createWork(root, { title: 'Refunds', repositories: ['shop'], summary: 'Refunds to the card.' }, today);
  const ledger = () => read(root, 'active/0004-refunds/ledger.md');
  const planning = (status: string) => (title: string) => ({ title, status, phase: 'planning' });
  assert.deepEqual(created.steps, [planning('doing')('Understand the request'), ...['Settle the design', 'Write the plan', 'Accepted'].map(planning('todo'))]);
  assert.match(ledger(), /^---\nschema_version: 2\nkind: ledger\nwork_id: work-0004\nupdated: "2026-10-14"\nblocked: null\nsteps:\n  - title: "Understand the request"\n    status: doing\n    phase: planning\n/);
  assert.deepEqual(errorsOf(root), []);
  // While designing, steps are planning steps (after the others); agents rename and remove them to fit the work.
  await setStepStatus(root, 'work-0004', 'Understand the request', 'done', today);
  await renameStep(root, 'work-0004', 'Settle the design', 'Settle the refund rules', today);
  await removeStep(root, 'work-0004', 'Write the plan', today);
  const added = await addSteps(root, 'work-0004', ['Ask finance'], today);
  assert.deepEqual(added.steps.map(step => [step.title, step.status, step.phase]), [['Understand the request', 'done', 'planning'], ['Settle the refund rules', 'todo', 'planning'], ['Accepted', 'todo', 'planning'], ['Ask finance', 'todo', 'planning']]);
  await assert.rejects(closeWork(root, 'work-0004', today), /only accepted work is closed/);
  // Accepting marks every planning step done; starting appends the implementation steps.
  const accepted = await acceptWork(root, 'work-0004', today);
  assert.deepEqual([accepted.progress, accepted.changed], ['All 4 steps done', ['active/0004-refunds/plan.md', 'active/0004-refunds/ledger.md']]);
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'Plan');
  await assert.rejects(startWork(root, 'work-0004', { steps: ['Accepted'] }, today), /already has these steps: Accepted/);
  const started = await startWork(root, 'work-0004', { steps: ['Build', 'Ship'] }, today);
  assert.deepEqual(started.steps.map(step => [step.title, step.status, step.phase]), [['Understand the request', 'done', 'planning'], ['Settle the refund rules', 'done', 'planning'], ['Accepted', 'done', 'planning'], ['Ask finance', 'done', 'planning'], ['Build', 'todo', undefined], ['Ship', 'todo', undefined]]);
  assert.deepEqual([started.implementationStatus, started.progress, started.warnings], ['in_progress', '4 of 6 steps done · 2 left', []]);
  assert.match(ledger(), /\n  - title: "Ship"\n    status: todo\n---\n$/, 'the ledger is only its header: no prose');
  await assert.rejects(startWork(root, 'work-0004', { steps: ['Again'] }, today), /implementation has started already; add steps with step_add/);
  // From then on, added steps are implementation steps; closing needs every step done.
  assert.deepEqual((await addSteps(root, 'work-0004', ['Announce'], today)).steps.at(-1), { title: 'Announce', status: 'todo' });
  await assert.rejects(closeWork(root, 'work-0004', today), /cannot close while items are open/);
  for (const step of ['Build', 'Ship', 'Announce']) await setStepStatus(root, 'work-0004', step, 'done', today);
  assert.equal((await closeWork(root, 'work-0004', today)).location, 'archive');
  assert.deepEqual(errorsOf(root), []);
});

test('work in progress or partly done without a started ledger starts once', async t => {
  const root = planningFolder(temporary(t));
  const accepted = { design_status: 'accepted', accepted_at: '"2026-10-02"' };
  // An older plan in progress, adopted without a ledger, gets one when it starts.
  writeFileSync(path.join(root, 'active/0001-existing/plan.md'), plan('work-0001', { ...accepted, implementation_status: 'in_progress' }));
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'Plans');
  const started = await startWork(root, 'work-0001', { steps: ['Build'] }, today);
  assert.deepEqual([started.ledger, started.steps], ['active/0001-existing/ledger.md', [{ title: 'Build', status: 'todo' }]]);
  await assert.rejects(startWork(root, 'work-0001', { steps: ['Again'] }, today), /implementation has started already/);
  // Partly done work whose ledger has only its planning steps starts once.
  writeFileSync(path.join(root, 'active/0002-other/plan.md'), plan('work-0002', { ...accepted, repositories: '[tools]', implementation_status: 'partial' }));
  write(path.join(root, 'active/0002-other/ledger.md'), planningLedger('work-0002', '2026-10-01').replace(/status: (?:doing|todo)/g, 'status: done'));
  await startWork(root, 'work-0002', { steps: ['Finish'] }, today);
  await assert.rejects(startWork(root, 'work-0002', { steps: ['Again'] }, today), /implementation has started already/);
});

test('a ledger whose steps have no phase reads as before, and a phase is planning or implementation', async t => {
  const root = planningFolder(temporary(t));
  const header = (steps: string) => `---\nschema_version: 2\nkind: ledger\nwork_id: work-0001\nupdated: "2026-10-14"\nblocked: null\nsteps:\n${steps}---\n\n# Ledger\n`;
  write(path.join(root, 'active/0001-existing/ledger.md'), header('  - title: "Build"\n    status: doing\n'));
  assert.deepEqual([(await workStatus(root, 'work-0001')).steps, errorsOf(root)], [[{ title: 'Build', status: 'doing' }], []]);
  // A step added to an older ledger is an implementation step, after the others: only work not
  // started, with no implementation step yet, is being planned.
  assert.deepEqual((await addSteps(root, 'work-0001', ['Ship'], today)).steps, [{ title: 'Build', status: 'doing' }, { title: 'Ship', status: 'todo' }]);
  writeFileSync(path.join(root, 'active/0001-existing/plan.md'), plan('work-0001', { implementation_status: 'unknown' }));
  write(path.join(root, 'active/0001-existing/ledger.md'), header('  - title: "Plan"\n    status: done\n    phase: planning\n'));
  assert.deepEqual((await addSteps(root, 'work-0001', ['Ship'], today)).steps.at(-1), { title: 'Ship', status: 'todo' }, 'implementation unknown is past planning');
  write(path.join(root, 'active/0001-existing/ledger.md'), header('  - title: "Design"\n    status: done\n    phase: planning\n  - title: "Build"\n    status: todo\n    phase: implementation\n'));
  assert.deepEqual([(await workStatus(root, 'work-0001')).steps, errorsOf(root)], [[{ title: 'Design', status: 'done', phase: 'planning' }, { title: 'Build', status: 'todo' }], []]);
  write(path.join(root, 'active/0001-existing/ledger.md'), header('  - title: "Build"\n    status: todo\n    phase: later\n'));
  assert.match(errorsOf(root).join('\n'), /Ledger step 1 phase must be planning or implementation/);
});

test('the design is accepted, then implementation starts with a ledger of its steps', async t => {
  const root = planningFolder(temporary(t));
  await assert.rejects(startWork(root, 'work-0001', { steps: ['Build'] }, today), /accept it before implementation starts/);
  const accepted = await acceptWork(root, 'work-0001', today);
  assert.deepEqual([accepted.designStatus, accepted.acceptedAt, accepted.updated], ['accepted', '2026-10-14', '2026-10-14']);
  assert.match((await acceptWork(root, 'work-0001', today)).warnings[0], /already accepted on 2026-10-14/);
  assert.equal(read(root, 'active/0001-existing/plan.md'), plan('work-0001', { updated: '"2026-10-14"', design_status: 'accepted', accepted_at: '"2026-10-14"' }), 'only the changed lines are rewritten');
  const started = await startWork(root, 'work-0001', { steps: ['Build the cart', 'Review'] }, today);
  assert.equal(started.implementationStatus, 'in_progress');
  assert.deepEqual(started.steps, [{ title: 'Build the cart', status: 'todo' }, { title: 'Review', status: 'todo' }]);
  assert.equal(started.progress, '0 of 2 steps done · 2 left');
  assert.match(read(root, 'active/0001-existing/ledger.md'), /\nsteps:\n  - title: "Build the cart"\n    status: todo\n  - title: "Review"\n    status: todo\n---\n$/);
  assert.deepEqual(errorsOf(root), []);
  await assert.rejects(startWork(root, 'work-0001', { steps: ['Again'] }, today), /implementation has started already/);
  await assert.rejects(startWork(root, 'work-0002', { steps: ['A', 'A'] }, today), /unique/);
  await assert.rejects(startWork(root, 'work-0002', { steps: [] }, today), /at least one/);
  await assert.rejects(startWork(root, 'work-0009', { steps: ['A'] }, today), /work-0009 is not registered/);
  await assert.rejects(startWork(root, 'nonsense', { steps: ['A'] }, today), /such as work-0001/);
});

test('a draft from before planning steps gets its ledger from its first planning steps', async t => {
  const root = planningFolder(temporary(t));
  const added = await addSteps(root, 'work-0001', ['Settle the refunds', 'Accepted'], today);
  assert.deepEqual(added.steps, [{ title: 'Settle the refunds', status: 'todo', phase: 'planning' }, { title: 'Accepted', status: 'todo', phase: 'planning' }]);
  const folder = readdirSync(path.join(root, 'active')).find(name => name.startsWith('0001'))!;
  assert.match(readFileSync(path.join(root, 'active', folder, 'ledger.md'), 'utf8'), /\n  - title: "Accepted"\n    status: todo\n    phase: planning\n---\n$/);
  assert.deepEqual(errorsOf(root), []);
  assert.deepEqual((await addSteps(root, 'work-0001', ['Write the plan'], today)).steps.map(step => step.title), ['Settle the refunds', 'Accepted', 'Write the plan']);
  await acceptWork(root, 'work-0001', today);
  const started = await startWork(root, 'work-0001', { steps: ['Build'] }, today);
  assert.deepEqual(started.steps.map(step => step.status), ['done', 'done', 'done', 'todo']);
});

test('steps are added, set, renamed and removed, and blocked is set and cleared', async t => {
  const root = planningFolder(temporary(t));
  await acceptWork(root, 'work-0001', today);
  await startWork(root, 'work-0001', { steps: ['Build'] }, today);
  const added = await addSteps(root, 'work-0001', ['Test', 'Ship'], { today: '2026-10-15' });
  assert.deepEqual(added.steps.map(step => step.title), ['Build', 'Test', 'Ship']);
  assert.equal(added.updated, '2026-10-15', 'the plan records the date too');
  await assert.rejects(addSteps(root, 'work-0001', ['Test'], today), /already has these steps: Test/);
  assert.deepEqual((await setStepStatus(root, 'work-0001', 'Build', 'done', today)).steps[0], { title: 'Build', status: 'done' });
  await assert.rejects(setStepStatus(root, 'work-0001', 'Missing', 'done', today), /no step "Missing". Its steps: "Build", "Test", "Ship"/);
  await assert.rejects(setStepStatus(root, 'work-0001', 'Build', 'finished' as never, today), /todo, doing or done/);
  assert.equal((await renameStep(root, 'work-0001', 'Test', 'Test it', today)).steps[1].title, 'Test it');
  await assert.rejects(renameStep(root, 'work-0001', 'Test it', 'Ship', today), /already has a step "Ship"/);
  const removed = await removeStep(root, 'work-0001', 'Ship', today);
  assert.deepEqual(removed.steps.map(step => step.title), ['Build', 'Test it']);
  const blocked = await setBlocked(root, 'work-0001', 'Waiting for the API key', today);
  assert.equal(blocked.blocked, 'Waiting for the API key');
  assert.match(read(root, 'active/0001-existing/ledger.md'), /^blocked: "Waiting for the API key"\n[^]*---\n$/m, 'only the header changes');
  assert.equal((await setBlocked(root, 'work-0001', null, today)).blocked, null);
  assert.deepEqual(errorsOf(root), []);
});

test('closing refuses while items are open, then completes and archives, repairing links; reopening reverses it', async t => {
  const root = planningFolder(temporary(t));
  await acceptWork(root, 'work-0001', today);
  await startWork(root, 'work-0001', { steps: ['Build', 'Review'] }, today);
  await setStepStatus(root, 'work-0001', 'Build', 'done', today);
  await setBlocked(root, 'work-0001', 'Review pending', today);
  await assert.rejects(closeWork(root, 'work-0001', today), (error: WorkError) => {
    assert.deepEqual(error.problems, ['Step "Review" is todo.', 'Blocked: Review pending']);
    return /cannot close while items are open/.test(error.message);
  });
  await assert.rejects(closeWork(root, 'work-0002', today), /only accepted work is closed/);
  // Work that never started, or whose ledger has no implementation steps, has nothing to show as done.
  await acceptWork(root, 'work-0002', today);
  await assert.rejects(closeWork(root, 'work-0002', today), /no ledger: its implementation never started/);
  write(path.join(root, 'active/0002-other/ledger.md'), '---\nschema_version: 2\nkind: ledger\nwork_id: work-0002\nupdated: "2026-10-14"\nblocked: null\nsteps: []\n---\n\n# Ledger\n');
  await assert.rejects(closeWork(root, 'work-0002', today), /ledger has no implementation steps/);
  rmSync(path.join(root, 'active/0002-other/ledger.md'));
  await setStepStatus(root, 'work-0001', 'Review', 'done', today);
  await setBlocked(root, 'work-0001', null, today);
  const closed = await closeWork(root, 'work-0001', { today: '2026-10-16' });
  assert.deepEqual([closed.path, closed.location, closed.implementationStatus, closed.completedAt, closed.plan], ['archive/0001-existing', 'archive', 'complete', '2026-10-16', 'archive/0001-existing/plan.md']);
  assert.ok(!existsSync(path.join(root, 'active/0001-existing')));
  assert.deepEqual(JSON.parse(read(root, 'planning.json')).work_items[0], { id: 'work-0001', path: 'archive/0001-existing', repositories: ['shop'], current_plan: 'archive/0001-existing/plan.md' });
  // Links into the moved folder and out of it follow; links within it, and code, stay.
  assert.equal(read(root, 'README.md'), '# Planning\n\n- [Existing](archive/0001-existing/plan.md)\n- [Ledger][ledger]\n\n[ledger]: <archive/0001-existing/ledger.md>\n\n```\n[not a link](active/0001-existing/plan.md)\n```\n');
  assert.ok(read(root, 'active/0002-other/plan.md').includes('[the first](../../archive/0001-existing/plan.md#why)'));
  assert.ok(read(root, 'archive/0001-existing/plan.md').includes('[the other work](../../active/0002-other/plan.md) and [the glossary](../../knowledge/glossary.md)'));
  assert.ok(closed.changed.includes('README.md') && closed.changed.includes('active/0002-other/plan.md'));
  assert.deepEqual(errorsOf(root), []);
  await assert.rejects(archiveWork(root, 'work-0001', {}, today), /not in active/);
  await assert.rejects(reopenWork(root, 'work-0001', { steps: [] }, today), /Give the steps/);
  await assert.rejects(reopenWork(root, 'work-0001', { steps: ['Review'] }, today), /already has these steps: Review/);
  const reopened = await reopenWork(root, 'work-0001', { steps: ['Fix the follow-up'] }, { today: '2026-10-17' });
  assert.deepEqual([reopened.path, reopened.implementationStatus, reopened.completedAt, reopened.updated], ['active/0001-existing', 'in_progress', null, '2026-10-17']);
  assert.deepEqual(reopened.steps.at(-1), { title: 'Fix the follow-up', status: 'todo' });
  assert.ok(read(root, 'README.md').includes('[Existing](active/0001-existing/plan.md)'));
  assert.deepEqual(errorsOf(root), []);
  // Work that is not complete is archived only as superseded or abandoned, with the reason recorded.
  await assert.rejects(archiveWork(root, 'work-0002', {}, today), /not complete: archive it as superseded/);
  await assert.rejects(archiveWork(root, 'work-0002', { disposition: 'abandoned' }, today), /reason/);
  await assert.rejects(archiveWork(root, 'work-0002', { reason: 'Never recorded.' }, today), /only with a disposition/);
  await assert.rejects(archiveWork(root, 'work-0002', { disposition: 'abandoned', supersededBy: 'work-0001', reason: 'x' }, today), /Only superseded work/);
  await assert.rejects(archiveWork(root, 'work-0002', { disposition: 'superseded', supersededBy: 'work-0009' }, today), /work-0009 is not registered/);
  const archived = await archiveWork(root, 'work-0002', { disposition: 'abandoned', reason: 'The tools moved elsewhere.' }, today);
  assert.deepEqual([archived.path, archived.designStatus], ['archive/0002-other', 'abandoned']);
  assert.match(read(root, 'archive/0002-other/plan.md'), /## Outcome\n\n- 2026-10-14: Archived as abandoned: The tools moved elsewhere\.\n$/);
  assert.ok(read(root, 'active/0001-existing/plan.md').includes('[the other work](../../archive/0002-other/plan.md)'));
  assert.deepEqual(errorsOf(root), []);
  const status = await workStatus(root, 'work-0001');
  assert.deepEqual(status.statistics, { reports: 0, agentMinutes: 0, tokens: null, primaryModel: null });
  // Superseded work with open steps: the plan says by what, and reopening accepts it again.
  await assert.rejects(archiveWork(root, 'work-0001', {}, today), (error: WorkError) => error.problems.includes('Step "Fix the follow-up" is todo.'));
  // Naming the work that supersedes it is enough.
  const superseded = await archiveWork(root, 'work-0001', { supersededBy: 'work-0002', reason: 'Folded into the tools work' }, today);
  assert.deepEqual([superseded.location, superseded.designStatus], ['archive', 'superseded']);
  assert.match(read(root, 'archive/0001-existing/plan.md'), /^superseded_by: "work-0002"$/m);
  assert.match(read(root, 'archive/0001-existing/plan.md'), /## Outcome\n\n- 2026-10-14: Archived as superseded by work-0002: Folded into the tools work\.\n$/);
  assert.deepEqual(errorsOf(root), []);
  const again = await reopenWork(root, 'work-0001', { steps: ['Pick it up again'] }, today);
  assert.deepEqual([again.designStatus, again.location], ['accepted', 'active']);
  assert.match(read(root, 'active/0001-existing/plan.md'), /^superseded_by: null$/m);
});

test('atlas check flags archived work left open without a disposition', async t => {
  const root = planningFolder(temporary(t));
  await acceptWork(root, 'work-0001', today);
  await startWork(root, 'work-0001', { steps: ['Build'] }, today);
  // Moved by hand, as the archive tool would refuse.
  mkdirSync(path.join(root, 'archive'));
  renameSync(path.join(root, 'active/0001-existing'), path.join(root, 'archive/0001-existing'));
  writeFileSync(path.join(root, 'planning.json'), read(root, 'planning.json').replaceAll('active/0001-existing', 'archive/0001-existing'));
  assert.deepEqual(errorsOf(root), ['archive/0001-existing/plan.md: archived with 1 open ledger item but neither superseded nor abandoned; reopen it, close it, or give it that disposition']);
  writeFileSync(path.join(root, 'archive/0001-existing/plan.md'), read(root, 'archive/0001-existing/plan.md').replace('design_status: accepted', 'design_status: abandoned'));
  assert.deepEqual(errorsOf(root), []);
});

test('a current_plan outside its work folder is refused before anything is written', async t => {
  const root = planningFolder(temporary(t));
  const registry = JSON.parse(read(root, 'planning.json'));
  const before = read(root, 'active/0002-other/plan.md');
  for (const pointer of ['active/0002-other/plan.md', 'active/0001-existing/../0002-other/plan.md']) {
    registry.work_items[0].current_plan = pointer;
    writeFileSync(path.join(root, 'planning.json'), JSON.stringify(registry, null, 2) + '\n');
    await assert.rejects(acceptWork(root, 'work-0001', today), new RegExp('current_plan .* is outside its work folder active/0001-existing'));
  }
  assert.equal(read(root, 'active/0002-other/plan.md'), before);
});

test('remotes are compared in one spelling', () => {
  for (const spelling of ['git@github.com:Example/Shop.git', 'ssh://git@github.com/example/shop', 'ssh://git@github.com:22/example/shop.git', 'https://github.com/example/shop.git', 'https://user@GitHub.com/example/shop/', 'git://github.com/example/shop']) {
    assert.equal(normalizeRemote(spelling), 'github.com/example/shop', spelling);
  }
  assert.equal(normalizeRemote(''), null);
  assert.equal(normalizeRemote('C:\\repos\\shop.git'), 'c:/repos/shop');
});

test('atlas check attributes findings to the files asked about and runs registered checkers', async t => {
  const root = planningFolder(temporary(t));
  writeFileSync(path.join(root, 'active/0001-existing/plan.md'), plan('work-0001').replace('title: "Existing work"', 'title: 1.5'));
  const [whole] = await checkPaths([root]);
  assert.deepEqual(whole.errors, ['active/0001-existing/plan.md: ambiguous implicit YAML scalar; quote intended strings']);
  assert.deepEqual((await checkPaths([path.join(root, 'active/0001-existing/plan.md')]))[0].errors, whole.errors);
  assert.deepEqual((await checkPaths([path.join(root, 'active/0002-other/plan.md')]))[0].errors, [], 'another file has no findings');
  assert.deepEqual((await checkPaths([path.join(root, 'active/0001-existing')]))[0].errors, whole.errors, 'a folder gets the findings about its files');
  writeFileSync(path.join(root, 'planning.json'), read(root, 'planning.json').replace('"schema_version": 1', '"schema_version": 2'));
  assert.deepEqual((await checkPaths([path.join(root, 'planning.json')]))[0].errors, ['registry schema_version must be integer 1']);
  const outside = await checkPaths([tmpdir()]);
  assert.match(outside[0].errors[0], /not inside a planning folder/);
  // Diagram files are checked as diagrams, with the line and column of each problem.
  write(path.join(root, 'active/0001-existing/model.puml'), '@startuml\nclass A\nclass B\nA -up-> B\n@enduml\n');
  const [diagram] = await checkPaths([path.join(root, 'active/0001-existing/model.puml')]);
  assert.equal(diagram.errors.length, 1);
  assert.match(diagram.errors[0], /^active\/0001-existing\/model\.puml:4:\d+: .*remove the direction `up`/);
  // A whole folder's check finds them too; a proposal reads its baseline beside it, never outside the planning folder.
  write(path.join(root, 'active/0001-existing/model.puml'), '@startuml\nclass A\n@enduml\n');
  write(path.join(root, 'active/0001-existing/proposal.puml'), "@startuml\n' atlas proposal model.puml\nclass A\nclass B\n@enduml\n");
  write(path.join(root, 'active/0002-other/proposal.puml'), "@startuml\n' atlas proposal ../../../outside.puml\nclass A\n@enduml\n");
  write(path.join(root, '..', 'outside.puml'), '@startuml\nclass A\n@enduml\n');
  const errors = (await checkPaths([root]))[0].errors.filter(error => error.includes('.puml'));
  assert.deepEqual(errors.map(error => error.split(':')[0]), ['active/0002-other/proposal.puml']);
  assert.match(errors[0], /outside\.puml does not exist/);
  // Other kinds of file can register their own checker.
  write(path.join(root, 'active/0001-existing/notes.txt'), 'x');
  fileCheckers.set('.txt', (_, file) => ({ errors: [file + ': checked'], warnings: [] }));
  t.after(() => fileCheckers.delete('.txt'));
  assert.ok((await checkPaths([path.join(root, 'active/0001-existing/notes.txt')]))[0].errors.includes('active/0001-existing/notes.txt: checked'));
});

test('atlas check warns about a diagram no document links, and checks the project name', async t => {
  const root = planningFolder(temporary(t));
  write(path.join(root, 'active/0001-existing/diagrams/model.puml'), '@startuml\nclass A\n@enduml\n');
  write(path.join(root, 'notes.puml'), '@startuml\nclass B\n@enduml\n');
  const unlinked = (await checkPaths([root]))[0].warnings.filter(warning => warning.includes('links this diagram'));
  assert.deepEqual(unlinked, ['active/0001-existing/diagrams/model.puml: no document links this diagram; link it from the plan under the heading it explains'], 'a diagram outside every work folder is not a work item\'s');
  // A link from any document of the planning folder counts: another work item's plan, or a knowledge note.
  const other = read(root, 'active/0002-other/plan.md');
  writeFileSync(path.join(root, 'active/0002-other/plan.md'), other + '\n[Their model](../0001-existing/diagrams/model.puml)\n');
  assert.deepEqual((await checkPaths([path.join(root, 'active/0001-existing/diagrams/model.puml')]))[0].warnings, []);
  writeFileSync(path.join(root, 'active/0002-other/plan.md'), other);
  writeFileSync(path.join(root, 'knowledge/glossary.md'), '# Glossary\n\n[Model](../active/0001-existing/diagrams/model.puml)\n');
  assert.deepEqual((await checkPaths([path.join(root, 'active/0001-existing/diagrams/model.puml')]))[0].warnings, []);
  writeFileSync(path.join(root, 'knowledge/glossary.md'), '# Glossary\n');
  writeFileSync(path.join(root, 'active/0001-existing/plan.md'), plan('work-0001') + '\n## Model\n\n[The model](diagrams/model.puml)\n');
  assert.deepEqual((await checkPaths([path.join(root, 'active/0001-existing/diagrams/model.puml')]))[0].warnings, []);
  const registry = JSON.parse(read(root, 'planning.json'));
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ ...registry, name: 'Shop' }));
  assert.deepEqual(validatePlanning(root).errors, []);
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ ...registry, name: ' ' }));
  assert.deepEqual(validatePlanning(root).errors, ['name must be a nonempty string of at most 100 characters when supplied']);
  // Workspace folders are absolute paths.
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ ...registry, workspaces: [path.join(root, 'workspace')] }));
  assert.deepEqual(validatePlanning(root).errors, []);
  // Windows and POSIX paths alike: a planning folder may be read on another system.
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ ...registry, workspaces: ['C:\\Dev\\shop', '/home/someone/shop', '\\\\server\\share\\shop'] }));
  assert.deepEqual(validatePlanning(root).errors, []);
  for (const workspaces of ['C:/x', ['relative/folder'], [''], [7]]) {
    writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ ...registry, workspaces }));
    assert.deepEqual(validatePlanning(root).errors, ['workspaces must be an array of absolute folder paths when supplied'], JSON.stringify(workspaces));
  }
});

test('atlas check warns about an active plan without a summary, and refuses one that is not text', async t => {
  const root = planningFolder(temporary(t));
  const warned = () => validatePlanning(root).warnings.filter(warning => warning.includes('summary'));
  assert.deepEqual(warned(), [
    'active/0001-existing/plan.md: no summary: add one to the header, two or three plain sentences on what the work is, why, and where it stands',
    'active/0002-other/plan.md: no summary: add one to the header, two or three plain sentences on what the work is, why, and where it stands',
  ]);
  assert.deepEqual((await checkPaths([path.join(root, 'active/0001-existing/plan.md')]))[0].warnings.length, 1, 'only the plan asked about');
  writeFileSync(path.join(root, 'active/0001-existing/plan.md'), plan('work-0001', { summary: '"Saved carts. Planned."' }));
  writeFileSync(path.join(root, 'active/0002-other/plan.md'), plan('work-0002', { repositories: '[tools]', summary: '" "' }));
  assert.deepEqual(warned().map(warning => warning.split(':')[0]), ['active/0002-other/plan.md'], 'a blank summary is none');
  writeFileSync(path.join(root, 'active/0002-other/plan.md'), plan('work-0002', { repositories: '[tools]', summary: '[one, two]' }));
  assert.deepEqual(validatePlanning(root).errors, ['active/0002-other/plan.md: summary must be a string or null']);
  // Archived work is not asked for one.
  writeFileSync(path.join(root, 'active/0002-other/plan.md'), plan('work-0002', { repositories: '[tools]' }));
  await archiveWork(root, 'work-0002', { disposition: 'abandoned', supersededBy: null, reason: 'Not needed.' }, today);
  assert.deepEqual(warned(), []);
});

test('a planning folder is adopted into the home with its path hints made absolute, its statistics imported', async t => {
  const directory = temporary(t);
  const root = planningFolder(directory);
  const home = path.join(directory, 'home');
  await assert.rejects(adoptPlanningFolder(path.join(root, 'active'), { home }), /no planning\.json/);
  // Document use from before the home database, kept by the folder's path, and a work statistics file.
  const usage = await statisticsDirectory(root, home);
  mkdirSync(usage, { recursive: true });
  const old = new DatabaseSync(path.join(usage, 'usage.sqlite'));
  old.exec(legacyUsageSchema);
  old.prepare("INSERT INTO events (id, source, document_key, path, timestamp) VALUES ('e-1', 'agent_report', 'root:README.md', 'README.md', '2026-10-01T10:00:00.000Z')").run();
  old.close();
  write(path.join(root, 'active/0001-existing/.atlas/statistics.jsonl'), JSON.stringify({ version: 1, at: '2026-10-02T10:00:00.000Z', model: 'claude-opus-5-5', session: null, tokens: null, step: null }) + '\nnot a report\n');
  const adopted = await adoptPlanningFolder(root, { home, name: 'shop-planning' });
  assert.ok(!existsSync(usage), 'the old document use is imported');
  assert.equal(adopted.to, path.join(home, 'planning', 'shop-planning'));
  assert.ok(!existsSync(root) && existsSync(path.join(adopted.to, '.git')));
  assert.deepEqual(adopted.rewritten, [{ id: 'shop', from: '../shop', to: path.join(directory, 'shop') }]);
  assert.deepEqual(adopted.statistics, { files: ['active/0001-existing/.atlas/statistics.jsonl'], reports: 1, invalid: 1, problems: [] });
  assert.ok(!existsSync(path.join(adopted.to, 'active/0001-existing/.atlas')), 'the statistics file is gone from the planning folder');
  withDatabase(home, database => {
    const project = database.projectByFolder(adopted.to)!;
    assert.equal(project.name, adopted.project);
    assert.equal((database.db.prepare("SELECT count(*) AS n FROM document_use WHERE project_id = ? AND source = 'agent_report'").get(project.id) as { n: number }).n, 1);
    assert.equal(storedReports(database, project.id).get('work-0001')?.length, 1);
  });
  const repositories = JSON.parse(read(adopted.to, 'planning.json')).repositories;
  assert.deepEqual(repositories.map((item: { path: string }) => item.path), ['.', path.join(directory, 'shop'), path.join(directory, 'tools')]);
  const other = planningFolder(directory, 'again');
  await assert.rejects(adoptPlanningFolder(other, { home, name: 'shop-planning' }), /already exists/);
  rmSync(path.join(other, '.git'), { recursive: true, force: true });
  await assert.rejects(adoptPlanningFolder(other, { home }), /not the top of a Git repository/);
});

test('adopting takes over a project row left for the target path, or refuses when the folder has a project of its own', async t => {
  const directory = temporary(t);
  const home = path.join(directory, 'home');
  // A row left for <home>/planning/kept, whose folder is gone, and a project for the folder being adopted.
  const target = path.join(home, 'planning', 'kept');
  mkdirSync(path.dirname(target), { recursive: true });
  const stale = path.join(realpathSync(path.dirname(target)), 'kept');
  const root = planningFolder(path.join(directory, 'first'));
  const [staleId, ownId] = withDatabase(home, database => [database.addProject(stale, 'Old', null, 'archived').id, database.addProject(realpathSync(root), 'main').id]);
  // A folder with a project of its own is another project: the row keeps its statistics, and nothing moves.
  await assert.rejects(adoptPlanningFolder(root, { home, name: 'kept' }), /The project Old, whose folder is gone, was last at .*kept.*choose another --name/);
  assert.ok(existsSync(root));
  withDatabase(home, database => {
    assert.equal(database.project(staleId)?.folder, stale);
    assert.equal(database.projectByFolder(realpathSync(root))?.id, ownId);
  });
  const adopted = await adoptPlanningFolder(root, { home, name: 'own' });
  assert.equal(adopted.reused, null);
  withDatabase(home, database => assert.equal(database.projectByFolder(adopted.to)?.id, ownId, 'the folder keeps its own project'));
  // Without a project of its own, the folder is taken for that project renamed or moved by hand: it
  // takes over the row with its statistics, active again, and says so.
  const second = planningFolder(path.join(directory, 'second'));
  const again = await adoptPlanningFolder(second, { home, name: 'kept' });
  assert.equal(again.reused, 'Old');
  withDatabase(home, database => {
    const project = database.projectByFolder(again.to)!;
    assert.equal(project.id, staleId);
    assert.equal(project.state, 'active');
  });
});
