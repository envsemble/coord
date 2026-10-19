// Work statistics: report grouping, measured and estimated agent time and token arithmetic,
// recording with atlas work report into the home database (measuring a synthetic session log),
// importing old statistics files, and how the reader summarizes them. Plan revisions from Git are in
// statistics.slow.test.ts.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validatePlanning } from '../check/check.ts';
import { loadPlanning } from '../reading/planning.ts';
import { exportPlan } from '../export/planExport.ts';
import { createReport, fitStep, importStatisticsFiles, insertReport, parseReport, storedReports, summarizeReports, StatisticsReportError, type Measured, type MeasuredSubagents, type StatisticsReport } from './statistics.ts';
import { withDatabase, withDatabaseAsync } from '../home/database.ts';
import type { WorkStage } from '../types.ts';
import { recordWorkReport, remeasureReports } from './workReport.ts';

// Reports made here never measure the developer's own session: no harness session, no logs at home.
delete process.env.CLAUDE_CODE_SESSION_ID;
delete process.env.CODEX_THREAD_ID;
const noLogs = mkdtempSync(path.join(tmpdir(), 'atlas-no-logs-'));
process.env.CLAUDE_CONFIG_DIR = path.join(noLogs, 'claude');
process.env.CODEX_HOME = path.join(noLogs, 'codex');
test.after(() => rmSync(noLogs, { recursive: true, force: true }));

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 11, 9, 0) + minutes * 60000).toISOString();
const report = (minutes: number, model: string, tokens: number | null = null, session: string | null = null): StatisticsReport => ({ version: 1, at: at(minutes), model, session, tokens, step: null });
type Share = [model: string, minutes: number, tokens: [input: number, cacheRead: number, cacheWrite: number, output: number]];
const measurement = (since: number, minutes: number, shares: Share[]): Measured => ({ since: at(since), agentMs: minutes * 60000, models: shares.map(([model, time, [input, cacheRead, cacheWrite, output]]) => ({ model, agentMs: time * 60000, input, cacheRead, cacheWrite, output })) });
const measured = (minutes: number, model: string, session: string, since: number, agentMinutes: number, shares: Share[]): StatisticsReport => ({ ...report(minutes, model, null, session), measured: measurement(since, agentMinutes, shares) });
/** A work item's reports in the test home's database. */
const reportsOf = (root: string, workId: string) => withDatabase(undefined, database => {
  const project = database.projectByFolder(realpathSync.native(root));
  return project ? storedReports(database, project.id, [workId]).get(workId) ?? [] : [];
});

test('a session sums the time between its reports and counts tokens from its first report on', () => {
  const summary = summarizeReports([
    report(0, 'model-a', 1000, 's1'), report(30, 'model-a', 4000, 's1'),
    report(30, 'model-a', 4000, 's1'), // a repeated report adds nothing
    report(90, 'model-b', 9000, 's1'), // a switch of model: the last hour and 5,000 tokens are model-b's
  ]);
  assert.equal(summary.reports, 4);
  assert.equal(summary.agentMs, 90 * 60000);
  assert.equal(summary.tokens, 8000, 'the first report is the starting point: tokens spent before this work are not counted');
  assert.deepEqual(summary.models.map(item => [item.model, item.agentMs / 60000, item.tokens, item.sessions]), [['model-b', 60, 5000, 1], ['model-a', 30, 3000, 1]]);
  assert.equal(summary.primaryModel, 'model-b');
  assert.equal(summary.firstReport, at(0));
  assert.equal(summary.lastReport, at(90));
});

test('a break of more than two hours between unmeasured reports is not agent time, in a session or without one', () => {
  const session = summarizeReports([report(0, 'model-a', 100, 's1'), report(30, 'model-a', 200, 's1'), report(24 * 60 + 30, 'model-a', 900, 's1')]);
  assert.equal(session.agentMs, 30 * 60000, 'an overnight gap in a resumed session is a break');
  assert.equal(session.tokens, 800, 'its tokens still count');
  const summary = summarizeReports([report(0, 'model-a'), report(60, 'model-a'), report(60 + 121, 'model-a'), report(60 + 150, 'model-a'), report(10, 'model-c')]);
  assert.equal(summary.agentMs, (60 + 29) * 60000, 'the gap of 121 minutes starts a new run');
  assert.equal(summary.models.find(item => item.model === 'model-a')!.sessions, 2);
  assert.equal(summary.models.find(item => item.model === 'model-c')!.agentMs, 0);
  assert.equal(summary.tokens, null, 'no tokens were reported');
  const clash = summarizeReports([report(0, 'model-a', null, 'run-1'), report(10, 'model-a', null, null)]);
  assert.equal(clash.models[0].sessions, 2, 'a session named like a generated run stays separate');
});

test('a lower token count starts the session again, and out-of-order lines are sorted by time', () => {
  const summary = summarizeReports([report(20, 'model-a', 500, 's1'), report(0, 'model-a', 8000, 's1'), report(10, 'model-a', 9000, 's1')]);
  assert.equal(summary.tokens, 1000 + 500);
  assert.equal(summarizeReports([report(0, 'model-a', 7000, 's1')]).tokens, null, 'one report is a starting point only: its cost is unknown, not zero');
  const none = { reports: 0, agentMs: 0, tokens: null, tokenKinds: null };
  assert.deepEqual(summarizeReports([]), { reports: 0, invalid: 0, models: [], primaryModel: null, tokens: null, tokenKinds: null, agentMs: 0, measuredMs: 0, estimatedMs: 0, measuredReports: 0, activeMs: 0, unmergedMs: 0, agents: [], stages: { planning: none, implementation: none, unknown: none }, subagents: { count: 0, agentMs: 0 }, firstReport: null, lastReport: null });
});

