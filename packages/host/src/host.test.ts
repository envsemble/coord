// The host end to end on 127.0.0.1: authentication and scopes, pairing with a one-time code, the
// whole computer for a paired device (its folder list, browsing, import), Manage access,
// revocation, and the checks that keep browsers and other hosts out.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { AccessStore, lockAddress, normalizeCode } from './access.ts';
import { HostClient, HostRequestError, describeHost, pairWithHost, parsePairing, type ClientStatus } from './client.ts';
import { browse } from './browse.ts';
import { FolderList } from './folderList.ts';
import { closeCodes, type ComputerFolder, type FolderState } from './contract.ts';
import { Host, acceptableHost, attachment } from './host.ts';
import { pairRequest, accessSettings } from './validate.ts';
import type { WorkerLike } from './planWorkerClient.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, '../../../app/e2e/fixtures/planning');
const started = Date.now();
/** Quiet, unless ATLAS_TEST_LOG is set to follow what the host does while a test runs. */
const print = (level: string) => (message: string, detail?: unknown) => { if (process.env.ATLAS_TEST_LOG) console.log(Date.now() - started, level, message, JSON.stringify(detail ?? '')); };
const quiet = { info: print('info'), warn: print('warn'), error: print('error') };

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
async function start(t: TestContext, options: { extraShared?: string[]; data?: string; loopbackPort?: number } = {}) {
  const data = options.data ?? realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-host-data-')));
  const parent = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-host-planning-')));
  const planning = path.join(parent, 'planning');
  cpSync(fixture, planning, { recursive: true });
  const host = new Host({
    dataDirectory: data, version: '0.0.0-test', log: quiet, owner: 'a test', dataBase: data, idleClose: 50,
    createPlanWorker: () => new Worker(new URL('./planWorker.ts', import.meta.url)) as unknown as WorkerLike,
    ...options,
  });
  const { port } = await host.start();
  // Stop the host (closing its folders' stores) before removing what it had open; a data folder passed in belongs to the caller.
  t.after(async () => {
    await host.stop();
    for (const directory of options.data ? [parent] : [data, parent]) rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const origin = 'http://127.0.0.1:' + port;
  return { host, planning, data, port, origin };
}
function client(t: TestContext, origin: string | (() => string), token: string | (() => string | Promise<string>), hostId: string | null = null) {
  const events: FolderState[] = [];
  const lists: ComputerFolder[][] = [];
  const statuses: ClientStatus[] = [];
  const connection = new HostClient({
    origin, token: typeof token === 'function' ? token : () => token, hostId, retry: { first: 0, cap: 100 }, onStatus: status => statuses.push(status),
    onEvent: (event, data) => { if (event === 'folder.changed') events.push(data as FolderState); else if (event === 'folders.changed') lists.push((data as { folders: ComputerFolder[] }).folders); },
  });
  connection.start();
  t.after(() => connection.close());
  return { connection, events, lists, statuses };
}
const noGrant = { label: null, manageAccess: false };
/** Turn remote access on for 127.0.0.1 and pair a device; returns its client and pairing. */
async function pairDevice(t: TestContext, host: Host, owner: HostClient, grant: { label: string | null; manageAccess: boolean } = noGrant, name = 'Laptop') {
  if (!host.networkStatus().listening) {
    const updated = await owner.request('access.update', { settings: { network: { enabled: true, address: '127.0.0.1', port: await freePort() } } });
    assert.equal(updated.status.listening, true, updated.status.error ?? '');
  }
  const link = await owner.request('access.pairingCreate', { address: null, ...grant });
  const { origin: remote, code } = parsePairing(link.url!);
  const { descriptor, pairing } = await pairWithHost(remote, code, { name, platform: 'linux' });
  return { ...client(t, remote, pairing.token, descriptor.hostId), pairing, remote, link };
}
const until = async (check: () => boolean, timeout = 5000, describe?: () => unknown) => {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() > deadline) throw new Error('Timed out' + (describe ? ': ' + JSON.stringify(describe()) : '')); await new Promise(resolve => setTimeout(resolve, 20)); }
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
  // The owner (one app, several windows) may prepare several exports at once.
  const both = await Promise.all([1, 2].map(() => connection.request('plan.exportPrepare', { folderId: opened.folderId, work: 'work-0001' })));
  for (const each of both) assert.equal((await connection.fetch('/api/exports/' + each.token)).status, 200);
  // A change on disk reaches the subscriber, and the folder's view shows it.
  writeFileSync(path.join(planning, 'README.md'), '# Changed\n');
  const readme = async () => (await connection.request('folder.snapshot', { folderId: opened.folderId })).documents.find(document => document.path === 'README.md')?.title;
  let title = await readme();
  for (const deadline = Date.now() + 10000; title !== 'Changed' && Date.now() < deadline;) { await new Promise(resolve => setTimeout(resolve, 100)); title = await readme(); }
  assert.equal(title, 'Changed', JSON.stringify({ state, events }));
  assert.ok(events.some(event => event.folderId === opened.folderId && event.revision > state.revision));
});

