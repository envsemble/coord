// The agent folder and the PATH entry, without Electron or the agents' commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installAgentFolder, launchers, needsCopy, readState, recordAgent } from './agentFolder.ts';
import { unpack } from './agentPack.ts';
import { commandPaths, pointPluginAtCommand } from './pluginCommands.ts';
import { fakeBundle, fakePlugin } from './testing.ts';
import { mergedPath, pathKey, withoutPathEntry, withPathEntry } from './userPath.ts';
import { chosenProgram } from './programs.ts';
import { agentCheck } from './verify.ts';

const temporary = () => mkdtempSync(path.join(tmpdir(), 'coord-agent-'));
const { packCommand } = createRequire(import.meta.url)('../../scripts/agent-payload.cjs') as { packCommand: (directory: string) => { files: number } };

test('the launchers run the build\'s command on its Node.js, by paths relative to themselves', () => {
  const [sh, cmd] = launchers('1.0.0-a', 'win32');
  assert.equal(sh.name, 'coord');
  assert.match(sh.text, /^exec "\$agent\/command\/1\.0\.0-a\/runtime\/node\.exe" "\$agent\/command\/1\.0\.0-a\/bin\/coord\.js" "\$@"$/m);
  assert.equal(cmd.name, 'coord.cmd');
  // One line runs it all, so a launcher rewritten while it runs is never read on from the middle.
  const lines = cmd.text.split('\r\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(lines[1], '@"%~dp0..\\command\\1.0.0-a\\runtime\\node.exe" "%~dp0..\\command\\1.0.0-a\\bin\\coord.js" %* & call exit /b %%errorlevel%%');
  const [linux] = launchers('1.0.0-a', 'linux');
  assert.match(linux.text, /readlink -f "\$0"/);
  assert.match(linux.text, /^exec "\$agent\/command\/1\.0\.0-a\/runtime\/node" /m);
});

test('the agent folder takes a new build whole, writes its launchers, and keeps the previous command', async () => {
  const directory = temporary(), folder = path.join(directory, 'home', 'agent');
  const first = fakeBundle(path.join(directory, 'one'), '1.0.0-aaa'), second = fakeBundle(path.join(directory, 'two'), '1.0.0-bbb');
  // The Windows app carries its command packed into one file; the update below comes from one.
  packCommand(second.directory);
  assert.deepEqual(readdirSync(second.directory).sort(), ['.agents', '.claude-plugin', 'build.json', 'command.pack', 'plugin']);
  assert.equal(needsCopy(null, folder, first.build, 'linux'), true);

  const installed = await installAgentFolder(first, folder, 'linux');
  assert.deepEqual(installed, { copied: true, state: { build: '1.0.0-aaa', onPath: false } });
  assert.equal(readFileSync(path.join(folder, 'command', '1.0.0-aaa', 'bin', 'coord.js'), 'utf8'), 'console.log("coord");\n');
  assert.ok(existsSync(path.join(folder, 'command', '1.0.0-aaa', 'runtime', 'node')));
  assert.ok(existsSync(path.join(folder, '.claude-plugin', 'marketplace.json')) && existsSync(path.join(folder, '.agents', 'plugins', 'marketplace.json')));
  assert.match(readFileSync(path.join(folder, 'bin', 'coord'), 'utf8'), /1\.0\.0-aaa\/bin\/coord\.js/);
  assert.equal(needsCopy(readState(folder), folder, first.build, 'linux'), false);
  // The copy's MCP server runs the launcher by its full path.
  assert.equal(JSON.parse(readFileSync(path.join(folder, 'plugin', '.mcp.json'), 'utf8')).mcpServers.coord.command, path.posix.join(folder, 'bin', 'coord'));

  // The same build again copies nothing, but puts back a launcher that is not this build's.
  writeFileSync(path.join(folder, 'bin', 'coord'), '#!/bin/sh\n');
  assert.equal((await installAgentFolder(first, folder, 'linux')).copied, false);
  assert.match(readFileSync(path.join(folder, 'bin', 'coord'), 'utf8'), /1\.0\.0-aaa\/bin\/coord\.js/);

  // An update replaces the plugin and adds a command beside the previous one, which a running MCP
  // server may still load. When each agent was connected stays.
  writeFileSync(path.join(folder, 'state.json'), JSON.stringify({ ...readState(folder), onPath: true }));
  await recordAgent(folder, 'codex', { connectedAt: '2026-10-22T10:00:00.000Z' });
  const updated = await installAgentFolder(second, folder, 'linux');
  assert.deepEqual(updated, { copied: true, state: { build: '1.0.0-bbb', onPath: true, agents: { codex: { connectedAt: '2026-10-22T10:00:00.000Z' } } } });
  assert.equal(JSON.parse(readFileSync(path.join(folder, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version, '1.0.0-bbb');
  assert.deepEqual(readdirSync(path.join(folder, 'command')).sort(), ['1.0.0-aaa', '1.0.0-bbb']);
  assert.deepEqual(readdirSync(folder).filter(name => name.startsWith('.') && !['.claude-plugin', '.agents'].includes(name)), [], 'no temporary folders left');
  assert.match(readFileSync(path.join(folder, 'bin', 'coord'), 'utf8'), /1\.0\.0-bbb/);
  assert.equal(readFileSync(path.join(folder, 'command', '1.0.0-bbb', 'bin', 'coord.js'), 'utf8'), 'console.log("coord");\n');
  if (process.platform !== 'win32') assert.equal(statSync(path.join(folder, 'command', '1.0.0-bbb', 'runtime', 'node')).mode & 0o777, statSync(path.join(first.directory, 'command', 'runtime', 'node')).mode & 0o777);
  // A pack naming a file outside its folder is refused.
  const index = Buffer.from(JSON.stringify([{ path: '../escaped', size: 0, mode: 0o644 }])), length = Buffer.alloc(4);
  length.writeUInt32BE(index.length);
  writeFileSync(path.join(directory, 'bad.pack'), Buffer.concat([length, index]));
  await assert.rejects(unpack(path.join(directory, 'bad.pack'), path.join(directory, 'bad')), /no index of files inside it/);
  assert.equal(existsSync(path.join(directory, 'escaped')), false);
  // The next one lets the oldest go.
  await installAgentFolder(fakeBundle(path.join(directory, 'three'), '1.0.0-ccc'), folder, 'linux');
  assert.deepEqual(readdirSync(path.join(folder, 'command')).sort(), ['1.0.0-bbb', '1.0.0-ccc']);
});

test('the command\'s folder is added to the user Path once, and taken off again, keeping the other entries as written', () => {
  const environment = { USERPROFILE: 'C:\\Users\\me' };
  const entry = 'C:\\Users\\me\\.coord\\agent\\bin';
  const path_ = '%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Tools;';
  assert.equal(withPathEntry(path_, entry, environment), '%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Tools;' + entry);
  assert.equal(withPathEntry(null, entry, environment), entry);
  // Already there, however it is written.
  assert.equal(withPathEntry('C:\\Tools;%userprofile%\\.Coord\\agent\\bin\\', entry, environment), null);
  assert.equal(withoutPathEntry('C:\\Tools;;' + entry + ';D:\\x', entry, environment), 'C:\\Tools;;D:\\x');
  assert.equal(withoutPathEntry('C:\\Tools', entry, environment), null);
  // The app's own PATH, repaired at start: the entries it lacks at its end, in the variable whatever its case.
  assert.equal(pathKey({ path: 'C:\\Windows' }, 'win32'), 'path');
  assert.equal(mergedPath('C:\\Windows;C:\\Tools\\', ['c:\\tools', 'C:\\Users\\me\\.local\\bin'], 'win32'), 'C:\\Windows;C:\\Tools\\;C:\\Users\\me\\.local\\bin');
  assert.equal(mergedPath('/usr/bin:/bin', ['/home/me/.nvm/bin', '/usr/bin/'], 'linux'), '/usr/bin:/bin:/home/me/.nvm/bin');
});

test('the copy of the plugin runs the command by its full path, in the form each agent runs it on each system', async () => {
  const plugin = path.join(temporary(), 'plugin');
  const read = (file: string) => JSON.parse(readFileSync(path.join(plugin, file), 'utf8'));
  const hooks = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'coord hook Stop', timeout: 60 }, { type: 'command', command: 'echo other' }] }] } };
  const stop = (file: string) => read(file).hooks.Stop[0].hooks;
  const copy = () => fakePlugin(plugin, hooks);

  copy();
  const windows = 'C:\\Users\\Ján O\'Neil\\.coord\\agent', paths = commandPaths(windows, '1.0.0-a', 'win32');
  assert.equal(paths.node, 'C:\\Users\\Ján O\'Neil\\.coord\\agent\\command\\1.0.0-a\\runtime\\node.exe');
  await pointPluginAtCommand(plugin, windows, '1.0.0-a', 'win32');
  // Claude Code: the build's Node.js on the command, without a shell (Git Bash or PowerShell); other commands as they were.
  assert.deepEqual(stop('hooks/hooks.json'), [{ type: 'command', command: paths.node, args: [paths.script, 'hook', 'Stop'], timeout: 60 }, { type: 'command', command: 'echo other' }]);
  // Codex: the launcher, whose path stays from one update to the next, for cmd.exe.
  assert.equal(stop('hooks/codex.json')[0].command, `"${paths.cmd}" hook Stop`);
  assert.deepEqual(read('.mcp.json').mcpServers.coord, { command: paths.node, args: [paths.script, 'mcp'] });
  // Codex keeps a copy, which a failed refresh would leave naming a build since removed: its own file runs the launcher.
  assert.equal(read('.codex-plugin/plugin.json').mcpServers, './.codex-mcp.json');
  assert.deepEqual(read('.codex-mcp.json').mcpServers.coord, { command: paths.cmd, args: ['mcp'] });

  copy();
  await pointPluginAtCommand(plugin, '/home/o\'neil/.coord/agent', '1.0.0-a', 'linux');
  const sh = "'/home/o'\\''neil/.coord/agent/bin/coord'";
  assert.equal(stop('hooks/hooks.json')[0].command, sh + ' hook Stop');
  assert.equal(stop('hooks/codex.json')[0].command, sh + ' hook Stop');
  assert.deepEqual(read('.mcp.json').mcpServers.coord, { command: '/home/o\'neil/.coord/agent/bin/coord', args: ['mcp'] });
  assert.deepEqual(read('.codex-mcp.json').mcpServers.coord, { command: '/home/o\'neil/.coord/agent/bin/coord', args: ['mcp'] });
});

