import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { grantClaudeDirectory, grantCodexRoot, repository } from './setup.ts';
import { atlas, environment, temporary, write } from './testing.ts';

const home = process.platform === 'win32' ? 'C:\\Users\\me\\.atlas' : '/home/me/.atlas';
const literal = "'" + home + "'";

test('the home is added to Claude Code\'s additional directories, keeping the rest of the settings', () => {
  assert.equal(grantClaudeDirectory(null, home), JSON.stringify({ permissions: { additionalDirectories: [home] } }, null, 2) + '\n');
  const settings = '{\r\n    "model": "opus",\r\n    "permissions": {\r\n        "allow": ["Bash(git status)"],\r\n        "additionalDirectories": ["/elsewhere"]\r\n    },\r\n    "hooks": {}\r\n}\r\n';
  const granted = grantClaudeDirectory(settings, home)!;
  assert.deepEqual(JSON.parse(granted), { model: 'opus', permissions: { allow: ['Bash(git status)'], additionalDirectories: ['/elsewhere', home] }, hooks: {} });
  assert.equal(granted, settings.replace('["/elsewhere"]', `["/elsewhere", ${JSON.stringify(home)}]`), 'only the list changes');
  assert.equal(grantClaudeDirectory(granted, home), null, 'granted once');
  // A missing key or object is added in the style of its neighbours; everything else stays as written.
  const bare = '{\n  "model": "opus",\n  "env": { "A": "1" }\n}\n';
  assert.equal(grantClaudeDirectory(bare, home), `{\n  "model": "opus",\n  "env": { "A": "1" },\n  "permissions": {\n    "additionalDirectories": [\n      ${JSON.stringify(home)}\n    ]\n  }\n}\n`);
  const noList = '{\n\t"permissions": {\n\t\t"allow": ["Read", "Edit"]\n\t}\n}';
  assert.equal(grantClaudeDirectory(noList, home), `{\n\t"permissions": {\n\t\t"allow": ["Read", "Edit"],\n\t\t"additionalDirectories": [\n\t\t\t${JSON.stringify(home)}\n\t\t]\n\t}\n}`);
  const listed = '{"permissions": {"additionalDirectories": [\n  "/a",\n  "/b"\n]}, "x": [1,2]}';
  assert.equal(grantClaudeDirectory(listed, home), `{"permissions": {"additionalDirectories": [\n  "/a",\n  "/b",\n  ${JSON.stringify(home)}\n]}, "x": [1,2]}`);
  assert.equal(grantClaudeDirectory('{"permissions": {}}', home), `{"permissions": {"additionalDirectories": [ ${JSON.stringify(home)} ]}}`);
  assert.equal(grantClaudeDirectory('{}', home), JSON.stringify({ permissions: { additionalDirectories: [home] } }, null, 2) + '\n');
  assert.throws(() => grantClaudeDirectory('{"permissions": null}', home), /not an object/);
  assert.throws(() => grantClaudeDirectory('{"permissions": []}', home), /not an object/);
  assert.throws(() => grantClaudeDirectory('{ broken', home));
});

