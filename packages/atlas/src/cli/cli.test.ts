import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { environment, reportsIn, run, temporary } from './testing.ts';
import { planningLedger } from '../planning/work/work.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.resolve(here, '../../package.json'), 'utf8')) as { version: string };

function planningFolder(directory: string) {
  const root = path.join(directory, 'planning');
  const work = path.join(root, 'active/0001-example');
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 2, name: 'planning', folders: [], work_items: [{ id: 'work-0001', path: 'active/0001-example', current_plan: 'active/0001-example/plan.md' }] }));
  writeFileSync(path.join(work, 'plan.md'), ['---', 'schema_version: 2', 'kind: plan', 'id: work-0001', 'title: Example work', 'created: "2026-10-01"', 'updated: "2026-10-02"', 'design_status: accepted', 'implementation_status: in_progress', 'accepted_at: "2026-10-02"', 'completed_at: null', 'supersedes: []', 'superseded_by: null', '---', '', '# Example work', ''].join('\n'));
  writeFileSync(path.join(work, 'ledger.md'), planningLedger('work-0001', '2026-10-01', [{ title: 'Build it', status: 'doing' }]));
  writeFileSync(path.join(root, 'README.md'), '# Planning\n');
  return root;
}

test('version and help describe the one atlas command', async () => {
  const shown = await run(['--version']);
  assert.equal(shown.status, 0);
  assert.equal(shown.stdout.trim(), version);
  const help = await run(['help']);
  assert.equal(help.status, 0);
  for (const usage of ['atlas where', 'atlas work create', 'atlas capture', 'atlas mcp', 'atlas hook', 'atlas setup', 'atlas work report']) assert.ok(help.stdout.includes(usage), usage);
  assert.deepEqual(await run([]), help);
});

test('unknown commands are usage errors', async () => {
  for (const args of [['tools'], ['plan', 'share']]) {
    const result = await run(args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /atlas: error:/);
  }
});

test('atlas work report records each report in the home database and never fails the caller', async t => {
  const directory = temporary(t);
  const root = planningFolder(directory);
  const reported = await run(['work', 'report', root, '--work', 'work-0001', '--model', 'model-a', '--tokens', '1200', '--session', 'chat-1', '--step', 'Build it']);
  assert.equal(reported.status, 0, reported.stderr);
  assert.match(reported.stdout, /^\{"recorded":true,"project":"planning","at":"[^"]+","model":"model-a"\}\n$/);
  assert.deepEqual(reportsIn(root, 'work-0001').map(report => [report.model, report.tokens, report.session, report.step, report.stage]), [['model-a', 1200, 'chat-1', 'Build it', 'implementation']]);
  assert.ok(!existsSync(path.join(root, 'active/0001-example/.atlas')), 'nothing is written into the planning folder');
  // Problems are reported on stderr with exit 0, so a report never fails the task.
  for (const args of [['--work', 'work-0009', '--model', 'model-a'], ['--work', 'work-0001', '--model', 'not a model id'], ['--work', 'work-0001', '--model', 'model-a', '--session', 'has space']]) {
    const refused = await run(['work', 'report', root, ...args]);
    assert.equal(refused.status, 0, args.join(' '));
    assert.equal(refused.stdout, '');
    assert.match(refused.stderr, /^Work statistics were not recorded \(.+[^.]\); continue the task\.\n$/);
  }
  assert.equal((await run(['work', 'report', path.join(directory, 'missing'), '--work', 'work-0001', '--model', 'model-a'])).status, 0);
  assert.equal(reportsIn(root, 'work-0001').length, 1, 'refused reports record nothing');
  // Usage errors exit 2.
  assert.equal((await run(['work', 'report', root, '--model', 'model-a'])).status, 2, '--work is required');
  assert.equal((await run(['work', 'report', root, '--work', 'work-0001'])).status, 2, '--model is required outside a harness');
  assert.equal((await run(['work', 'report', '--work', 'work-0001', '--model', 'model-a'])).status, 2, 'the planning root is required');
  assert.equal((await run(['work', 'report', root, '--work', 'work-0001', '--model', 'model-a', '--tokens', '12k'])).status, 2);
  assert.equal((await run(['check', root])).status, 0, 'the check accepts the reports');
});

test('inside a harness, atlas work report needs only the work and the step: the session log gives the rest', async t => {
  const directory = temporary(t);
  const root = planningFolder(directory);
  // A synthetic Claude Code session that started ten minutes ago and is at work now.
  const session = '0b6c3c9e-5a1f-4d2b-9a7e-1f2e3d4c5b6a';
  const config = path.join(directory, 'claude');
  const project = path.join(config, 'projects', 'C--work-example');
  mkdirSync(project, { recursive: true });
  const usage = { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 3000, output_tokens: 400 };
  // A response calls a tool (this command, say) or, with end_turn, ends the turn.
  const line = (at: number, kind: 'prompt' | 'response' | 'result', id = '', stop = 'tool_use') => JSON.stringify(kind === 'response' ? { type: 'assistant', message: { id, model: 'claude-opus-5-5', role: 'assistant', content: [], stop_reason: stop, usage }, timestamp: new Date(at).toISOString() }
    : { type: 'user', message: { role: 'user', content: kind === 'prompt' ? 'Placeholder' : [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] }, timestamp: new Date(at).toISOString() });
  const log = path.join(project, session + '.jsonl');
  writeFileSync(log, [line(Date.now() - 600000, 'prompt'), line(Date.now() - 540000, 'response', 'msg_1')].join('\n') + '\n');
  const env = { ...environment, CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: session, CLAUDE_CONFIG_DIR: config };
  const first = await run(['work', 'report', root, '--work', 'work-0001', '--step', 'Build it'], { env });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stderr, '');
  const start = JSON.parse(first.stdout);
  assert.equal(start.model, 'claude-opus-5-5', 'the model comes from the log');
  // The turn goes on after the report: a tool result and a response, before the next report.
  const since = Date.parse(start.at);
  writeFileSync(log, [line(since + 30, 'result'), line(since + 60, 'response', 'msg_2', 'end_turn')].map(text => text + '\n').join(''), { flag: 'a' });
  // The next report comes after that response.
  while (Date.now() <= since + 60) await new Promise(resolve => setTimeout(resolve, 10));
  const second = await run(['work', 'report', root, '--work', 'work-0001', '--step', 'Build it'], { env });
  assert.equal(second.status, 0, second.stderr);
  const shown = JSON.parse(second.stdout);
  assert.deepEqual([shown.model, shown.since, shown.agentMs, shown.tokens], ['claude-opus-5-5', start.at, 60, 3610], 'the turn under way since the first report, and the response in it');
  assert.deepEqual(reportsIn(root, 'work-0001').map(report => [report.session, report.model, Boolean(report.measured)]), [[session, 'claude-opus-5-5', false], [session, 'claude-opus-5-5', true]]);
});

