import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validatePlanning } from './check.ts';
import { checkPaths, fileCheckers } from './checkPaths.ts';
import { adoptPlanningFolder } from './adopt.ts';
import { statisticsDirectory } from './storage.ts';
import { findPlanning, normalizeRemote, resolvePlanningFolder } from './resolve.ts';
import { acceptWork, addSteps, archiveWork, closeWork, createWork, removeStep, renameStep, reopenWork, setBlocked, setStepStatus, startWork, WorkError, workStatus } from './work.ts';

const today = { today: '2026-10-14' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Atlas Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8', windowsHide: true });

function temporary(t: TestContext) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'atlas-work-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(file: string, text: string) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); }
function plan(id: string, fields: Record<string, string> = {}) {
  const values: Record<string, string> = { title: '"Existing work"', repositories: '[shop]', created: '"2026-10-01"', updated: '"2026-10-02"', design_status: 'draft', implementation_status: 'not_started', accepted_at: 'null', completed_at: 'null', ...fields };
  return ['---', 'schema_version: 1', 'kind: plan', 'id: ' + id, ...Object.entries(values).map(([key, value]) => key + ': ' + value), 'supersedes: []', 'superseded_by: null', '---', '', '# Existing work', '', 'See [the other work](../0002-other/plan.md) and [the glossary](../../knowledge/glossary.md).', ''].join('\n');
}
/** A planning folder in a Git repository with work-0001 (draft) and an unregistered folder 0003. */
function planningFolder(directory: string, name = 'planning') {
  const root = path.join(directory, name);
  write(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'planning', name: 'Planning', path: '.' }, { id: 'shop', name: 'Shop', path: '../shop', remote: 'git@github.com:Example/Shop.git' }, { id: 'tools', name: 'Tools', path: path.join(directory, 'tools') }], work_items: [
    { id: 'work-0001', path: 'active/0001-existing', repositories: ['shop'], current_plan: 'active/0001-existing/plan.md' },
    { id: 'work-0002', path: 'active/0002-other', repositories: ['tools'], current_plan: 'active/0002-other/plan.md' },
  ] }, null, 2) + '\n');
  write(path.join(root, 'active/0001-existing/plan.md'), plan('work-0001'));
  write(path.join(root, 'active/0002-other/plan.md'), plan('work-0002', { repositories: '[tools]' }).replace('[the other work](../0002-other/plan.md)', '[the first](../0001-existing/plan.md#why)'));
  write(path.join(root, 'active/0003-unregistered/notes.md'), '# Notes\n');
  write(path.join(root, 'knowledge/glossary.md'), '# Glossary\n');
  write(path.join(root, 'README.md'), '# Planning\n\n- [Existing](active/0001-existing/plan.md)\n- [Ledger][ledger]\n\n[ledger]: <active/0001-existing/ledger.md>\n\n```\n[not a link](active/0001-existing/plan.md)\n```\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'Start');
  return root;
}
const read = (root: string, relative: string) => readFileSync(path.join(root, relative), 'utf8');
const errorsOf = (root: string) => validatePlanning(root).errors;