test('a device pairs once with a five-minute code, gets the whole computer, and is cut off when revoked', async t => {
  const { host, origin, planning } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  await assert.rejects(owner.connection.request('access.pairingCreate', { address: null, ...noGrant }), /Turn on remote access first/);
  const port = await freePort();
  const updated = await owner.connection.request('access.update', { settings: { network: { enabled: true, address: '127.0.0.1', port } } });
  assert.equal(updated.status.listening, true, updated.status.error ?? '');
  const link = await owner.connection.request('access.pairingCreate', { address: null, label: 'Work laptop', manageAccess: false });
  assert.equal(link.url, `http://127.0.0.1:${port}/pair#token=${link.code}`);
  assert.deepEqual([link.label, link.manageAccess], ['Work laptop', false]);
  assert.ok(Date.parse(link.expiresAt) - Date.now() <= 5 * 60000 && Date.parse(link.expiresAt) - Date.now() > 4 * 60000);
  const { origin: remote, code } = parsePairing(link.url!);
  assert.deepEqual(parsePairing(`127.0.0.1:${port}`, code.toLowerCase()), { origin: remote, code: code.toLowerCase() });
  const { descriptor, pairing } = await pairWithHost(remote, code.toLowerCase().replaceAll('-', ' '), { name: 'LAPTOP-7Q2', platform: 'linux' });
  assert.equal(descriptor.hostId, host.descriptor.hostId);
  assert.deepEqual(pairing.scopes, ['computer']);
  await assert.rejects(pairWithHost(remote, code, { name: 'Again', platform: 'linux' }), /wrong, expired or already used/, 'a code is used once');
  // The label the owner gave the link names the device.
  assert.deepEqual((await owner.connection.request('access.devices', {})).map(entry => [entry.name, entry.scopes]), [['Work laptop', ['computer']]]);

  // The device browses the computer and opens any planning folder there, with its real path.
  const device = client(t, remote, pairing.token, descriptor.hostId);
  assert.deepEqual(await device.connection.request('folders.list', {}), []);
  const beginning = await device.connection.request('folders.browse', { path: null });
  assert.equal(beginning.path, null);
  assert.equal(beginning.folders[0].name, 'Home');
  const parent = await device.connection.request('folders.browse', { path: path.dirname(planning) });
  assert.deepEqual(parent.folders.map(entry => [entry.name, entry.planning]), [['planning', true]]);
  await assert.rejects(device.connection.request('folders.open', { path: path.dirname(planning) }), (error: HostRequestError) => error.code === 'folder-invalid' && /planning\.json/.test(error.message));
  await assert.rejects(device.connection.request('folders.open', { path: path.join(planning, 'nowhere') }), (error: HostRequestError) => error.code === 'folder-missing');
  const opened = await device.connection.request('folders.open', { path: planning });
  assert.equal(opened.status, 'ready');
  const folder = await device.connection.follow(opened.folderId, () => device.connection.request('folders.open', { path: planning }));
  const snapshot = await device.connection.request('folder.snapshot', { folderId: folder.folderId });
  assert.equal(snapshot.work.length, 4);
  assert.equal(snapshot.root, planning, 'a device sees real paths');
  // Opening it put it on the computer's folder list, which every client sees at once.
  const listed = await device.connection.request('folders.list', {});
  assert.deepEqual(listed.map(entry => [entry.path, entry.available, entry.workItems]), [[planning, true, 4]]);
  // The app here may open a folder that is not a planning folder (to explain why); it stays off the list, and a device cannot reach it.
  const plain = path.dirname(planning);
  const notPlanning = await owner.connection.request('folders.open', { path: plain });
  assert.equal((await owner.connection.request('folders.list', {})).length, 1);
  await assert.rejects(device.connection.request('folders.subscribe', { folderId: notPlanning.folderId }), (error: HostRequestError) => error.code === 'forbidden');
  assert.equal((await device.connection.fetch(`/api/folders/${notPlanning.folderId}/files/planning/README.md`)).status, 403);
  await until(() => owner.lists.some(list => list.some(entry => entry.path === planning)), 5000, () => owner.lists);
  // Its views count in this computer's document use.
  await device.connection.request('folder.recordView', { folderId: folder.folderId, event: { id: 'view-00000001', path: 'README.md', session: 'session-0001', contentHash: null } });
  // It sends its plans for import (below); it cannot make this computer read a file by path, or reach a network share.
  await assert.rejects(device.connection.request('plan.importRead', { folderId: folder.folderId, file: path.join(planning, 'README.md') }), (error: HostRequestError) => error.code === 'forbidden');
  for (const share of ['\\\\fileserver\\plans\\planning', '//fileserver/plans/planning', ...(process.platform === 'win32' ? ['/\\fileserver\\plans', '/\\?\\UNC\\fileserver\\plans'] : [])]) {
    await assert.rejects(device.connection.request('folders.open', { path: share }), (error: HostRequestError) => error.code === 'forbidden' && /Network paths/.test(error.message), share);
    await assert.rejects(device.connection.request('folders.browse', { path: share }), (error: HostRequestError) => error.code === 'forbidden', share);
  }
  // Reopening a folder (after a reconnection, or for a restored window) leaves the folder list as it is.
  await owner.connection.request('folders.remove', { folderId: folder.folderId });
  await device.connection.request('folders.open', { path: planning, remember: false });
  assert.deepEqual(await device.connection.request('folders.list', {}), []);
  await device.connection.request('folders.open', { path: planning });
  // Only the owner changes the remote-access settings; managing access needs Manage access.
  await assert.rejects(device.connection.request('access.update', { settings: { network: { enabled: false, address: null, port } } }), (error: HostRequestError) => error.code === 'forbidden' && /Only the Atlas app on/.test(error.message));
  await assert.rejects(device.connection.request('access.devices', {}), (error: HostRequestError) => error.code === 'forbidden' && /may not manage access/.test(error.message));
  await assert.rejects(device.connection.request('access.pairingCreate', { address: null, ...noGrant }), (error: HostRequestError) => error.code === 'forbidden');
  assert.deepEqual((await owner.connection.request('access.devices', {})).map(entry => [entry.name, entry.connected]), [['Work laptop', true]]);
  // The device's token works only on the remote address: the loopback port is the app's own.
  const onLoopback = client(t, origin, pairing.token, descriptor.hostId);
  await until(() => onLoopback.connection.status === 'revoked');
  assert.equal((await fetch(origin + '/api/folders/' + folder.folderId + '/files/README.md', { headers: { Authorization: 'Bearer ' + pairing.token } })).status, 401);
  // Exports download with an exact UTF-8 name besides the ASCII one (the unit test below covers non-ASCII names).
  const prepared = await device.connection.request('plan.exportPrepare', { folderId: folder.folderId, work: 'work-0001' });
  const download = await device.connection.fetch('/api/exports/' + prepared.token);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition') ?? '', /filename\*=UTF-8''/);
  await download.arrayBuffer();
  // Exports belong to whoever prepared them: a device cannot take the owner's.
  const ownerFolder = await owner.connection.request('folders.open', { path: planning });
  await owner.connection.follow(ownerFolder.folderId);
  const ownerExport = await owner.connection.request('plan.exportPrepare', { folderId: ownerFolder.folderId, work: 'work-0001' });
  assert.equal((await device.connection.fetch('/api/exports/' + ownerExport.token)).status, 404);
  assert.equal((await owner.connection.fetch('/api/exports/' + ownerExport.token)).status, 200);

  await owner.connection.request('access.deviceRevoke', { deviceId: pairing.deviceId });
  await until(() => device.connection.status === 'revoked');
  assert.match(device.connection.detail!, /revoked/);
  const again = client(t, remote, pairing.token, descriptor.hostId);
  await until(() => again.connection.status === 'revoked');
  assert.equal((await fetch(remote + '/api/folders/' + folder.folderId + '/files/README.md', { headers: { Authorization: 'Bearer ' + pairing.token } })).status, 401);

  // Turning remote access off stops the listener and forgets open pairing links.
  const open = await owner.connection.request('access.pairingCreate', { address: null, ...noGrant });
  await owner.connection.request('access.update', { settings: { network: { enabled: false, address: '127.0.0.1', port } } });
  await assert.rejects(describeHost(remote, 1000), /could not reach/);
  await owner.connection.request('access.update', { settings: { network: { enabled: true, address: '127.0.0.1', port } } });
  await assert.rejects(pairWithHost(remote, open.code, { name: 'Late', platform: 'linux' }), /wrong, expired or already used/, 'a link from before is gone');
  // Pairing happens only on the remote access address, never through the app's loopback port.
  const fresh = await owner.connection.request('access.pairingCreate', { address: null, ...noGrant });
  await assert.rejects(pairWithHost(origin, fresh.code, { name: 'Local', platform: 'linux' }), /Pairing failed|Not found/);
});