test('a measured report replaces the estimate for its interval, long gaps included; older reports keep the estimate', () => {
  const session = '5752382d-8571-4733-a9e9-0db82c361b65';
  const summary = summarizeReports([
    report(0, 'claude-opus-5-5', null, session), // the starting point
    measured(90, 'claude-opus-5-5', session, 0, 70, [['claude-opus-5-5', 70, [10, 5000, 300, 900]], ['claude-haiku-5-5', 20, [5, 1000, 100, 200]]]),
    // Six hours later: an estimate would call it a break; the log shows 200 minutes of work.
    measured(450, 'claude-opus-5-5', session, 90, 200, [['claude-opus-5-5', 200, [20, 9000, 500, 1500]]]),
    // An older Atlas's reports of another session: estimated from report times, tokens self-reported.
    report(0, 'model-alpha-2', 1000, 'session-b'), report(30, 'model-alpha-2', 4000, 'session-b'),
  ]);
  assert.deepEqual([summary.measuredMs / 60000, summary.estimatedMs / 60000, summary.agentMs / 60000, summary.measuredReports], [270, 30, 300, 2]);
  assert.deepEqual(summary.models.map(item => [item.model, item.agentMs / 60000, item.tokens, item.reports, item.sessions]), [['claude-opus-5-5', 270, 17230, 3, 1], ['model-alpha-2', 30, 3000, 2, 1], ['claude-haiku-5-5', 20, 1305, 0, 1]]);
  assert.deepEqual(summary.models[0].tokenKinds, { input: 30, cacheRead: 14000, cacheWrite: 800, output: 2400 });
  assert.equal(summary.models[1].tokenKinds, null, 'self-reported tokens have no kinds');
  assert.deepEqual(summary.tokenKinds, { input: 35, cacheRead: 15000, cacheWrite: 900, output: 2600 });
  assert.equal(summary.tokens, 17230 + 1305 + 3000);
  assert.equal(summary.primaryModel, 'claude-opus-5-5');
  // A helper that worked longer than the main agent is the model that did most of the work.
  const helper = summarizeReports([report(0, 'claude-opus-5-5', null, session), measured(60, 'claude-opus-5-5', session, 0, 50, [['claude-haiku-5-5', 50, [0, 0, 0, 10]], ['claude-opus-5-5', 5, [0, 0, 0, 900]]])]);
  assert.equal(helper.primaryModel, 'claude-haiku-5-5');
  const quiet = summarizeReports([report(0, 'claude-opus-5-5', null, session), measured(60, 'claude-opus-5-5', session, 0, 0, [])]);
  assert.deepEqual([quiet.tokens, quiet.tokenKinds, quiet.agentMs], [0, { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, 0], 'a measurement of nothing is a known zero');
});

test('measured reports are validated when written and read, and stay readable to older versions', () => {
  const valid = createReport({ model: 'claude-opus-5-5', session: 's'.repeat(128), step: '"'.repeat(200), at: new Date(at(60)), measured: measurement(0, 50, Array.from({ length: 8 }, (_, index): Share => [String(index).repeat(100), 50, [1e12, 1e12, 1e12, 1e12]])) });
  const line = JSON.stringify(valid);
  assert.ok(line.length < 3000, 'the longest step, session and model names with the largest counts stay well inside a line: ' + line.length);
  assert.deepEqual(parseReport(line), valid);
  assert.deepEqual(Object.keys(JSON.parse(line)), ['version', 'at', 'model', 'session', 'tokens', 'step', 'measured'], 'version 1 with every field older versions read');
  assert.equal(JSON.stringify(createReport({ model: 'model-a', at: new Date(at(0)) })).includes('measured'), false, 'an unmeasured report is written as before');
  const extra = { ...measurement(0, 5, [['model-a', 5, [1, 2, 3, 4]]]), harness: 'future' };
  assert.deepEqual(parseReport(JSON.stringify({ ...report(10, 'model-a'), measured: extra }))?.measured, measurement(0, 5, [['model-a', 5, [1, 2, 3, 4]]]), 'fields a later version adds are left out');
  const invalid: unknown[] = [
    [], 'yes', { ...measurement(0, 5, []), since: at(61) }, { ...measurement(0, 5, []), since: 'yesterday' }, { ...measurement(0, 5, []), since: '2026-02-30T09:00:00.000Z' },
    measurement(0, 61, []), measurement(0, -1, []), { ...measurement(0, 5, []), agentMs: 1.5 }, measurement(30, 31, []),
    measurement(0, 5, [['model-a', 6, [0, 0, 0, 0]]]), measurement(0, 5, [['model a', 1, [0, 0, 0, 0]]]), measurement(0, 5, [['model-a', 1, [0, 0, 0, 0]], ['model-a', 1, [0, 0, 0, 0]]]),
    measurement(0, 5, [['model-a', 1, [-1, 0, 0, 0]]]), measurement(0, 5, [['model-a', 1, [0, 0.5, 0, 0]]]), measurement(0, 5, [['model-a', 1, [0, 0, 1e13, 0]]]),
    { ...measurement(0, 5, []), models: [{ model: 'model-a', agentMs: 0, input: 0, cacheRead: 0, cacheWrite: 0 }] }, { since: at(0), agentMs: 0 },
  ];
  for (const value of invalid) {
    assert.throws(() => createReport({ model: 'model-a', at: new Date(at(60)), measured: value as Measured }), StatisticsReportError, JSON.stringify(value));
    assert.deepEqual(parseReport(JSON.stringify({ ...report(60, 'model-a'), measured: value })), report(60, 'model-a'), 'read without the measurement: ' + JSON.stringify(value));
  }
  assert.equal(parseReport(JSON.stringify({ ...report(60, 'model a'), measured: measurement(0, 5, []) })), null, 'the rest of the report must still be valid');
  // Reports name at most eight models; one with more, from a later version, is still read.
  const nine = { ...measurement(0, 5, []), models: Array.from({ length: 9 }, (_, index) => ({ model: 'm' + index, agentMs: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })) };
  assert.throws(() => createReport({ model: 'model-a', at: new Date(at(60)), measured: nine }), StatisticsReportError);
  assert.equal(parseReport(JSON.stringify({ ...report(60, 'model-a'), measured: nine }))?.measured?.models.length, 9);
});

test('two agents of a session reporting at once measure from the same report: what an earlier report covered counts once', () => {
  const session = '5752382d-8571-4733-a9e9-0db82c361b65';
  const summary = summarizeReports([
    report(0, 'claude-opus-5-5', null, session),
    measured(60, 'claude-opus-5-5', session, 0, 60, [['claude-opus-5-5', 60, [0, 6000, 0, 600]]]),
    // A second helper read the file before the first report was written: its interval overlaps by 60 of 80 minutes.
    measured(80, 'claude-opus-5-5', session, 0, 80, [['claude-opus-5-5', 80, [0, 8000, 0, 800]]]),
  ]);
  assert.deepEqual([summary.agentMs / 60000, summary.tokens], [80, 6600 + 2200], 'the second counts its last 20 minutes, and a quarter of its tokens');
});

type Helper = [id: string, model: string | null, minutes: number, tokens: number];
const helpers = (count: number, minutes: number, tokens: number, agents: Helper[]): MeasuredSubagents => ({ count, agentMs: minutes * 60000, tokens, agents: agents.map(([id, model, time, spent]) => ({ id, model, agentMs: time * 60000, tokens: spent })) });

test('agent time and tokens add up by stage, and each subagent counts once however many reports list it', () => {
  const session = '5752382d-8571-4733-a9e9-0db82c361b65';
  const staged = (stage: WorkStage, entry: StatisticsReport, subagents?: MeasuredSubagents): StatisticsReport => ({ ...entry, stage, ...(subagents && { measured: { ...entry.measured!, subagents } }) });
  const summary = summarizeReports([
    // From before stages were recorded: estimated, with self-reported tokens.
    report(0, 'model-alpha-2', 1000, 'session-b'), report(30, 'model-alpha-2', 4000, 'session-b'),
    staged('planning', report(0, 'claude-opus-5-5', null, session)),
    staged('planning', measured(60, 'claude-opus-5-5', session, 0, 50, [['claude-opus-5-5', 50, [0, 1000, 0, 100]]])),
    staged('implementation', measured(120, 'claude-opus-5-5', session, 60, 40, [['claude-opus-5-5', 40, [0, 2000, 0, 200]], ['claude-haiku-5-5', 30, [0, 500, 0, 50]]]), helpers(2, 45, 550, [['a1', 'claude-haiku-5-5', 30, 550], ['a2', null, 15, 0]])),
    // Another agent of the session at the same moment, from the same report: nothing new, no new subagent.
    staged('implementation', measured(120, 'claude-opus-5-5', session, 60, 40, [['claude-opus-5-5', 40, [0, 2000, 0, 200]]]), helpers(1, 40, 0, [['a6', null, 40, 0]])),
    // Six subagents, four listed: a1 again, three new, and two more unlisted.
    staged('implementation', measured(180, 'claude-opus-5-5', session, 120, 30, [['claude-opus-5-5', 30, [0, 0, 0, 10]]]), helpers(6, 60, 0, [['a1', 'claude-haiku-5-5', 20, 0], ['a3', null, 10, 0], ['a4', null, 10, 0], ['a5', null, 10, 0]])),
  ]);
  assert.deepEqual(summary.stages, {
    planning: { reports: 2, agentMs: 50 * 60000, tokens: 1100, tokenKinds: { input: 0, cacheRead: 1000, cacheWrite: 0, output: 100 } },
    implementation: { reports: 3, agentMs: 70 * 60000, tokens: 2760, tokenKinds: { input: 0, cacheRead: 2500, cacheWrite: 0, output: 260 } },
    unknown: { reports: 2, agentMs: 30 * 60000, tokens: 3000, tokenKinds: null },
  });
  assert.equal(summary.agentMs, 150 * 60000, 'the stages add up to the whole');
  assert.equal(summary.tokens, 1100 + 2760 + 3000);
  assert.deepEqual(summary.subagents, { count: 5 + 2, agentMs: (45 + 60) * 60000 }, 'a1 to a5 and the two unlisted; a6 came with an interval already covered');
  // The same subagent identifier in another session is another subagent.
  const other = summarizeReports([report(0, 'model-a', null, 's1'), measured(10, 'model-a', 's1', 0, 10, []), report(0, 'model-a', null, 's2'), measured(10, 'model-a', 's2', 0, 10, [])].map(entry => entry.measured ? staged('implementation', entry, helpers(1, 5, 0, [['a1', null, 5, 0]])) : entry));
  assert.deepEqual(other.subagents, { count: 2, agentMs: 10 * 60000 });
});

test('stages and subagents are validated when written and read leniently: a line without a stage is from before stages', () => {
  const valid = createReport({ model: 'model-a', at: new Date(at(60)), stage: 'implementation', measured: { ...measurement(0, 50, [['model-a', 50, [1, 2, 3, 4]]]), subagents: helpers(5, 100, 10, [['a1', 'model-a', 50, 10], ['a2', null, 50, 0]]) } });
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(valid))), ['version', 'at', 'model', 'session', 'tokens', 'step', 'stage', 'measured']);
  assert.deepEqual(parseReport(JSON.stringify(valid)), valid);
  assert.equal(parseReport(JSON.stringify(report(0, 'model-a')))!.stage, undefined, 'unknown');
  assert.throws(() => createReport({ model: 'model-a', stage: 'review' as WorkStage }), StatisticsReportError);
  assert.deepEqual(parseReport(JSON.stringify({ ...report(0, 'model-a'), stage: 'review' })), report(0, 'model-a'), 'a stage this version does not know is unknown');
  const invalid: unknown[] = [
    'yes', [], { ...helpers(1, 5, 0, []), count: -1 }, helpers(1, 61, 0, []), helpers(1, 5, -1, []), helpers(1, 5, 0, [['a1', null, 5, 0], ['a2', null, 5, 0]]),
    helpers(2, 5, 0, [['a 1', null, 5, 0]]), helpers(2, 5, 0, [['a1', 'model a', 5, 0]]), helpers(2, 5, 0, [['a1', null, 61, 0]]), helpers(2, 5, 0, [['a1', null, 5, 0.5]]),
    helpers(2, 5, 0, [['a1', null, 1, 0], ['a1', null, 1, 0]]), { ...helpers(1, 5, 0, []), agents: undefined },
  ];
  for (const subagents of invalid) {
    const value = { ...measurement(0, 5, []), subagents } as Measured;
    assert.throws(() => createReport({ model: 'model-a', at: new Date(at(60)), measured: value }), StatisticsReportError, JSON.stringify(subagents));
    assert.deepEqual(parseReport(JSON.stringify({ ...report(60, 'model-a'), measured: value }))?.measured, measurement(0, 5, []), 'the measurement is read without them: ' + JSON.stringify(subagents));
  }
  // Reports list at most four subagents; one listing more, from a later version, is still read.
  const five = helpers(5, 5, 0, ['a1', 'a2', 'a3', 'a4', 'a5'].map((id): Helper => [id, null, 1, 0]));
  assert.throws(() => createReport({ model: 'model-a', at: new Date(at(60)), measured: { ...measurement(0, 5, []), subagents: five } }), StatisticsReportError);
  assert.equal(parseReport(JSON.stringify({ ...report(60, 'model-a'), measured: { ...measurement(0, 5, []), subagents: five } }))?.measured?.subagents?.agents.length, 5);
  // The longest of everything still fits the line older versions read (4,096 characters).
  const longest = createReport({ model: 'model-a', session: 's'.repeat(128), step: '"'.repeat(200), stage: 'implementation', at: new Date(at(60)), measured: {
    ...measurement(0, 50, Array.from({ length: 8 }, (_, index): Share => [String(index).repeat(100), 50, [1e12, 1e12, 1e12, 1e12]])),
    subagents: { count: 1e6, agentMs: 1e6 * 3600000, tokens: 1e12, agents: Array.from({ length: 4 }, (_, index) => ({ id: String(index).repeat(64), model: String(index).repeat(100), agentMs: 3600000, tokens: 1e12 })) },
  } });
  const line = JSON.stringify(longest);
  assert.ok(line.length <= 4096, 'longest line: ' + line.length);
  assert.deepEqual(parseReport(line), longest);
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

