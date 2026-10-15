import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectListWatch } from './projectWatch.ts';

function temporary(t: TestContext) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-project-watch-')));
  t.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 10 }));
  return directory;
}
const until = async (check: () => boolean, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 20)); }
};
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

test('a project folder that cannot be watched yet is tried again, less often each time, and then watched', async t => {
  const root = path.join(temporary(t), 'shop');
  let changes = 0;
  const warnings: unknown[] = [];
  const watcher = new ProjectListWatch(root, false, { log: { ...quiet, warn: (_message, detail) => warnings.push(detail) }, changed: () => changes++, retryDelay: 100 });
  t.after(() => watcher.close());
  await until(() => warnings.length >= 2);
  const waits = warnings.map(detail => (detail as { retryIn: number }).retryIn);
  assert.ok(waits[1] > waits[0], 'the waits grow: ' + waits.join(', '));
  // Once the folder is there, the next try watches it.
  mkdirSync(path.join(root, 'active', '0001-cart'), { recursive: true });
  writeFileSync(path.join(root, 'planning.json'), '{}');
  await new Promise(resolve => setTimeout(resolve, 1500));
  const before = changes;
  writeFileSync(path.join(root, 'active', '0001-cart', 'ledger.md'), '# Ledger\n');
  await until(() => changes > before);
  // Other files do not count.
  await new Promise(resolve => setTimeout(resolve, 800));
  const settled = changes;
  writeFileSync(path.join(root, 'active', '0001-cart', 'notes.txt'), 'notes\n');
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(changes, settled);
});
