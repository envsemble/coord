// The agent folder and the PATH entry, without Electron or the agents' commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installAgentFolder, launchers, needsCopy, readState } from './agentFolder.ts';
import { fakeBundle } from './testing.ts';
import { withoutPathEntry, withPathEntry } from './userPath.ts';

const temporary = () => mkdtempSync(path.join(tmpdir(), 'atlas-agent-'));

test('the launchers run the build\'s command on its Node.js, by paths relative to themselves', () => {
  const [sh, cmd] = launchers('1.0.0-a', 'win32');
  assert.equal(sh.name, 'atlas');
  assert.match(sh.text, /^exec "\$agent\/command\/1\.0\.0-a\/runtime\/node\.exe" "\$agent\/command\/1\.0\.0-a\/bin\/atlas\.js" "\$@"$/m);
  assert.equal(cmd.name, 'atlas.cmd');
  // One line runs it all, so a launcher rewritten while it runs is never read on from the middle.
  const lines = cmd.text.split('\r\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(lines[1], '@"%~dp0..\\command\\1.0.0-a\\runtime\\node.exe" "%~dp0..\\command\\1.0.0-a\\bin\\atlas.js" %* & call exit /b %%errorlevel%%');
  const [linux] = launchers('1.0.0-a', 'linux');
  assert.match(linux.text, /readlink -f "\$0"/);
  assert.match(linux.text, /^exec "\$agent\/command\/1\.0\.0-a\/runtime\/node" /m);
});

test('the agent folder takes a new build whole, writes its launchers, and keeps the previous command', async () => {
  const directory = temporary(), folder = path.join(directory, 'home', 'agent');
  const first = fakeBundle(path.join(directory, 'one'), '1.0.0-aaa'), second = fakeBundle(path.join(directory, 'two'), '1.0.0-bbb');
  assert.equal(needsCopy(null, folder, first.build, 'linux'), true);

  const installed = await installAgentFolder(first, folder, 'linux');
  assert.deepEqual(installed, { copied: true, state: { build: '1.0.0-aaa', onPath: false } });
  assert.equal(readFileSync(path.join(folder, 'command', '1.0.0-aaa', 'bin', 'atlas.js'), 'utf8'), 'console.log("atlas");\n');
  assert.ok(existsSync(path.join(folder, 'command', '1.0.0-aaa', 'runtime', 'node')));
  assert.ok(existsSync(path.join(folder, '.claude-plugin', 'marketplace.json')) && existsSync(path.join(folder, '.agents', 'plugins', 'marketplace.json')));
  assert.match(readFileSync(path.join(folder, 'bin', 'atlas'), 'utf8'), /1\.0\.0-aaa\/bin\/atlas\.js/);
  assert.equal(needsCopy(readState(folder), folder, first.build, 'linux'), false);

  // The same build again copies nothing, but puts back a launcher that is not this build's.
  writeFileSync(path.join(folder, 'bin', 'atlas'), '#!/bin/sh\n');
  assert.equal((await installAgentFolder(first, folder, 'linux')).copied, false);
  assert.match(readFileSync(path.join(folder, 'bin', 'atlas'), 'utf8'), /1\.0\.0-aaa\/bin\/atlas\.js/);

  // An update replaces the plugin and adds a command beside the previous one, which a running MCP server may still load.
  writeFileSync(path.join(folder, 'state.json'), JSON.stringify({ ...readState(folder), onPath: true }));
  const updated = await installAgentFolder(second, folder, 'linux');
  assert.deepEqual(updated, { copied: true, state: { build: '1.0.0-bbb', onPath: true } });
  assert.equal(JSON.parse(readFileSync(path.join(folder, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version, '1.0.0-bbb');
  assert.deepEqual(readdirSync(path.join(folder, 'command')).sort(), ['1.0.0-aaa', '1.0.0-bbb']);
  assert.deepEqual(readdirSync(folder).filter(name => name.startsWith('.') && !['.claude-plugin', '.agents'].includes(name)), [], 'no temporary folders left');
  assert.match(readFileSync(path.join(folder, 'bin', 'atlas'), 'utf8'), /1\.0\.0-bbb/);
  // The next one lets the oldest go.
  await installAgentFolder(fakeBundle(path.join(directory, 'three'), '1.0.0-ccc'), folder, 'linux');
  assert.deepEqual(readdirSync(path.join(folder, 'command')).sort(), ['1.0.0-bbb', '1.0.0-ccc']);
});

test('the command\'s folder is added to the user Path once, and taken off again, keeping the other entries as written', () => {
  const environment = { USERPROFILE: 'C:\\Users\\me' };
  const entry = 'C:\\Users\\me\\.atlas\\agent\\bin';
  const path_ = '%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Tools;';
  assert.equal(withPathEntry(path_, entry, environment), '%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Tools;' + entry);
  assert.equal(withPathEntry(null, entry, environment), entry);
  // Already there, however it is written.
  assert.equal(withPathEntry('C:\\Tools;%userprofile%\\.Atlas\\agent\\bin\\', entry, environment), null);
  assert.equal(withoutPathEntry('C:\\Tools;;' + entry + ';D:\\x', entry, environment), 'C:\\Tools;;D:\\x');
  assert.equal(withoutPathEntry('C:\\Tools', entry, environment), null);
});