const planText = (id: string, body: string, completed: string | null = null) => ['---', 'schema_version: 1', 'kind: plan', 'id: ' + id, 'title: "Example"', 'repositories: [example]', 'created: "2026-10-01"', 'updated: "2026-10-05"', 'design_status: accepted', 'implementation_status: ' + (completed ? 'complete' : 'in_progress'), 'accepted_at: "2026-10-01"', 'completed_at: ' + (completed ? '"' + completed + '"' : 'null'), 'supersedes: []', 'superseded_by: null', '---', '', '# Example', '', body, ''].join('\n');

function repository(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'atlas-statistics-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const register = (folder: string) => writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: [{ id: 'work-0001', path: folder, repositories: ['example'], current_plan: folder + '/plan.md' }] }, null, 2) + '\n');
  return { root, register };
}

test('a long step is shortened, and a step with doubled spaces is still the ledger\'s', async t => {
  const { root, register } = repository(t);
  const folder = 'active/0001-example';
  mkdirSync(path.join(root, folder), { recursive: true });
  register(folder);
  writeFileSync(path.join(root, folder, 'plan.md'), planText('work-0001', 'Body.'));
  const long = await recordWorkReport(root, 'work-0001', { model: 'model-a', step: 'x'.repeat(300) });
  assert.match(long.warnings.join(' '), /shortened to 200/);
  writeFileSync(path.join(root, folder, 'ledger.md'), ['---', 'schema_version: 2', 'kind: ledger', 'work_id: work-0001', 'updated: null', 'blocked: null', 'steps:', '  - title: "Build  the  thing"', '    status: doing', '---', ''].join('\n'));
  assert.deepEqual((await recordWorkReport(root, 'work-0001', { model: 'model-a', step: 'Build  the  thing' })).warnings, [], 'a title with double spaces is still the ledger\'s step');
  assert.equal(reportsOf(root, 'work-0001').length, 2);
});

