// atlas setup on a user folder of its own: the harnesses it installs into are stand-in programs on
// PATH.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repository } from './setup.ts';
import { environment, run, temporary, write } from '../testing.ts';

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

test('atlas setup creates the home and its database, grants the home and installs the plugin, once', async t => {
  const directory = temporary(t);
  const user = path.join(directory, 'user'), roaming = path.join(directory, 'roaming'), bin = path.join(directory, 'bin');
  const claude = path.join(user, '.claude'), codex = path.join(directory, 'codex-home');
  const log = path.join(directory, 'calls.jsonl');
  write(path.join(claude, 'settings.json'), '{\n  "model": "opus"\n}\n');
  write(path.join(codex, 'config.toml'), 'model = "gpt-5.5"\n');
  write(path.join(bin, '.keep'), '');
  fakeProgram(bin, 'claude', log);
  fakeProgram(bin, 'codex', log);
  const env: NodeJS.ProcessEnv = { ...environment, HOME: user, USERPROFILE: user, APPDATA: roaming, XDG_CONFIG_HOME: path.join(directory, 'config'), CODEX_HOME: codex, PATH: bin + path.delimiter + path.dirname(process.execPath) };
  delete env.ATLAS_HOME; delete env.CLAUDE_CONFIG_DIR; delete env.Path;
  const atlasHome = path.join(user, '.atlas');
  const marketplace = JSON.parse(readFileSync(path.join(repository, '.claude-plugin', 'marketplace.json'), 'utf8')).name;

  const dry = await run(['setup', '--dry-run'], { env });
  assert.equal(dry.status, 0, dry.stderr);
  for (const line of [`Would create the Atlas home: ${atlasHome}`, `Claude Code: would grant the home in ${path.join(claude, 'settings.json')}`, `Would run: claude plugin marketplace add ${repository}`, `Would run: claude plugin install atlas@${marketplace}`, `Would run: codex plugin marketplace add ${repository}`, `Would run: codex plugin add atlas@${marketplace}`]) {
    assert.ok(dry.stdout.includes(line), line + '\n' + dry.stdout);
  }
  assert.equal(readFileSync(path.join(claude, 'settings.json'), 'utf8'), '{\n  "model": "opus"\n}\n', 'a dry run changes nothing');
  assert.ok(!existsSync(log) && !existsSync(atlasHome));

  // Codex keeps a marketplace's first source: one added from another checkout is replaced.
  writeFileSync(log + '.codex.source', path.join(directory, 'another-checkout'));
  const done = await run(['setup'], { env });
  assert.equal(done.status, 0, done.stderr);
  assert.ok(existsSync(path.join(atlasHome, 'planning')) && existsSync(path.join(atlasHome, 'atlas.db')), 'the home, its planning folder and its database');
  assert.deepEqual(JSON.parse(readFileSync(path.join(claude, 'settings.json'), 'utf8')), { model: 'opus', permissions: { additionalDirectories: [atlasHome] } });
  assert.match(readFileSync(path.join(codex, 'config.toml'), 'utf8'), /^model = "gpt-5\.5"\n\n\[sandbox_workspace_write\]\nwritable_roots = \[.+\]\n$/);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)), [
    ['claude', 'plugin', 'marketplace', 'add', repository], ['claude', 'plugin', 'install', 'atlas@' + marketplace],
    ['codex', 'plugin', 'marketplace', 'add', repository], ['codex', 'plugin', 'marketplace', 'remove', marketplace], ['codex', 'plugin', 'marketplace', 'add', repository], ['codex', 'plugin', 'add', 'atlas@' + marketplace],
  ]);
  const settings = readFileSync(path.join(claude, 'settings.json'), 'utf8'), config = readFileSync(path.join(codex, 'config.toml'), 'utf8');
  const again = await run(['setup'], { env });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Claude Code: the home is already granted/);
  assert.match(again.stdout, /Codex: the home is already granted/);
  assert.equal(readFileSync(path.join(claude, 'settings.json'), 'utf8'), settings);
  assert.equal(readFileSync(path.join(codex, 'config.toml'), 'utf8'), config);
  // Without the harnesses, there is nothing to grant or install.
  const bare = await run(['setup', '--dry-run'], { env: { ...env, PATH: path.dirname(process.execPath), CODEX_HOME: path.join(directory, 'none'), HOME: path.join(directory, 'nobody'), USERPROFILE: path.join(directory, 'nobody') } });
  assert.match(bare.stdout, /Claude Code: not found/);
  assert.match(bare.stdout, /Codex: not found/);
  assert.equal((await run(['setup', 'now'], { env })).status, 2);
});
