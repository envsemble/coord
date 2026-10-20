import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCoalescer, ignoredInHome, ignoredPath, nodeWatchSystem, projectListChange, relevantChange, watchFolder, type WatchSystem } from './watcher.ts';

/** An in-memory folder tree with fake per-folder watchers, as Linux's watcher sees it. */
function linuxSystem(root: string, initial: string[], options: { failOnWatch?: number } = {}) {
  const tree = new Set(initial);
  const watched = new Map<string, EventEmitter & { closed: boolean; listener(event: string, filename: string | null): void }>();
  let calls = 0;
  const relative = (target: string) => path.relative(root, target).split(path.sep).join('/');
  const system: WatchSystem = {
    platform: 'linux',
    watch(target, _options, listener) {
      if (++calls === options.failOnWatch) throw Object.assign(new Error('ENOSPC: System limit for number of file watchers reached'), { code: 'ENOSPC' });
      const watcher = Object.assign(new EventEmitter(), { closed: false, listener, close() { watcher.closed = true; } });
      watched.set(relative(target), watcher);
      return watcher as never;
    },
    folders(target) {
      const folder = relative(target);
      return [...tree].filter(item => item !== folder && path.posix.dirname(item === '' ? '.' : item) === (folder || '.')).map(item => path.posix.basename(item));
    },
    isFolder: target => tree.has(relative(target)),
  };
  const open = () => [...watched].filter(([, watcher]) => !watcher.closed).map(([key]) => key).sort();
  return { system, tree, watched, open };
}

const temporary = () => mkdtempSync(path.join(tmpdir(), 'atlas-watch-'));
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

test('on Linux each visible folder gets its own watch; Git objects and dependencies get none', () => {
  const directory = temporary();
  const root = path.join(directory, 'planning');
  const fake = linuxSystem(root, ['', 'active', 'active/0001-x', 'active/0001-x/.atlas', 'active/0001-x/.atlas/prepared', '.git', '.git/objects', '.git/objects/ab', '.git/refs', 'node_modules', 'node_modules/x', '.atlas-import-1a2b']);
  const watcher = watchFolder(root, { onChange: () => undefined, onError: () => assert.fail('no error expected') }, fake.system);
  try {
    assert.deepEqual(fake.open(), ['', '.git', '.git/refs', 'active', 'active/0001-x', 'active/0001-x/.atlas']);
  } finally { watcher.close(); rmSync(directory, { recursive: true, force: true }); }
  assert.deepEqual(fake.open(), []);
});