test('atlas work report records into the home database, which the reader summarizes; old statistics files are imported once', async t => {
  const { root, register } = repository(t);
  const folder = 'active/0001-example';
  mkdirSync(path.join(root, folder), { recursive: true });
  register(folder);
  writeFileSync(path.join(root, folder, 'plan.md'), planText('work-0001', 'Body.'));
  writeFileSync(path.join(root, folder, 'ledger.md'), ['---', 'schema_version: 2', 'kind: ledger', 'work_id: work-0001', 'updated: null', 'blocked: null', 'steps:', '  - title: "Build it"', '    status: doing', '---', '', '# Ledger', ''].join('\n'));
  const first = await recordWorkReport(root, 'work-0001', { model: 'model-a', tokens: 1000, session: 's1', step: 'Build it', at: new Date(at(0)) });
  assert.equal(first.project, path.basename(root), 'recorded under the folder\'s project, named after the folder');
  assert.deepEqual(first.warnings, []);
  assert.ok(!existsSync(path.join(root, folder, '.atlas')), 'nothing is written into the planning folder');
  const second = await recordWorkReport(root, 'work-0001', { model: 'model-a', tokens: 3000, session: 's1', step: 'Ship it', at: new Date(at(45)) });
  assert.match(second.warnings[0], /not one of the ledger's steps/);
  await assert.rejects(recordWorkReport(root, 'work-0002', { model: 'model-a' }), /not a registered work item/);
  await assert.rejects(recordWorkReport(root, 'work-0001', { model: 'model a' }), StatisticsReportError);
  assert.equal(reportsOf(root, 'work-0001').length, 2);
  const statistics = (await loadPlanning(root)).work[0].statistics!;
  assert.deepEqual({ reports: statistics.reports, tokens: statistics.tokens, minutes: statistics.agentMs / 60000, model: statistics.primaryModel }, { reports: 2, tokens: 2000, minutes: 45, model: 'model-a' });
  assert.equal(statistics.planRevisions, null, 'no Git history');

  // A statistics file as Atlas wrote it before the database: imported once, then deleted.
  const file = path.join(root, folder, '.atlas/statistics.jsonl');
  mkdirSync(path.dirname(file));
  const subagents: MeasuredSubagents = { count: 6, agentMs: 60000, tokens: 600, agents: [{ id: 'a1', model: 'model-b', agentMs: 30000, tokens: 100 }] };
  writeFileSync(file, [JSON.stringify(report(50, 'model-a', null, 's1')), 'garbage', JSON.stringify({ ...measured(60, 'model-a', 's1', 50, 1, [['model-a', 1, [1, 2, 3, 4]]]), measured: { ...measurement(50, 1, [['model-a', 1, [1, 2, 3, 4]]]), subagents } })].join('\n') + '\n');
  assert.deepEqual(validatePlanning(root).warnings.filter(warning => warning.includes('statistics')), [], 'atlas check no longer reads statistics files');
  const imported = await withDatabaseAsync(undefined, database => importStatisticsFiles(database, root));
  assert.deepEqual(imported, { files: [folder + '/.atlas/statistics.jsonl'], reports: 2, invalid: 1, problems: [] });
  assert.ok(!existsSync(path.join(root, folder, '.atlas')), 'the file and its empty folder are gone');
  mkdirSync(path.dirname(file));
  writeFileSync(file, JSON.stringify(report(50, 'model-a', null, 's1')) + '\n');
  assert.equal((await withDatabaseAsync(undefined, database => importStatisticsFiles(database, root))).reports, 0, 'a report imported before is not added again');
  const reread = (await loadPlanning(root)).work[0].statistics!;
  assert.equal(reread.reports, 4);
  assert.deepEqual(reread.subagents, { count: 6, agentMs: 60000 }, 'the subagents a line counted without listing them still count');

  mkdirSync(path.dirname(file));
  writeFileSync(file, JSON.stringify(report(70, 'model-a')) + '\n');
  const exported = await exportPlan(root, 'work-0001');
  assert.ok(!exported.manifest.files.some(entry => entry.path.endsWith('statistics.jsonl')), 'plan exports leave statistics files out');
});

test('inside a harness, atlas work report reads the session, model, agent time and tokens from the session log', async t => {
  const { root, register } = repository(t);
  const folder = 'active/0001-example';
  mkdirSync(path.join(root, folder), { recursive: true });
  register(folder);
  writeFileSync(path.join(root, folder, 'plan.md'), planText('work-0001', 'Body.'));
  // A synthetic Claude Code session: worked 0–20, waited for the person, worked 100–130 with a helper.
  const session = '0b6c3c9e-5a1f-4d2b-9a7e-1f2e3d4c5b6a';
  const config = mkdtempSync(path.join(tmpdir(), 'atlas-claude-'));
  t.after(() => rmSync(config, { recursive: true, force: true }));
  const project = path.join(config, 'projects', 'C--work-example');
  mkdirSync(path.join(project, session, 'subagents'), { recursive: true });
  const usage = { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 3000, output_tokens: 400 };
  const prompt = (minutes: number) => JSON.stringify({ type: 'user', message: { role: 'user', content: 'Placeholder' }, timestamp: at(minutes) });
  // A response that calls a tool, or the one that ends the turn.
  const response = (minutes: number, id: string, model: string, stop = 'tool_use') => JSON.stringify({ type: 'assistant', message: { id, model, role: 'assistant', content: [], stop_reason: stop, usage }, timestamp: at(minutes) });
  const result = (minutes: number) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] }, timestamp: at(minutes) });
  const log = path.join(project, session + '.jsonl');
  writeFileSync(log, [prompt(0), response(1, 'msg_1', 'claude-opus-5-5'), result(19), response(20, 'msg_2', 'claude-opus-5-5', 'end_turn')].join('\n') + '\n');
  const options = { environment: { CLAUDE_CODE_SESSION_ID: session, CLAUDECODE: '1', CLAUDE_CONFIG_DIR: config }, home: config };

  const first = await recordWorkReport(root, 'work-0001', { step: 'Build it', at: new Date(at(2)) }, options);
  assert.deepEqual([first.report.model, first.report.session, first.report.measured, first.warnings], ['claude-opus-5-5', session, undefined, []], 'the first report is the starting point, with the model from the log');
  appendFileSync(log, [prompt(100), response(101, 'msg_3', 'claude-opus-5-5'), result(130), response(130, 'msg_4', 'claude-opus-5-5', 'end_turn')].join('\n') + '\n');
  writeFileSync(path.join(project, session, 'subagents', 'agent-a1.jsonl'), [prompt(110), response(111, 'msg_5', 'claude-haiku-5-5'), result(139), response(140, 'msg_6', 'claude-haiku-5-5', 'end_turn')].join('\n') + '\n');
  const second = await recordWorkReport(root, 'work-0001', { step: 'Ship it', at: new Date(at(150)) }, options);
  assert.deepEqual(second.report.measured, { since: at(2), agentMs: (20 - 2 + 30 + 30) * 60000, models: [
    { model: 'claude-opus-5-5', agentMs: (20 - 2 + 30) * 60000, input: 30, cacheRead: 9000, cacheWrite: 600, output: 1200 },
    { model: 'claude-haiku-5-5', agentMs: 30 * 60000, input: 20, cacheRead: 6000, cacheWrite: 400, output: 800 },
  ], subagents: { count: 1, agentMs: 30 * 60000, tokens: 2 * 3610, agents: [{ id: 'a1', model: 'claude-haiku-5-5', agentMs: 30 * 60000, tokens: 2 * 3610 }] }, intervals: [
    { agent: null, start: at(2), end: at(20) }, { agent: null, start: at(100), end: at(130) }, { agent: 'a1', start: at(110), end: at(140) },
  ] }, 'from the previous report on, waiting excluded, the main agent and its helper each in full, and when each worked');
  assert.equal(second.report.stage, 'implementation', 'the plan is accepted');
  const statistics = (await loadPlanning(root)).work[0].statistics!;
  assert.deepEqual([statistics.agentMs / 60000, statistics.measuredMs / 60000, statistics.activeMs / 60000, statistics.estimatedMs, statistics.primaryModel, statistics.tokens], [78, 78, 58, 0, 'claude-opus-5-5', 5 * 3610], 'five responses since the first report');

  // An explicit model and session work as before, measured when the session has a log.
  const named = await recordWorkReport(root, 'work-0001', { model: 'claude-opus-5-5[1m]', session, at: new Date(at(160)) }, { environment: { CLAUDE_CONFIG_DIR: config }, home: config });
  assert.equal(named.report.model, 'claude-opus-5-5', 'the log names the model more reliably');
  assert.equal(named.report.measured?.agentMs, 0, 'nothing happened since the previous report');
  // Without a readable log the report is recorded unmeasured, with the given model, and says why.
  const missing = { environment: { CLAUDE_CODE_SESSION_ID: '11111111-2222-4333-8444-555555555555', CLAUDE_CONFIG_DIR: config }, home: config };
  const unmeasured = await recordWorkReport(root, 'work-0001', { model: 'model-a', at: new Date(at(170)) }, missing);
  assert.deepEqual([unmeasured.report.session, unmeasured.report.measured], ['11111111-2222-4333-8444-555555555555', undefined]);
  assert.match(unmeasured.warnings.join(' '), /^Agent time and tokens were not measured: no Claude Code log of session 11111111-2222-4333-8444-555555555555 was found on this computer\.$/);
  await assert.rejects(recordWorkReport(root, 'work-0001', { at: new Date(at(180)) }, missing), /model is unknown/);
  await assert.rejects(recordWorkReport(root, 'work-0001', { at: new Date(at(180)) }, { environment: {}, home: config }), /model is unknown: give it with --model/);
  assert.equal(reportsOf(root, 'work-0001').length, 4, 'refused reports record nothing');
});

