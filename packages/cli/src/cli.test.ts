import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportsIn as reportsInHome, usageIn } from './testing.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const command = path.resolve(here, '../bin/atlas.js');
const { version } = JSON.parse(readFileSync(path.resolve(here, '../package.json'), 'utf8')) as { version: string };

// The command runs outside any agent harness, with no harness logs to find: work reports never
// measure the developer's own session.
const noLogs = mkdtempSync(path.join(tmpdir(), 'atlas-cli-no-logs-'));
test.after(() => rmSync(noLogs, { recursive: true, force: true }));
const environment: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: path.join(noLogs, 'claude'), CODEX_HOME: path.join(noLogs, 'codex'), ATLAS_HOME: path.join(noLogs, 'home') };
for (const name of ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'CLAUDECODE']) delete environment[name];
const reportsIn = (root: string, workId: string) => reportsInHome(root, workId, environment.ATLAS_HOME);

function atlas(args: string[], options: { input?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  const result = spawnSync(process.execPath, [command, ...args], { encoding: 'utf8', input: options.input, env: options.env ?? environment, cwd: options.cwd, windowsHide: true, timeout: 60000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
function atlasAsync(args: string[], env: NodeJS.ProcessEnv = environment) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [command, ...args], { env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}
function temporary(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'atlas-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function planningFolder(directory: string) {
  const root = path.join(directory, 'planning');
  const work = path.join(root, 'active/0001-example');
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'example', name: 'Example' }], work_items: [{ id: 'work-0001', path: 'active/0001-example', repositories: ['example'], current_plan: 'active/0001-example/plan.md' }] }));
  writeFileSync(path.join(work, 'plan.md'), ['---', 'schema_version: 1', 'kind: plan', 'id: work-0001', 'title: Example work', 'repositories: [example]', 'created: "2026-10-01"', 'updated: "2026-10-02"', 'design_status: accepted', 'implementation_status: in_progress', 'accepted_at: "2026-10-02"', 'completed_at: null', 'supersedes: []', 'superseded_by: null', '---', '', '# Example work', ''].join('\n'));
  writeFileSync(path.join(root, 'README.md'), '# Planning\n');
  return root;
}

test('version and help describe the one atlas command', () => {
  const shown = atlas(['--version']);
  assert.equal(shown.status, 0);
  assert.equal(shown.stdout.trim(), version);
  const help = atlas(['help']);
  assert.equal(help.status, 0);
  for (const usage of ['atlas where', 'atlas work create --title <title>', 'atlas work step remove <work-id> <title>', 'atlas work close <work-id>', 'atlas check [<path>...]', 'atlas home adopt <folder>', 'atlas mcp', 'atlas hook <SessionStart|PostToolUse|Stop|SubagentStop>', 'atlas setup [--dry-run]', 'atlas planning check <planning-root>', 'atlas plan export <work-id|work-folder>', 'atlas plan import <file>', '--dry-run', 'atlas usage log <planning-root> --files', 'atlas work report <planning-root> --work <work-id> [--step <title>] [--model <model>]']) assert.ok(help.stdout.includes(usage), usage);
  assert.equal(atlas([]).status, 0);
});

test('unknown commands and retired spellings are usage errors', () => {
  for (const args of [['tools'], ['review', '--input', 'x.json'], ['inspect', '--root', '.'], ['model', 'tools'], ['model', 'create', '--root', '.'], ['mcp', '--root', '.'], ['planning'], ['planning', 'lint', '.'], ['usage'], ['usage', 'show', '.'], ['plan'], ['plan', 'share']]) {
    const result = atlas(args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /atlas: error:/);
  }
});