test('a device with Manage access pairs and revokes devices, but does not change the settings', async t => {
  const { host, origin } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId).connection;
  const manager = await pairDevice(t, host, owner, { label: null, manageAccess: true }, 'Desk');
  assert.deepEqual(manager.pairing.scopes, ['computer', 'access:manage']);
  const state = await manager.connection.request('access.state', {});
  assert.equal(state.status.listening, true);
  // It pairs another device from its own pairing link, sees it, and revokes it.
  const link = await manager.connection.request('access.pairingCreate', { address: null, label: 'Phone', manageAccess: false });
  const { origin: remote, code } = parsePairing(link.url!);
  const phone = await pairWithHost(remote, code, { name: 'pixel', platform: 'android' });
  assert.deepEqual(phone.pairing.scopes, ['computer']);
  const listed = await manager.connection.request('access.devices', {});
  assert.deepEqual(listed.map(entry => [entry.name, entry.scopes.includes('access:manage')]), [['Desk', true], ['Phone', false]]);
  const phoneClient = client(t, remote, phone.pairing.token, phone.descriptor.hostId);
  await until(() => phoneClient.connection.status === 'connected');
  await manager.connection.request('access.deviceRevoke', { deviceId: phone.pairing.deviceId });
  await until(() => phoneClient.connection.status === 'revoked');
  await assert.rejects(manager.connection.request('access.update', { settings: { network: { enabled: false, address: null, port: 7346 } } }), (error: HostRequestError) => error.code === 'forbidden');
});

