// Coord Dev's copy of the Coord data (scripts/dev-home.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
// @ts-expect-error -- a plain ES module of the launcher's, without types
import { copyRealData } from '../scripts/dev-home.mjs';

test("Coord Dev copies the real data: projects on the copy, remote access off, no paired device or computer, its own files kept, the real home untouched", () => {
  const root = mkdtempSync(path.join(tmpdir(), 'coord-dev-home-'));
  try {
    const real = path.join(root, 'real'), copy = path.join(root, 'copy');
    mkdirSync(path.join(real, 'planning', 'shop'), { recursive: true });
    writeFileSync(path.join(real, 'planning', 'shop', 'planning.json'), '{}');
    const elsewhere = path.join(root, 'elsewhere');
    const database = new DatabaseSync(path.join(real, 'coord.db'));
    database.exec(`CREATE TABLE project (id INTEGER PRIMARY KEY, computer_id TEXT, folder TEXT NOT NULL);
      CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE device (id TEXT PRIMARY KEY);
      CREATE TABLE paired_computer (id TEXT PRIMARY KEY);`);
    database.prepare("INSERT INTO paired_computer (id) VALUES ('laptop')").run();
    database.prepare('INSERT INTO project (id, computer_id, folder) VALUES (?, ?, ?)').run(1, null, path.join(real, 'planning', 'shop'));
    database.prepare('INSERT INTO project (id, computer_id, folder) VALUES (?, ?, ?)').run(2, null, elsewhere);
    database.prepare('INSERT INTO project (id, computer_id, folder) VALUES (?, ?, ?)').run(3, 'laptop', '/remote/planning');
    database.prepare("INSERT INTO setting (key, value) VALUES ('host.network', ?)").run(JSON.stringify({ enabled: true, address: '100.1.2.3', port: 7346 }));
    database.prepare("INSERT INTO device (id) VALUES ('phone')").run();
    database.close();
    // Coord Dev's own files, from before.
    mkdirSync(path.join(copy, 'agent', 'dev-sessions'), { recursive: true });
    writeFileSync(path.join(copy, 'agent', 'dev-sessions', 's1'), 'x');

    assert.deepEqual(copyRealData(real, copy), { projects: 1, empty: false });
    assert.equal(readFileSync(path.join(copy, 'planning', 'shop', 'planning.json'), 'utf8'), '{}');
    const copied = new DatabaseSync(path.join(copy, 'coord.db'), { readOnly: true });
    try {
      assert.deepEqual(copied.prepare('SELECT id, folder FROM project ORDER BY id').all().map(row => ({ ...row })), [
        { id: 1, folder: path.join(copy, 'planning', 'shop') }, { id: 2, folder: elsewhere },
      ]);
      assert.equal(copied.prepare('SELECT count(*) AS n FROM paired_computer').get()!.n, 0);
      assert.deepEqual(JSON.parse(String(copied.prepare("SELECT value FROM setting WHERE key = 'host.network'").get()!.value)), { enabled: false, address: '100.1.2.3', port: 7346 });
      assert.equal(copied.prepare('SELECT count(*) AS n FROM device').get()!.n, 0);
    } finally { copied.close(); }
    assert.ok(existsSync(path.join(copy, 'agent', 'dev-sessions', 's1')));
    assert.deepEqual(JSON.parse(readFileSync(path.join(copy, 'agent', 'onboarding.json'), 'utf8')), { done: true });
    // The real home as it was.
    const after = new DatabaseSync(path.join(real, 'coord.db'), { readOnly: true });
    try {
      assert.equal(after.prepare('SELECT folder FROM project WHERE id = 1').get()!.folder, path.join(real, 'planning', 'shop'));
      assert.equal(after.prepare('SELECT count(*) AS n FROM device').get()!.n, 1);
    } finally { after.close(); }

    // Copying again replaces the copy's data; with no real data it starts empty.
    writeFileSync(path.join(copy, 'planning', 'shop', 'note.md'), 'changed in the copy');
    copyRealData(real, copy);
    assert.equal(existsSync(path.join(copy, 'planning', 'shop', 'note.md')), false);
    assert.deepEqual(copyRealData(path.join(root, 'none'), path.join(root, 'empty')), { projects: 0, empty: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
