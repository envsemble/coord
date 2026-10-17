import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, realpath, mkdir, symlink } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir, homedir, hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { recordView, usageSummary } from './telemetry.ts';
import { HomeDatabase, projectOf, withDatabase, withDatabaseAsync } from '../home/database.ts';
import { atlasAppRunning, atlasHome, homePlanningFolders, legacyData, legacyDataDirectory, legacySettings, legacyUsageSchema, mergeUsage, migrateLegacyData, prepareHome, statisticsDirectory } from '../home/storage.ts';
import { filesystemCaseSensitive, filesystemNormalizesUnicode } from '../system/filesystem.ts';
import { logConsultation, reportConsultation } from './consultation.ts';

/** A planning folder's usage store as Atlas kept it before the home database, with one view of `key`. */
function legacyView(file: string, key: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  const store = new DatabaseSync(file);
  try {
    store.exec(legacyUsageSchema);
    store.prepare("INSERT INTO events (id, source, document_key, path, session_id, timestamp) VALUES (?, 'dashboard_view', ?, ?, ?, ?)").run(randomUUID(), key, key, randomUUID(), new Date().toISOString());
  } finally { store.close(); }
}
function legacyCounts(file: string) {
  const store = new DatabaseSync(file);
  try { return { events: (store.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n, failures: (store.prepare('SELECT count(*) AS n FROM failures').get() as { n: number }).n }; }
  finally { store.close(); }
}

test('POSIX backslash planning roots remain separate projects from nested roots', { skip: process.platform === 'win32' }, async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'planning-backslash-cache-')));
  try {
    const root = path.join(temporary, 'foo\\bar');
    const nested = path.join(temporary, 'foo/bar');
    for (const folder of [root, nested]) {
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [], work_items: [] }));
    }
    const metrics = path.join(temporary, 'metrics');
    await writeFile(path.join(root, 'foo\\bar.md'), '# Consulted original\n');
    assert.deepEqual(await reportConsultation(root, ['foo\\bar.md'], { home: metrics }), { recorded: 1, failed: 0 });
    await withDatabaseAsync(metrics, async database => {
      const summary = usageSummary(database, (await projectOf(database, root)).id);
      assert.equal(summary.reports, 1);
      assert.equal(summary.documents[0].key, 'root:foo\\bar.md');
      assert.equal(summary.documents[0].path, 'foo\\bar.md');
      assert.equal(usageSummary(database, (await projectOf(database, nested)).id).reports, 0);
    });
  } finally { await rm(temporary, { recursive: true }); }
});

test('the Atlas home is ~/.atlas unless overridden, and the old data folder follows the per-user convention', async () => {
  const home = path.resolve('/home/someone');
  assert.equal(atlasHome(undefined, {}, home), path.join(home, '.atlas'));
  assert.equal(atlasHome(undefined, { ATLAS_HOME: path.resolve('/elsewhere') }, home), path.resolve('/elsewhere'));
  assert.equal(atlasHome('~/explicit', { ATLAS_HOME: path.resolve('/elsewhere') }, home), path.join(home, 'explicit'), 'an explicit --home wins over ATLAS_HOME');
  assert.equal(legacyDataDirectory({ APPDATA: path.resolve('/roaming') }, 'win32', home), path.join(path.resolve('/roaming'), 'Atlas'));
  assert.equal(legacyDataDirectory({}, 'win32', home), path.join(home, 'AppData', 'Roaming', 'Atlas'));
  assert.equal(legacyDataDirectory({}, 'linux', home), path.join(home, '.config', 'Atlas'));
  assert.equal(legacyDataDirectory({ XDG_CONFIG_HOME: path.resolve('/xdg') }, 'linux', home), path.join(path.resolve('/xdg'), 'Atlas'));
  assert.equal(legacyDataDirectory({ XDG_CONFIG_HOME: 'relative/config' }, 'linux', home), path.join(home, '.config', 'Atlas'), 'a relative XDG_CONFIG_HOME is ignored');
  assert.equal(legacyDataDirectory({}, 'darwin', home), path.join(home, 'Library', 'Application Support', 'Atlas'));
  const root = path.dirname(fileURLToPath(import.meta.url));
  const statistics = await statisticsDirectory(root);
  assert.equal(path.dirname(statistics), path.join(atlasHome(), 'usage'));
  assert.match(path.basename(statistics), /^[a-f0-9]{16}$/);
});