test('the folder list starts from the recent folders and the folders the first remote access shared', async t => {
  // Removed after the host stops (registered after start's own cleanup), since the host holds files in it.
  const data = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-host-data-')));
  const places = temporary(t, 'atlas-host-places-');
  const [recent, older, shared] = ['recent', 'older', 'shared'].map(name => { const folder = path.join(places, name, 'planning'); cpSync(fixture, folder, { recursive: true }); return folder; });
  const gone = path.join(places, 'gone', 'planning');
  writeFileSync(path.join(data, 'planning-roots.json'), JSON.stringify({ recent: [recent, gone, older] }));
  // Remote access as the first version saved it: a shared folder and a device that could read only shared folders.
  const legacy = new AccessStore(path.join(data, 'host'), quiet, 'a test');
  await legacy.lock();
  const paired = legacy.pair(legacy.createPairing(null).code, { name: 'Old laptop', platform: 'linux' });
  legacy.unlock();
  const file = path.join(data, 'host', 'access.json');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...saved, version: 1, settings: { ...saved.settings, sharedFolders: [shared, recent] }, devices: saved.devices.map((device: { scopes: string[] }) => ({ ...device, scopes: ['planning:read'] })) }));
  const { host, origin } = await start(t, { data });
  t.after(() => rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const folders = await host.computerFolders();
  assert.deepEqual(folders.map(entry => [entry.path, entry.available, entry.openedAt]), [[recent, true, null], [gone, false, null], [older, true, null], [shared, true, null]]);
  // The device paired with version 1 now has the whole computer.
  assert.deepEqual(host.access.deviceForToken(paired.token)?.scopes, ['computer']);
  // Opening moves a folder to the top; removing takes it off for everyone; the missing one stays until removed.
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  await owner.connection.request('folders.open', { path: older });
  const after = await owner.connection.request('folders.list', {});
  assert.deepEqual(after.map(entry => entry.path), [older, recent, gone, shared]);
  assert.ok(after[0].openedAt);
  await owner.connection.request('folders.remove', { folderId: after.find(entry => entry.path === gone)!.folderId });
  await until(() => owner.lists.some(list => list.length === 3), 5000, () => owner.lists);
  await assert.rejects(owner.connection.request('folders.remove', { folderId: 'f-' + 'a'.repeat(32) }), (error: HostRequestError) => error.code === 'not-found');
  // The settings are saved as version 2 by the next change, without the shared folders.
  await owner.connection.request('access.update', { settings: { network: { enabled: false, address: null, port: 7346 } } });
  const rewritten = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(rewritten.version, 2);
  assert.equal(rewritten.settings.sharedFolders, undefined);
  assert.deepEqual(rewritten.devices[0].scopes, ['computer']);
  // A folder the list names but this process never opened still opens by its ID (after a restart, say).
  const fromList = after.find(entry => entry.path === shared)!;
  assert.equal((await owner.connection.follow(fromList.folderId)).status, 'ready');
});