test('on Linux new folders are watched as they appear and released when they go', async () => {
  const directory = temporary();
  const root = path.join(directory, 'planning');
  const fake = linuxSystem(root, ['', 'active']);
  const changes: string[][] = [];
  const watcher = watchFolder(root, { debounce: 10, maxWait: 50, onChange: paths => changes.push(paths), onError: () => assert.fail('no error expected') }, fake.system);
  try {
    fake.tree.add('active/0002-new'); fake.tree.add('active/0002-new/docs');
    fake.watched.get('active')!.listener('rename', '0002-new');
    assert.deepEqual(fake.open(), ['', 'active', 'active/0002-new', 'active/0002-new/docs']);
    fake.tree.delete('active/0002-new/docs'); fake.tree.delete('active/0002-new');
    fake.watched.get('active')!.listener('rename', '0002-new');
    assert.deepEqual(fake.open(), ['', 'active']);
    await pause(80);
    assert.deepEqual(changes, [['active/0002-new']]);
  } finally { watcher.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('on Linux a watch that cannot be added ends watching and reports the error, so the folder is rescanned', async () => {
  const directory = temporary();
  const root = path.join(directory, 'planning');
  const fake = linuxSystem(root, ['', 'active', 'active/a', 'active/b'], { failOnWatch: 3 });
  const errors: Error[] = [];
  const watcher = watchFolder(root, { onChange: () => undefined, onError: error => errors.push(error) }, fake.system);
  try {
    await pause(10);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /ENOSPC/);
    assert.deepEqual(fake.open(), [], 'the partly watched tree is released');
  } finally { watcher.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('on Linux an error from any folder watch ends watching and is reported once', async () => {
  const directory = temporary();
  const root = path.join(directory, 'planning');
  const fake = linuxSystem(root, ['', 'active', 'notes']);
  const errors: Error[] = [];
  const watcher = watchFolder(root, { onChange: () => undefined, onError: error => errors.push(error) }, fake.system);
  try {
    fake.watched.get('notes')!.emit('error', new Error('EACCES: permission denied'));
    fake.watched.get('active')!.emit('error', new Error('EACCES: permission denied'));
    await pause(10);
    assert.equal(errors.length, 1);
    assert.deepEqual(fake.open(), []);
  } finally { watcher.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('the per-folder watcher follows real folders as they are created and written', async () => {
  const directory = temporary();
  const root = path.join(directory, 'planning');
  mkdirSync(path.join(root, 'active'), { recursive: true });
  const changes: string[] = [];
  const watcher = watchFolder(root, { debounce: 20, maxWait: 100, onChange: paths => changes.push(...paths), onError: error => assert.fail(error) }, { ...nodeWatchSystem, platform: 'linux' });
  try {
    await pause(100);
    mkdirSync(path.join(root, 'active', '0002-new'));
    await waitFor(() => changes.includes('active/0002-new'));
    await pause(100);
    writeFileSync(path.join(root, 'active', '0002-new', 'plan.md'), '# Plan');
    await waitFor(() => changes.includes('active/0002-new/plan.md'));
  } finally { watcher.close(); rmSync(directory, { recursive: true, force: true }); }
});

async function waitFor(condition: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error('Timed out');
    await pause(20);
  }
}

test('folders that are never watched (they would exhaust inotify watches on Linux)', () => {
  for (const ignored of ['.git/objects', '.git/objects/ab', 'node_modules', 'active/x/node_modules/y', '__pycache__', 'active/0001/.atlas/prepared', 'active/0001/.atlas/results/x.json', 'active/0001/.atlas/exports', '.atlas-import.lock', '.atlas-import.lock.takeover', '.atlas-import-1b2c', '.\\node_modules', 'knowledge\\node_modules\\x']) assert.ok(ignoredPath(ignored), ignored);
  for (const watched of ['.git', '.git/HEAD', '.git/refs/heads/main', 'active', 'active/0001/.atlas', 'active/0001/.atlas/statistics.jsonl', 'notes/node.md', 'planning.json']) assert.ok(!ignoredPath(watched), watched);
});

test('only changes that can alter the view count, and bursts coalesce', async () => {
  assert.ok(relevantChange('active/0001/plan.md'));
  assert.ok(relevantChange('active/0001/.atlas/statistics.jsonl'));
  assert.ok(relevantChange('.git/HEAD'));
  assert.ok(relevantChange('.git/refs/heads/main'));
  assert.ok(!relevantChange('.git/objects/ab/cdef'));
  assert.ok(!relevantChange('.git/index'));
  assert.ok(!relevantChange('.git/refs/heads/main.lock'));
  assert.ok(!relevantChange('node_modules/x/index.js'));
  assert.ok(!relevantChange('.atlas-import.lock'));
  assert.ok(!relevantChange('.atlas-import-0f3a/plan.md'));
  assert.ok(!relevantChange('active/0001/.atlas/prepared/x.json'));
  const batches: string[][] = [];
  const coalescer = createCoalescer(paths => batches.push(paths), 30, 200);
  for (let index = 0; index < 20; index++) coalescer.add('file-' + (index % 3));
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(batches, [['file-0', 'file-1', 'file-2']]);
});

test('the folder watcher sees atomic saves and its own folder disappearing', async () => {
  const directory = temporary();
  const root = path.join(directory, 'planning');
  mkdirSync(path.join(root, 'active'), { recursive: true });
  let changes = 0;
  const watcher = watchFolder(root, { debounce: 50, maxWait: 300, presenceInterval: 100, onChange: () => { changes++; }, onError: () => undefined });
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    writeFileSync(path.join(root, 'active', 'plan.md.tmp'), '# Plan');
    renameSync(path.join(root, 'active', 'plan.md.tmp'), path.join(root, 'active', 'plan.md'));
    await waitFor(() => changes > 0);
    const before = changes;
    renameSync(root, root + '-moved');
    await waitFor(() => changes > before);
  } finally {
    watcher.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('in the home, only what the project list shows counts: registries, plans, ledgers and folders', () => {
  for (const [relative, change] of [
    ['shop/planning.json', true], ['shop/active/0001-cart/plan.md', true], ['shop/archive/0002-old/ledger.md', true], [null, true],
    ['shop', 'folders'], ['shop/active', 'folders'], ['shop/archive/0002-old', 'folders'],
    ['shop/active/0001-cart/CONTEXT.md', 'maybe'], ['shop/legacy/plan-notes.md', 'maybe'],
    ['shop/active/0001-cart/diagrams/orders.puml', false], ['shop/active/0001-cart/evidence/plan.md', false], ['shop/.git/HEAD', false], ['shop/.git/index', false],
    ['shop/notes.txt', false], ['shop/notes/planning.json', false], ['diagrams/active/0001-cart/plan.md', true], ['shop/active/evidence/ledger.md', true], ['shop\\active\\0001-cart\\ledger.md', true],
  ] as const) assert.equal(projectListChange(relative), change, String(relative));
  for (const folder of ['shop/.git', 'shop/.git/objects', 'shop/active/0001/evidence', 'shop/node_modules', 'shop/.atlas-import-1']) assert.ok(ignoredInHome(folder), folder);
  for (const folder of ['shop', 'shop/active', 'shop/active/0001', 'shop/active/0001/diagrams', 'shop/notes', 'diagrams', 'evidence/active/0001', 'shop/active/diagrams', 'shop/active/evidence', 'shop/notes/diagrams']) assert.ok(!ignoredInHome(folder), folder);
});