test('a work item is created under the next unused number, registered, and valid', async t => {
  const root = planningFolder(temporary(t));
  const before = read(root, 'planning.json');
  const created = await createWork(root, { title: 'Säve the "cart"', repositories: ['shop', 'tools'] }, today);
  assert.equal(created.workId, 'work-0004', 'numbers taken by registered work and unregistered folders are skipped');
  assert.equal(created.path, 'active/0004-save-the-cart');
  assert.deepEqual([created.designStatus, created.implementationStatus, created.created, created.updated, created.ledger], ['draft', 'not_started', '2026-10-14', '2026-10-14', null]);
  assert.deepEqual(created.changed, ['active/0004-save-the-cart/plan.md', 'planning.json']);
  assert.ok(read(root, 'planning.json').startsWith(before.slice(0, before.lastIndexOf('}\n  ]'))), 'the registry is extended, not rewritten');
  assert.deepEqual(JSON.parse(read(root, 'planning.json')).work_items.at(-1), { id: 'work-0004', path: 'active/0004-save-the-cart', repositories: ['shop', 'tools'], current_plan: 'active/0004-save-the-cart/plan.md' });
  assert.match(read(root, created.plan), /^title: "Säve the \\"cart\\""$/m);
  assert.deepEqual(errorsOf(root), []);
  const slugged = await createWork(root, { title: 'Other', repositories: ['shop'], slug: 'custom-name' }, today);
  assert.equal(slugged.path, 'active/0005-custom-name');
  for (const [request, message] of [
    [{ title: '', repositories: ['shop'] }, /title must be nonempty/],
    [{ title: 'Two\nlines', repositories: ['shop'] }, /one line/],
    [{ title: 'X', repositories: [] }, /Name the repositories/],
    [{ title: 'X', repositories: ['nope'] }, /Not registered in planning\.json: nope/],
    [{ title: 'X', repositories: ['shop'], slug: 'Bad Slug' }, /slug/],
  ] as const) await assert.rejects(createWork(root, request as never, today), message);
});

test('the design is accepted, then implementation starts with a ledger that records the selection', async t => {
  const root = planningFolder(temporary(t));
  await assert.rejects(startWork(root, 'work-0001', { steps: ['Build'] }, today), /accept it before implementation starts/);
  const accepted = await acceptWork(root, 'work-0001', today);
  assert.deepEqual([accepted.designStatus, accepted.acceptedAt, accepted.updated], ['accepted', '2026-10-14', '2026-10-14']);
  assert.match((await acceptWork(root, 'work-0001', today)).warnings[0], /already accepted on 2026-10-14/);
  assert.equal(read(root, 'active/0001-existing/plan.md'), plan('work-0001', { updated: '"2026-10-14"', design_status: 'accepted', accepted_at: '"2026-10-14"' }), 'only the changed lines are rewritten');
  const revision = git(root, 'rev-parse', 'HEAD').trim();
  const started = await startWork(root, 'work-0001', { steps: ['Build the cart', 'Review'] }, today);
  assert.equal(started.implementationStatus, 'in_progress');
  assert.deepEqual(started.steps, [{ title: 'Build the cart', status: 'todo' }, { title: 'Review', status: 'todo' }]);
  assert.equal(started.progress, '0 of 2 steps done · 2 left');
  assert.match(started.warnings[0], /uncommitted changes/, 'the accepted plan was not committed yet');
  const ledger = read(root, 'active/0001-existing/ledger.md');
  assert.ok(ledger.includes('steps:\n  - title: "Build the cart"\n    status: todo\n  - title: "Review"\n    status: todo\n---'));
  assert.ok(ledger.includes(`- **Selected plan:** \`active/0001-existing/plan.md\` at planning revision \`${revision}\`.`));
  assert.ok(ledger.includes('[plan](plan.md), accepted on 2026-10-14'));
  assert.deepEqual(errorsOf(root), []);
  await assert.rejects(startWork(root, 'work-0001', { steps: ['Again'] }, today), /already has a ledger/);
  await assert.rejects(startWork(root, 'work-0002', { steps: ['A', 'A'] }, today), /unique/);
  await assert.rejects(startWork(root, 'work-0002', { steps: [] }, today), /at least one/);
  await assert.rejects(startWork(root, 'work-0009', { steps: ['A'] }, today), /work-0009 is not registered/);
  await assert.rejects(startWork(root, 'nonsense', { steps: ['A'] }, today), /such as work-0001/);
});

