import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Telemetry, statisticsDirectory } from '@envsemble/atlas-planning';

const here = path.dirname(fileURLToPath(import.meta.url));
const command = path.resolve(here, '../bin/atlas.js');
const { version } = JSON.parse(readFileSync(path.resolve(here, '../package.json'), 'utf8')) as { version: string };

function atlas(args: string[], options: { input?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  const result = spawnSync(process.execPath, [command, ...args], { encoding: 'utf8', input: options.input, env: options.env ?? process.env, cwd: options.cwd, windowsHide: true, timeout: 60000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
function atlasAsync(args: string[], env: NodeJS.ProcessEnv = process.env) {
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
  for (const usage of ['atlas model <operation> --root <workspace>', 'atlas model review --input', 'atlas model tools', 'atlas mcp --root <workspace>', 'atlas planning check <planning-root>', 'atlas usage log <planning-root> --files']) assert.ok(help.stdout.includes(usage), usage);
  assert.equal(atlas([]).status, 0);
});

test('unknown commands and retired spellings are usage errors', () => {
  for (const args of [['tools'], ['review', '--input', 'x.json'], ['inspect', '--root', '.'], ['model', 'mcp', '--root', '.'], ['planning'], ['planning', 'lint', '.'], ['usage'], ['usage', 'show', '.']]) {
    const result = atlas(args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /atlas: error:/);
  }
});

test('atlas model delegates to the diagram tools with JSON output and exit codes', t => {
  const workspace = temporary(t);
  const tools = atlas(['model', 'tools']);
  assert.equal(tools.status, 0);
  assert.ok((JSON.parse(tools.stdout) as { name: string }[]).some(tool => tool.name === 'atlas_create'));
  assert.match(atlas(['model']).stdout, /atlas model <operation>/);
  const project = { type: 'StructuralModel', nodes: [{ id: 'order', name: 'Order', attributes: [{ id: 'total', name: 'total', type: 'number' }] }], relations: [], generalizations: [], generalizationSets: [] };
  const created = atlas(['model', 'create', '--root', workspace, '--input', '-'], { input: JSON.stringify({ input: { title: 'Orders', profile: 'code', model: project } }) });
  assert.equal(created.status, 0, created.stderr);
  const { handle } = JSON.parse(created.stdout) as { handle: string };
  const request = path.join(workspace, 'inspect.json');
  writeFileSync(request, JSON.stringify({ handle }));
  const inspected = atlas(['model', 'inspect', '--root', workspace, '--input', request]);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout).title, 'Orders');
  assert.ok(existsSync(path.join(workspace, '.atlas/models', handle + '.json')));
  const validated = atlas(['model', 'validate', '--root', workspace, '--input', request]);
  assert.ok([0, 1].includes(validated.status!), 'validation exits 0 or 1 for blocking findings');
  assert.equal(typeof JSON.parse(validated.stdout).valid, 'boolean');
  const malformed = atlas(['model', 'inspect', '--root', workspace, '--unknown', 'x']);
  assert.equal(malformed.status, 2);
  assert.ok(JSON.parse(malformed.stderr), 'input failures are bounded JSON');
  assert.equal(atlas(['model', 'inspect']).status, 2, 'a workspace root is required');
  assert.equal(atlas(['model', 'review']).status, 2, 'review needs an explicit request');
  assert.equal(atlas(['model', 'job', 'help']).status, 0);
  assert.equal(atlas(['model', 'job', 'unknown']).status, 2);
});

test('atlas mcp serves the model tools over stdio', async t => {
  const workspace = temporary(t);
  const child = spawn(process.execPath, [command, 'mcp', '--root', workspace], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  const response = new Promise<{ result: { tools: { name: string }[] } }>((resolve, reject) => {
    child.stdout.on('data', chunk => {
      output += chunk;
      const line = output.split('\n').find(item => item.includes('"id":2'));
      if (line) resolve(JSON.parse(line));
    });
    child.on('exit', status => reject(new Error('MCP server exited with ' + status + ': ' + output)));
  });
  const send = (message: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'atlas-cli-test', version: '1' } } });
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list', params: {} });
  const listed = await Promise.race([response, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('MCP timeout: ' + output)), 30000))]);
  assert.ok(listed.result.tools.some(tool => tool.name === 'atlas_inspect'));
  assert.equal(atlas(['mcp']).status, 2, 'mcp needs --root');
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
  const data = path.join(directory, 'data');
  const env = { ...process.env, ATLAS_DATA_DIR: data };
  const logged = atlas(['usage', 'log', root, '--task', 'work-0001', '--session', 'chat-1', '--files', 'active/0001-example/plan.md', 'README.md', 'README.md', '../outside.md'], { env });
  assert.equal(logged.status, 0, logged.stderr);
  assert.equal(logged.stdout.trim(), '{"reported_documents": 2, "unrecorded_documents": 1}');
  assert.match(logged.stderr, /Some usage reports were not recorded; continue the task\./);
  const statistics = await statisticsDirectory(root, data);
  assert.equal(path.dirname(statistics), path.join(data, 'usage'), 'statistics live in the Atlas data folder, keyed by the planning folder');
  const store = new Telemetry(path.join(statistics, 'usage.sqlite'));
  try {
    let summary = store.summary();
    assert.equal(summary.reports, 2); assert.equal(summary.tasks, 1); assert.equal(summary.failures, 1);
    assert.deepEqual(summary.documents.map(item => item.key).sort(), ['root:README.md', 'work-0001:plan.md']);
    const explicit = path.join(directory, 'explicit');
    assert.equal(atlas(['usage', 'log', root, '--data-dir', explicit, '--files', 'README.md'], { env }).status, 0);
    assert.ok(existsSync(path.join(await statisticsDirectory(root, explicit), 'usage.sqlite')), '--data-dir overrides ATLAS_DATA_DIR');
    // Concurrent writers (several agents at once) share the store; each report is recorded or leaves a gap.
    const writers = await Promise.all(Array.from({ length: 6 }, (_, index) => atlasAsync(['usage', 'log', root, '--task', 'parallel-' + index, '--files', 'README.md'], env)));
    assert.ok(writers.every(result => result.status === 0));
    summary = store.summary();
    const gaps = existsSync(path.join(statistics, 'collection-gaps.jsonl')) ? readFileSync(path.join(statistics, 'collection-gaps.jsonl'), 'utf8').trim().split('\n').length : 0;
    assert.equal(summary.reports + gaps, 2 + 6);
    assert.ok(summary.reports >= 3, 'concurrent writers wait for the lock instead of failing');
    // A locked store leaves a lasting coverage signal and still exits 0.
    const lock = new DatabaseSync(path.join(statistics, 'usage.sqlite'));
    try {
      lock.exec('BEGIN IMMEDIATE');
      const locked = atlas(['usage', 'log', root, '--files', 'README.md'], { env });
      assert.equal(locked.status, 0);
      assert.equal(locked.stdout, '');
      assert.match(locked.stderr, /^Planning usage logging unavailable \(.+\); continue the task\.$/m);
      lock.exec('ROLLBACK');
    } finally { lock.close(); }
    assert.equal(store.summary().failures, summary.failures + 1);
  } finally { store.close(); }
  const unreadable = atlas(['usage', 'log', path.join(directory, 'missing'), '--files', 'README.md'], { env });
  assert.equal(unreadable.status, 0, 'a missing planning folder never fails the caller');
  assert.match(unreadable.stderr, /Planning usage logging unavailable/);
  assert.deepEqual(readdirSync(root).sort(), ['README.md', 'active', 'planning.json'], 'nothing is written into planning');
  assert.equal(atlas(['usage', 'log', root], { env }).status, 2, '--files is required');
  assert.equal(atlas(['usage', 'log', '--files', 'README.md'], { env }).status, 2, 'the planning root is required');
  assert.equal(atlas(['usage', 'log', root, '--files'], { env }).status, 2);
  assert.equal(atlas(['usage', 'log', root, '--files', 'README.md', '--tsk', 'x'], { env }).status, 2);
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
