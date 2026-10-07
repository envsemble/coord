import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, realpath, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Telemetry } from './telemetry.ts';
import { DatabaseSync } from 'node:sqlite';
import { statisticsDirectory } from './storage.ts';
import { filesystemCaseSensitive, filesystemNormalizesUnicode } from './filesystem.ts';

test('POSIX backslash planning roots remain separate from nested roots in both collectors', { skip: process.platform === 'win32' }, async () => {
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
    const helper = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../planning-workflow/planning-bootstrap/scripts/log_consultation.py');
    execFileSync(process.env.PYTHON ?? 'python', [helper, root, '--data-dir', metrics, '--files', 'foo\\bar.md']);
    const store = new Telemetry(path.join(expected, 'usage.sqlite'));
    try {
      assert.equal(store.summary().reports, 1);
      assert.equal(store.summary().documents[0].key, 'root:foo\\bar.md');
      assert.equal(store.summary().documents[0].path, 'foo\\bar.md');
    } finally { store.close(); }
  } finally { await rm(temporary, { recursive: true }); }
});

test('cache overrides resolve home shorthand identically in Node and the Python collector', async () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const shorthand = '~/.planning-dashboard-path-test';
  const helper = path.resolve(root, '../../planning-workflow/planning-bootstrap/scripts/log_consultation.py');
  const expected = await statisticsDirectory(root, path.join(homedir(), '.planning-dashboard-path-test'));
  assert.equal(await statisticsDirectory(root, shorthand), expected);
  const script = 'import importlib.util, pathlib, sys; spec = importlib.util.spec_from_file_location("collector", sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); print(module.data_directory(pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])))';
  const collected = execFileSync(process.env.PYTHON ?? 'python', ['-c', script, helper, root, shorthand], { encoding: 'utf8' }).trim();
  assert.equal(path.normalize(collected), expected);
  if (!(await filesystemCaseSensitive(root))) {
    assert.equal(await statisticsDirectory(root.toUpperCase(), shorthand), expected);
    const aliased = execFileSync(process.env.PYTHON ?? 'python', ['-c', script, helper, root.toUpperCase(), shorthand], { encoding: 'utf8' }).trim();
    assert.equal(path.normalize(aliased), expected, 'POSIX case folding must share the same Node/Python cache');
  }
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

test('Unicode cache-root aliases share Node/Python storage only when the filesystem equates them', async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'planning-unicode-cache-')));
  try {
    const root = path.join(temporary, 'planning-cafe\u0301'); await mkdir(root);
    await writeFile(path.join(root, 'planning.json'), '{}');
    const alias = root.normalize('NFC');
    const metrics = path.join(temporary, 'metrics');
    const expected = await statisticsDirectory(root, metrics);
    const helper = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../planning-workflow/planning-bootstrap/scripts/log_consultation.py');
    const script = 'import importlib.util, pathlib, sys; spec = importlib.util.spec_from_file_location("collector", sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); print(module.data_directory(pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])))';
    const collect = (folder: string) => execFileSync(process.env.PYTHON ?? 'python', ['-c', script, helper, folder, metrics], { encoding: 'utf8' }).trim();
    assert.equal(path.normalize(collect(root)), expected);
    if (await filesystemNormalizesUnicode(root)) {
      assert.equal(await statisticsDirectory(alias, metrics), expected);
      assert.equal(path.normalize(collect(alias)), expected);
    } else {
      await mkdir(alias); await writeFile(path.join(alias, 'planning.json'), '{}');
      assert.notEqual(await statisticsDirectory(alias, metrics), expected);
      assert.notEqual(path.normalize(collect(alias)), expected);
    }
  } finally { await rm(temporary, { recursive: true }); }
});
test('Python reports written with no dashboard running are readable by Node with source and unknown identities preserved', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'planning-usage-'));
  let store: Telemetry | null = null;
  try {
    const root = path.join(temporary, 'planning'); await mkdir(root);
    await writeFile(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, work_items: [] }));
    await writeFile(path.join(root, 'note.md'), 'A consulted record.\n');
    await writeFile(path.join(root, 'other.md'), 'Another scoped record.\n');
    const metrics = path.join(temporary, 'metrics');
    const helper = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../planning-workflow/planning-bootstrap/scripts/log_consultation.py');
    execFileSync(process.env.PYTHON ?? 'python', [helper, root, '--data-dir', metrics, '--files', 'note.md']);
    execFileSync(process.env.PYTHON ?? 'python', [helper, root, '--data-dir', metrics, '--task', 'real-task', '--files', 'note.md', '../not-a-document.md']);
    const filename = path.join(await statisticsDirectory(root, metrics), 'usage.sqlite');
    store = new Telemetry(filename);
    const summary = store.summary();
    assert.equal(summary.reports, 2); assert.equal(summary.views, 0);
    assert.equal(summary.tasks, 1); assert.equal(summary.unassigned, 1);
    assert.equal(summary.documentsConsulted, 1); assert.equal(summary.failures, 1);
    assert.ok(summary.agentSince); assert.equal(summary.documents[0].key, 'root:note.md');
    execFileSync(process.env.PYTHON ?? 'python', [helper, root, '--data-dir', metrics, '--task', 'real-task', '--files', 'other.md']);
    execFileSync(process.env.PYTHON ?? 'python', [helper, root, '--data-dir', metrics, '--task', 'unrelated-task', '--files', 'other.md']);
    assert.equal(store.summary().tasks, 2);
    const scoped = store.summary(['root:note.md']);
    assert.equal(scoped.reports, 2); assert.equal(scoped.tasks, 1); assert.equal(scoped.unassigned, 1);
    assert.equal(store.summary([]).reports, 0);
    const unrelated = path.join(temporary, 'unrelated-planning'); await mkdir(unrelated);
    await writeFile(path.join(unrelated, 'planning.json'), JSON.stringify({ schema_version: 1, work_items: [] }));
    await writeFile(path.join(unrelated, 'note.md'), 'A different repository record.\n');
    execFileSync(process.env.PYTHON ?? 'python', [helper, unrelated, '--data-dir', metrics, '--task', 'unrelated-task', '--files', 'note.md']);
    const unrelatedStore = new Telemetry(path.join(await statisticsDirectory(unrelated, metrics), 'usage.sqlite'));
    try {
      assert.equal(unrelatedStore.summary().reports, 1);
      assert.equal(store.summary().reports, 4, 'a reused cache base must not mix planning roots');
    } finally { unrelatedStore.close(); }
    const lock = new DatabaseSync(filename);
    try {
      lock.exec('BEGIN IMMEDIATE');
      execFileSync(process.env.PYTHON ?? 'python', [helper, root, '--data-dir', metrics, '--files', 'other.md'], { stdio: 'pipe', timeout: 8000 });
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
