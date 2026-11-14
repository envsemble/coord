import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claudeInstalled, cmdLine, codexInstalled, onPath } from './agents.ts';

test('the Coord plugin is read from each agent\'s plugin list, with its version and where it came from', () => {
  const claude = JSON.stringify([
    { id: 'other@elsewhere', version: '1.0.0', enabled: true },
    { id: 'coord@coord', version: '0.9.0', enabled: false, readFromFolder: '/home/me/.coord/agent/plugin' },
  ]);
  assert.deepEqual(claudeInstalled(claude, 'coord@coord'), { version: '0.9.0', enabled: false, source: '/home/me/.coord/agent' });
  assert.equal(claudeInstalled('[]', 'coord@coord'), null);
  const codex = JSON.stringify({
    installed: [{ pluginId: 'coord@coord', version: '0.9.0', installed: true, enabled: true, marketplaceSource: { sourceType: 'local', source: '\\\\?\\C:\\Users\\me\\.coord\\agent' } }],
    available: [],
  });
  assert.deepEqual(codexInstalled(codex, 'coord@coord'), { version: '0.9.0', enabled: true, source: 'C:\\Users\\me\\.coord\\agent' });
  assert.equal(codexInstalled('{"installed": [], "available": []}', 'coord@coord'), null);
  // An agent too old for --json is not connected, as far as Coord can tell.
  assert.equal(codexInstalled('error: unexpected argument', 'coord@coord'), null);
});

test('a .cmd program\'s arguments reach it as written through cmd.exe', () => {
  assert.equal(cmdLine('C:\\npm\\codex.cmd', ['plugin', 'add', 'coord@coord']), '"C:\\npm\\codex.cmd ^"plugin^" ^"add^" ^"coord@coord^""');
  // Spaces, & and % in a folder's name are escaped, and a trailing backslash does not escape the quote.
  assert.equal(cmdLine('C:\\Program Files\\codex.cmd', ['C:\\Tom & Jerry\\%HOME%\\']), '"C:\\Program^ Files\\codex.cmd ^"C:\\Tom^ ^&^ Jerry\\^%HOME^%\\\\^""');
});

test('a program is found on the PATH whatever case its variable has, as Explorer starts programs with `path`', { skip: process.platform !== 'win32' && 'Windows names variables in any case' }, () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'coord-path-'));
  try {
    writeFileSync(path.join(folder, 'claude.exe'), '');
    assert.equal(onPath('claude', { path: folder, PathExt: '.COM;.EXE' }), path.join(folder, 'claude.exe'));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
