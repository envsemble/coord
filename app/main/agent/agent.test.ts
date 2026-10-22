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

test('the launchers run the command on the app\'s executable in Node mode, with arguments, and keep the console\'s variables', () => {
  const [sh, cmd] = launchers('C:\\Program Files\\Atlas\\Atlas.exe', 'C:\\Users\\me\\.atlas\\agent\\command\\1.0.0-a\\bin\\atlas.js', 'win32');
  assert.equal(sh.name, 'atlas');
  assert.match(sh.text, /^export ELECTRON_RUN_AS_NODE=1\nexec 'C:\/Program Files\/Atlas\/Atlas\.exe' 'C:\/Users\/me\/\.atlas\/agent\/command\/1\.0\.0-a\/bin\/atlas\.js' "\$@"$/m);
  assert.equal(cmd.name, 'atlas.cmd');
  // One line runs it all, so a launcher rewritten while it runs is never read on from the middle.
  const lines = cmd.text.split('\r\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^@setlocal & set "ELECTRON_RUN_AS_NODE=1" & "C:\\Program Files\\Atlas\\Atlas\.exe" ".+atlas\.js" %\* & call exit \/b %%errorlevel%%$/);
  assert.match(launchers('/opt/Atlas 100%.AppImage', "/home/o'neil/.atlas/agent/command/b/bin/atlas.js", 'linux')[0].text, /^exec '\/opt\/Atlas 100%\.AppImage' '\/home\/o'\\''neil\/.+atlas\.js' "\$@"$/m);
  assert.equal(launchers('C:\\100%\\Atlas.exe', 'C:\\x.js', 'win32')[1].text.includes('"C:\\100%%\\Atlas.exe"'), true);
});

test('the agent folder takes a new build whole, rewrites the launchers for a new executable, and keeps the previous command', async () => {
  const directory = temporary(), folder = path.join(directory, 'home', 'agent');
  const first = fakeBundle(path.join(directory, 'one'), '1.0.0-aaa'), second = fakeBundle(path.join(directory, 'two'), '1.0.0-bbb');
  assert.equal(needsCopy(null, folder, first.build), true);

  const installed = await installAgentFolder(first, folder, '/opt/Atlas', 'linux');
  assert.deepEqual(installed, { copied: true, state: { build: '1.0.0-aaa', executable: '/opt/Atlas', onPath: false } });
  assert.equal(readFileSync(path.join(folder, 'command', '1.0.0-aaa', 'bin', 'atlas.js'), 'utf8'), 'console.log("atlas");\n');
  assert.ok(existsSync(path.join(folder, '.claude-plugin', 'marketplace.json')) && existsSync(path.join(folder, '.agents', 'plugins', 'marketplace.json')));
  assert.match(readFileSync(path.join(folder, 'bin', 'atlas'), 'utf8'), /'\/opt\/Atlas' '.+1\.0\.0-aaa.+atlas\.js'/);
  assert.equal(needsCopy(readState(folder), folder, first.build), false);

  // The same build again copies nothing; another executable (a moved AppImage) only rewrites the launchers.
  assert.equal((await installAgentFolder(first, folder, '/opt/Atlas', 'linux')).copied, false);
  assert.equal((await installAgentFolder(first, folder, '/home/me/Atlas.AppImage', 'linux')).copied, false);
  assert.match(readFileSync(path.join(folder, 'bin', 'atlas'), 'utf8'), /Atlas\.AppImage/);

  // An update replaces the plugin and adds a command beside the previous one, which a running MCP server may still load.
  writeFileSync(path.join(folder, 'state.json'), JSON.stringify({ ...readState(folder), onPath: true }));
  const updated = await installAgentFolder(second, folder, '/home/me/Atlas.AppImage', 'linux');
  assert.deepEqual(updated, { copied: true, state: { build: '1.0.0-bbb', executable: '/home/me/Atlas.AppImage', onPath: true } });
  assert.equal(JSON.parse(readFileSync(path.join(folder, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version, '1.0.0-bbb');
  assert.deepEqual(readdirSync(path.join(folder, 'command')).sort(), ['1.0.0-aaa', '1.0.0-bbb']);
  assert.deepEqual(readdirSync(folder).filter(name => name.startsWith('.') && !['.claude-plugin', '.agents'].includes(name)), [], 'no temporary folders left');
  assert.match(readFileSync(path.join(folder, 'bin', 'atlas'), 'utf8'), /1\.0\.0-bbb/);
  // The next one lets the oldest go.
  await installAgentFolder(fakeBundle(path.join(directory, 'three'), '1.0.0-ccc'), folder, '/opt/Atlas', 'linux');
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
