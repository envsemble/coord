import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Telemetry, cacheOutsidePlanning, statisticsDirectory } from '@envsemble/atlas-planning';
import { localOrigin } from './origin.ts';

test('local HTTP origins accept the default port while rejecting unrelated origins', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    assert.ok(localOrigin('http://' + hostname, 80));
    assert.ok(localOrigin('http://' + hostname + ':80', 80));
    assert.ok(localOrigin('http://' + hostname + ':4317', 4317));
    assert.equal(localOrigin('http://' + hostname, 4317), false);
    assert.equal(localOrigin('http://' + hostname + ':4318', 4317), false);
    assert.equal(localOrigin('https://' + hostname, 443), false);
  }
  for (const origin of ['null', 'http://', 'file:///tmp/record', 'http://unrelated.example', 'http://localhost.unrelated.example:4317']) {
    assert.equal(localOrigin(origin, 80), false);
    assert.equal(localOrigin(origin, 4317), false);
  }
});

test('HTTP reading survives unavailable collection and lost views retain coverage after restart', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'planning-http-'));
  let lock: DatabaseSync | null = null;
  let child: ReturnType<typeof spawn> | null = null;
  try {
    const root = path.join(temporary, 'planning'); await mkdir(root);
    const original = '# Original record\n';
    await writeFile(path.join(root, 'note.md'), original);
    await writeFile(path.join(root, 'evidence.png'), Buffer.from('Original image fixture'));
    await writeFile(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [], work_items: [] }));
    await assert.rejects(cacheOutsidePlanning(root, path.join(root, 'cache')), /outside the planning folder/);
    await symlink(root, path.join(temporary, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(cacheOutsidePlanning(root, path.join(temporary, 'linked/new/cache')), /outside the planning folder/);
    const metrics = path.join(temporary, 'metrics');
    const filename = path.join(await statisticsDirectory(root, metrics), 'usage.sqlite');
    const initialized = new Telemetry(filename); initialized.close();
    lock = new DatabaseSync(filename); lock.exec('BEGIN IMMEDIATE');
    const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--dev', '--port', String(port), '--planning-dir', root, '--data-dir', metrics], { cwd: appRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { output += chunk; });
    const address = 'http://127.0.0.1:' + port;
    let snapshot: { collectionError: string | null } | null = null;
    const deadline = Date.now() + 20000;
    while (!snapshot && Date.now() < deadline) {
      try { const response = await fetch(address + '/api/snapshot'); if (response.ok) snapshot = await response.json(); } catch { /* Startup is bounded below. */ }
      if (!snapshot) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(snapshot, output);
    assert.ok(snapshot.collectionError);
    lock.exec('ROLLBACK'); lock.close(); lock = null;
    const document = await fetch(address + '/api/document?path=note.md');
    assert.equal(document.status, 200);
    assert.equal((await document.json()).body, original);
    const attachment = await (await fetch(address + '/api/document?path=evidence.png')).json();
    assert.match(attachment.contentHash, /^[a-f0-9]{64}$/);
    await writeFile(path.join(root, 'evidence.png'), Buffer.from('Replaced image fixture'));
    const staleView = await fetch(address + '/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: address }, body: JSON.stringify({ id: randomUUID(), session: randomUUID(), path: 'evidence.png', contentHash: attachment.contentHash }) });
    assert.equal(staleView.status, 409, 'changed attachments must not record a view of the wrong version');
    assert.equal((await fetch(address + '/api/document?path=..%2Foutside.md')).status, 403);
    assert.equal((await fetch(address + '/api/snapshot', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
    const event = await fetch(address + '/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: address }, body: JSON.stringify({ id: randomUUID(), session: randomUUID(), path: 'note.md' }) });
    assert.equal(event.status, 503);
    const reopened = new Telemetry(filename);
    try { assert.equal(reopened.summary().views, 0); assert.equal(reopened.summary().failures, 1); }
    finally { reopened.close(); }
    assert.equal(await readFile(path.join(root, 'note.md'), 'utf8'), original);
  } finally {
    lock?.close();
    if (child && child.exitCode === null) {
      const closed = once(child, 'exit');
      child.kill('SIGTERM'); await closed;
    }
    const actual = await realpath(temporary);
    assert.equal(path.dirname(actual), await realpath(tmpdir()));
    assert.ok(path.basename(actual).startsWith('planning-http-'));
    await rm(actual, { recursive: true });
  }
});