test('a folder list the host cannot read right now is left as it is', async t => {
  const directory = temporary(t, 'atlas-list-');
  const list = new FolderList(directory, quiet, async () => []);
  await list.touch(path.join(directory, 'one'));
  assert.deepEqual((await list.entries()).map(entry => path.basename(entry.path)), ['one']);
  // Another program holds the file (here: a folder in its place, which cannot be read as a file).
  const saved = readFileSync(list.file, 'utf8');
  rmSync(list.file);
  mkdirSync(list.file);
  assert.deepEqual(await list.entries(), []);
  await assert.rejects(list.touch(path.join(directory, 'two')), /cannot be read right now/);
  await assert.rejects(list.remove(path.join(directory, 'one')), /cannot be read right now/);
  rmSync(list.file, { recursive: true });
  writeFileSync(list.file, saved);
  assert.deepEqual((await list.entries()).map(entry => path.basename(entry.path)), ['one'], 'nothing replaced it meanwhile');
});

test('the folder browser lists folders only, marks planning folders and follows links to folders', async t => {
  const root = temporary(t, 'atlas-browse-');
  cpSync(fixture, path.join(root, 'b-planning'), { recursive: true });
  for (const name of ['a-folder', 'folder 10', 'folder 9', '.hidden']) mkdirSync(path.join(root, name));
  writeFileSync(path.join(root, 'notes.md'), 'a file');
  // A junction (Windows) or a symbolic link (elsewhere) to a folder counts as a folder.
  symlinkSync(path.join(root, 'b-planning'), path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const listed = await browse(root);
  assert.deepEqual(listed.folders.map(entry => [entry.name, entry.planning]), [['a-folder', false], ['b-planning', true], ['folder 9', false], ['folder 10', false], ['linked', true]]);
  assert.equal(listed.parent, path.dirname(root));
  assert.equal(listed.planning, false);
  assert.equal((await browse(path.join(root, 'b-planning'))).planning, true);
  await assert.rejects(browse(path.join(root, 'missing')), (error: Error & { code?: string }) => error.code === 'not-found');
  await assert.rejects(browse(path.join(root, 'notes.md')), (error: Error & { code?: string }) => error.code === 'invalid-argument');
  const places = await browse(null, process.platform);
  assert.equal(places.folders[0].name, 'Home');
  assert.ok(places.folders.length >= 2, 'the drives or the root follow');
});

test('another computer imports a plan by sending its file', async t => {
  const { host, origin, planning } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId).connection;
  const device = await pairDevice(t, host, owner);
  const opened = await device.connection.request('folders.open', { path: planning });
  await device.connection.follow(opened.folderId);
  const prepared = await device.connection.request('plan.exportPrepare', { folderId: opened.folderId, work: 'work-0002' });
  const html = new Uint8Array(await (await device.connection.fetch('/api/exports/' + prepared.token)).arrayBuffer());
  const sent = await device.connection.fetch(`/api/folders/${opened.folderId}/imports`, 60000, { method: 'POST', body: html, length: html.byteLength });
  assert.equal(sent.status, 200, await sent.clone().text());
  const preview = await sent.json() as { token: string; newId: string; title: string };
  assert.equal(preview.newId, 'work-0005');
  // The preview belongs to the device that sent the file.
  await assert.rejects(owner.request('plan.importConfirm', { folderId: opened.folderId, token: preview.token }), /expired/);
  const result = await device.connection.request('plan.importConfirm', { folderId: opened.folderId, token: preview.token });
  assert.equal(result.workId, 'work-0005');
  assert.equal((await device.connection.request('folder.snapshot', { folderId: opened.folderId })).work.length, 5);
  // Something that is not a plan export is refused, and nothing is written.
  const junk = new TextEncoder().encode('<!doctype html><p>not a plan</p>');
  const refused = await device.connection.fetch(`/api/folders/${opened.folderId}/imports`, 60000, { method: 'POST', body: junk, length: junk.byteLength });
  assert.equal(refused.status, 400);
  assert.equal((await fetch(device.remote + `/api/folders/${opened.folderId}/imports`, { method: 'POST', body: junk })).status, 401, 'only paired devices send files');
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
  assert.equal(await store.lock(), null);
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
  // Wrong codes from one address do not block pairing from another.
  assert.equal(store.pair(valid.code, { name: 'Elsewhere', platform: 'linux' }, '100.64.9.9').device.name, 'Elsewhere');
  t.mock.timers.tick(5 * 60000);
  const paired = store.pair(store.createPairing(null).code, { name: 'Later', platform: 'win32' });
  assert.equal(store.deviceForToken(paired.token)?.deviceId, paired.device.deviceId);
  assert.equal(store.deviceForToken(paired.token + 'x'), null);
  assert.equal(normalizeCode('k7qf-2mxp 9tra-4d6w'), 'K7QF2MXP9TRA4D6W');
  assert.equal(normalizeCode('O1IL-uuuu'), '0111VVVV');
  // Tokens are stored only as hashes.
  const { readFileSync } = await import('node:fs');
  assert.ok(!readFileSync(path.join(directory, 'access.json'), 'utf8').includes(paired.token));
  // Another process on this computer cannot take over remote access while this one manages it, and takes over once it stops.
  const second = new AccessStore(directory, quiet, 'another test');
  assert.match(await second.lock() ?? '', /a test \(process \d+\)/);
  assert.throws(() => second.createPairing(null), /managed by a test/);
  store.unlock();
  assert.equal(await second.lock(), null);
  second.createPairing(null);
  second.unlock();
});

