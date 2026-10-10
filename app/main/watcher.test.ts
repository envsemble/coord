import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nodeWatchSystem, watchFolder, type WatchSystem } from './watcher.ts';

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
  const fake = linuxSystem(root, ['', 'active', 'active/0001-x', 'active/0001-x/.atlas', 'active/0001-x/.atlas/models', 'active/0001-x/.atlas/prepared', '.git', '.git/objects', '.git/objects/ab', '.git/refs', 'node_modules', 'node_modules/x', '.atlas-import-1a2b']);
  const watcher = watchFolder(root, { onChange: () => undefined, onError: () => assert.fail('no error expected') }, fake.system);
  try {
    assert.deepEqual(fake.open(), ['', '.git', '.git/refs', 'active', 'active/0001-x', 'active/0001-x/.atlas', 'active/0001-x/.atlas/models']);
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
  const fake = linuxSystem(root, ['', 'active', 'knowledge']);
  const errors: Error[] = [];
  const watcher = watchFolder(root, { onChange: () => undefined, onError: error => errors.push(error) }, fake.system);
  try {
    fake.watched.get('knowledge')!.emit('error', new Error('EACCES: permission denied'));
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
