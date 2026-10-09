import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, realpath, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Telemetry } from './telemetry.ts';
import { atlasDataDirectory, recentRootsFile, statisticsDirectory } from './storage.ts';
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
    assert.deepEqual(await reportConsultation(root, ['foo\\bar.md'], { dataDir: metrics }), { recorded: 1, failed: 0 });
    const store = new Telemetry(path.join(expected, 'usage.sqlite'));
    try {
      assert.equal(store.summary().reports, 1);
      assert.equal(store.summary().documents[0].key, 'root:foo\\bar.md');
      assert.equal(store.summary().documents[0].path, 'foo\\bar.md');
    } finally { store.close(); }
  } finally { await rm(temporary, { recursive: true }); }
});

test('the Atlas data folder follows the per-user convention and honours overrides', async () => {
  const home = path.resolve('/home/someone');
  assert.equal(atlasDataDirectory(undefined, { APPDATA: path.resolve('/roaming') }, 'win32', home), path.join(path.resolve('/roaming'), 'Atlas'));
  assert.equal(atlasDataDirectory(undefined, {}, 'win32', home), path.join(home, 'AppData', 'Roaming', 'Atlas'));
  assert.equal(atlasDataDirectory(undefined, {}, 'linux', home), path.join(home, '.config', 'Atlas'));
  assert.equal(atlasDataDirectory(undefined, { XDG_CONFIG_HOME: path.resolve('/xdg') }, 'linux', home), path.join(path.resolve('/xdg'), 'Atlas'));
  assert.equal(atlasDataDirectory(undefined, { XDG_CONFIG_HOME: 'relative/config' }, 'linux', home), path.join(home, '.config', 'Atlas'), 'a relative XDG_CONFIG_HOME is ignored');
  assert.equal(atlasDataDirectory(undefined, {}, 'darwin', home), path.join(home, 'Library', 'Application Support', 'Atlas'));
  assert.equal(atlasDataDirectory(undefined, { ATLAS_DATA_DIR: path.resolve('/data'), APPDATA: path.resolve('/roaming') }, 'win32', home), path.resolve('/data'));
  assert.equal(atlasDataDirectory('~/explicit', { ATLAS_DATA_DIR: path.resolve('/data') }, 'linux', home), path.join(home, 'explicit'), 'an explicit --data-dir wins over ATLAS_DATA_DIR');
  const root = path.dirname(fileURLToPath(import.meta.url));
  const statistics = await statisticsDirectory(root);
  assert.equal(path.dirname(statistics), path.join(atlasDataDirectory(), 'usage'));
  assert.match(path.basename(statistics), /^[a-f0-9]{16}$/);
  assert.equal(recentRootsFile(), path.join(atlasDataDirectory(), 'planning-roots.json'));
  assert.ok(!atlasDataDirectory().includes('planning-dashboard'), 'the retired dashboard cache is not used');
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
    const log = (folder: string, files: string[], task?: string) => logConsultation(folder, files, { dataDir: metrics, task });
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
