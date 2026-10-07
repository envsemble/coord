import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, realpath, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Telemetry } from './telemetry.ts';
import { DatabaseSync } from 'node:sqlite';

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
    store = new Telemetry(path.join(metrics, 'usage.sqlite'));
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
    const lock = new DatabaseSync(path.join(metrics, 'usage.sqlite'));
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