test('merging the same usage statistics again adds nothing, so a failed move can be retried', async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'atlas-usage-merge-')));
  try {
    const from = path.join(temporary, 'old'), to = path.join(temporary, 'home');
    legacyView(path.join(from, 'usage.sqlite'), 'old.md');
    const database = new DatabaseSync(path.join(from, 'usage.sqlite'));
    database.prepare('INSERT INTO failures (timestamp, detail) VALUES (?, ?)').run('2026-10-01T00:00:00.000Z', 'locked');
    database.close();
    await writeFile(path.join(from, 'collection-gaps.jsonl'), '{"source":"agent_report","timestamp":"2026-10-02T00:00:00.000Z"}\n');
    await mkdir(to);
    await writeFile(path.join(to, 'collection-gaps.jsonl'), '{"source":"dashboard_view","timestamp":"2026-10-03T00:00:00.000Z"}');
    await mergeUsage(from, to);
    const once = legacyCounts(path.join(to, 'usage.sqlite'));
    assert.deepEqual(once, { events: 1, failures: 1 });
    await mergeUsage(from, to);
    assert.deepEqual(legacyCounts(path.join(to, 'usage.sqlite')), once);
    assert.equal(readFileSync(path.join(to, 'collection-gaps.jsonl'), 'utf8').trim().split('\n').length, 2, 'the home\'s unfinished last line is kept apart');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("the old data folder moves into the home once, merging usage per planning folder and setting aside what the home has", async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'atlas-home-migration-')));
  try {
    const user = path.join(temporary, 'user'), appData = path.join(temporary, 'roaming');
    const legacy = legacyDataDirectory({ APPDATA: appData, XDG_CONFIG_HOME: path.join(temporary, 'config') }, process.platform, user);
    const write = async (file: string, text: string) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); };
    const view = legacyView;
    await write(path.join(legacy, 'usage', 'def', 'usage.sqlite'), 'usage');
    view(path.join(legacy, 'usage', 'abc', 'usage.sqlite'), 'old.md');
    await write(path.join(legacy, 'usage', 'abc', 'collection-gaps.jsonl'), '{"source":"agent_report"}\n');
    await write(path.join(legacy, 'host', 'access.json'), 'access');
    await write(path.join(legacy, 'planning-roots.json'), 'recent');
    await write(path.join(legacy, 'connections.json'), 'connections');
    await write(path.join(legacy, 'logs', 'atlas.log'), 'log');
    await write(path.join(legacy, 'logs', 'host.1.log'), 'host log');
    await write(path.join(legacy, 'chromium', 'Cache', 'data'), 'cache');
    await write(path.join(legacy, 'Preferences'), 'electron');
    const home = path.join(user, '.atlas');
    await write(path.join(home, 'desktop-state.json'), 'kept');
    await write(path.join(legacy, 'desktop-state.json'), 'older');
    // A hook recorded document use for the same planning folder before the move.
    view(path.join(home, 'usage', 'abc', 'usage.sqlite'), 'new.md');
    const environment = { APPDATA: appData, XDG_CONFIG_HOME: path.join(temporary, 'config') };
    // Preparing a home never takes the user's data.
    assert.equal((await prepareHome({ environment, home: user })).home, home);
    assert.ok(existsSync(path.join(home, 'planning')), 'the home and its planning folder are created');
    assert.deepEqual(await legacyData(legacy), ['host', 'planning-roots.json', 'connections.json', 'desktop-state.json', 'logs/atlas.log', 'logs/host.1.log', 'usage/abc', 'usage/def']);
    const first = await migrateLegacyData(home, legacy);
    assert.deepEqual(first, { moved: ['host', 'planning-roots.json', 'connections.json', 'logs/atlas.log', 'logs/host.1.log', 'usage/def'], merged: ['usage/abc'], setAside: ['desktop-state.json'], failed: [] });
    assert.equal(readFileSync(path.join(home, 'usage', 'def', 'usage.sqlite'), 'utf8'), 'usage');
    assert.deepEqual(legacyCounts(path.join(home, 'usage', 'abc', 'usage.sqlite')).events, 2, 'both stores\' events are kept');
    assert.equal(readFileSync(path.join(home, 'usage', 'abc', 'collection-gaps.jsonl'), 'utf8').trim().split('\n').length, 1, 'collection gaps are kept');
    assert.equal(readFileSync(path.join(home, 'desktop-state.json'), 'utf8'), 'kept', 'nothing in the home is overwritten');
    assert.equal(readFileSync(path.join(home, 'legacy', 'desktop-state.json'), 'utf8'), 'older', 'the old copy is set aside in the home');
    assert.ok(existsSync(path.join(home, 'legacy', 'usage', 'abc', 'usage.sqlite')), 'a merged store is set aside too');
    assert.ok(existsSync(path.join(legacy, 'chromium', 'Cache', 'data')) && existsSync(path.join(legacy, 'Preferences')), "Electron's files stay");
    assert.deepEqual(await legacyData(legacy), []);
    assert.deepEqual(await migrateLegacyData(home, legacy), { moved: [], merged: [], setAside: [], failed: [] }, 'a second run has nothing to move');
    // An older Atlas writing the old folder again: a later move numbers what it sets aside, so it never sticks.
    await write(path.join(legacy, 'desktop-state.json'), 'older again');
    assert.deepEqual(await legacySettings(legacy), ['desktop-state.json']);
    assert.deepEqual((await migrateLegacyData(home, legacy)).setAside, ['desktop-state.json']);
    assert.equal(readFileSync(path.join(home, 'legacy', 'desktop-state.json.2'), 'utf8'), 'older again');
    assert.deepEqual(await legacySettings(legacy), []);
    await mkdir(path.join(home, 'planning', 'one'), { recursive: true });
    await writeFile(path.join(home, 'planning', 'one', 'planning.json'), '{}');
    await mkdir(path.join(home, 'planning', 'not-planning'), { recursive: true });
    assert.deepEqual(await homePlanningFolders(home), [path.join(home, 'planning', 'one')]);
  } finally { await rm(temporary, { recursive: true }); }
});

