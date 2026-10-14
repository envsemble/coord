// The home database: its schema and versions, projects (order, state, paired computers' rows), and
// the migration of the files Atlas kept in its home before it.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseVersionError, HomeDatabase, planningName, schemaVersion, withDatabase, withDatabaseAsync } from './database.ts';
import { migrateHomeFiles, pendingHomeFiles } from './homeMigration.ts';
import { legacyUsageSchema, statisticsDirectory } from './storage.ts';
import { usageSummary } from './telemetry.ts';

function temporary(t: TestContext) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-database-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(file: string, text: string) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); }
function planningFolder(folder: string, name?: string) {
  write(path.join(folder, 'planning.json'), JSON.stringify({ schema_version: 1, ...name && { name }, repositories: [], work_items: [] }));
  return realpathSync.native(folder);
}
const tables = (database: HomeDatabase) => (database.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(row => row.name);

test('the database is created with the accepted schema, and refuses a newer one', t => {
  const home = temporary(t);
  withDatabase(home, database => {
    assert.deepEqual(tables(database), ['collection_gap', 'connection', 'device', 'document_use', 'project', 'report_model', 'report_subagent', 'session', 'session_work', 'setting', 'tab', 'window', 'work_report']);
    assert.equal(Number((database.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), schemaVersion);
    assert.equal((database.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
    database.setSetting('theme', 'dark');
  });
  // Opening again keeps what is there.
  assert.equal(withDatabase(home, database => database.setting('theme')), 'dark');
  const raw = new DatabaseSync(path.join(home, 'atlas.db'));
  raw.exec(`PRAGMA user_version = ${schemaVersion + 1}`);
  raw.close();
  assert.throws(() => HomeDatabase.open(home), DatabaseVersionError);
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
    database.updateProject(second.id, { state: 'hidden', name: 'Two' });
    database.updateProject(first.id, { state: 'archived' });
    assert.deepEqual(database.projects().map(project => [project.name, project.state]), [['Three', 'active'], ['Coord', 'archived'], ['Two', 'hidden']]);
    // A paired computer's projects: rows of this app, ordered and hidden here.
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

test('the home\'s files are imported once, and set aside', async t => {
  const home = temporary(t);
  const shop = planningFolder(path.join(home, 'planning', 'shop'), 'Shop');
  const kom = planningFolder(path.join(home, 'planning', 'kom'));
  const outside = planningFolder(path.join(home, '..', path.basename(home) + '-outside', 'planning'));
  t.after(() => rmSync(path.dirname(outside), { recursive: true, force: true }));
  const secret = 'S'.repeat(43);
  write(path.join(home, 'host', 'access.json'), JSON.stringify({ version: 2, hostId: 'host-1234-abcd', name: 'Desk', secret, settings: { network: { enabled: true, address: '100.64.0.1', port: 7346 } }, devices: [
    { deviceId: 'd-' + 'b'.repeat(32), name: 'Phone', platform: 'android', tokenHash: 'c'.repeat(64), scopes: ['computer', 'access:manage'], pairedAt: '2026-10-01T00:00:00.000Z', lastSeenAt: null },
    { deviceId: 'broken' },
  ] }));
  write(path.join(home, 'host', 'folders.json'), JSON.stringify({ version: 1, folders: [{ path: outside, openedAt: null }, { path: path.join(home, 'gone'), openedAt: null }, { path: shop, openedAt: null }] }));
  write(path.join(home, 'planning-roots.json'), JSON.stringify({ recent: [kom] }));
  write(path.join(home, 'connections.json'), JSON.stringify([{ hostId: 'laptop-0001', name: 'Laptop', origin: 'http://100.64.0.2:7346', deviceId: 'd-' + 'e'.repeat(32), token: 'safe:c2VhbGVk', pairedAt: '2026-10-02T00:00:00.000Z', manageAccess: true }]));
  write(path.join(home, 'desktop-state.json'), JSON.stringify({ version: 1, theme: 'dark', windows: [shop, 'atlas-remote:laptop-0001/f-' + '1'.repeat(32)], folders: {
    a: { root: shop, used: '2026', bounds: { x: 10, y: 20, width: 900, height: 700 }, maximized: true, ui: { sidebar: { visible: true, width: 300, expanded: [] }, page: 'work', tabs: { active: 'work:work-0001', items: [
      { id: 'view:work', target: { kind: 'view', view: 'work' }, preview: false },
      { id: 'work:work-0001', target: { kind: 'work', work: 'work-0001', section: 'ledger' }, preview: false },
      { id: 'work:work-0002', target: { kind: 'work', work: 'work-0002', section: 'diagrams', diagram: 'diagrams/model.puml' }, preview: true },
      { id: 'file:notes.md', target: { kind: 'file', path: 'notes.md' }, preview: false },
    ] } } },
    b: { root: 'atlas-remote:laptop-0001/f-' + '1'.repeat(32), used: '2026', remotePath: '/home/me/.atlas/planning/coord' },
  } }));
  const session = '0b6c3c9e-5a1f-4d2b-9a7e-1f2e3d4c5b6a';
  write(path.join(home, 'sessions', session + '.json'), JSON.stringify({ session, transcriptPath: '/home/me/.claude/projects/x/' + session + '.jsonl', updated: '2026-10-03T00:00:00.000Z', work: [{ planningFolder: shop, workId: 'work-0001', amending: true, linked: '2026-10-03T00:00:00.000Z', amended: '2026-10-03T00:00:00.000Z' }] }));
  write(path.join(home, 'sessions', session + '.json.lock'), '{}');
  // Document use of the shop project, and of a folder Atlas no longer knows.
  const usage = await statisticsDirectory(shop, home);
  mkdirSync(usage, { recursive: true });
  const old = new DatabaseSync(path.join(usage, 'usage.sqlite'));
  old.exec(legacyUsageSchema);
  old.prepare("INSERT INTO events (id, source, document_key, path, task_id, session_id, timestamp) VALUES ('e-1', 'agent_report', 'root:notes.md', 'notes.md', 'work-0001', 's', '2026-09-01T00:00:00.000Z')").run();
  old.prepare("INSERT INTO metadata (key, value) VALUES ('dashboard_since', '2026-08-01T00:00:00.000Z')").run();
  old.prepare("INSERT INTO failures (timestamp, detail) VALUES ('2026-09-02T00:00:00.000Z', 'x')").run();
  old.close();
  write(path.join(usage, 'collection-gaps.jsonl'), '{"source":"dashboard_view","timestamp":"2026-09-03T00:00:00.000Z"}\n');
  write(path.join(home, 'usage', 'ffffffffffffffff', 'usage.sqlite'), '');

  const pending = await pendingHomeFiles(home);
  assert.deepEqual(pending.filter(name => !name.startsWith('usage/')), ['host/access.json', 'connections.json', 'host/folders.json', 'planning-roots.json', 'desktop-state.json', 'sessions/' + session + '.json']);
  const database = HomeDatabase.open(home);
  try {
    const result = await migrateHomeFiles(database);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.unmatched, ['usage/ffffffffffffffff'], 'usage of an unknown folder waits');
    assert.equal(result.imported.length, 7);
    // The host's identity and its devices.
    assert.deepEqual(['host.id', 'host.name', 'host.secret'].map(key => database.setting(key)), ['host-1234-abcd', 'Desk', secret]);
    assert.deepEqual(JSON.parse(database.setting('host.network')!), { enabled: true, address: '100.64.0.1', port: 7346 });
    assert.deepEqual(database.db.prepare('SELECT id, name, platform, manage_access FROM device').all().map(row => ({ ...row })), [{ id: 'd-' + 'b'.repeat(32), name: 'Phone', platform: 'android', manage_access: 1 }]);
    // Paired computers, their tokens as sealed as they were.
    const connection = database.db.prepare('SELECT * FROM connection').get() as { id: string; host_id: string; token: Uint8Array; manage_access: number };
    assert.deepEqual([connection.host_id, Buffer.from(connection.token).toString('utf8'), connection.manage_access], ['laptop-0001', 'safe:c2VhbGVk', 1]);
    // The folder list, then the recent folders, then the home's others, become projects; gone folders do not.
    assert.deepEqual(database.projects().map(project => [project.name, project.folder]), [['planning', outside], ['Shop', shop], ['kom', kom]]);
    // The theme and the windows open at quit, each with its project page first and its tabs.
    assert.equal(database.setting('theme'), 'dark');
    const windows = database.db.prepare('SELECT * FROM "window" ORDER BY id').all() as Record<string, unknown>[];
    assert.deepEqual(windows.map(row => [row.connection_id, row.x, row.y, row.width, row.height, row.maximized, row.sidebar_width]), [[null, 10, 20, 900, 700, 1, 300], [connection.id, 0, 0, 1280, 820, 0, 280]]);
    const tabs = database.db.prepare('SELECT window_id, project_id, position, kind, target, active FROM tab ORDER BY window_id, position').all() as Record<string, unknown>[];
    const shopProject = database.projectByFolder(shop)!.id;
    assert.deepEqual(tabs.map(row => [row.window_id, row.project_id, row.kind, row.target, row.active]), [
      [windows[0].id, shopProject, 'project', null, 0],
      [windows[0].id, shopProject, 'work', '{"work":"work-0001","anchor":null}', 1],
      [windows[0].id, shopProject, 'diagram', '{"work":"work-0002","path":"diagrams/model.puml","element":null}', 0],
      [windows[0].id, shopProject, 'file', '{"path":"notes.md","anchor":null}', 0],
      [windows[1].id, database.projectByFolder('/home/me/.atlas/planning/coord', connection.id)!.id, 'project', null, 1],
    ]);
    // The session and its links.
    assert.deepEqual({ ...database.db.prepare('SELECT harness, transcript_path FROM session').get() }, { harness: 'claude-code', transcript_path: '/home/me/.claude/projects/x/' + session + '.jsonl' });
    assert.deepEqual({ ...database.db.prepare('SELECT project_id, work_id, amending FROM session_work').get() }, { project_id: shopProject, work_id: 'work-0001', amending: 1 });
    // Document use, its gaps, and since when views were counted.
    const summary = usageSummary(database, shopProject);
    assert.deepEqual([summary.reports, summary.tasks, summary.failures, summary.dashboardSince], [1, 1, 2, '2026-08-01T00:00:00.000Z']);
    // Everything imported is set aside; the lock files are gone; a second run has nothing left.
    assert.deepEqual(readdirSync(path.join(home, 'legacy')).sort(), ['connections.json', 'desktop-state.json', 'host', 'planning-roots.json', 'sessions', 'usage']);
    assert.ok(!existsSync(path.join(home, 'host')) && !existsSync(path.join(home, 'sessions')));
    assert.deepEqual(await pendingHomeFiles(home), ['usage/ffffffffffffffff']);
    const again = await migrateHomeFiles(database);
    assert.deepEqual([again.imported, again.failed], [[], []]);
    assert.equal(database.projects().length, 3);
    assert.equal(usageSummary(database, shopProject).reports, 1);
  } finally { database.close(); }
});

test('a home file that cannot be read stays where it is', async t => {
  const home = temporary(t);
  write(path.join(home, 'connections.json'), '{ not json');
  write(path.join(home, 'host', 'access.json'), JSON.stringify({ version: 3 }));
  const result = await withDatabaseAsync(home, database => migrateHomeFiles(database));
  assert.deepEqual(result.imported, []);
  assert.deepEqual(result.failed.map(item => item.split(':')[0]), ['host/access.json', 'connections.json']);
  assert.ok(existsSync(path.join(home, 'connections.json')) && existsSync(path.join(home, 'host', 'access.json')));
});
