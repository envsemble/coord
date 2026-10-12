// Work statistics: report grouping and token arithmetic, plan revisions from Git (following
// archive moves), recording with atlas work report, and how the reader and checker treat them.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validatePlanning } from './check.ts';
import { loadPlanning } from './planning.ts';
import { exportPlan } from './planExport.ts';
import { createReport, fitStep, parseReport, planRevisions, summarizeReports, StatisticsReportError, type StatisticsReport } from './statistics.ts';
import { recordWorkReport } from './workReport.ts';

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 11, 9, 0) + minutes * 60000).toISOString();
const report = (minutes: number, model: string, tokens: number | null = null, session: string | null = null): StatisticsReport => ({ version: 1, at: at(minutes), model, session, tokens, step: null });

test('a session sums the time between its reports and counts tokens from its first report on', () => {
  const summary = summarizeReports([
    report(0, 'model-a', 1000, 's1'), report(30, 'model-a', 4000, 's1'),
    report(30, 'model-a', 4000, 's1'), // a repeated report adds nothing
    report(90, 'model-b', 9000, 's1'), // a switch of model: the last hour and 5,000 tokens are model-b's
  ]);
  assert.equal(summary.reports, 4);
  assert.equal(summary.activeMs, 90 * 60000);
  assert.equal(summary.tokens, 8000, 'the first report is the starting point: tokens spent before this work are not counted');
  assert.deepEqual(summary.models.map(item => [item.model, item.activeMs / 60000, item.tokens, item.sessions]), [['model-b', 60, 5000, 1], ['model-a', 30, 3000, 1]]);
  assert.equal(summary.primaryModel, 'model-b');
  assert.equal(summary.firstReport, at(0));
  assert.equal(summary.lastReport, at(90));
});

test('a break of more than two hours is not active time, in a session or without one', () => {
  const session = summarizeReports([report(0, 'model-a', 100, 's1'), report(30, 'model-a', 200, 's1'), report(24 * 60 + 30, 'model-a', 900, 's1')]);
  assert.equal(session.activeMs, 30 * 60000, 'an overnight gap in a resumed session is a break');
  assert.equal(session.tokens, 800, 'its tokens still count');
  const summary = summarizeReports([report(0, 'model-a'), report(60, 'model-a'), report(60 + 121, 'model-a'), report(60 + 150, 'model-a'), report(10, 'model-c')]);
  assert.equal(summary.activeMs, (60 + 29) * 60000, 'the gap of 121 minutes starts a new run');
  assert.equal(summary.models.find(item => item.model === 'model-a')!.sessions, 2);
  assert.equal(summary.models.find(item => item.model === 'model-c')!.activeMs, 0);
  assert.equal(summary.tokens, null, 'no tokens were reported');
  const clash = summarizeReports([report(0, 'model-a', null, 'run-1'), report(10, 'model-a', null, null)]);
  assert.equal(clash.models[0].sessions, 2, 'a session named like a generated run stays separate');
});

test('a lower token count starts the session again, and out-of-order lines are sorted by time', () => {
  const summary = summarizeReports([report(20, 'model-a', 500, 's1'), report(0, 'model-a', 8000, 's1'), report(10, 'model-a', 9000, 's1')]);
  assert.equal(summary.tokens, 1000 + 500);
  assert.equal(summarizeReports([report(0, 'model-a', 7000, 's1')]).tokens, null, 'one report is a starting point only: its cost is unknown, not zero');
  assert.deepEqual(summarizeReports([]), { reports: 0, invalid: 0, models: [], primaryModel: null, tokens: null, activeMs: 0, firstReport: null, lastReport: null });
});

