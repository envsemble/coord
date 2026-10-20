// The home database: its schema and version, and projects (order, state, paired computers' rows).
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseVersionError, HomeDatabase, NotPlanningFolderError, planningName, projectOf, schemaVersion, withDatabase, withDatabaseAsync } from './database.ts';
import { prepareHome } from './storage.ts';
function temporary(t: TestContext) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-database-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(file: string, text: string) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); }
function planningFolder(folder: string, name?: string) {
  write(path.join(folder, 'planning.json'), JSON.stringify({ schema_version: 2, ...name && { name }, folders: [], work_items: [] }));
  return realpathSync.native(folder);
}
const tables = (database: HomeDatabase) => (database.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(row => row.name);

test('the database is created with the schema, and one of another version is refused', t => {
  const home = temporary(t);
  withDatabase(home, database => {
    assert.deepEqual(tables(database), ['connection', 'device', 'place', 'project', 'report_effort', 'report_interval', 'report_model', 'report_subagent', 'session', 'session_agent', 'session_leave', 'session_product', 'session_wait', 'session_work', 'setting', 'window', 'work_report']);
    assert.equal(Number((database.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), schemaVersion);
    assert.equal((database.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
    database.setSetting('theme', 'dark');
  });
  assert.equal(withDatabase(home, database => database.setting('theme')), 'dark', 'opening again keeps what is there');
  for (const version of [schemaVersion - 1, schemaVersion + 1]) {
    const raw = new DatabaseSync(path.join(home, 'atlas.db'));
    raw.exec(`PRAGMA user_version = ${version}`);
    raw.close();
    assert.throws(() => HomeDatabase.open(home), DatabaseVersionError);
  }
});

test('the home and its database are owner-only on POSIX', { skip: process.platform === 'win32' && 'Windows profile permissions apply' }, async t => {
  const directory = temporary(t);
  const mode = (file: string) => statSync(file).mode & 0o777;
  const home = path.join(directory, 'home');
  await prepareHome({ override: home });
  assert.equal(mode(home), 0o700);
  withDatabase(home, database => database.setSetting('theme', 'dark'));
  const file = path.join(home, 'atlas.db');
  for (const name of [file, file + '-wal', file + '-shm']) if (existsSync(name)) assert.equal(mode(name), 0o600, name);
});

test('projects keep their order and state, and a paired computer\'s rows are kept apart', async t => {
  const home = temporary(t);
  const one = planningFolder(path.join(home, 'planning', 'one'), 'Coord');
  const two = planningFolder(path.join(home, 'planning', 'two'));
  assert.equal(await planningName(one), 'Coord', 'the registry names the project');
  assert.equal(await planningName(two), 'two', 'else the folder does');
  withDatabase(home, database => {
    const first = database.addProject(one, 'Coord');
    const second = database.addProject(two, 'two');
    if (process.platform === 'win32' || process.platform === 'darwin') assert.equal(database.addProject(one.toUpperCase(), 'Again').id, first.id, 'a folder is one project however it is spelled');
    const third = database.addProject(path.join(home, 'planning', 'three'), 'Three');
    assert.deepEqual(database.projects().map(project => [project.name, project.position, project.state]), [['Coord', 0, 'active'], ['two', 1, 'active'], ['Three', 2, 'active']]);
    database.updateProject(third.id, { position: 0 });
    database.updateProject(second.id, { name: 'Two' });
    database.updateProject(first.id, { state: 'archived' });
    database.updateProject(second.id, { state: 'archived' });
    assert.deepEqual(database.projects().map(project => [project.name, project.state]), [['Three', 'active'], ['Coord', 'archived'], ['Two', 'archived']]);
    // A paired computer's projects: rows of this app, ordered and archived here.
    database.db.prepare('INSERT INTO connection (id, host_id, name, origin, device_id, token, paired_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('c1', 'host-0001', 'Laptop', 'http://100.64.0.2:7346', 'd-' + 'a'.repeat(32), Buffer.from('plain:x'), '2026-10-15T00:00:00.000Z');
    const remote = database.addProject('/home/me/.atlas/planning/one', 'One', 'c1');
    assert.notEqual(remote.id, first.id);
    assert.equal(remote.position, 0, 'a computer\'s projects are numbered on their own');
    assert.deepEqual(database.projects('c1').map(project => project.name), ['One']);
    assert.ok(!database.projects().some(project => project.id === remote.id));
    // Forgetting the computer forgets its rows.
    database.db.prepare("DELETE FROM connection WHERE id = 'c1'").run();
    assert.deepEqual(database.projects('c1'), []);
  });
});

test('only planning folders become projects: never a mistyped or missing path', async t => {
  const directory = temporary(t);
  const home = path.join(directory, 'home');
  const plain = path.join(directory, 'plain');
  mkdirSync(plain);
  await withDatabaseAsync(home, async database => {
    await assert.rejects(projectOf(database, path.join(directory, 'missing')), NotPlanningFolderError);
    await assert.rejects(projectOf(database, plain), NotPlanningFolderError);
    const root = planningFolder(path.join(directory, 'planning'), 'Shop');
    assert.equal((await projectOf(database, root)).name, 'Shop');
    // A project whose folder is briefly not a planning folder keeps its row.
    rmSync(path.join(root, 'planning.json'));
    assert.equal((await projectOf(database, root)).name, 'Shop');
  });
});