test('a connected agent is ready once its hooks ran since it was connected, whatever its configuration says; untrusted hooks and tools used without hooks warn', () => {
  const connectedAt = '2026-10-22T10:00:00.000Z', before = '2026-10-21T10:00:00.000Z', after = '2026-10-22T11:00:00.000Z';
  assert.deepEqual(agentCheck({ connectedAt, hooksAt: after, toolsAt: after, trust: 'unknown' }), { status: 'ready', at: after });
  assert.deepEqual(agentCheck({ connectedAt, hooksAt: before, toolsAt: null, trust: 'trusted' }), { status: 'waiting' });
  assert.deepEqual(agentCheck({ connectedAt, hooksAt: before, toolsAt: after, trust: 'unknown' }), { status: 'no-hooks' });
  assert.deepEqual(agentCheck({ connectedAt, hooksAt: null, toolsAt: null, trust: 'untrusted' }), { status: 'untrusted' });
  assert.deepEqual(agentCheck({ connectedAt, hooksAt: after, toolsAt: after, trust: 'untrusted' }), { status: 'ready', at: after });
});

test('a program chosen for an agent is used only while it is the agent\'s, by its name, at a full path that is there', () => {
  const folder = temporary(), program = path.join(folder, process.platform === 'win32' ? 'codex.cmd' : 'codex'), other = path.join(folder, 'notepad.exe');
  for (const file of [program, other]) writeFileSync(file, '');
  writeFileSync(path.join(folder, 'programs.json'), JSON.stringify({ codex: program, claude: other }));
  assert.equal(chosenProgram(folder, 'codex'), program);
  assert.equal(chosenProgram(folder, 'claude'), null, 'another program is not Claude Code');
  writeFileSync(path.join(folder, 'programs.json'), JSON.stringify({ codex: path.basename(program) }));
  assert.equal(chosenProgram(folder, 'codex'), null, 'a path that is not full');
});
