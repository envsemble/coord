import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { environment, reportsIn, run, temporary, usageIn } from './testing.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.resolve(here, '../../package.json'), 'utf8')) as { version: string };

function planningFolder(directory: string) {
  const root = path.join(directory, 'planning');
  const work = path.join(root, 'active/0001-example');
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: [{ id: 'work-0001', path: 'active/0001-example', repositories: ['example'], current_plan: 'active/0001-example/plan.md' }] }));
  writeFileSync(path.join(work, 'plan.md'), ['---', 'schema_version: 1', 'kind: plan', 'id: work-0001', 'title: Example work', 'repositories: [example]', 'created: "2026-10-01"', 'updated: "2026-10-02"', 'design_status: accepted', 'implementation_status: in_progress', 'accepted_at: "2026-10-02"', 'completed_at: null', 'supersedes: []', 'superseded_by: null', '---', '', '# Example work', ''].join('\n'));
  writeFileSync(path.join(root, 'README.md'), '# Planning\n');
  return root;
}

test('version and help describe the one atlas command', async () => {
  const shown = await run(['--version']);
  assert.equal(shown.status, 0);
  assert.equal(shown.stdout.trim(), version);
  const help = await run(['help']);
  assert.equal(help.status, 0);
  for (const usage of ['atlas where', 'atlas work create', 'atlas capture', 'atlas mcp', 'atlas hook', 'atlas setup', 'atlas plan export', 'atlas work report']) assert.ok(help.stdout.includes(usage), usage);
  assert.deepEqual(await run([]), help);
});

test('unknown commands are usage errors', async () => {
  for (const args of [['tools'], ['planning'], ['plan', 'share']]) {
    const result = await run(args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /atlas: error:/);
  }
});