test('a running Atlas app is recognized by the single-instance lock it holds in its data folder', async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'atlas-app-lock-')));
  try {
    assert.equal(atlasAppRunning(path.join(temporary, 'missing'), 'win32'), false);
    // Windows: Chromium deletes lockfile when the app exits; one that opens for writing is stale.
    await writeFile(path.join(temporary, 'lockfile'), '');
    assert.equal(atlasAppRunning(temporary, 'win32'), false);
    if (process.platform !== 'win32') {
      // Elsewhere: SingletonLock names the computer and the process holding it.
      await symlink(`${hostname()}-${process.pid}`, path.join(temporary, 'SingletonLock'));
      assert.equal(atlasAppRunning(temporary, process.platform), true);
      await rm(path.join(temporary, 'SingletonLock'));
      await symlink(`${hostname()}-99999999`, path.join(temporary, 'SingletonLock'));
      assert.equal(atlasAppRunning(temporary, process.platform), false, 'the process is gone');
    }
  } finally { await rm(temporary, { recursive: true }); }
});

test('~\\ starts a home path on Windows, as ~/ does everywhere', { skip: process.platform !== 'win32' }, () => {
  const home = path.resolve('/home/someone');
  assert.equal(atlasHome(undefined, { ATLAS_HOME: '~\\atlas' }, home), path.join(home, 'atlas'));
  assert.equal(atlasHome(undefined, { ATLAS_HOME: '~/atlas' }, home), path.join(home, 'atlas'));
});

test('data folder overrides resolve home shorthand identically for every caller', async () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const shorthand = '~/.atlas-data-path-test';
  const expected = await statisticsDirectory(root, path.join(homedir(), '.atlas-data-path-test'));
  assert.equal(await statisticsDirectory(root, shorthand), expected);
  if (!(await filesystemCaseSensitive(root))) assert.equal(await statisticsDirectory(root.toUpperCase(), shorthand), expected, 'case-folded aliases share one store');
});