test('reports are validated when written and when read', () => {
  assert.throws(() => createReport({ model: 'two words' }), StatisticsReportError);
  assert.throws(() => createReport({ model: 'model-a', tokens: -1 }), StatisticsReportError);
  assert.throws(() => createReport({ model: 'model-a', tokens: 1.5 }), StatisticsReportError);
  assert.throws(() => createReport({ model: 'model-a', session: 'has space' }), StatisticsReportError);
  assert.throws(() => createReport({ model: 'model-a', step: 'two\nlines' }), StatisticsReportError);
  assert.equal(createReport({ model: 'vendor/model-1.5@2026', step: '  Trimmed  ' }).step, 'Trimmed');
  assert.equal(createReport({ model: 'model-x[1m]' }).model, 'model-x[1m]', 'bracketed model variants');
  assert.equal(createReport({ model: 'model-a', step: '' }).step, null);
  assert.deepEqual(fitStep('Two\nlines'), { step: 'Two lines', note: 'The step was recorded as one line.', shortened: false });
  assert.equal(fitStep('x'.repeat(300)).step!.length, 200);
  assert.equal(fitStep('A \u202eright-to-left\u202c step').step, 'A right-to-left step');
  assert.equal(fitStep('A \u202eright-to-left\u202c step').note, 'Control characters were removed from the step.');
  const emoji = fitStep('x'.repeat(198) + '\u{1F600}\u{1F600}').step!;
  assert.ok(!/[\ud800-\udbff]\u2026$/.test(emoji), 'never half of an emoji before the ellipsis');
  const valid = JSON.stringify(report(0, 'model-a', 10, 's1'));
  assert.deepEqual(parseReport(valid), report(0, 'model-a', 10, 's1'));
  for (const line of ['not json', '[]', '{}', valid.replace('"version":1', '"version":2'), valid.replace(at(0), 'yesterday'), valid.replace(at(0), '2026-02-30T09:00:00.000Z'), valid.replace(at(0), '2026-10-11T09:00:00'), valid.replace('"tokens":10', '"tokens":"10"'), JSON.stringify({ ...report(0, 'model-a'), step: 'x'.repeat(5000) })]) {
    assert.equal(parseReport(line), null, line);
  }
});

function git(root: string, date: string, ...args: string[]) {
  execFileSync('git', ['-C', root, '-c', 'user.name=Atlas test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore', windowsHide: true, env: { ...process.env, GIT_AUTHOR_DATE: date + 'T12:00:00Z', GIT_COMMITTER_DATE: date + 'T12:00:00Z' } });
}
const planText = (id: string, body: string, completed: string | null = null) => ['---', 'schema_version: 1', 'kind: plan', 'id: ' + id, 'title: "Example"', 'repositories: [example]', 'created: "2026-10-01"', 'updated: "2026-10-05"', 'design_status: accepted', 'implementation_status: ' + (completed ? 'complete' : 'in_progress'), 'accepted_at: "2026-10-01"', 'completed_at: ' + (completed ? '"' + completed + '"' : 'null'), 'supersedes: []', 'superseded_by: null', '---', '', '# Example', '', body, ''].join('\n');

function repository(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'atlas-statistics-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const register = (folder: string) => writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: [{ id: 'work-0001', path: folder, repositories: ['example'], current_plan: folder + '/plan.md' }] }, null, 2) + '\n');
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

test('reports are never written through a linked .atlas folder, and a file without a final newline gets one', async t => {
  const { root, register } = repository(t);
  const folder = 'active/0001-example';
  mkdirSync(path.join(root, folder), { recursive: true });
  register(folder);
  writeFileSync(path.join(root, folder, 'plan.md'), planText('work-0001', 'Body.'));
  mkdirSync(path.join(root, folder, '.atlas'));
  writeFileSync(path.join(root, folder, '.atlas/statistics.jsonl'), JSON.stringify(report(0, 'model-a')));
  await recordWorkReport(root, 'work-0001', { model: 'model-a' });
  const lines = readFileSync(path.join(root, folder, '.atlas/statistics.jsonl'), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.ok(lines.every(line => parseReport(line)));
  const long = await recordWorkReport(root, 'work-0001', { model: 'model-a', step: 'x'.repeat(300) });
  assert.match(long.warnings.join(' '), /shortened to 200/);
  writeFileSync(path.join(root, folder, 'ledger.md'), ['---', 'schema_version: 2', 'kind: ledger', 'work_id: work-0001', 'updated: null', 'blocked: null', 'steps:', '  - title: "Build  the  thing"', '    status: doing', '---', ''].join('\n'));
  assert.deepEqual((await recordWorkReport(root, 'work-0001', { model: 'model-a', step: 'Build  the  thing' })).warnings, [], 'a title with double spaces is still the ledger\'s step');

  // A junction (Windows, no rights needed) or a symbolic link to a folder outside.
  const other = 'active/0002-other';
  mkdirSync(path.join(root, other), { recursive: true });
  const outside = mkdtempSync(path.join(tmpdir(), 'atlas-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, path.join(root, other, '.atlas'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: [
    { id: 'work-0001', path: folder, repositories: ['example'], current_plan: folder + '/plan.md' },
    { id: 'work-0002', path: other, repositories: ['example'], current_plan: null },
  ] }));
  await assert.rejects(recordWorkReport(root, 'work-0002', { model: 'model-a' }), /link or not a folder/);
  assert.deepEqual(readdirSync(outside), [], 'nothing was written outside');
  assert.ok(validatePlanning(root).warnings.some(warning => warning.includes('0002-other/.atlas: a link')));
});

