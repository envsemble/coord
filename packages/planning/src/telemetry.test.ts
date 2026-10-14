import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, realpath, mkdir, symlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir, hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Telemetry } from './telemetry.ts';
import { atlasAppRunning, atlasHome, homePlanningFolders, legacyData, legacyDataDirectory, mergeUsage, migrateLegacyData, prepareHome, recentRootsFile, statisticsDirectory } from './storage.ts';
import { filesystemCaseSensitive, filesystemNormalizesUnicode } from './filesystem.ts';
import { logConsultation, reportConsultation } from './consultation.ts';

test('POSIX backslash planning roots remain separate from nested roots for the command and the app', { skip: process.platform === 'win32' }, async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'planning-backslash-cache-')));
  try {
    const root = path.join(temporary, 'foo\\bar');
    const nested = path.join(temporary, 'foo/bar');
    for (const folder of [root, nested]) {
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [], work_items: [] }));
    }
    const metrics = path.join(temporary, 'metrics');
    const expected = await statisticsDirectory(root, metrics);
    assert.notEqual(await statisticsDirectory(nested, metrics), expected);
    await writeFile(path.join(root, 'foo\\bar.md'), '# Consulted original\n');
    assert.deepEqual(await reportConsultation(root, ['foo\\bar.md'], { home: metrics }), { recorded: 1, failed: 0 });
    const store = new Telemetry(path.join(expected, 'usage.sqlite'));
    try {
      assert.equal(store.summary().reports, 1);
      assert.equal(store.summary().documents[0].key, 'root:foo\\bar.md');
      assert.equal(store.summary().documents[0].path, 'foo\\bar.md');
    } finally { store.close(); }
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
  assert.equal(recentRootsFile(), path.join(atlasHome(), 'planning-roots.json'));
});