test('view collection is deduplicated and cannot claim agent consultation', async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'atlas-views-')));
  const database = HomeDatabase.open(temporary);
  try {
    const project = database.addProject(path.join(temporary, 'planning'), 'Planning');
    const event = { id: randomUUID(), path: 'knowledge/example.md', key: 'root:knowledge/example.md', session: randomUUID(), revision: null, contentHash: 'a'.repeat(64) };
    recordView(database, project.id, event); recordView(database, project.id, { ...event, id: randomUUID() });
    const summary = usageSummary(database, project.id);
    assert.equal(summary.views, 1); assert.equal(summary.sessions, 1);
    assert.equal(summary.reports, 0); assert.equal(summary.agentSince, null);
    assert.equal(summary.dashboardSince, project.createdAt, 'views count since the project was added');
    assert.equal(summary.documents[0].tasks, 0);
    assert.throws(() => recordView(database, project.id, { ...event, id: '' }));
  } finally { database.close(); await rm(temporary, { recursive: true }); }
});

test('Unicode root aliases share storage only when the filesystem equates them', async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'planning-unicode-cache-')));
  try {
    const root = path.join(temporary, 'planning-cafe\u0301'); await mkdir(root);
    await writeFile(path.join(root, 'planning.json'), '{}');
    const alias = root.normalize('NFC');
    const metrics = path.join(temporary, 'metrics');
    const expected = await statisticsDirectory(root, metrics);
    if (await filesystemNormalizesUnicode(root)) assert.equal(await statisticsDirectory(alias, metrics), expected);
    else {
      await mkdir(alias); await writeFile(path.join(alias, 'planning.json'), '{}');
      assert.notEqual(await statisticsDirectory(alias, metrics), expected);
    }
  } finally { await rm(temporary, { recursive: true }); }
});

test('consultation written with no app running is readable by the app with source and unknown identities preserved', async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'planning-usage-')));
  try {
    const root = path.join(temporary, 'planning'); await mkdir(root);
    await writeFile(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, work_items: [] }));
    await writeFile(path.join(root, 'note.md'), 'A consulted record.\n');
    await writeFile(path.join(root, 'other.md'), 'Another scoped record.\n');
    const metrics = path.join(temporary, 'metrics');
    const log = (folder: string, files: string[], task?: string) => logConsultation(folder, files, { home: metrics, task });
    assert.deepEqual(await log(root, ['note.md']), { recorded: 1, failed: 0, unavailable: null });
    assert.deepEqual(await log(root, ['note.md', '../not-a-document.md'], 'real-task'), { recorded: 1, failed: 1, unavailable: null });
    const summary = (keys?: string[], folder = root) => withDatabase(metrics, database => usageSummary(database, database.projectByFolder(folder)!.id, keys));
    const first = summary();
    assert.equal(first.reports, 2); assert.equal(first.views, 0);
    assert.equal(first.tasks, 1); assert.equal(first.unassigned, 1);
    assert.equal(first.documentsConsulted, 1); assert.equal(first.failures, 1);
    assert.ok(first.agentSince); assert.equal(first.documents[0].key, 'root:note.md');
    await log(root, ['other.md'], 'real-task');
    await log(root, ['other.md'], 'unrelated-task');
    assert.equal(summary().tasks, 2);
    const scoped = summary(['root:note.md']);
    assert.equal(scoped.reports, 2); assert.equal(scoped.tasks, 1); assert.equal(scoped.unassigned, 1);
    assert.equal(summary([]).reports, 0);
    const unrelated = path.join(temporary, 'unrelated-planning'); await mkdir(unrelated);
    await writeFile(path.join(unrelated, 'planning.json'), JSON.stringify({ schema_version: 1, work_items: [] }));
    await writeFile(path.join(unrelated, 'note.md'), 'A different repository record.\n');
    await log(unrelated, ['note.md'], 'unrelated-task');
    assert.equal(summary(undefined, unrelated).reports, 1);
    assert.equal(summary().reports, 4, 'one database never mixes projects');
    assert.equal(summary().reports, 4);
  } finally { await rm(temporary, { recursive: true }); }
});
