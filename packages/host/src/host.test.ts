// The host end to end on 127.0.0.1: authentication and scopes, pairing with a one-time code,
// shared folders, revocation, and the checks that keep browsers and other hosts out.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { AccessStore, normalizeCode } from './access.ts';
import { HostClient, HostRequestError, describeHost, pairWithHost, parsePairing, type ClientStatus } from './client.ts';
import { closeCodes, type FolderState } from './contract.ts';
import { Host, acceptableHost } from './host.ts';
import type { WorkerLike } from './planWorkerClient.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, '../../../app/e2e/fixtures/planning');
const quiet = { info() {}, warn() {}, error() {} };

function temporary(t: TestContext, prefix: string) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 5 }));
  return directory;
}
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address() as { port: number }; server.close(() => resolve(port)); });
  });
}
async function start(t: TestContext, options: { extraShared?: string[] } = {}) {
  const data = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-host-data-')));
  const parent = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-host-planning-')));
  const planning = path.join(parent, 'planning');
  cpSync(fixture, planning, { recursive: true });
  const host = new Host({
    dataDirectory: data, version: '0.0.0-test', log: quiet, owner: 'a test', dataBase: data, idleClose: 50,
    createPlanWorker: () => new Worker(new URL('./planWorker.ts', import.meta.url)) as unknown as WorkerLike,
    ...options,
  });
  const { port } = await host.start();
  // Stop the host (closing its folders' stores) before removing what it had open.
  t.after(async () => {
    await host.stop();
    for (const directory of [data, parent]) rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const origin = 'http://127.0.0.1:' + port;
  return { host, planning, data, port, origin };
}
function client(t: TestContext, origin: string, token: string, hostId: string | null = null) {
  const events: FolderState[] = [];
  const statuses: ClientStatus[] = [];
  const connection = new HostClient({ origin, token: () => token, hostId, retry: { first: 0, cap: 100 }, onEvent: (event, data) => { if (event === 'folder.changed') events.push(data as FolderState); }, onStatus: status => statuses.push(status) });
  connection.start();
  t.after(() => connection.close());
  return { connection, events, statuses };
}
const until = async (check: () => boolean, timeout = 5000) => {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 20)); }
};

test('only Atlas clients with a credential get in: no browsers, no host names, no anonymous sockets', async t => {
  const { host, origin, port } = await start(t);
  assert.deepEqual(await describeHost(origin), host.descriptor);
  const fromBrowser = await fetch(origin + '/api/host', { headers: { Origin: 'https://evil.example' } });
  assert.equal(fromBrowser.status, 403);
  // fetch cannot set Host; a raw request can, as a page on a rebound host name would.
  const { request } = await import('node:http');
  const rebound = await new Promise<number>((resolve, reject) => request({ host: '127.0.0.1', port, path: '/api/host', headers: { Host: 'evil.example:' + port } }, response => { response.resume(); resolve(response.statusCode!); }).on('error', reject).end());
  assert.equal(rebound, 421, 'a host name could be re-pointed at this computer (DNS rebinding)');
  for (const value of ['127.0.0.1:7346', '[::1]:7346', 'localhost:7346', '100.64.1.2']) assert.ok(acceptableHost(value), value);
  for (const value of ['example.com', 'atlas.local:7346', '127.0.0.1.nip.io', undefined]) assert.ok(!acceptableHost(value), String(value));
  const anonymous = client(t, origin, 'atl_not-a-token');
  await until(() => anonymous.connection.status === 'revoked');
  assert.match(anonymous.connection.detail!, /no longer paired/);
  assert.equal((await fetch(origin + '/api/folders/f-' + '0'.repeat(32) + '/files/plan.md')).status, 401);
});