test('atlas work report appends to the work folder, which the reader summarizes and plan exports leave out', async t => {
  const { root, register } = repository(t);
  const folder = 'active/0001-example';
  mkdirSync(path.join(root, folder), { recursive: true });
  register(folder);
  writeFileSync(path.join(root, folder, 'plan.md'), planText('work-0001', 'Body.'));
  writeFileSync(path.join(root, folder, 'ledger.md'), ['---', 'schema_version: 2', 'kind: ledger', 'work_id: work-0001', 'updated: null', 'blocked: null', 'steps:', '  - title: "Build it"', '    status: doing', '---', '', '# Ledger', ''].join('\n'));
  const first = await recordWorkReport(root, 'work-0001', { model: 'model-a', tokens: 1000, session: 's1', step: 'Build it', at: new Date(at(0)) });
  assert.equal(first.file, folder + '/.atlas/statistics.jsonl');
  assert.deepEqual(first.warnings, []);
  const second = await recordWorkReport(root, 'work-0001', { model: 'model-a', tokens: 3000, session: 's1', step: 'Ship it', at: new Date(at(45)) });
  assert.match(second.warnings[0], /not one of the ledger's steps/);
  await assert.rejects(recordWorkReport(root, 'work-0002', { model: 'model-a' }), /not a registered work item/);
  await assert.rejects(recordWorkReport(root, 'work-0001', { model: 'model a' }), StatisticsReportError);
  assert.equal(readFileSync(path.join(root, first.file), 'utf8').trim().split('\n').length, 2);

  appendFileSync(path.join(root, first.file), 'garbage\n');
  const statistics = (await loadPlanning(root)).work[0].statistics!;
  assert.deepEqual({ reports: statistics.reports, invalid: statistics.invalid, tokens: statistics.tokens, minutes: statistics.activeMs / 60000, model: statistics.primaryModel }, { reports: 2, invalid: 1, tokens: 2000, minutes: 45, model: 'model-a' });
  assert.equal(statistics.planRevisions, null, 'no Git history');
  assert.ok(validatePlanning(root).warnings.some(warning => warning.includes('statistics.jsonl: 1 line is not a valid statistics report')));
  assert.deepEqual(validatePlanning(root).errors, []);

  const exported = await exportPlan(root, 'work-0001');
  assert.ok(!exported.manifest.files.some(file => file.path.endsWith('statistics.jsonl')), 'plan exports leave the statistics out');
});

test('reports never follow a symbolic link out of the work folder', { skip: process.platform === 'win32' ? 'Symbolic links need extra rights on Windows.' : false }, async t => {
  const { root, register } = repository(t);
  const folder = 'active/0001-example';
  mkdirSync(path.join(root, folder, '.atlas'), { recursive: true });
  register(folder);
  writeFileSync(path.join(root, folder, 'plan.md'), planText('work-0001', 'Body.'));
  const outside = mkdtempSync(path.join(tmpdir(), 'atlas-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(path.join(outside, 'target.jsonl'), JSON.stringify(report(0, 'model-a')) + '\n');
  symlinkSync(path.join(outside, 'target.jsonl'), path.join(root, folder, '.atlas/statistics.jsonl'));
  await assert.rejects(recordWorkReport(root, 'work-0001', { model: 'model-a' }), /not a regular file/);
  assert.equal(readFileSync(path.join(outside, 'target.jsonl'), 'utf8').trim().split('\n').length, 1);
  assert.equal((await loadPlanning(root)).work[0].statistics?.reports, 0);
});
