// atlas setup on a user folder of its own: the harnesses it installs into are stand-in programs on
// PATH, and an older host holding its lock is a process of its own.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repository } from './setup.ts';
import { withDatabase } from '@envsemble/atlas-planning';
import { environment, reportsIn, run, temporary, write } from '../testing.ts';

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

/**
 * A process holding the remote-access lock of an older host working from the data folder `data`, as
 * `atlas serve` did before the home database: its host/access.json names the lock's secret.
 */
async function holdHostLock(data: string) {
  const secret = 'S'.repeat(43);
  write(path.join(data, 'host', 'access.json'), JSON.stringify({ version: 2, hostId: 'host-1234-abcd', name: 'Desk', secret, settings: { network: { enabled: false, address: null, port: 7346 } }, devices: [] }));
  const access = pathToFileURL(path.join(repository, 'packages', 'host', 'src', 'access', 'access.ts')).href;
  const planning = pathToFileURL(path.join(repository, 'packages', 'planning', 'src', 'home', 'database.ts')).href;
  const script = `const { AccessStore } = await import(${JSON.stringify(access)});
const { HomeDatabase } = await import(${JSON.stringify(planning)});
const database = HomeDatabase.open(${JSON.stringify(path.join(data, '..', 'serve-home'))});
database.setSetting('host.secret', ${JSON.stringify(secret)});
const store = new AccessStore(database, { info() {}, warn() {}, error() {} }, 'atlas serve');
console.log(await store.lock() === null ? 'locked' : 'not locked');
setInterval(() => {}, 60000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  const [line] = await once(child.stdout!, 'data') as [Buffer];
  assert.equal(line.toString().trim(), 'locked');
  return child;
}

test('atlas setup creates the home, moves the old data folder, grants the home and installs the plugin, once', async t => {
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

  const dry = await run(['setup', '--dry-run'], { env });
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
  const running = await run(['setup'], { env });
  assert.equal(running.status, 1);
  assert.match(running.stderr, /Atlas is running and uses .*\. Quit it \(the app or atlas serve\), then run atlas setup again/);
  assert.ok(existsSync(path.join(legacy, 'planning-roots.json')) && !existsSync(atlasHome) && !existsSync(log), 'nothing changed');
  if (process.platform === 'win32') chmodSync(lock, 0o666);
  rmSync(lock);

  // Nor while an older `atlas serve` works from it, holding no app lock but its host's remote-access lock.
  const serve = await holdHostLock(legacy);
  const serving = await run(['setup'], { env });
  serve.kill();
  await once(serve, 'exit');
  assert.equal(serving.status, 1, serving.stdout);
  assert.match(serving.stderr, /Atlas is running and uses/);
  assert.ok(existsSync(path.join(legacy, 'planning-roots.json')) && existsSync(path.join(legacy, 'host', 'access.json')) && !existsSync(atlasHome), 'nothing changed');

  // Codex keeps a marketplace's first source: one added from another checkout is replaced.
  writeFileSync(log + '.codex.source', path.join(directory, 'another-checkout'));
  const done = await run(['setup'], { env });
  assert.equal(done.status, 0, done.stderr);
  assert.ok(existsSync(path.join(atlasHome, 'planning')));
  assert.ok(!existsSync(path.join(legacy, 'planning-roots.json')), 'the old data folder moved into the home');
  assert.match(done.stdout, /Moved from .*: host, planning-roots\.json/, 'once the host stopped');
  // Then into the home's database: the files are set aside.
  assert.match(done.stdout, /Imported into the Atlas home's database \(the files are set aside in .*\): host\/access\.json, planning-roots\.json/);
  assert.ok(existsSync(path.join(atlasHome, 'atlas.db')) && existsSync(path.join(atlasHome, 'legacy', 'planning-roots.json')) && !existsSync(path.join(atlasHome, 'host')));
  assert.equal(withDatabase(atlasHome, database => database.setting('host.id')), 'host-1234-abcd', 'the host keeps its identity');
  assert.deepEqual(JSON.parse(readFileSync(path.join(claude, 'settings.json'), 'utf8')), { model: 'opus', permissions: { additionalDirectories: [atlasHome] } });
  assert.match(readFileSync(path.join(codex, 'config.toml'), 'utf8'), /^model = "gpt-5\.5"\n\n\[sandbox_workspace_write\]\nwritable_roots = \[.+\]\n$/);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)), [
    ['claude', 'plugin', 'marketplace', 'add', repository], ['claude', 'plugin', 'install', 'atlas@' + marketplace],
    ['codex', 'plugin', 'marketplace', 'add', repository], ['codex', 'plugin', 'marketplace', 'remove', marketplace], ['codex', 'plugin', 'marketplace', 'add', repository], ['codex', 'plugin', 'add', 'atlas@' + marketplace],
  ]);
  const settings = readFileSync(path.join(claude, 'settings.json'), 'utf8'), config = readFileSync(path.join(codex, 'config.toml'), 'utf8');
  // Statistics files in the home's planning folders are imported once and deleted there, for the user to commit.
  const project = path.join(atlasHome, 'planning', 'shop');
  write(path.join(project, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [], work_items: [{ id: 'work-0001', path: 'active/0001-cart', repositories: [], current_plan: null }] }));
  write(path.join(project, 'active/0001-cart/.atlas/statistics.jsonl'), JSON.stringify({ version: 1, at: '2026-10-01T10:00:00.000Z', model: 'model-a', session: null, tokens: null, step: null }) + '\n');
  // A project outside the home is left alone: its file waits until the folder moves into the home.
  const outside = path.join(directory, 'elsewhere');
  write(path.join(outside, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [], work_items: [{ id: 'work-0002', path: 'active/0002-pay', repositories: [], current_plan: null }] }));
  write(path.join(outside, 'active/0002-pay/.atlas/statistics.jsonl'), JSON.stringify({ version: 1, at: '2026-10-01T11:00:00.000Z', model: 'model-a', session: null, tokens: null, step: null }) + '\n');
  withDatabase(atlasHome, database => database.addProject(realpathSync(outside), 'Elsewhere'));
  const again = await run(['setup'], { env });
  assert.ok(!again.stdout.includes('elsewhere'), again.stdout);
  assert.ok(existsSync(path.join(outside, 'active/0002-pay/.atlas/statistics.jsonl')), 'a folder outside the home keeps its statistics file');
  assert.equal(reportsIn(outside, 'work-0002', atlasHome).length, 0);
  assert.match(again.stdout, /Imported 1 work report from .*shop and deleted active\/0001-cart\/\.atlas\/statistics\.jsonl there\. Atlas never commits: commit the removal in that planning folder\./);
  assert.ok(!existsSync(path.join(project, 'active/0001-cart/.atlas')));
  assert.equal(reportsIn(project, 'work-0001', atlasHome).length, 1);
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