test('the owner reads any folder it opens; a request with the wrong shape or scope is refused', async t => {
  const { host, origin, planning } = await start(t);
  const { connection, events } = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const session = await connection.request('host.session', {});
  assert.deepEqual(session.scopes, ['owner']);
  const opened = await connection.request('folders.open', { path: planning });
  assert.equal(opened.status, 'ready');
  const state = await connection.follow(opened.folderId);
  assert.equal(state.folderId, opened.folderId);
  const snapshot = await connection.request('folder.snapshot', { folderId: opened.folderId });
  assert.equal(snapshot.work.length, 4);
  const plan = await connection.request('folder.document', { folderId: opened.folderId, path: 'active/0001-saved-payment-methods/plan.md' });
  assert.equal(plan.title, 'Saved payment methods');
  await assert.rejects(connection.request('folder.document', { folderId: opened.folderId, path: '../outside.md' }), (error: HostRequestError) => error.code === 'invalid-argument');
  await assert.rejects(connection.request('folder.snapshot', { folderId: 'f-' + 'a'.repeat(32) }), (error: HostRequestError) => error.code === 'forbidden');
  await assert.rejects(connection.request('folders.open' as never, { path: 42 } as never), (error: HostRequestError) => error.code === 'invalid-argument');
  // Files in documents and plan exports come over authenticated HTTP.
  const image = await connection.fetch(`/api/folders/${opened.folderId}/files/active/0001-saved-payment-methods/plan.md`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'application/octet-stream', 'only images keep their type');
  assert.match(image.headers.get('content-security-policy') ?? '', /sandbox/);
  // Paths stay inside the folder: an encoded escape and hidden folders are refused.
  assert.equal((await connection.fetch(`/api/folders/${opened.folderId}/files/..%2F..%2Fpackage.json`)).status, 403);
  assert.equal((await connection.fetch(`/api/folders/${opened.folderId}/files/active/0001-saved-payment-methods/.atlas/statistics.jsonl`)).status, 403);
  const prepared = await connection.request('plan.exportPrepare', { folderId: opened.folderId, work: 'work-0001' });
  assert.equal(prepared.fileName, 'saved-payment-methods-work-0001.atlas-plan.html');
  const exported = await connection.fetch('/api/exports/' + prepared.token);
  assert.equal(exported.status, 200);
  assert.match(await exported.text(), /<!doctype html>/i);
  assert.equal((await connection.fetch('/api/exports/' + prepared.token)).status, 404, 'an export is handed over once');
  // A change on disk reaches the subscriber.
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path.join(planning, 'README.md'), '# Changed\n');
  await until(() => events.some(event => event.folderId === opened.folderId && event.revision > state.revision));
});

test('a device pairs once with a five-minute code, reads only shared folders, and is cut off when revoked', async t => {
  const { host, origin, planning } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId).connection;
  await assert.rejects(owner.request('access.pairingCreate', { address: null }), /Turn on remote access first/);
  const port = await freePort();
  const updated = await owner.request('access.update', { settings: { network: { enabled: true, address: '127.0.0.1', port }, sharedFolders: [planning] } });
  assert.equal(updated.status.listening, true, updated.status.error ?? '');
  const link = await owner.request('access.pairingCreate', { address: null });
  assert.equal(link.url, `http://127.0.0.1:${port}/pair#token=${link.code}`);
  assert.ok(Date.parse(link.expiresAt) - Date.now() <= 5 * 60000 && Date.parse(link.expiresAt) - Date.now() > 4 * 60000);
  const { origin: remote, code } = parsePairing(link.url!);
  assert.deepEqual(parsePairing(`127.0.0.1:${port}`, code.toLowerCase()), { origin: remote, code: code.toLowerCase() });
  const { descriptor, pairing } = await pairWithHost(remote, code.toLowerCase().replaceAll('-', ' '), { name: 'Laptop', platform: 'linux' });
  assert.equal(descriptor.hostId, host.descriptor.hostId);
  assert.deepEqual(pairing.scopes, ['planning:read']);
  await assert.rejects(pairWithHost(remote, code, { name: 'Again', platform: 'linux' }), /wrong, expired or already used/, 'a code is used once');

  const device = client(t, remote, pairing.token, descriptor.hostId);
  const shared = await device.connection.request('folders.shared', {});
  assert.equal(shared.length, 1);
  const folder = await device.connection.follow(shared[0].folderId);
  assert.equal(folder.status, 'ready');
  assert.equal((await device.connection.request('folder.snapshot', { folderId: folder.folderId })).work.length, 4);
  await assert.rejects(device.connection.request('folders.open', { path: planning }), (error: HostRequestError) => error.code === 'forbidden' && /Atlas app on the host/.test(error.message));
  await assert.rejects(device.connection.request('access.devices', {}), (error: HostRequestError) => error.code === 'forbidden');
  await assert.rejects(device.connection.request('folder.recordView', { folderId: folder.folderId, event: { id: 'view-00000001', path: 'README.md', session: 'session-0001', contentHash: null } }), (error: HostRequestError) => error.code === 'forbidden');
  // The device's token works only on the remote address; the owner token only from this computer on the loopback port.
  const devices = await owner.request('access.devices', {});
  assert.deepEqual(devices.map(entry => [entry.name, entry.connected]), [['Laptop', true]]);

  // Unsharing takes the folder away at once.
  await owner.request('access.update', { settings: { network: { enabled: true, address: '127.0.0.1', port }, sharedFolders: [] } });
  await until(() => device.events.some(event => event.folderId === folder.folderId && event.status === 'missing'));
  await assert.rejects(device.connection.request('folder.snapshot', { folderId: folder.folderId }), (error: HostRequestError) => error.code === 'forbidden');

  await owner.request('access.deviceRevoke', { deviceId: pairing.deviceId });
  await until(() => device.connection.status === 'revoked');
  assert.match(device.connection.detail!, /revoked/);
  const again = client(t, remote, pairing.token, descriptor.hostId);
  await until(() => again.connection.status === 'revoked');
  assert.equal((await fetch(remote + '/api/folders/' + folder.folderId + '/files/README.md', { headers: { Authorization: 'Bearer ' + pairing.token } })).status, 401);

  // Turning remote access off stops the listener.
  await owner.request('access.update', { settings: { network: { enabled: false, address: '127.0.0.1', port }, sharedFolders: [] } });
  await assert.rejects(describeHost(remote, 1000), /could not reach/);
});