test('the lock is a system object that disappears with its process, named after the data folder secret', () => {
  const windows = lockAddress('secret-one', 'win32');
  assert.match(windows.address, /^\\\\\.\\pipe\\atlas-host-[a-f0-9]{32}$/);
  assert.equal(windows.file, false);
  const linux = lockAddress('secret-one', 'linux');
  assert.equal(linux.address.charCodeAt(0), 0, 'an abstract socket');
  assert.equal(linux.file, false);
  assert.notEqual(lockAddress('secret-two', 'linux').address, linux.address, 'another data folder, another lock');
  assert.equal(lockAddress('secret-one', 'darwin').file, true);
  assert.ok(lockAddress('secret-one', 'darwin').address.length < 104, 'socket paths are short');
});

test('stored access survives one bad device record, and device names are trimmed and never blank', async t => {
  const directory = temporary(t, 'atlas-access-');
  const store = new AccessStore(directory, quiet, 'a test');
  await store.lock();
  const first = store.pair(store.createPairing(null).code, { name: 'Desk', platform: 'win32' });
  store.unlock();
  assert.throws(() => pairRequest({ code: 'AAAA-AAAA-AAAA-AAAA', device: { name: '   ', platform: 'linux' } }), /not blank/);
  assert.equal(pairRequest({ code: 'AAAA-AAAA-AAAA-AAAA', device: { name: '  Laptop ', platform: 'linux' } }).device.name, 'Laptop');
  assert.throws(() => accessSettings({ network: { enabled: true, address: '0.0.0.0', port: 7346 } }), /not every address/);
  const file = path.join(directory, 'access.json');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  const hostId = saved.hostId;
  saved.devices.push({ ...saved.devices[0], deviceId: 'd-' + 'b'.repeat(32), name: '' }, { ...saved.devices[0], deviceId: 'd-' + 'c'.repeat(32), scopes: ['owner'] });
  writeFileSync(file, JSON.stringify(saved));
  const reread = new AccessStore(directory, quiet, 'a test');
  assert.equal(reread.hostId, hostId, 'the identity stays');
  assert.equal(reread.deviceForToken(first.token)?.name, 'Desk', 'good devices stay paired');
  assert.equal(reread.devices(new Set()).length, 1, 'bad records (a blank name, an owner scope) are dropped');
});

