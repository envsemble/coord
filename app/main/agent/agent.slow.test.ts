// The launchers the agent folder writes, run as a shell runs them, on this Node.js standing in for
// the one the app ships, in a home with letters such as "á" in its path, as a user's folder may
// have; and the command the packaged app carries, assembled as packaging assembles it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installAgentFolder } from './agentFolder.ts';
import { fakeBundle } from './testing.ts';

/** Run the folder's `atlas` as a terminal does: atlas.cmd through cmd.exe on Windows, the sh launcher elsewhere. */
function atlas(folder: string, args: string[], options: { input?: string; cwd?: string } = {}) {
  const quote = (value: string) => /[\s&"]/.test(value) ? '"' + value + '"' : value;
  return process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${path.join(folder, 'bin', 'atlas.cmd')}" ${args.map(quote).join(' ')}"`], { ...options, encoding: 'utf8', windowsVerbatimArguments: true })
    : spawnSync(path.join(folder, 'bin', 'atlas'), args, { ...options, encoding: 'utf8' });
}

test('the launcher passes arguments, input, output and the exit status through', async t => {
  // A folder name with a space, an ampersand, a percent sign and an "á", which cmd.exe would read otherwise.
  const directory = mkdtempSync(path.join(tmpdir(), 'atlas agent & 100% Ján '));
  const script = 'let input = ""; for await (const chunk of process.stdin) input += chunk;\n'
    + 'console.log(JSON.stringify({ args: process.argv.slice(2), input }));\nprocess.exitCode = 3;\n';
  const bundle = fakeBundle(path.join(directory, 'bundle'), '1.0.0-test', script, process.execPath);
  const folder = path.join(directory, 'home', 'agent');
  await installAgentFolder(bundle, folder);
  const args = ['hook', 'Stop', 'a b', 'c&d'];
  const result = atlas(folder, args, { input: '{"x":1}' });
  assert.equal(result.status, 3, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args, input: '{"x":1}' });
  if (process.platform !== 'win32') {
    // On Linux the PATH reaches the launcher through a link in ~/.local/bin.
    const link = path.join(directory, 'local-bin', 'atlas');
    mkdirSync(path.dirname(link));
    symlinkSync(path.join(folder, 'bin', 'atlas'), link);
    const linked = spawnSync(link, args, { input: '{"x":1}', encoding: 'utf8' });
    assert.equal(linked.status, 3, linked.stderr);
    assert.deepEqual(JSON.parse(linked.stdout), { args, input: '{"x":1}' });
    return;
  }
  // Git Bash, which Claude Code runs hooks in on Windows, runs the sh launcher.
  const bash = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
  const sh = spawnSync(bash, ['-c', '"$0" "$@"', path.join(folder, 'bin', 'atlas').replace(/\\/g, '/'), ...args], { input: '{"x":1}', encoding: 'utf8' });
  if (sh.error) { t.skip('Git Bash is not installed'); return; }
  assert.equal(sh.status, 3, sh.stderr);
  assert.deepEqual(JSON.parse(sh.stdout), { args, input: '{"x":1}' });
});

test('the command the app carries exports a plan with its diagrams drawn', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'atlas-payload-'));
  const repository = path.resolve(import.meta.dirname, '../../..');
  type Runtime = { name: string; executable: Buffer; license: Buffer };
  const { assemble } = createRequire(import.meta.url)('../../scripts/agent-payload.cjs') as { assemble: (repository: string, destination: string, version: string, runtime: Runtime) => unknown };
  // The payload's Node.js is a stand-in, and this one runs its command: the launchers are tested above.
  assemble(repository, path.join(directory, 'agent'), '1.0.0', { name: 'node', executable: Buffer.from('node'), license: Buffer.from('Node.js') });
  const planning = path.join(directory, 'planning');
  cpSync(path.join(repository, 'app', 'e2e', 'fixtures', 'planning'), planning, { recursive: true });
  const result = spawnSync(process.execPath, [path.join(directory, 'agent', 'command', 'bin', 'atlas.js'), 'plan', 'export', 'work-0002', '--planning-dir', planning, '--out', path.join(directory, 'plan.html')], { encoding: 'utf8', cwd: directory });
  assert.equal(result.status, 0, result.stderr);
  // A diagram the command cannot draw (React missing, say) is still exported, with a warning.
  assert.doesNotMatch(result.stderr, /cannot be drawn/);
  assert.match(result.stdout, /Exported work-0002/);
});