test('a client sends no credential to another host answering on a known address', async t => {
  const first = await start(t);
  const second = await start(t);
  const confused = client(t, second.origin, 'atl_secret', first.host.descriptor.hostId);
  await until(() => confused.connection.status === 'mismatch');
  assert.match(confused.connection.detail!, /different computer/);
});

test('pairing codes expire, can be revoked, and too many wrong codes pause pairing', async t => {
  const directory = temporary(t, 'atlas-access-');
  const store = new AccessStore(directory, quiet, 'a test');
  t.after(() => store.unlock());
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-11T10:00:00Z') });
  const expiring = store.createPairing('100.64.1.2');
  t.mock.timers.tick(5 * 60000 + 1);
  assert.throws(() => store.pair(expiring.code, { name: 'Late', platform: 'linux' }), /expired/);
  const revoked = store.createPairing(null);
  store.revokePairing(revoked.code);
  assert.throws(() => store.pair(revoked.code, { name: 'Revoked', platform: 'linux' }), /expired or already used/);
  for (let attempt = 0; attempt < 18; attempt++) assert.throws(() => store.pair('AAAA-AAAA-AAAA-AAAA', { name: 'Guess', platform: 'linux' }), /wrong/);
  const valid = store.createPairing(null);
  assert.throws(() => store.pair(valid.code, { name: 'Blocked', platform: 'linux' }), /Too many wrong pairing codes/, 'the 21st attempt in five minutes is refused, even with a valid code');
  t.mock.timers.tick(5 * 60000);
  const paired = store.pair(store.createPairing(null).code, { name: 'Later', platform: 'win32' });
  assert.equal(store.deviceForToken(paired.token)?.deviceId, paired.device.deviceId);
  assert.equal(store.deviceForToken(paired.token + 'x'), null);
  assert.equal(normalizeCode('k7qf-2mxp 9tra-4d6w'), 'K7QF2MXP9TRA4D6W');
  assert.equal(normalizeCode('O1IL-uuuu'), '0111VVVV');
  // Tokens are stored only as hashes.
  const { readFileSync } = await import('node:fs');
  assert.ok(!readFileSync(path.join(directory, 'access.json'), 'utf8').includes(paired.token));
  // Another process on this computer cannot take over remote access while this one manages it.
  const second = new AccessStore(directory, quiet, 'another test');
  assert.match(second.managedBy ?? '', /a test \(process \d+\)/);
  assert.throws(() => second.createPairing(null), /managed by a test/);
});

test('an owner connection on the loopback port is refused for a device token used from the network listener', async t => {
  const { host, origin } = await start(t);
  // The owner token is accepted on the loopback listener only; on the remote address it is just an unknown token.
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId).connection;
  const port = await freePort();
  await owner.request('access.update', { settings: { network: { enabled: true, address: '127.0.0.1', port }, sharedFolders: [] } });
  const remote = client(t, 'http://127.0.0.1:' + port, host.ownerToken, host.descriptor.hostId);
  await until(() => remote.connection.status === 'revoked');
  assert.equal(closeCodes.revoked, 4401);
});