test('a Codex helper reporting under its own thread reports into its root session, so no work counts twice', async t => {
  const { root, register } = repository(t);
  const folder = 'active/0001-example';
  mkdirSync(path.join(root, folder), { recursive: true });
  register(folder);
  writeFileSync(path.join(root, folder, 'plan.md'), planText('work-0001', 'Body.'));
  const codex = mkdtempSync(path.join(tmpdir(), 'atlas-codex-'));
  t.after(() => rmSync(codex, { recursive: true, force: true }));
  const day = path.join(codex, 'sessions', '2026', '10', '11');
  mkdirSync(day, { recursive: true });
  const main = '01a118ad-b889-71a3-a075-de1eee5ff2e2', helper = '01a118ae-0000-7000-8000-000000000001';
  const time = (minutes: number) => Date.parse(at(minutes));
  const meta = (id: string, extra: object = {}) => ({ timestamp: at(0), type: 'session_meta', payload: { id, session_id: main, ...extra } });
  const started = (minutes: number, turn: string) => ({ timestamp: at(minutes), type: 'event_msg', payload: { type: 'task_started', turn_id: turn, started_at: Math.floor(time(minutes) / 1000) } });
  const context = (minutes: number, turn: string, model: string) => ({ timestamp: at(minutes), type: 'turn_context', payload: { turn_id: turn, model } });
  const tokens = (minutes: number, input: number, output: number) => ({ timestamp: at(minutes), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: output }, last_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: output } } } });
  const complete = (minutes: number, turn: string) => ({ timestamp: at(minutes), type: 'event_msg', payload: { type: 'task_complete', turn_id: turn } });
  const write = (id: string, lines: object[]) => writeFileSync(path.join(day, `rollout-2026-10-11T11-00-00-${id}.jsonl`), lines.map(line => JSON.stringify(line)).join('\n') + '\n');
  // The parent works 0–10 and spawns a helper, which works 10–70 while the parent waits.
  write(main, [meta(main), started(0, 'm1'), context(0, 'm1', 'gpt-6.1-sol'), tokens(5, 500, 50), complete(10, 'm1')]);
  write(helper, [meta(helper, { parent_thread_id: main }), started(10, 'h1'), context(10, 'h1', 'gpt-5-codex-mini'), tokens(60, 1000, 100), complete(70, 'h1')]);
  const as = (thread: string) => ({ environment: { CODEX_THREAD_ID: thread, CODEX_HOME: codex }, home: codex });
  await recordWorkReport(root, 'work-0001', { step: 'Start', at: new Date(at(1)) }, as(main));
  const begun = await recordWorkReport(root, 'work-0001', { step: 'Helper starts', at: new Date(at(11)) }, as(helper));
  assert.equal(begun.report.session, main, 'the helper reports into its root session');
  await recordWorkReport(root, 'work-0001', { step: 'Helper done', at: new Date(at(70)) }, as(helper));
  await recordWorkReport(root, 'work-0001', { step: 'Done', at: new Date(at(80)) }, as(main));
  const statistics = (await loadPlanning(root)).work[0].statistics!;
  assert.deepEqual([statistics.agentMs / 60000, statistics.tokens], [69, 1650], 'the parent 1–10 and the helper 10–70, once; their tokens once');
  assert.deepEqual(statistics.models.map(model => [model.model, model.agentMs / 60000, model.tokens]), [['gpt-5-codex-mini', 60, 1100], ['gpt-6.1-sol', 9, 550]]);
});