test('the home is added to Codex\'s writable roots with a text edit that keeps everything else', () => {
  assert.equal(grantCodexRoot(null, home), `[sandbox_workspace_write]\nwritable_roots = [${literal}]\n`);
  const config = '# My settings\nmodel = "gpt-5.5"\nsandbox_mode = "workspace-write"\n\n[projects."C:\\\\work"]\ntrust_level = "trusted"\n';
  assert.equal(grantCodexRoot(config, home), config + `\n[sandbox_workspace_write]\nwritable_roots = [${literal}]\n`);
  const table = '[sandbox_workspace_write]\nnetwork_access = true # yes\n\n[other]\nx = 1\n';
  assert.equal(grantCodexRoot(table, home), `[sandbox_workspace_write]\nwritable_roots = [${literal}]\nnetwork_access = true # yes\n\n[other]\nx = 1\n`);
  const inline = '[sandbox_workspace_write]\nwritable_roots = ["/tmp/a", \'/tmp/b\'] # roots\n[other]\nwritable_roots = []\n';
  assert.equal(grantCodexRoot(inline, home), inline.replace("'/tmp/b']", `'/tmp/b', ${literal}]`));
  const multiline = '[sandbox_workspace_write]\nwritable_roots = [\n  "/tmp/a",\n  "/tmp/b" # last\n]\n';
  assert.equal(grantCodexRoot(multiline, home), `[sandbox_workspace_write]\nwritable_roots = [\n  "/tmp/a",\n  "/tmp/b", # last\n  ${literal},\n]\n`);
  const crlf = '[sandbox_workspace_write]\r\nwritable_roots = []\r\n';
  assert.equal(grantCodexRoot(crlf, home), `[sandbox_workspace_write]\r\nwritable_roots = [${literal}]\r\n`);
  const dotted = 'sandbox_workspace_write.writable_roots = ["/tmp/a"]\n';
  assert.equal(grantCodexRoot(dotted, home), `sandbox_workspace_write.writable_roots = ["/tmp/a", ${literal}]\n`);
  // A table defined by dotted keys cannot get a header too: the list is added as one more dotted key.
  const dottedOther = 'model = "gpt-5.5"\nsandbox_workspace_write.network_access = true\n\n[other]\nx = 1\n';
  assert.equal(grantCodexRoot(dottedOther, home), `model = "gpt-5.5"\nsandbox_workspace_write.writable_roots = [${literal}]\nsandbox_workspace_write.network_access = true\n\n[other]\nx = 1\n`);
  const dottedBoth = 'sandbox_workspace_write.network_access = true\nsandbox_workspace_write.writable_roots = [\n  "/tmp/a",\n]\n';
  assert.equal(grantCodexRoot(dottedBoth, home), `sandbox_workspace_write.network_access = true\nsandbox_workspace_write.writable_roots = [\n  "/tmp/a",\n  ${literal},\n]\n`);
  const escaped = `[sandbox_workspace_write]\nwritable_roots = [${JSON.stringify(home)}]\n`;
  assert.equal(grantCodexRoot(escaped, home), null, 'already granted, however it is quoted');
  assert.equal(grantCodexRoot(grantCodexRoot(config, home), home), null);
  assert.throws(() => grantCodexRoot('sandbox_workspace_write = { writable_roots = [] }\n', home), /inline table/);
  assert.throws(() => grantCodexRoot('[sandbox_workspace_write]\nwritable_roots = "x"\n', home), /not a list/);
});

/**
 * A stand-in for a harness's command that records how it was called. Like Codex, it refuses to add
 * a marketplace another source added already, until that is removed.
 */
function fakeProgram(folder: string, name: string, log: string) {
  const script = path.join(folder, 'fake.mjs');
  writeFileSync(script, [
    "import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';",
    'const args = process.argv.slice(2), source = ' + JSON.stringify(log) + ' + "." + args[0] + ".source";',
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');`,
    "if (args[2] === 'marketplace' && args[3] === 'remove') rmSync(source, { force: true });",
    "if (args[2] === 'marketplace' && args[3] === 'add') {",
    "  if (existsSync(source) && readFileSync(source, 'utf8') !== args[4]) { console.error(\"Error: marketplace 'atlas' is already added from a different source; remove it before adding this source\"); process.exit(1); }",
    '  writeFileSync(source, args[4]);',
    '}',
  ].join('\n'));
  if (process.platform === 'win32') writeFileSync(path.join(folder, name + '.cmd'), `@"${process.execPath}" "${script}" ${name} %*\r\n`);
  else { writeFileSync(path.join(folder, name), `#!/bin/sh\nexec "${process.execPath}" "${script}" ${name} "$@"\n`); chmodSync(path.join(folder, name), 0o755); }
}