test('atlas planning check validates read-only with 0/1/2 exit codes', t => {
  const directory = temporary(t);
  const root = planningFolder(directory);
  const before = readFileSync(path.join(root, 'active/0001-example/plan.md'));
  const valid = atlas(['planning', 'check', root]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Planning registry and selected plan metadata valid; files were not modified\./);
  assert.deepEqual(readFileSync(path.join(root, 'active/0001-example/plan.md')), before);
  writeFileSync(path.join(root, 'active/0001-example/plan.md'), before.toString().replace('title: Example work', 'title: 1.5'));
  const invalid = atlas(['planning', 'check', root]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /^ERROR: active\/0001-example\/plan\.md: ambiguous implicit YAML scalar; quote intended strings$/m);
  const missing = atlas(['planning', 'check', path.join(directory, 'missing')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^ERROR: planning\.json: /m);
  assert.equal(atlas(['planning', 'check']).status, 2);
  assert.equal(atlas(['planning', 'check', root, 'extra']).status, 2);
  assert.equal(atlas(['planning', 'check', root, '--fix']).status, 2);
  assert.equal(atlas(['planning', 'check', '--help']).status, 0);
});

test('atlas usage log writes what the app reads, deduplicates and never fails the caller', async t => {
  const directory = temporary(t);
  const root = planningFolder(directory);
  const data = path.join(directory, 'home');
  const env = { ...environment, ATLAS_HOME: data };
  const logged = atlas(['usage', 'log', root, '--task', 'work-0001', '--session', 'chat-1', '--files', 'active/0001-example/plan.md', 'README.md', 'README.md', '../outside.md'], { env });
  assert.equal(logged.status, 0, logged.stderr);
  assert.equal(logged.stdout.trim(), '{"reported_documents": 2, "unrecorded_documents": 1}');
  assert.match(logged.stderr, /Some usage reports were not recorded; continue the task\./);
  let summary = usageIn(root, data)!;
  assert.equal(summary.reports, 2); assert.equal(summary.tasks, 1); assert.equal(summary.failures, 1);
  assert.deepEqual(summary.documents.map(item => item.key).sort(), ['root:README.md', 'work-0001:plan.md']);
  const explicit = path.join(directory, 'explicit');
  assert.equal(atlas(['usage', 'log', root, '--home', explicit, '--files', 'README.md'], { env }).status, 0);
  assert.equal(usageIn(root, explicit)?.reports, 1, '--home overrides ATLAS_HOME');
  // Concurrent writers (several agents at once) share the database: each waits for the others.
  const writers = await Promise.all(Array.from({ length: 6 }, (_, index) => atlasAsync(['usage', 'log', root, '--task', 'parallel-' + index, '--files', 'README.md'], env)));
  assert.ok(writers.every(result => result.status === 0 && !result.stderr), JSON.stringify(writers));
  summary = usageIn(root, data)!;
  assert.equal(summary.reports, 2 + 6);
  const unreadable = atlas(['usage', 'log', path.join(directory, 'missing'), '--files', 'README.md'], { env });
  assert.equal(unreadable.status, 0, 'a missing planning folder never fails the caller');
  assert.match(unreadable.stderr, /Planning usage logging unavailable/);
  assert.deepEqual(readdirSync(root).sort(), ['README.md', 'active', 'planning.json'], 'nothing is written into planning');
  assert.equal(atlas(['usage', 'log', root], { env }).status, 2, '--files is required');
  assert.equal(atlas(['usage', 'log', '--files', 'README.md'], { env }).status, 2, 'the planning root is required');
  assert.equal(atlas(['usage', 'log', root, '--files'], { env }).status, 2);
  assert.equal(atlas(['usage', 'log', root, '--files', 'README.md', '--tsk', 'x'], { env }).status, 2);
});

test('atlas work report records each report in the home database, even from concurrent agents, and never fails the caller', async t => {
  const directory = temporary(t);
  const root = planningFolder(directory);
  const reported = atlas(['work', 'report', root, '--work', 'work-0001', '--model', 'model-a', '--tokens', '1200', '--session', 'chat-1', '--step', 'Build it']);
  assert.equal(reported.status, 0, reported.stderr);
  assert.match(reported.stdout, /^\{"recorded":true,"project":"planning","at":"[^"]+","model":"model-a"\}\n$/);
  assert.deepEqual(reportsIn(root, 'work-0001').map(report => [report.model, report.tokens, report.session, report.step, report.stage]), [['model-a', 1200, 'chat-1', 'Build it', 'implementation']]);
  assert.ok(!existsSync(path.join(root, 'active/0001-example/.atlas')), 'nothing is written into the planning folder');
  // Several agents at once: each waits for the others.
  const writers = await Promise.all(Array.from({ length: 8 }, (_, index) => atlasAsync(['work', 'report', root, '--work', 'work-0001', '--model', 'model-b', '--tokens', String(index * 1000), '--session', 'parallel-' + index])));
  assert.ok(writers.every(result => result.status === 0 && result.stdout.includes('"recorded":true')), JSON.stringify(writers));
  assert.equal(reportsIn(root, 'work-0001').length, 9);
  // Problems are reported on stderr with exit 0, so a report never fails the task.
  for (const args of [['--work', 'work-0009', '--model', 'model-a'], ['--work', 'work-0001', '--model', 'not a model id'], ['--work', 'work-0001', '--model', 'model-a', '--session', 'has space']]) {
    const refused = atlas(['work', 'report', root, ...args]);
    assert.equal(refused.status, 0, args.join(' '));
    assert.equal(refused.stdout, '');
    assert.match(refused.stderr, /^Work statistics were not recorded \(.+[^.]\); continue the task\.\n$/);
  }
  assert.equal(atlas(['work', 'report', path.join(directory, 'missing'), '--work', 'work-0001', '--model', 'model-a']).status, 0);
  assert.equal(reportsIn(root, 'work-0001').length, 9, 'refused reports record nothing');
  // Usage errors exit 2.
  assert.equal(atlas(['work', 'report', root, '--model', 'model-a']).status, 2, '--work is required');
  assert.equal(atlas(['work', 'report', root, '--work', 'work-0001']).status, 2, '--model is required outside a harness');
  assert.equal(atlas(['work', 'report', '--work', 'work-0001', '--model', 'model-a']).status, 2, 'the planning root is required');
  assert.equal(atlas(['work', 'report', root, '--work', 'work-0001', '--model', 'model-a', '--tokens', '12k']).status, 2);
  assert.equal(atlas(['work', 'tally', root]).status, 2);
  assert.equal(atlas(['planning', 'check', root]).status, 0, 'the planning check accepts the reports');
});

test('inside a harness, atlas work report needs only the work and the step: the session log gives the rest', t => {
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
  const first = atlas(['work', 'report', root, '--work', 'work-0001', '--step', 'Build it'], { env });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stderr, '');
  const start = JSON.parse(first.stdout);
  assert.equal(start.model, 'claude-opus-5-5', 'the model comes from the log');
  // The turn goes on after the report: a tool result and a response, before the next report.
  const since = Date.parse(start.at);
  writeFileSync(log, [line(since + 30, 'result'), line(since + 60, 'response', 'msg_2', 'end_turn')].map(text => text + '\n').join(''), { flag: 'a' });
  const second = atlas(['work', 'report', root, '--work', 'work-0001', '--step', 'Build it'], { env });
  assert.equal(second.status, 0, second.stderr);
  const shown = JSON.parse(second.stdout);
  assert.deepEqual([shown.model, shown.since, shown.agentMs, shown.tokens], ['claude-opus-5-5', start.at, 60, 3610], 'the turn under way since the first report, and the response in it');
  assert.deepEqual(reportsIn(root, 'work-0001').map(report => [report.session, report.model, Boolean(report.measured)]), [[session, 'claude-opus-5-5', false], [session, 'claude-opus-5-5', true]]);
  // A session without a log: recorded with --model and a warning, or not recorded without one.
  const elsewhere = { ...env, CLAUDE_CODE_SESSION_ID: '11111111-2222-4333-8444-555555555555' };
  const unmeasured = atlas(['work', 'report', root, '--work', 'work-0001', '--model', 'model-a'], { env: elsewhere });
  assert.equal(unmeasured.status, 0);
  assert.match(unmeasured.stderr, /^WARNING: Agent time and tokens were not measured: no Claude Code log of session 11111111-2222-4333-8444-555555555555 was found on this computer\.\n$/);
  const unknown = atlas(['work', 'report', root, '--work', 'work-0001'], { env: elsewhere });
  assert.deepEqual([unknown.status, unknown.stdout], [0, '']);
  assert.match(unknown.stderr, /^Work statistics were not recorded \(The model is unknown \(no Claude Code log of session .+ was found on this computer\): give it with --model\); continue the task\.\n$/);
  assert.equal(atlas(['planning', 'check', root]).status, 0, 'the planning check accepts measured reports');
});

test('atlas plan export and import share a work item with a preview, --dry-run and 0/1/2 exit codes', t => {
  const directory = temporary(t);
  const source = planningFolder(directory);
  const target = path.join(directory, 'target');
  mkdirSync(path.join(target, 'active'), { recursive: true });
  writeFileSync(path.join(target, 'planning.json'), '{\n  "schema_version": 1,\n  "repositories": [{ "id": "example", "name": "Example" }],\n  "work_items": []\n}\n');
  const shared = path.join(directory, 'shared');
  mkdirSync(shared);

  const exported = atlas(['plan', 'export', 'work-0001', '--planning-dir', source], { cwd: shared });
  assert.equal(exported.status, 0, exported.stderr);
  const file = path.join(shared, 'example-work-0001.atlas-plan.html');
  assert.ok(existsSync(file), 'the default name is <slug>-<work-id>.atlas-plan.html in the current folder');
  assert.match(exported.stdout, /Exported work-0001 “Example work”/);
  const refused = atlas(['plan', 'export', path.join(source, 'active/0001-example'), '--planning-dir', source], { cwd: shared });
  assert.equal(refused.status, 1, 'a different existing file needs --force');
  assert.match(refused.stderr, /--force/);
  assert.equal(atlas(['plan', 'export', path.join(source, 'active/0001-example'), '--force'], { cwd: source }).status, 0, 'a work folder path and the current folder work too');
  const html = readFileSync(path.join(source, 'example-work-0001.atlas-plan.html'));
  rmSync(path.join(source, 'example-work-0001.atlas-plan.html'));

  const registry = readFileSync(path.join(target, 'planning.json'));
  const preview = atlas(['plan', 'import', file, '--planning-dir', target, '--dry-run']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Plan export: “Example work”/);
  assert.match(preview.stdout, /Import as: +work-0001 in active\/0001-example/);
  assert.match(preview.stdout, /Dry run: nothing was written/);
  assert.deepEqual(readdirSync(path.join(target, 'active')), []);
  assert.deepEqual(readFileSync(path.join(target, 'planning.json')), registry);

  const imported = atlas(['plan', 'import', file], { cwd: target });
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stdout, /Import as: +work-0001/);
  assert.match(imported.stdout, /README/);
  assert.deepEqual(readFileSync(path.join(target, 'active/0001-example/plan.md')), readFileSync(path.join(source, 'active/0001-example/plan.md')));
  assert.equal(atlas(['planning', 'check', target]).status, 0);
  writeFileSync(path.join(shared, 'other.html'), html.toString().replace(/"sha256":"[0-9a-f]{64}"/, '"sha256":"' + '0'.repeat(64) + '"'));
  const tampered = atlas(['plan', 'import', path.join(shared, 'other.html'), '--planning-dir', target]);
  assert.equal(tampered.status, 1);
  assert.match(tampered.stderr, /SHA-256/);
  assert.equal(atlas(['plan', 'import', file, '--planning-dir', directory]).status, 1, 'a folder that is not a planning repository is refused');
  assert.equal(atlas(['plan', 'export', 'work-0042', '--planning-dir', source]).status, 1);

  // Text from an export cannot drive the terminal: control characters are refused, other invisible controls replaced.
  const payload = /<script id="atlas-plan-export" type="application\/json">([\s\S]*?)<\/script>/.exec(html.toString())!;
  const restyled = (change: (value: { source: { title: string } }) => void) => {
    const value = JSON.parse(payload[1]); change(value);
    return html.toString().replace(payload[0], () => `<script id="atlas-plan-export" type="application/json">${JSON.stringify(value).replaceAll('<', '\\u003c')}</script>`);
  };
  writeFileSync(path.join(shared, 'escape.html'), restyled(value => { value.source.title = 'Harmless' + String.fromCharCode(0x1b) + ']52;c;ZWNobw==' + String.fromCharCode(7); }));
  const escaped = atlas(['plan', 'import', path.join(shared, 'escape.html'), '--planning-dir', target, '--dry-run']);
  assert.equal(escaped.status, 1);
  assert.match(escaped.stderr, /control characters/);
  assert.ok(!escaped.stdout.includes(String.fromCharCode(0x1b)) && !escaped.stderr.includes(String.fromCharCode(0x1b)));
  writeFileSync(path.join(shared, 'bidi.html'), restyled(value => { value.source.title = 'Plan ' + String.fromCharCode(0x202e) + 'txt.exe'; }));
  const bidi = atlas(['plan', 'import', path.join(shared, 'bidi.html'), '--planning-dir', target, '--dry-run']);
  assert.equal(bidi.status, 0, bidi.stderr);
  assert.match(bidi.stdout, /Plan export: “Plan \?txt\.exe”/);

  // Filesystem problems are one-line messages, never stack traces.
  for (const [args, message] of [
    [['plan', 'export', 'work-0001', '--planning-dir', source, '--out', shared], /is a folder/],
    [['plan', 'export', 'work-0001', '--planning-dir', source, '--out', path.join(shared, 'missing/x.html')], /does not exist/],
    [['plan', 'import', shared, '--planning-dir', target], /is a folder/],
    [['plan', 'import', path.join(shared, 'absent.html'), '--planning-dir', target], /does not exist/],
  ] as const) {
    const failed = atlas([...args]);
    assert.equal(failed.status, 1, args.join(' '));
    assert.match(failed.stderr, message);
    assert.doesNotMatch(failed.stderr, /\n\s+at /, 'no stack trace');
  }
  for (const args of [['plan', 'import'], ['plan', 'import', file, '--dry-run=yes'], ['plan', 'export'], ['plan', 'export', 'work-0001', '--forse'], ['plan', 'export', 'a', 'b']]) {
    assert.equal(atlas(args).status, 2, args.join(' '));
  }
});

// Local-only: the sibling planning repositories of this workspace (absent in CI).
const workspaceRoot = path.resolve(here, '../../../..');
for (const name of ['planning', 'demo/planning']) {
  const folder = path.join(workspaceRoot, name);
  test(`atlas planning check passes on the local ${name} folder`, { skip: !existsSync(path.join(folder, 'planning.json')) && 'local planning folder absent' }, () => {
    const registry = readFileSync(path.join(folder, 'planning.json'));
    const result = atlas(['planning', 'check', folder]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /metadata valid; files were not modified/);
    assert.deepEqual(readFileSync(path.join(folder, 'planning.json')), registry);
  });
}
