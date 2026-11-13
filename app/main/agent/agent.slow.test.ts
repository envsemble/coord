// The launchers the agent folder writes, and the plugin's hooks and MCP server as its copy there
// runs them, each as its agent starts it, on this Node.js standing in for the one the app ships, in
// a home with letters such as "á" in its path, as a user's folder may have; and the command the
// packaged app carries, assembled as packaging assembles it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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

test('the launcher passes arguments, input, output and the exit status through, and the plugin\'s copy runs it by its full path', async t => {
  // A folder name with a space, an ampersand, a percent sign, an apostrophe and an "á", which a shell would read otherwise.
  const directory = mkdtempSync(path.join(tmpdir(), 'atlas agent & 100% Ján\'s '));
  const script = 'let input = ""; for await (const chunk of process.stdin) input += chunk;\n'
    + 'console.log(JSON.stringify({ args: process.argv.slice(2), input }));\nprocess.exitCode = 3;\n';
  const bundle = fakeBundle(path.join(directory, 'bundle'), '1.0.0-test', script, process.execPath);
  cpSync(path.resolve(import.meta.dirname, '../../../plugin'), path.join(bundle.directory, 'plugin'), { recursive: true, force: true });
  const folder = path.join(directory, 'home', 'agent');
  await installAgentFolder(bundle, folder);
  const args = ['hook', 'Stop', 'a b', 'c&d'];
  const result = atlas(folder, args, { input: '{"x":1}' });
  assert.equal(result.status, 3, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args, input: '{"x":1}' });

  // The copy's SessionStart hooks and MCP server, as each agent runs them: Claude Code's hooks in sh
  // (on Windows without a shell, as a program and its arguments), Codex's with cmd.exe /C on Windows
  // (the command line in quotes, as Codex passes it) and $SHELL -lc elsewhere; MCP servers as programs,
  // Codex's its own copy, the launcher.
  const read = (file: string) => JSON.parse(readFileSync(path.join(folder, 'plugin', file), 'utf8'));
  const claude = read('hooks/hooks.json').hooks.SessionStart[0].hooks[0], codex = read('hooks/codex.json').hooks.SessionStart[0].hooks[0];
  const mcp = read('.mcp.json').mcpServers.atlas, codexMcp = read('.codex-mcp.json').mcpServers.atlas;
  const ran = (child: ReturnType<typeof spawnSync>, expected: string[]) => {
    assert.equal(child.status, 3, String(child.stderr));
    assert.deepEqual(JSON.parse(String(child.stdout)), { args: expected, input: '{"x":1}' });
  };
  const options = { input: '{"x":1}', encoding: 'utf8' as const };
  if (process.platform === 'win32') {
    ran(spawnSync(claude.command, claude.args, options), ['hook', 'SessionStart']);
    ran(spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/C', `"${codex.command}"`], { ...options, windowsVerbatimArguments: true }), ['hook', 'SessionStart']);
  } else {
    ran(spawnSync('/bin/sh', ['-c', claude.command], options), ['hook', 'SessionStart']);
    ran(spawnSync(process.env.SHELL || '/bin/sh', ['-lc', codex.command], options), ['hook', 'SessionStart']);
  }
  ran(spawnSync(mcp.command, mcp.args, options), ['mcp']);
  // Codex starts its server, the launcher, as a program: on Windows a .cmd, which runs in cmd.exe.
  ran(process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${codexMcp.command}" ${codexMcp.args.join(' ')}"`], { ...options, windowsVerbatimArguments: true })
    : spawnSync(codexMcp.command, codexMcp.args, options), ['mcp']);
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

test('the command the app carries checks a planning folder with its diagrams', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'atlas-payload-'));
  const repository = path.resolve(import.meta.dirname, '../../..');
  type Runtime = { name: string; executable: Buffer; license: Buffer };
  const { assemble } = createRequire(import.meta.url)('../../scripts/agent-payload.cjs') as { assemble: (repository: string, destination: string, version: string, runtime: Runtime) => unknown };
  // The payload's Node.js is a stand-in, and this one runs its command: the launchers are tested above.
  assemble(repository, path.join(directory, 'agent'), '1.0.0', { name: 'node', executable: Buffer.from('node'), license: Buffer.from('Node.js') });
  const planning = path.join(directory, 'planning');
  cpSync(path.join(repository, 'app', 'e2e', 'fixtures', 'planning'), planning, { recursive: true });
  const result = spawnSync(process.execPath, [path.join(directory, 'agent', 'command', 'bin', 'atlas.js'), 'check', planning], { encoding: 'utf8', cwd: directory });
  assert.equal(result.status, 0, result.stderr);
});

test('the Windows uninstaller disconnects the agents connected to the agent folder, and only them', { skip: process.platform !== 'win32' && 'the uninstaller is Windows only' }, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'atlas-uninstall-'));
  const profile = path.join(directory, 'Ján'), agent = path.join(profile, '.atlas', 'agent');
  mkdirSync(agent, { recursive: true });
  for (const name of ['state.json', 'onboarding.json']) writeFileSync(path.join(agent, name), '{}');
  mkdirSync(path.join(agent, 'activity'));
  writeFileSync(path.join(agent, 'activity', 'claude-hooks'), '2026-10-22T10:00:00.000Z');
  // Stand-ins for claude and codex, which record their arguments and list the plugins they have:
  // Claude Code's from the agent folder, Codex's from a checkout. Codex is not on the PATH: its
  // program was chosen in Settings. The entry for Claude Code names another program (claude.cmd,
  // which a stand-in there would log), so the PATH's is used.
  const shims = path.join(directory, 'bin'), chosen = path.join(directory, 'chosen');
  mkdirSync(shims);
  mkdirSync(chosen);
  writeFileSync(path.join(agent, 'programs.json'), JSON.stringify({ codex: path.join(chosen, 'codex.cmd'), claude: path.join(chosen, 'claude.cmd') }));
  writeFileSync(path.join(chosen, 'claude.cmd'), '@echo off\r\n>>"%~dp0claude.log" echo %*\r\nexit /b 1\r\n');
  const lists = {
    claude: [{ id: 'atlas@atlas', version: '0.8.0', enabled: true, readFromFolder: path.join(agent, 'plugin') }],
    codex: { installed: [{ pluginId: 'atlas@atlas', installed: true, marketplaceSource: { source: '\\\\?\\C:\\checkout\\atlas' } }] },
  };
  for (const [name, list] of Object.entries(lists)) {
    const folder = name === 'codex' ? chosen : shims;
    writeFileSync(path.join(folder, name + '.json'), JSON.stringify(list));
    writeFileSync(path.join(folder, name + '.cmd'), `@echo off\r\n>>"%~dp0${name}.log" echo %*\r\nif "%~1 %~2"=="plugin list" type "%~dp0${name}.json"\r\nexit /b 0\r\n`);
  }
  const environment: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'path'));
  const system = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  Object.assign(environment, { USERPROFILE: profile, Path: [shims, system].join(';'), ATLAS_REMOVE_AGENT: path.resolve(import.meta.dirname, '../../build/remove-agent.ps1') });
  // As installer.nsh runs it, but leaving the registry alone.
  const powershell = path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '& ([ScriptBlock]::Create([IO.File]::ReadAllText($env:ATLAS_REMOVE_AGENT))) -KeepRegistry'], { env: environment, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const log = (name: string) => readFileSync(path.join(name === 'codex' ? chosen : shims, name + '.log'), 'utf8').split(/\r?\n/).filter(Boolean);
  assert.deepEqual(log('claude'), ['plugin list --json', 'plugin uninstall atlas@atlas', 'plugin marketplace remove atlas']);
  assert.deepEqual(log('codex'), ['plugin list --json --marketplace atlas']);
  assert.ok(!existsSync(path.join(chosen, 'claude.log')), 'a program of another name is not run');
  assert.deepEqual(readdirSync(agent), [], 'the state, the programs chosen, the activity and the onboarding are forgotten');
});
