import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, realpath, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';

const registry = (work = 0) => JSON.stringify({ schema_version: 1, repositories: [], work_items: Array.from({ length: work }, (_, index) => ({ id: 'work-' + String(index + 1).padStart(4, '0'), path: 'active/' + index, repositories: [], current_plan: null })) });

async function workspace() {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'planning-roots-')));
  const current = path.join(temporary, 'planning'); await mkdir(current); await writeFile(path.join(current, 'planning.json'), registry(2));
  const demo = path.join(temporary, 'demo/planning'); await mkdir(demo, { recursive: true }); await writeFile(path.join(demo, 'planning.json'), registry(3));
  const tooDeep = path.join(temporary, 'a/b/planning'); await mkdir(tooDeep, { recursive: true }); await writeFile(path.join(tooDeep, 'planning.json'), registry());
  const hidden = path.join(temporary, '.hidden/planning'); await mkdir(hidden, { recursive: true }); await writeFile(path.join(hidden, 'planning.json'), registry());
  const future = path.join(temporary, 'future'); await mkdir(future); await writeFile(path.join(future, 'planning.json'), JSON.stringify({ schema_version: 2, repositories: [], work_items: [] }));
  const broken = path.join(temporary, 'broken'); await mkdir(broken); await writeFile(path.join(broken, 'planning.json'), '{');
  return { temporary, current, demo, future, broken };
}

test('the HTTP server switches planning folders only for local JSON requests', async () => {
  const { temporary, current, demo, future } = await workspace();
  let child: ReturnType<typeof spawn> | null = null;
  try {
    const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const data = path.join(temporary, 'data');
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--dev', '--port', String(port), '--planning-dir', current, '--data-dir', data], { cwd: appRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { output += chunk; });
    const address = 'http://127.0.0.1:' + port;
    let snapshot: { root: string } | null = null;
    const deadline = Date.now() + 20000;
    while (!snapshot && Date.now() < deadline) {
      try { const response = await fetch(address + '/api/snapshot'); if (response.ok) snapshot = await response.json(); } catch { /* Startup is bounded below. */ }
      if (!snapshot) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(snapshot, output);
    assert.equal(snapshot.root, current);
    const roots = await (await fetch(address + '/api/planning-roots')).json();
    assert.equal(roots.current.path, current);
    assert.deepEqual(roots.discovered.map((item: { path: string }) => item.path), [demo]);
    const post = (body: unknown, headers: Record<string, string> = {}) => fetch(address + '/api/planning-root', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: address, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    assert.equal((await post('path=' + demo, { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
    assert.equal((await post({ path: demo }, { Origin: 'https://unrelated.example' })).status, 403);
    assert.equal((await post({ path: demo }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await post({ path: 'planning' })).status, 400);
    assert.equal((await post({ path: future })).status, 422);
    assert.equal((await (await fetch(address + '/api/snapshot')).json()).root, current, 'rejected switches keep the open folder');
    const switched = await post({ path: demo });
    assert.equal(switched.status, 200);
    assert.equal((await switched.json()).path, demo);
    assert.equal((await (await fetch(address + '/api/snapshot')).json()).root, demo);
    const stale = await fetch(address + '/api/document?path=README.md', { headers: { 'X-Planning-Root': encodeURIComponent(current) } });
    assert.equal(stale.status, 409, 'a tab still showing the previous folder is told to reload');
    assert.equal((await stale.json()).code, 'planning-root-changed');
    assert.equal((await fetch(address + '/api/file?' + new URLSearchParams({ path: 'README.md', root: current }))).status, 409);
    assert.notEqual((await fetch(address + '/api/document?path=README.md', { headers: { 'X-Planning-Root': encodeURIComponent(demo) } })).status, 409);
    const after = await (await fetch(address + '/api/planning-roots')).json();
    assert.equal(after.current.path, demo);
    assert.deepEqual(after.recent.map((item: { path: string }) => item.path), [current]);
    const stored = JSON.parse(await readFile(path.join(data, 'planning-roots.json'), 'utf8'));
    assert.deepEqual(stored.recent, [demo, current], 'recents live in the data directory, not in planning');
  } finally {
    if (child && child.exitCode === null) {
      const closed = once(child, 'exit');
      child.kill('SIGTERM'); await closed;
    }
    await rm(temporary, { recursive: true, force: true });
  }
});
