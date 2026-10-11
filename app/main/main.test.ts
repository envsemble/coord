// Unit tests for the main-process modules that do not need Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { folderArguments } from './args.ts';
import { RotatingLog } from './log.ts';
import { containedFile, contentSecurityPolicy, originOf } from './protocol.ts';
import { folderKey, parseState, StateStore } from './state.ts';

const temporary = () => mkdtempSync(path.join(tmpdir(), 'atlas-main-'));

test('command lines yield folders, skipping the app path and switches', () => {
  const cwd = path.resolve('/work');
  assert.deepEqual(folderArguments(['Atlas.exe', '--inspect=0', 'planning'], cwd, false), [path.resolve(cwd, 'planning')]);
  assert.deepEqual(folderArguments(['electron', '.', '--remote-debugging-port=0', '"/x/plan ning"'], cwd, true), [path.resolve(cwd, '/x/plan ning')]);
  assert.deepEqual(folderArguments(['Atlas.exe'], cwd, false), []);
});

test('the renderer and planning protocol never resolve outside their folder', () => {
  const base = path.resolve('/app/renderer');
  assert.equal(containedFile(base, '/index.html'), path.join(base, 'index.html'));
  assert.equal(containedFile(base, '/'), path.join(base, 'index.html'));
  for (const escape of ['/../main/index.js', '/..%2Fmain%2Findex.js', '/assets/..\\..\\x', '/%00', '/%E0%A4%A']) assert.equal(containedFile(base, escape), null, escape);
  assert.equal(originOf('atlas://app/index.html'), 'atlas://app');
  assert.equal(originOf('http://localhost:5173/x'), 'http://localhost:5173');
  assert.equal(originOf('not a url'), null);
  assert.match(contentSecurityPolicy, /default-src 'none'/);
  assert.doesNotMatch(contentSecurityPolicy, /unsafe-eval|script-src[^;]*unsafe-inline/);
});

test('the log rotates and keeps a bounded number of files', () => {
  const directory = temporary();
  try {
    const log = new RotatingLog(directory, { maxBytes: 400, keep: 2 });
    for (let index = 0; index < 40; index++) log.info('line ' + index, { index });
    assert.deepEqual(readdirSync(directory).sort(), ['atlas.1.log', 'atlas.2.log', 'atlas.log']);
    assert.match(readFileSync(path.join(directory, 'atlas.log'), 'utf8'), /line 39/);
    for (const line of readFileSync(path.join(directory, 'atlas.log'), 'utf8').trim().split('\n')) assert.ok(JSON.parse(line).time);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('desktop state survives damage and keeps folders apart', () => {
  assert.deepEqual(parseState(null), { version: 1, windows: [], folders: {} });
  assert.deepEqual(parseState({ version: 2 }), { version: 1, windows: [], folders: {} });
  const state = parseState({ version: 1, windows: ['C:/a', 5], folders: { x: { root: 'C:/a', used: '2026', ui: { bad: true } }, y: { root: 'C:/b', used: '2026', bounds: { x: 1, y: 2, width: 800, height: 600 } } } });
  assert.deepEqual(state.windows, [], 'an unreadable window list is dropped');
  assert.deepEqual(Object.values(state.folders).map(item => item.root), ['C:/b'], 'a damaged folder entry is skipped');
  assert.equal(folderKey('C:/Work', 'win32'), folderKey('c:/work', 'win32'));
  assert.notEqual(folderKey('/Work', 'linux'), folderKey('/work', 'linux'));
  const directory = temporary();
  try {
    const file = path.join(directory, 'desktop-state.json');
    const store = new StateStore(file);
    store.updateFolder('/p', { maximized: true });
    store.setWindows(['/p']);
    store.flush();
    const reread = new StateStore(file);
    assert.deepEqual(reread.windows, ['/p']);
    assert.equal(reread.folder('/p')?.maximized, true);
    assert.deepEqual(reread.ui('/other').tabs.items, []);
    // Forgetting another computer drops what was saved for its folders, and only that.
    const remote = 'atlas-remote:host-one/f-' + 'a'.repeat(32);
    reread.updateFolder(remote, { maximized: true });
    reread.setWindows(['/p', remote]);
    reread.forgetFolders(root => root.startsWith('atlas-remote:host-one/'));
    reread.flush();
    const forgotten = new StateStore(file);
    assert.deepEqual(forgotten.windows, ['/p']);
    assert.equal(forgotten.folder(remote), undefined);
    assert.equal(forgotten.folder('/p')?.maximized, true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

async function waitFor(condition: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error('Timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('Atlas refuses to start without its sandbox, and a released build refuses debuggers', async () => {
  const { startupRefusal } = await import('./refusal.ts');
  const check = (switches: string[], options: { packaged?: boolean; endToEndBuild?: boolean; environment?: NodeJS.ProcessEnv } = {}) =>
    startupRefusal({ hasSwitch: name => switches.includes(name), environment: options.environment ?? {}, packaged: options.packaged ?? true, endToEndBuild: options.endToEndBuild ?? false });
  assert.equal(check([]), null);
  assert.deepEqual(check(['no-sandbox']), { reason: 'sandbox', switches: ['no-sandbox'] });
  assert.deepEqual(check([], { environment: { ELECTRON_DISABLE_SANDBOX: '1' } }), { reason: 'sandbox', switches: ['ELECTRON_DISABLE_SANDBOX'] });
  assert.deepEqual(check(['no-sandbox'], { endToEndBuild: true }), { reason: 'sandbox', switches: ['no-sandbox'] }, 'no build may drop the sandbox');
  for (const name of ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk']) assert.deepEqual(check([name]), { reason: 'debugging', switches: [name] }, name);
  assert.equal(check(['remote-debugging-port', 'inspect'], { endToEndBuild: true }), null, 'the end-to-end build lets Playwright attach');
  assert.equal(check(['remote-debugging-port'], { packaged: false }), null, 'development runs are not packaged');
});