test('merging the same usage statistics again adds nothing, so a failed move can be retried', async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'atlas-usage-merge-')));
  try {
    const from = path.join(temporary, 'old'), to = path.join(temporary, 'home');
    const store = new Telemetry(path.join(from, 'usage.sqlite'));
    store.recordView({ id: randomUUID(), path: 'old.md', key: 'old.md', session: randomUUID(), revision: null, contentHash: null });
    store.close();
    const database = new DatabaseSync(path.join(from, 'usage.sqlite'));
    database.prepare('INSERT INTO failures (timestamp, detail) VALUES (?, ?)').run('2026-10-01T00:00:00.000Z', 'locked');
    database.close();
    await writeFile(path.join(from, 'collection-gaps.jsonl'), '{"source":"agent_report","timestamp":"2026-10-02T00:00:00.000Z"}\n');
    await mkdir(to);
    await writeFile(path.join(to, 'collection-gaps.jsonl'), '{"source":"dashboard_view","timestamp":"2026-10-03T00:00:00.000Z"}');
    const counted = () => { const merged = new Telemetry(path.join(to, 'usage.sqlite')); try { const { failures, documents } = merged.summary(); return { failures, documents: documents.length }; } finally { merged.close(); } };
    await mergeUsage(from, to);
    const once = counted();
    assert.deepEqual(once, { failures: 3, documents: 1 }, 'a failure and two gaps (the home\'s own included)');
    await mergeUsage(from, to);
    assert.deepEqual(counted(), once);
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
    const view = (file: string, key: string) => { const store = new Telemetry(file); try { store.recordView({ id: randomUUID(), path: key, key, session: randomUUID(), revision: null, contentHash: null }); } finally { store.close(); } };
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
    const merged = new Telemetry(path.join(home, 'usage', 'abc', 'usage.sqlite'));
    try {
      assert.deepEqual(merged.summary().documents.map(item => item.key).sort(), ['new.md', 'old.md'], 'both stores\' events are kept');
      assert.equal(merged.summary().failures, 1, 'collection gaps are kept');
    } finally { merged.close(); }
    assert.equal(readFileSync(path.join(home, 'desktop-state.json'), 'utf8'), 'kept', 'nothing in the home is overwritten');
    assert.equal(readFileSync(path.join(home, 'legacy', 'desktop-state.json'), 'utf8'), 'older', 'the old copy is set aside in the home');
    assert.ok(existsSync(path.join(home, 'legacy', 'usage', 'abc', 'usage.sqlite')), 'a merged store is set aside too');
    assert.ok(existsSync(path.join(legacy, 'chromium', 'Cache', 'data')) && existsSync(path.join(legacy, 'Preferences')), "Electron's files stay");
    assert.deepEqual(await legacyData(legacy), []);
    assert.deepEqual(await migrateLegacyData(home, legacy), { moved: [], merged: [], setAside: [], failed: [] }, 'a second run has nothing to move');
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

test('view collection is deduplicated and cannot claim agent consultation', () => {
  const store = new Telemetry(':memory:');
  try {
    const event = { id: randomUUID(), path: 'knowledge/example.md', key: 'root:knowledge/example.md', session: randomUUID(), revision: null, contentHash: 'a'.repeat(64) };
    store.recordView(event); store.recordView({ ...event, id: randomUUID() });
    const summary = store.summary();
    assert.equal(summary.views, 1); assert.equal(summary.sessions, 1);
    assert.equal(summary.reports, 0); assert.equal(summary.agentSince, null);
    assert.equal(summary.documents[0].tasks, 0);
    assert.throws(() => store.recordView({ ...event, id: '' }));
  } finally { store.close(); }
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
  const temporary = await mkdtemp(path.join(tmpdir(), 'planning-usage-'));
  let store: Telemetry | null = null;
  try {
    const root = path.join(temporary, 'planning'); await mkdir(root);
    await writeFile(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, work_items: [] }));
    await writeFile(path.join(root, 'note.md'), 'A consulted record.\n');
    await writeFile(path.join(root, 'other.md'), 'Another scoped record.\n');
    const metrics = path.join(temporary, 'metrics');
    const log = (folder: string, files: string[], task?: string) => logConsultation(folder, files, { home: metrics, task });
    assert.deepEqual(await log(root, ['note.md']), { recorded: 1, failed: 0, unavailable: null });
    assert.deepEqual(await log(root, ['note.md', '../not-a-document.md'], 'real-task'), { recorded: 1, failed: 1, unavailable: null });
    const filename = path.join(await statisticsDirectory(root, metrics), 'usage.sqlite');
    store = new Telemetry(filename);
    const summary = store.summary();
    assert.equal(summary.reports, 2); assert.equal(summary.views, 0);
    assert.equal(summary.tasks, 1); assert.equal(summary.unassigned, 1);
    assert.equal(summary.documentsConsulted, 1); assert.equal(summary.failures, 1);
    assert.ok(summary.agentSince); assert.equal(summary.documents[0].key, 'root:note.md');
    await log(root, ['other.md'], 'real-task');
    await log(root, ['other.md'], 'unrelated-task');
    assert.equal(store.summary().tasks, 2);
    const scoped = store.summary(['root:note.md']);
    assert.equal(scoped.reports, 2); assert.equal(scoped.tasks, 1); assert.equal(scoped.unassigned, 1);
    assert.equal(store.summary([]).reports, 0);
    const unrelated = path.join(temporary, 'unrelated-planning'); await mkdir(unrelated);
    await writeFile(path.join(unrelated, 'planning.json'), JSON.stringify({ schema_version: 1, work_items: [] }));
    await writeFile(path.join(unrelated, 'note.md'), 'A different repository record.\n');
    await log(unrelated, ['note.md'], 'unrelated-task');
    const unrelatedStore = new Telemetry(path.join(await statisticsDirectory(unrelated, metrics), 'usage.sqlite'));
    try {
      assert.equal(unrelatedStore.summary().reports, 1);
      assert.equal(store.summary().reports, 4, 'a reused data folder must not mix planning roots');
    } finally { unrelatedStore.close(); }
    const lock = new DatabaseSync(filename);
    try {
      lock.exec('BEGIN IMMEDIATE');
      const locked = await log(root, ['other.md']);
      assert.equal(locked.recorded, 0);
      assert.ok(locked.unavailable, 'a locked store is reported, not thrown');
      lock.exec('ROLLBACK');
      assert.equal(store.summary().reports, 4);
      assert.equal(store.summary().failures, 2, 'a locked database must leave a lasting coverage signal');
    } finally { lock.close(); }
  } finally {
    store?.close();
    const actual = await realpath(temporary);
    assert.equal(path.dirname(actual), await realpath(tmpdir()));
    assert.ok(path.basename(actual).startsWith('planning-usage-'));
    await rm(actual, { recursive: true });
  }
});
