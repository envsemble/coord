// The import lock under contention: mutual exclusion, including when several waiters find a stale
// lock at once, in one process and across processes.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, release, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireImportLock, importLockName } from './fileLock.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function folder(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'import-lock-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const deadHolder = () => JSON.stringify({ pid: 2 ** 30, hostname: hostname(), platform: process.platform, release: release(), token: 'gone', createdAt: '2026-10-10T00:00:00Z' });

test('waiters that find a dead holder\'s lock at once never hold it together', async t => {
  const directory = folder(t);
  for (let iteration = 0; iteration < 10; iteration++) {
    writeFileSync(path.join(directory, importLockName), deadHolder());
    let inside = 0, most = 0;
    await Promise.all(Array.from({ length: 5 }, async () => {
      const unlock = await acquireImportLock(directory, 20000);
      inside++; most = Math.max(most, inside);
      await sleep(Math.random() * 4);
      inside--;
      await unlock();
    }));
    assert.equal(most, 1, `iteration ${iteration}: one holder at a time`);
  }
});

test('separate processes take turns, also when they start from a stale lock', async t => {
  const directory = folder(t);
  writeFileSync(path.join(directory, importLockName), deadHolder());
  const log = path.join(directory, 'log.txt');
  writeFileSync(log, '');
  const script = `
    import { appendFileSync } from 'node:fs';
    const { acquireImportLock } = await import(${JSON.stringify(pathToFileURL(path.resolve(import.meta.dirname, 'fileLock.ts')).href)});
    for (let round = 0; round < 8; round++) {
      const unlock = await acquireImportLock(${JSON.stringify(directory)}, 60000);
      appendFileSync(${JSON.stringify(log)}, 'enter ' + process.pid + '\\n');
      await new Promise(resolve => setTimeout(resolve, Math.random() * 5));
      appendFileSync(${JSON.stringify(log)}, 'leave ' + process.pid + '\\n');
      await unlock();
    }`;
  await Promise.all(Array.from({ length: 3 }, () => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let errors = '';
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('exit', status => status === 0 ? resolve() : reject(new Error('child failed: ' + errors)));
  })));
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3 * 8 * 2);
  for (let index = 0; index < lines.length; index += 2) {
    const [enter, leave] = [lines[index].split(' '), lines[index + 1].split(' ')];
    assert.deepEqual([enter[0], leave[0], leave[1]], ['enter', 'leave', enter[1]], 'no process entered while another held the lock');
  }
});
