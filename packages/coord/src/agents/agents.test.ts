import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claudeInstalled, cmdLine, codexInstalled, codexPluginEnabled, marketplaceOf, onPath } from './agents.ts';
import { installedHome } from '../home/homePath.ts';

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

test("a marketplace's plugin is named from its manifest: the release's coord@coord, Coord Dev's coord-dev@coord-dev", () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'coord-marketplace-'));
  try {
    const write = (manifest: unknown) => { const dir = path.join(folder, '.claude-plugin'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir); writeFileSync(path.join(dir, 'marketplace.json'), JSON.stringify(manifest)); };
    write({ name: 'coord', plugins: [{ name: 'coord', source: './plugin' }] });
    assert.deepEqual(marketplaceOf(folder), { marketplace: 'coord', plugin: 'coord@coord' });
    write({ name: 'coord-dev', plugins: [{ name: 'coord-dev', source: './plugin' }] });
    assert.deepEqual(marketplaceOf(folder), { marketplace: 'coord-dev', plugin: 'coord-dev@coord-dev' });
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("a plugin is turned on and off in Codex's config.toml, the rest of it left as written", () => {
  const config = '[marketplaces.coord]\r\nsource = "x"\r\n\r\n[plugins."coord@coord"]\r\nenabled = true\r\n';
  // Added at the end, in the file's own line endings.
  const added = codexPluginEnabled(config, 'coord-dev@coord-dev', true);
  assert.equal(added, config.trimEnd() + '\r\n\r\n[plugins."coord-dev@coord-dev"]\r\nenabled = true\r\n');
  // Turned off where it is, then on again: back to what it was; unchanged when it already says so.
  const off = codexPluginEnabled(added, 'coord-dev@coord-dev', false);
  assert.equal(off, added.replace(/enabled = true\r\n$/, 'enabled = false\r\n'));
  assert.equal(codexPluginEnabled(off, 'coord-dev@coord-dev', true), added);
  assert.equal(codexPluginEnabled(added, 'coord@coord', true), added);
  // A table without the line gets it; an empty file gets the table.
  assert.equal(codexPluginEnabled('[plugins."coord-dev@coord-dev"]\n[other]\n', 'coord-dev@coord-dev', false), '[plugins."coord-dev@coord-dev"]\nenabled = false\n[other]\n');
  assert.equal(codexPluginEnabled('', 'coord-dev@coord-dev', true), '[plugins."coord-dev@coord-dev"]\nenabled = true\n');
});

test("a command installed in a home's agent folder belongs to that home; one anywhere else to none", () => {
  const marked = new Set([path.join('/h/.coord-dev', 'agent', 'state.json')]);
  const exists = (file: string) => marked.has(file);
  assert.equal(installedHome(path.join('/h/.coord-dev', 'agent', 'command', '0.9.0-abc', 'bin', 'coord.js'), exists), path.join('/h/.coord-dev'));
  // An agent folder the app did not write (no state.json), and a checkout's command.
  assert.equal(installedHome(path.join('/h/.coord', 'agent', 'command', '0.9.0-abc', 'bin', 'coord.js'), exists), null);
  assert.equal(installedHome(path.join('/src/coord', 'packages', 'coord', 'bin', 'coord.js'), exists), null);
});