test('atlas planning check validates read-only with 0/1/2 exit codes', async t => {
  const directory = temporary(t);
  const root = planningFolder(directory);
  const before = readFileSync(path.join(root, 'active/0001-example/plan.md'));
  const valid = await run(['planning', 'check', root]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Planning registry and selected plan metadata valid; files were not modified\./);
  assert.deepEqual(readFileSync(path.join(root, 'active/0001-example/plan.md')), before);
  writeFileSync(path.join(root, 'active/0001-example/plan.md'), before.toString().replace('title: Example work', 'title: 1.5'));
  const invalid = await run(['planning', 'check', root]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /^ERROR: active\/0001-example\/plan\.md: ambiguous implicit YAML scalar; quote intended strings$/m);
  const missing = await run(['planning', 'check', path.join(directory, 'missing')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^ERROR: planning\.json: /m);
  assert.equal((await run(['planning', 'check'])).status, 2);
  assert.equal((await run(['planning', 'check', root, 'extra'])).status, 2);
  assert.equal((await run(['planning', 'check', root, '--fix'])).status, 2);
  assert.equal((await run(['planning', 'check', '--help'])).status, 0);
});

test('atlas usage log writes what the app reads, deduplicates and never fails the caller', async t => {
  const directory = temporary(t);
  const root = planningFolder(directory);
  const data = path.join(directory, 'home');
  const env = { ...environment, ATLAS_HOME: data };
  const logged = await run(['usage', 'log', root, '--task', 'work-0001', '--session', 'chat-1', '--files', 'active/0001-example/plan.md', 'README.md', 'README.md', '../outside.md'], { env });
  assert.equal(logged.status, 0, logged.stderr);
  assert.equal(logged.stdout.trim(), '{"reported_documents": 2, "unrecorded_documents": 1}');
  assert.match(logged.stderr, /Some usage reports were not recorded; continue the task\./);
  const summary = usageIn(root, data)!;
  assert.equal(summary.reports, 2); assert.equal(summary.tasks, 1); assert.equal(summary.failures, 1);
  assert.deepEqual(summary.documents.map(item => item.key).sort(), ['root:README.md', 'work-0001:plan.md']);
  const explicit = path.join(directory, 'explicit');
  assert.equal((await run(['usage', 'log', root, '--home', explicit, '--files', 'README.md'], { env })).status, 0);
  assert.equal(usageIn(root, explicit)?.reports, 1, '--home overrides ATLAS_HOME');
  const unreadable = await run(['usage', 'log', path.join(directory, 'missing'), '--files', 'README.md'], { env });
  assert.equal(unreadable.status, 0, 'a missing planning folder never fails the caller');
  assert.match(unreadable.stderr, /Planning usage logging unavailable/);
  assert.deepEqual(readdirSync(root).sort(), ['README.md', 'active', 'planning.json'], 'nothing is written into planning');
  assert.equal((await run(['usage', 'log', root], { env })).status, 2, '--files is required');
  assert.equal((await run(['usage', 'log', '--files', 'README.md'], { env })).status, 2, 'the planning root is required');
  assert.equal((await run(['usage', 'log', root, '--files'], { env })).status, 2);
  assert.equal((await run(['usage', 'log', root, '--files', 'README.md', '--tsk', 'x'], { env })).status, 2);
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
  assert.equal((await run(['planning', 'check', root])).status, 0, 'the planning check accepts the reports');
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

test('atlas plan export and import share a work item with a preview, --dry-run and 0/1/2 exit codes', async t => {
  const directory = temporary(t);
  const source = planningFolder(directory);
  const target = path.join(directory, 'target');
  mkdirSync(path.join(target, 'active'), { recursive: true });
  writeFileSync(path.join(target, 'planning.json'), '{\n  "schema_version": 1,\n  "repositories": [{ "id": "example", "name": "Example" }],\n  "work_items": []\n}\n');
  const shared = path.join(directory, 'shared');
  mkdirSync(shared);

  const exported = await run(['plan', 'export', 'work-0001', '--planning-dir', source], { cwd: shared });
  assert.equal(exported.status, 0, exported.stderr);
  const file = path.join(shared, 'example-work-0001.atlas-plan.html');
  assert.ok(existsSync(file), 'the default name is <slug>-<work-id>.atlas-plan.html in the current folder');
  assert.match(exported.stdout, /Exported work-0001 “Example work”/);
  const refused = await run(['plan', 'export', path.join(source, 'active/0001-example'), '--planning-dir', source], { cwd: shared });
  assert.equal(refused.status, 1, 'a different existing file needs --force');
  assert.match(refused.stderr, /--force/);
  assert.equal((await run(['plan', 'export', path.join(source, 'active/0001-example'), '--force'], { cwd: source })).status, 0, 'a work folder path and the current folder work too');
  const html = readFileSync(path.join(source, 'example-work-0001.atlas-plan.html'));
  rmSync(path.join(source, 'example-work-0001.atlas-plan.html'));

  const registry = readFileSync(path.join(target, 'planning.json'));
  const preview = await run(['plan', 'import', file, '--planning-dir', target, '--dry-run']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Plan export: “Example work”/);
  assert.match(preview.stdout, /Import as: +work-0001 in active\/0001-example/);
  assert.match(preview.stdout, /Dry run: nothing was written/);
  assert.deepEqual(readdirSync(path.join(target, 'active')), []);
  assert.deepEqual(readFileSync(path.join(target, 'planning.json')), registry);

  const imported = await run(['plan', 'import', file], { cwd: target });
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stdout, /Import as: +work-0001/);
  assert.match(imported.stdout, /README/);
  assert.deepEqual(readFileSync(path.join(target, 'active/0001-example/plan.md')), readFileSync(path.join(source, 'active/0001-example/plan.md')));
  assert.equal((await run(['planning', 'check', target])).status, 0);

  // Text from an export cannot drive the terminal: control characters are refused, other invisible controls replaced.
  const payload = /<script id="atlas-plan-export" type="application\/json">([\s\S]*?)<\/script>/.exec(html.toString())!;
  const restyled = (change: (value: { source: { title: string } }) => void) => {
    const value = JSON.parse(payload[1]); change(value);
    return html.toString().replace(payload[0], () => `<script id="atlas-plan-export" type="application/json">${JSON.stringify(value).replaceAll('<', '\\u003c')}</script>`);
  };
  writeFileSync(path.join(shared, 'escape.html'), restyled(value => { value.source.title = 'Harmless' + String.fromCharCode(0x1b) + ']52;c;ZWNobw==' + String.fromCharCode(7); }));
  const escaped = await run(['plan', 'import', path.join(shared, 'escape.html'), '--planning-dir', target, '--dry-run']);
  assert.equal(escaped.status, 1);
  assert.match(escaped.stderr, /control characters/);
  assert.ok(!escaped.stdout.includes(String.fromCharCode(0x1b)) && !escaped.stderr.includes(String.fromCharCode(0x1b)));
  writeFileSync(path.join(shared, 'bidi.html'), restyled(value => { value.source.title = 'Plan ' + String.fromCharCode(0x202e) + 'txt.exe'; }));
  const bidi = await run(['plan', 'import', path.join(shared, 'bidi.html'), '--planning-dir', target, '--dry-run']);
  assert.equal(bidi.status, 0, bidi.stderr);
  assert.match(bidi.stdout, /Plan export: “Plan \?txt\.exe”/);

  // Filesystem problems are one-line messages, never stack traces.
  for (const [args, message] of [
    [['plan', 'export', 'work-0001', '--planning-dir', source, '--out', shared], /is a folder/],
    [['plan', 'export', 'work-0001', '--planning-dir', source, '--out', path.join(shared, 'missing/x.html')], /does not exist/],
    [['plan', 'import', shared, '--planning-dir', target], /is a folder/],
    [['plan', 'import', path.join(shared, 'absent.html'), '--planning-dir', target], /does not exist/],
  ] as const) {
    const failed = await run([...args]);
    assert.equal(failed.status, 1, args.join(' '));
    assert.match(failed.stderr, message);
    assert.doesNotMatch(failed.stderr, /\n\s+at /, 'no stack trace');
  }
  for (const args of [['plan', 'import', file, '--dry-run=yes'], ['plan', 'export', 'work-0001', '--forse']]) {
    assert.equal((await run(args)).status, 2, args.join(' '));
  }
});

// Local-only: the sibling planning repositories of this workspace (absent in CI).
const workspaceRoot = path.resolve(here, '../../../../..');
for (const name of ['planning', 'demo/planning']) {
  const folder = path.join(workspaceRoot, name);
  test(`atlas planning check passes on the local ${name} folder`, { skip: !existsSync(path.join(folder, 'planning.json')) && 'local planning folder absent' }, async () => {
    const registry = readFileSync(path.join(folder, 'planning.json'));
    const result = await run(['planning', 'check', folder]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /metadata valid; files were not modified/);
    assert.deepEqual(readFileSync(path.join(folder, 'planning.json')), registry);
  });
}