test('steps are added, set, renamed and removed with a reason, and blocked is set and cleared', async t => {
  const root = planningFolder(temporary(t));
  await assert.rejects(addSteps(root, 'work-0001', ['X'], today), /no ledger yet/);
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
  await assert.rejects(removeStep(root, 'work-0001', 'Ship', '', today), /reason must be nonempty/);
  const removed = await removeStep(root, 'work-0001', 'Ship', 'Moved to work-0002', today);
  assert.deepEqual(removed.steps.map(step => step.title), ['Build', 'Test it']);
  assert.match(read(root, 'active/0001-existing/ledger.md'), /## Progress\n\n- 2026-10-14: implementation started\.\n- 2026-10-14: removed the step "Ship" \(todo\): Moved to work-0002\.\n$/);
  const blocked = await setBlocked(root, 'work-0001', 'Waiting for the API key', today);
  assert.equal(blocked.blocked, 'Waiting for the API key');
  assert.match(read(root, 'active/0001-existing/ledger.md'), /^blocked: "Waiting for the API key"$/m);
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
  // Work that never started, or whose ledger has no steps, has nothing to show as done.
  await acceptWork(root, 'work-0002', today);
  await assert.rejects(closeWork(root, 'work-0002', today), /no ledger: its implementation never started/);
  write(path.join(root, 'active/0002-other/ledger.md'), '---\nschema_version: 2\nkind: ledger\nwork_id: work-0002\nupdated: "2026-10-14"\nblocked: null\nsteps: []\n---\n\n# Ledger\n');
  await assert.rejects(closeWork(root, 'work-0002', today), /ledger has no steps/);
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
  assert.ok(read(root, 'archive/0001-existing/ledger.md').includes('[plan](plan.md)'));
  assert.ok(closed.changed.includes('README.md') && closed.changed.includes('active/0002-other/plan.md'));
  assert.deepEqual(errorsOf(root), []);
  await assert.rejects(archiveWork(root, 'work-0001', {}, today), /not in active/);
  await assert.rejects(reopenWork(root, 'work-0001', { steps: [] }, today), /Give the steps/);
  await assert.rejects(reopenWork(root, 'work-0001', { steps: ['Review'] }, today), /already has these steps: Review/);
  const reopened = await reopenWork(root, 'work-0001', { steps: ['Fix the follow-up'] }, { today: '2026-10-17' });
  assert.deepEqual([reopened.path, reopened.implementationStatus, reopened.completedAt, reopened.updated], ['active/0001-existing', 'in_progress', null, '2026-10-17']);
  assert.deepEqual(reopened.steps.at(-1), { title: 'Fix the follow-up', status: 'todo' });
  assert.match(read(root, 'active/0001-existing/ledger.md'), /- 2026-10-17: reopened with the step "Fix the follow-up"\./);
  assert.ok(read(root, 'README.md').includes('[Existing](active/0001-existing/plan.md)'));
  assert.deepEqual(errorsOf(root), []);
  // Work that is not complete is archived only as superseded or abandoned, with the reason recorded.
  await assert.rejects(archiveWork(root, 'work-0002', {}, today), /not complete: archive it as superseded/);
  await assert.rejects(archiveWork(root, 'work-0002', { disposition: 'abandoned' }, today), /reason/);
  await assert.rejects(archiveWork(root, 'work-0002', { disposition: 'superseded', supersededBy: 'work-0009' }, today), /work-0009 is not registered/);
  const archived = await archiveWork(root, 'work-0002', { disposition: 'abandoned', reason: 'The tools moved elsewhere.' }, today);
  assert.deepEqual([archived.path, archived.designStatus], ['archive/0002-other', 'abandoned']);
  assert.match(read(root, 'archive/0002-other/plan.md'), /## Outcome\n\n- 2026-10-14: Archived as abandoned: The tools moved elsewhere\.\n$/);
  assert.ok(read(root, 'active/0001-existing/plan.md').includes('[the other work](../../archive/0002-other/plan.md)'));
  assert.deepEqual(errorsOf(root), []);
  const status = await workStatus(root, 'work-0001');
  assert.deepEqual(status.statistics, { reports: 0, agentMinutes: 0, tokens: null, primaryModel: null });
  // Superseded work with open steps: the ledger says by what, and reopening accepts it again.
  await assert.rejects(archiveWork(root, 'work-0001', {}, today), (error: WorkError) => error.problems.includes('Step "Fix the follow-up" is todo.'));
  const superseded = await archiveWork(root, 'work-0001', { disposition: 'superseded', supersededBy: 'work-0002', reason: 'Folded into the tools work' }, today);
  assert.deepEqual([superseded.location, superseded.designStatus], ['archive', 'superseded']);
  assert.match(read(root, 'archive/0001-existing/plan.md'), /^superseded_by: "work-0002"$/m);
  assert.match(read(root, 'archive/0001-existing/ledger.md'), /- 2026-10-14: archived as superseded by work-0002: Folded into the tools work\.\n$/);
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

test('a checkout finds its planning folders in the home by remote, by path hint, and from inside', async t => {
  const directory = temporary(t);
  const home = path.join(directory, 'home');
  const root = planningFolder(path.join(home, 'planning'), 'main');
  planningFolder(path.join(home, 'planning'), 'unrelated').toString();
  writeFileSync(path.join(home, 'planning', 'unrelated', 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'x', name: 'X', remote: 'https://github.com/example/other' }], work_items: [] }));
  const shop = path.join(directory, 'shop');
  mkdirSync(shop);
  git(shop, 'init', '-q');
  git(shop, 'remote', 'add', 'origin', 'https://someone:secret-token@github.com/example/shop.git');
  mkdirSync(path.join(shop, 'src'));
  await acceptWork(root, 'work-0001', today);
  await startWork(root, 'work-0001', { steps: ['Build'] }, today);
  const where = await findPlanning(path.join(shop, 'src'), { home });
  assert.equal(where.checkout, realpathSync(shop));
  assert.deepEqual(where.remotes, ['https://github.com/example/shop.git'], 'credentials in a remote are never shown');
  assert.deepEqual(where.matches.map(match => [match.planningFolder, match.via, match.repositories]), [[root, ['remote'], ['shop']]]);
  assert.deepEqual(where.matches[0].work.map(item => [item.workId, item.title, item.designStatus, item.progress]), [['work-0001', 'Existing work', 'accepted', '0 of 1 step done · 1 left']]);
  // A repository without a remote matches by its absolute path hint.
  const tools = path.join(home, 'planning', 'tools'); // the fixture's absolute hint
  mkdirSync(tools);
  git(tools, 'init', '-q');
  const byPath = await findPlanning(tools, { home });
  assert.deepEqual(byPath.matches.map(match => [match.via, match.repositories, match.work.map(item => item.workId)]), [[['path'], ['tools'], ['work-0002']]]);
  // Inside the planning folder: its own repository and all of its active work.
  const inside = await findPlanning(path.join(root, 'active'), { home });
  assert.deepEqual(inside.matches.map(match => [match.via, match.repositories, match.work.map(item => item.workId)]), [[['inside'], ['planning'], []]]);
  const outside = await findPlanning(directory, { home });
  assert.deepEqual(outside.matches, []);
  assert.equal(await resolvePlanningFolder({ cwd: shop, home }), root);
  assert.equal(await resolvePlanningFolder({ planningFolder: root, home }), root);
  await assert.rejects(resolvePlanningFolder({ cwd: directory, home }), /No planning folder in the Atlas home/);
});

test('atlas check attributes findings to the files asked about and runs registered checkers', async t => {
  const root = planningFolder(temporary(t));
  writeFileSync(path.join(root, 'active/0001-existing/plan.md'), plan('work-0001').replace('title: "Existing work"', 'title: 1.5'));
  const [whole] = checkPaths([root]);
  assert.deepEqual(whole.errors, ['active/0001-existing/plan.md: ambiguous implicit YAML scalar; quote intended strings']);
  assert.deepEqual(checkPaths([path.join(root, 'active/0001-existing/plan.md')])[0].errors, whole.errors);
  assert.deepEqual(checkPaths([path.join(root, 'active/0002-other/plan.md')])[0].errors, [], 'another file has no findings');
  assert.deepEqual(checkPaths([path.join(root, 'active/0001-existing')])[0].errors, whole.errors, 'a folder gets the findings about its files');
  writeFileSync(path.join(root, 'planning.json'), read(root, 'planning.json').replace('"schema_version": 1', '"schema_version": 2'));
  assert.deepEqual(checkPaths([path.join(root, 'planning.json')])[0].errors, ['registry schema_version must be integer 1']);
  const outside = checkPaths([tmpdir()]);
  assert.match(outside[0].errors[0], /not inside a planning folder/);
  // Diagram files are checked as diagrams, with the line and column of each problem.
  write(path.join(root, 'active/0001-existing/model.puml'), '@startuml\nclass A\nclass B\nA -up-> B\n@enduml\n');
  const [diagram] = checkPaths([path.join(root, 'active/0001-existing/model.puml')]);
  assert.equal(diagram.errors.length, 1);
  assert.match(diagram.errors[0], /^active\/0001-existing\/model\.puml:4:\d+: .*remove the direction `up`/);
  // A whole folder's check finds them too; a proposal reads its baseline beside it, never outside the planning folder.
  write(path.join(root, 'active/0001-existing/model.puml'), '@startuml\nclass A\n@enduml\n');
  write(path.join(root, 'active/0001-existing/proposal.puml'), "@startuml\n' atlas proposal model.puml\nclass A\nclass B\n@enduml\n");
  write(path.join(root, 'active/0002-other/proposal.puml'), "@startuml\n' atlas proposal ../../../outside.puml\nclass A\n@enduml\n");
  write(path.join(root, '..', 'outside.puml'), '@startuml\nclass A\n@enduml\n');
  const errors = checkPaths([root])[0].errors.filter(error => error.includes('.puml'));
  assert.deepEqual(errors.map(error => error.split(':')[0]), ['active/0002-other/proposal.puml']);
  assert.match(errors[0], /outside\.puml does not exist/);
  // Other kinds of file can register their own checker.
  write(path.join(root, 'active/0001-existing/notes.txt'), 'x');
  fileCheckers.set('.txt', (_, file) => ({ errors: [file + ': checked'], warnings: [] }));
  t.after(() => fileCheckers.delete('.txt'));
  assert.ok(checkPaths([path.join(root, 'active/0001-existing/notes.txt')])[0].errors.includes('active/0001-existing/notes.txt: checked'));
});

test('a planning folder is adopted into the home with its path hints made absolute', async t => {
  const directory = temporary(t);
  const root = planningFolder(directory);
  const home = path.join(directory, 'home');
  await assert.rejects(adoptPlanningFolder(path.join(root, 'active'), { home }), /no planning\.json/);
  const usage = await statisticsDirectory(root, home);
  write(path.join(usage, 'usage.sqlite'), 'statistics');
  const adopted = await adoptPlanningFolder(root, { home, name: 'shop-planning' });
  assert.equal(read(await statisticsDirectory(adopted.to, home), 'usage.sqlite'), 'statistics', 'document use follows the folder');
  assert.ok(!existsSync(usage));
  assert.equal(adopted.to, path.join(home, 'planning', 'shop-planning'));
  assert.ok(!existsSync(root) && existsSync(path.join(adopted.to, '.git')));
  assert.deepEqual(adopted.rewritten, [{ id: 'shop', from: '../shop', to: path.join(directory, 'shop') }]);
  const repositories = JSON.parse(read(adopted.to, 'planning.json')).repositories;
  assert.deepEqual(repositories.map((item: { path: string }) => item.path), ['.', path.join(directory, 'shop'), path.join(directory, 'tools')]);
  const other = planningFolder(directory, 'again');
  await assert.rejects(adoptPlanningFolder(other, { home, name: 'shop-planning' }), /already exists/);
  rmSync(path.join(other, '.git'), { recursive: true, force: true });
  await assert.rejects(adoptPlanningFolder(other, { home }), /not the top of a Git repository/);
});
