// The import lock: a holder that cannot be judged, and deadlines. Holders taking turns, in this
// process and in others, are in importLock.slow.test.ts.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, release, tmpdir } from 'node:os';
import path from 'node:path';
import { ImportLockBusyError, acquireImportLock, importLockName, staleAfterMs } from './importLock.ts';

function folder(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'import-lock-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const deadHolder = () => JSON.stringify({ pid: 2 ** 30, hostname: hostname(), platform: process.platform, release: release(), token: 'gone', createdAt: '2026-10-10T00:00:00Z' });

test('a lock whose holder cannot be judged is taken over only when it is old', async t => {
  const directory = folder(t);
  const file = path.join(directory, importLockName);
  // Same host name but another system (WSL beside Windows), or a damaged lock: wait.
  for (const content of [JSON.stringify({ pid: 2 ** 30, hostname: hostname(), platform: process.platform === 'linux' ? 'win32' : 'linux', release: 'other', token: 'x', createdAt: 'now' }), '{"pid":']) {
    writeFileSync(file, content);
    await assert.rejects(acquireImportLock(directory, 50), ImportLockBusyError);
    assert.equal(readFileSync(file, 'utf8'), content, 'a lock that may be live is left alone');
    const old = new Date(Date.now() - staleAfterMs - 60000);
    utimesSync(file, old, old);
    const unlock = await acquireImportLock(directory, 2000);
    assert.notEqual(readFileSync(file, 'utf8'), content);
    await unlock();
  }
  // A live holder in this process is waited for.
  const unlock = await acquireImportLock(directory, 1000);
  await assert.rejects(acquireImportLock(directory, 50), ImportLockBusyError);
  await unlock();
});

test('a waiter gives up at its deadline while another takeover guard is held', async t => {
  const directory = folder(t);
  writeFileSync(path.join(directory, importLockName), deadHolder());
  writeFileSync(path.join(directory, importLockName + '.takeover'), 'crashed mid-takeover');
  const started = Date.now();
  await assert.rejects(acquireImportLock(directory, 100), ImportLockBusyError);
  assert.ok(Date.now() - started < 5000, 'the deadline bounds the wait instead of the guard\'s 60 s staleness');
});