test('atlas setup creates the home, moves the old data folder, grants the home and installs the plugin, once', t => {
  const directory = temporary(t);
  const user = path.join(directory, 'user'), roaming = path.join(directory, 'roaming'), bin = path.join(directory, 'bin');
  const claude = path.join(user, '.claude'), codex = path.join(directory, 'codex-home');
  const log = path.join(directory, 'calls.jsonl');
  write(path.join(claude, 'settings.json'), '{\n  "model": "opus"\n}\n');
  write(path.join(codex, 'config.toml'), 'model = "gpt-5.5"\n');
  const legacy = process.platform === 'win32' ? path.join(roaming, 'Atlas') : process.platform === 'darwin' ? path.join(user, 'Library', 'Application Support', 'Atlas') : path.join(directory, 'config', 'Atlas');
  write(path.join(legacy, 'planning-roots.json'), '{"recent": []}\n');
  write(path.join(bin, '.keep'), '');
  fakeProgram(bin, 'claude', log);
  fakeProgram(bin, 'codex', log);
  const env: NodeJS.ProcessEnv = { ...environment, HOME: user, USERPROFILE: user, APPDATA: roaming, XDG_CONFIG_HOME: path.join(directory, 'config'), CODEX_HOME: codex, PATH: bin + path.delimiter + path.dirname(process.execPath) };
  delete env.ATLAS_HOME; delete env.CLAUDE_CONFIG_DIR; delete env.Path;
  const atlasHome = path.join(user, '.atlas');
  const marketplace = JSON.parse(readFileSync(path.join(repository, '.claude-plugin', 'marketplace.json'), 'utf8')).name;

  const dry = atlas(['setup', '--dry-run'], { env });
  assert.equal(dry.status, 0, dry.stderr);
  for (const line of [`Claude Code: would grant the home in ${path.join(claude, 'settings.json')}`, `Would run: claude plugin marketplace add ${repository}`, `Would run: claude plugin install atlas@${marketplace}`, `Would run: codex plugin marketplace add ${repository}`, `Would run: codex plugin add atlas@${marketplace}`]) {
    assert.ok(dry.stdout.includes(line), line + '\n' + dry.stdout);
  }
  assert.equal(readFileSync(path.join(claude, 'settings.json'), 'utf8'), '{\n  "model": "opus"\n}\n', 'a dry run changes nothing');
  assert.ok(!existsSync(log));

  assert.ok(dry.stdout.includes(`Would move from ${legacy}: planning-roots.json`), dry.stdout);

  // While an Atlas app holds its single-instance lock in the old data folder, nothing moves.
  const lock = path.join(legacy, process.platform === 'win32' ? 'lockfile' : 'SingletonLock');
  // A read-only lockfile refuses to open for writing, as the one the app holds open does.
  if (process.platform === 'win32') { writeFileSync(lock, ''); chmodSync(lock, 0o444); }
  else symlinkSync(`${hostname()}-${process.pid}`, lock);
  const running = atlas(['setup'], { env });
  assert.equal(running.status, 1);
  assert.match(running.stderr, /Atlas is running and uses .*\. Quit it, then run atlas setup again/);
  assert.ok(existsSync(path.join(legacy, 'planning-roots.json')) && !existsSync(atlasHome) && !existsSync(log), 'nothing changed');
  if (process.platform === 'win32') chmodSync(lock, 0o666);
  rmSync(lock);

  // Codex keeps a marketplace's first source: one added from another checkout is replaced.
  writeFileSync(log + '.codex.source', path.join(directory, 'another-checkout'));
  const done = atlas(['setup'], { env });
  assert.equal(done.status, 0, done.stderr);
  assert.ok(existsSync(path.join(atlasHome, 'planning')));
  assert.ok(existsSync(path.join(atlasHome, 'planning-roots.json')) && !existsSync(path.join(legacy, 'planning-roots.json')), 'the old data folder moved into the home');
  assert.match(done.stdout, /Moved from .*: planning-roots\.json/);
  assert.deepEqual(JSON.parse(readFileSync(path.join(claude, 'settings.json'), 'utf8')), { model: 'opus', permissions: { additionalDirectories: [atlasHome] } });
  assert.match(readFileSync(path.join(codex, 'config.toml'), 'utf8'), /^model = "gpt-5\.5"\n\n\[sandbox_workspace_write\]\nwritable_roots = \[.+\]\n$/);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)), [
    ['claude', 'plugin', 'marketplace', 'add', repository], ['claude', 'plugin', 'install', 'atlas@' + marketplace],
    ['codex', 'plugin', 'marketplace', 'add', repository], ['codex', 'plugin', 'marketplace', 'remove', marketplace], ['codex', 'plugin', 'marketplace', 'add', repository], ['codex', 'plugin', 'add', 'atlas@' + marketplace],
  ]);
  const settings = readFileSync(path.join(claude, 'settings.json'), 'utf8'), config = readFileSync(path.join(codex, 'config.toml'), 'utf8');
  const again = atlas(['setup'], { env });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Claude Code: the home is already granted/);
  assert.match(again.stdout, /Codex: the home is already granted/);
  assert.equal(readFileSync(path.join(claude, 'settings.json'), 'utf8'), settings);
  assert.equal(readFileSync(path.join(codex, 'config.toml'), 'utf8'), config);
  // Without the harnesses, there is nothing to grant or install.
  const bare = atlas(['setup', '--dry-run'], { env: { ...env, PATH: path.dirname(process.execPath), CODEX_HOME: path.join(directory, 'none'), HOME: path.join(directory, 'nobody'), USERPROFILE: path.join(directory, 'nobody') } });
  assert.match(bare.stdout, /Claude Code: not found/);
  assert.match(bare.stdout, /Codex: not found/);
  assert.equal(atlas(['setup', 'now'], { env }).status, 2);
});
