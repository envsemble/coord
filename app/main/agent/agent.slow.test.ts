// The launchers the agent folder writes, run as a shell runs them, with Node standing in for the
// app's executable (it runs the script whatever ELECTRON_RUN_AS_NODE says); and the command the
// packaged app carries, assembled as packaging assembles it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installAgentFolder } from './agentFolder.ts';
import { fakeBundle } from './testing.ts';

test('the launcher passes arguments, input, output and the exit status through, in Node mode', async t => {
  // A folder name with a space, an ampersand and a percent sign, which cmd.exe would read otherwise.
  const directory = mkdtempSync(path.join(tmpdir(), 'atlas agent & 100% '));
  const script = 'let input = ""; for await (const chunk of process.stdin) input += chunk;\n'
    + 'console.log(JSON.stringify({ args: process.argv.slice(2), input, mode: process.env.ELECTRON_RUN_AS_NODE }));\nprocess.exitCode = 3;\n';
  const bundle = fakeBundle(path.join(directory, 'bundle'), '1.0.0-test', script);
  const folder = path.join(directory, 'home', 'agent');
  await installAgentFolder(bundle, folder, process.execPath);
  const args = ['hook', 'Stop', 'a b', 'c&d'];
  const environment = { ...process.env, ELECTRON_RUN_AS_NODE: '' };
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${path.join(folder, 'bin', 'atlas.cmd')}" hook Stop "a b" "c&d""`], { input: '{"x":1}', encoding: 'utf8', env: environment, windowsVerbatimArguments: true })
    : spawnSync(path.join(folder, 'bin', 'atlas'), args, { input: '{"x":1}', encoding: 'utf8', env: environment });
  assert.equal(result.status, 3, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args, input: '{"x":1}', mode: '1' });
  if (process.platform === 'win32') {
    // Git Bash, which Claude Code runs hooks in on Windows, runs the sh launcher.
    const bash = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
    const sh = spawnSync(bash, ['-c', '"$0" "$@"', path.join(folder, 'bin', 'atlas').replace(/\\/g, '/'), ...args], { input: '{"x":1}', encoding: 'utf8', env: environment });
    if (sh.error) { t.skip('Git Bash is not installed'); return; }
    assert.equal(sh.status, 3, sh.stderr);
    assert.deepEqual(JSON.parse(sh.stdout), { args, input: '{"x":1}', mode: '1' });
  }
});

test('the command the app carries exports a plan with its diagrams drawn', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'atlas-payload-'));
  const repository = path.resolve(import.meta.dirname, '../../..');
  const { assemble } = createRequire(import.meta.url)('../../scripts/agent-payload.cjs') as { assemble: (repository: string, destination: string, version: string) => unknown };
  assemble(repository, path.join(directory, 'agent'), '1.0.0');
  const planning = path.join(directory, 'planning');
  cpSync(path.join(repository, 'app', 'e2e', 'fixtures', 'planning'), planning, { recursive: true });
  const result = spawnSync(process.execPath, [path.join(directory, 'agent', 'command', 'bin', 'atlas.js'), 'plan', 'export', 'work-0002', '--planning-dir', planning, '--out', path.join(directory, 'plan.html')], { encoding: 'utf8', cwd: directory });
  assert.equal(result.status, 0, result.stderr);
  // A diagram the command cannot draw (React missing, say) is still exported, with a warning.
  assert.doesNotMatch(result.stderr, /cannot be drawn/);
  assert.match(result.stdout, /Exported work-0002/);
});