test('a report records the work item\'s stage: planning until its plan is accepted, and while a session amends it', async t => {
  const { root, register } = repository(t);
  const folder = 'active/0001-example';
  mkdirSync(path.join(root, folder), { recursive: true });
  register(folder);
  const stage = async (options = {}) => (await recordWorkReport(root, 'work-0001', { model: 'model-a' }, options)).report.stage;
  assert.equal(await stage(), 'planning', 'no plan yet');
  writeFileSync(path.join(root, folder, 'plan.md'), planText('work-0001', 'Body.').replace('design_status: accepted', 'design_status: draft').replace('accepted_at: "2026-10-01"', 'accepted_at: null'));
  assert.equal(await stage(), 'planning', 'a draft');
  writeFileSync(path.join(root, folder, 'plan.md'), planText('work-0001', 'Body.'));
  assert.equal(await stage(), 'implementation', 'accepted');
  assert.equal(await stage({ amending: true }), 'planning', 'a session amending the accepted plan');
  assert.deepEqual(Object.entries((await loadPlanning(root)).work[0].statistics!.stages).map(([name, usage]) => [name, usage.reports]), [['planning', 3], ['implementation', 1], ['unknown', 0]]);
});

test('a hook names the session\'s log: it is measured with its subagents, whatever the environment says', async t => {
  const { root, register } = repository(t);
  const folder = 'active/0001-example';
  mkdirSync(path.join(root, folder), { recursive: true });
  register(folder);
  writeFileSync(path.join(root, folder, 'plan.md'), planText('work-0001', 'Body.'));
  const session = '0b6c3c9e-5a1f-4d2b-9a7e-1f2e3d4c5b6a';
  const config = mkdtempSync(path.join(tmpdir(), 'atlas-claude-'));
  t.after(() => rmSync(config, { recursive: true, force: true }));
  const project = path.join(config, 'projects', 'C--work-example');
  mkdirSync(path.join(project, session, 'subagents'), { recursive: true });
  const usage = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 90 };
  const prompt = (minutes: number) => JSON.stringify({ type: 'user', message: { role: 'user', content: 'Placeholder' }, timestamp: at(minutes) });
  const response = (minutes: number, id: string, model: string, stop = 'end_turn') => JSON.stringify({ type: 'assistant', message: { id, model, role: 'assistant', content: [], stop_reason: stop, usage }, timestamp: at(minutes) });
  const log = path.join(project, session + '.jsonl');
  writeFileSync(log, [prompt(0), response(1, 'msg_1', 'claude-opus-5-5'), prompt(10), response(30, 'msg_2', 'claude-opus-5-5')].join('\n') + '\n');
  writeFileSync(path.join(project, session, 'subagents', 'agent-a7.jsonl'), [prompt(12), response(20, 'msg_3', 'claude-haiku-5-5')].join('\n') + '\n');
  // Another session in the environment, and no harness folder: the transcript path decides.
  const options = { environment: { CLAUDE_CODE_SESSION_ID: '11111111-2222-4333-8444-555555555555' }, home: path.join(config, 'nowhere'), transcriptPath: log };
  const first = await recordWorkReport(root, 'work-0001', { at: new Date(at(2)) }, options);
  assert.deepEqual([first.report.session, first.report.model, first.warnings], [session, 'claude-opus-5-5', []]);
  const second = await recordWorkReport(root, 'work-0001', { at: new Date(at(40)) }, options);
  assert.deepEqual([second.report.measured?.agentMs, second.report.measured?.subagents], [(20 + 8) * 60000, { count: 1, agentMs: 8 * 60000, tokens: 100, agents: [{ id: 'a7', model: 'claude-haiku-5-5', agentMs: 8 * 60000, tokens: 100 }] }]);
  // Every agent adds up; the time at least one worked is their union, and each agent has its share.
  const statistics = (await loadPlanning(root)).work[0].statistics!;
  assert.deepEqual([statistics.subagents, statistics.stages.implementation.agentMs, statistics.activeMs, statistics.unmergedMs], [{ count: 1, agentMs: 8 * 60000 }, 28 * 60000, 20 * 60000, 0]);
  assert.deepEqual(statistics.agents, [{ session, subagent: null, model: 'claude-opus-5-5', agentMs: 20 * 60000 }, { session, subagent: 'a7', model: 'claude-haiku-5-5', agentMs: 8 * 60000 }]);
  const elsewhere = path.join(config, 'notes.jsonl');
  writeFileSync(elsewhere, prompt(0) + '\n');
  const unread = await recordWorkReport(root, 'work-0001', { model: 'model-a', at: new Date(at(50)) }, { ...options, transcriptPath: elsewhere });
  assert.deepEqual([unread.report.measured, unread.warnings], [undefined, ['Agent time and tokens were not measured: ' + elsewhere + ' is not a Claude Code or Codex session log.']]);

  // A report from before intervals (as an older Atlas measured it: the union, without intervals) is
  // measured again from its log, once; one whose log is gone keeps its total, added as is.
  const projectId = withDatabase(undefined, database => database.projectByFolder(realpathSync.native(root))!.id);
  withDatabase(undefined, database => {
    database.db.prepare('UPDATE work_report SET intervals = NULL, agent_ms = ? WHERE project_id = ? AND measured_since IS NOT NULL').run(20 * 60000, projectId);
    database.db.prepare('DELETE FROM report_interval WHERE report_id IN (SELECT id FROM work_report WHERE project_id = ?)').run(projectId);
    insertReport(database, projectId, 'work-0001', createReport({ model: 'claude-opus-5-5', session: '22222222-3333-4444-8555-666666666666', at: new Date(at(45)), measured: measurement(35, 5, []) }));
  });
  const remeasure = () => withDatabaseAsync(undefined, database => remeasureReports(database, { environment: { CLAUDE_CONFIG_DIR: config }, home: options.home }));
  assert.equal((await remeasure()).left, 0);
  assert.deepEqual(withDatabase(undefined, database => database.db.prepare('SELECT intervals FROM work_report WHERE project_id = ? AND measured_since IS NOT NULL ORDER BY at').all(projectId).map(row => row.intervals)), [1, 0]);
  assert.deepEqual(await remeasure(), { measured: 0, missing: 0, left: 0 }, 'each report is tried once');
  const remeasured = (await loadPlanning(root)).work[0].statistics!;
  assert.deepEqual([remeasured.agentMs, remeasured.activeMs, remeasured.unmergedMs].map(ms => ms / 60000), [28 + 5, 20 + 5, 5]);
});