test('the owner token works only on the loopback port, never on the remote access address', async t => {
  const { host, origin } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId).connection;
  const port = await freePort();
  await owner.request('access.update', { settings: { network: { enabled: true, address: '127.0.0.1', port } } });
  const remote = client(t, 'http://127.0.0.1:' + port, host.ownerToken, host.descriptor.hostId);
  await until(() => remote.connection.status === 'revoked');
  // Overlapping changes leave exactly the listener the last one asked for.
  const [first, second] = [await freePort(), await freePort()];
  await Promise.all([first, second].map(next => owner.request('access.update', { settings: { network: { enabled: true, address: '127.0.0.1', port: next } } })));
  await owner.request('access.update', { settings: { network: { enabled: false, address: '127.0.0.1', port: second } } });
  for (const closed of [port, first, second]) await assert.rejects(describeHost('http://127.0.0.1:' + closed, 1000), /could not reach/, 'port ' + closed + ' is closed');
});

test('a restarted host serves the owner its folders again, and a WebSocket from a browser is refused', async t => {
  const data = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-host-data-')));
  let current = await start(t, { data });
  const owner = client(t, () => current.origin, () => current.host.ownerToken, current.host.descriptor.hostId);
  const opened = await owner.connection.request('folders.open', { path: current.planning });
  const planning = current.planning;
  await owner.connection.follow(opened.folderId, () => owner.connection.request('folders.open', { path: planning }));
  // The host stops (a crash) and starts again with the same identity: the folder comes back by path.
  await current.host.stop();
  const restarted = await start(t, { data });
  current = { ...restarted, planning };
  // Remove the shared data folder only once the running host has let go of it, whatever order cleanup runs in.
  t.after(async () => { await restarted.host.stop(); rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });
  owner.connection.wake();
  await until(() => owner.events.some(event => event.folderId === opened.folderId && event.status === 'ready'), 15000);
  assert.equal((await owner.connection.request('folder.snapshot', { folderId: opened.folderId })).work.length, 4);
  const { request } = await import('node:http');
  const upgrade = await new Promise<number>((resolve, reject) => request({ host: '127.0.0.1', port: current.port, path: '/api/connect', headers: { Origin: 'https://evil.example', Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': Buffer.from('the sample nonce').toString('base64'), 'Sec-WebSocket-Version': '13', Authorization: 'Bearer ' + current.host.ownerToken } })
    .on('response', response => { response.resume(); resolve(response.statusCode!); }).on('upgrade', () => resolve(101)).on('error', reject).end());
  assert.equal(upgrade, 403);
});

test('waking a client while it connects opens one connection, not two', async t => {
  const { host, origin } = await start(t);
  const slow = client(t, origin, async () => { await new Promise(resolve => setTimeout(resolve, 200)); return host.ownerToken; }, host.descriptor.hostId);
  slow.connection.wake();
  slow.connection.wake();
  await until(() => slow.connection.status === 'connected');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal((host as unknown as { connections: Set<unknown> }).connections.size, 1);
  slow.connection.close();
  await until(() => (host as unknown as { connections: Set<unknown> }).connections.size === 0);
});

test('settings this version cannot read are left alone, and remote access stays off until they can be read', async t => {
  const directory = temporary(t, 'atlas-access-');
  const manager = new AccessStore(directory, quiet, 'a test');
  assert.equal(await manager.lock(), null);
  const paired = manager.pair(manager.createPairing(null).code, { name: 'Desk', platform: 'win32' });
  manager.unlock();
  const file = path.join(directory, 'access.json');
  const good = readFileSync(file, 'utf8');
  // A newer Atlas wrote the file: this version neither replaces nor rewrites it.
  const newer = JSON.stringify({ ...JSON.parse(good), version: 3 });
  writeFileSync(file, newer);
  const reader = new AccessStore(directory, quiet, 'a test');
  assert.match(reader.problem ?? '', /not in a form this version of Atlas can read/);
  assert.equal(await reader.lock(), 'nobody');
  assert.throws(() => reader.createPairing(null), /not in a form this version/);
  reader.reload();
  assert.equal(readFileSync(file, 'utf8'), newer, 'the file is untouched');
  // Once the file is readable again, this process asks for a restart (its folder IDs use the secret it started with), and keeps asking; a new start works.
  writeFileSync(file, good);
  assert.equal(await reader.lock(), 'nobody');
  assert.match(reader.problem ?? '', /Quit and start Atlas again/);
  reader.reload();
  assert.equal(await reader.lock(), 'nobody', 'reading the file again does not make it a manager');
  assert.match(reader.problem ?? '', /Quit and start Atlas again/);
  const restarted = new AccessStore(directory, quiet, 'a test');
  assert.equal(await restarted.lock(), null);
  assert.equal(restarted.problem, null);
  assert.equal(restarted.deviceForToken(paired.token)?.name, 'Desk');
  restarted.unlock();
});

test('a process taking over remote access starts from what the previous manager saved', async t => {
  const directory = temporary(t, 'atlas-access-');
  const serve = new AccessStore(directory, quiet, '`atlas serve`');
  assert.equal(await serve.lock(), null);
  const old = serve.pair(serve.createPairing(null).code, { name: 'Old laptop', platform: 'linux' });
  const app = new AccessStore(directory, quiet, 'the Atlas app');
  assert.match(await app.lock() ?? '', /atlas serve/);
  // While the app waits, the manager pairs one device and revokes another.
  const fresh = serve.pair(serve.createPairing(null).code, { name: 'New laptop', platform: 'win32' });
  serve.revokeDevice(old.device.deviceId);
  serve.unlock();
  assert.equal(await app.lock(), null);
  assert.equal(app.deviceForToken(old.token), null, 'the revocation holds');
  assert.equal(app.deviceForToken(fresh.token)?.name, 'New laptop', 'the new pairing holds');
  app.unlock();
});

test('a program squatting on the lock\'s name is not taken for Atlas', async t => {
  const directory = temporary(t, 'atlas-access-');
  const store = new AccessStore(directory, quiet, 'a test');
  const { address } = lockAddress(store.folderKey);
  // It holds the name but cannot prove it read the data folder's secret.
  const connections = new Set<import('node:net').Socket>();
  const squatter = createServer(socket => { connections.add(socket); socket.on('error', () => undefined); socket.end(JSON.stringify({ owner: 'the Atlas app', pid: 1, proof: 'guess' })); });
  await new Promise<void>(resolve => squatter.listen(address, resolve));
  t.after(() => new Promise(resolve => { for (const socket of connections) socket.destroy(); squatter.close(resolve); }));
  assert.equal(await store.lock(), 'a program that is not Atlas');
});

test('download names keep their exact characters, with an ASCII fallback', () => {
  assert.equal(attachment('přehled-work-0001.atlas-plan.html'), `attachment; filename="p_ehled-work-0001.atlas-plan.html"; filename*=UTF-8''p%C5%99ehled-work-0001.atlas-plan.html`);
  assert.equal(attachment('a "quoted" (one).html'), `attachment; filename="a _quoted_ (one).html"; filename*=UTF-8''a%20%22quoted%22%20%28one%29.html`);
});

test('the close code for revocation is part of the protocol', () => {
  assert.equal(closeCodes.revoked, 4401);
});
