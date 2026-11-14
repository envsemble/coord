// The host end to end on 127.0.0.1: authentication and scopes, pairing with a one-time code, the
// whole computer for a paired device, Manage access, revocation, and
// the checks that keep browsers and other hosts out. Its projects are in projects.test.ts; what
// waits on watchers and the host's timers is in host.slow.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HomeDatabase } from '../planning/index.ts';
import { AccessStore, lockAddress, normalizeCode } from './access/access.ts';
import { HostRequestError, describeHost, pairWithHost, parsePairing } from './client.ts';
import { withWorkDocuments } from './contract.ts';
import { acceptableHost } from './host.ts';
import { pairRequest, accessSettings } from './validate.ts';
import { accessStore, client, freePort, noGrant, opened, pairDevice, projectNamed, quiet, start, temporary, until } from './testing.ts';

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
  assert.equal((await fetch(origin + '/api/projects/f-' + '0'.repeat(32) + '/files/plan.md')).status, 401);
});

test('the owner reads any folder it opens; a request with the wrong shape or scope is refused', async t => {
  const { host, origin, planning } = await start(t);
  const { connection, events } = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const session = await connection.request('host.session', {});
  assert.deepEqual(session.scopes, ['owner']);
  const opened = await projectNamed(connection);
  assert.deepEqual([opened.path, opened.state, opened.position], [planning, 'active', 0]);
  const state = await connection.follow(opened.id);
  assert.deepEqual([state.projectId, state.status], [opened.id, 'ready']);
  const snapshot = await connection.request('project.snapshot', { projectId: opened.id });
  assert.equal(snapshot.work.length, 4);
  // Each document comes once: the work items get theirs back from the snapshot's, the plan first.
  assert.ok(snapshot.work.every(work => !('documents' in work)));
  assert.equal(withWorkDocuments(snapshot).work.find(work => work.id === 'work-0001')?.documents[0]?.path, 'active/0001-saved-payment-methods/plan.md');
  const plan = await connection.request('project.document', { projectId: opened.id, path: 'active/0001-saved-payment-methods/plan.md' });
  assert.equal(plan.title, 'Saved payment methods');
  await assert.rejects(connection.request('project.document', { projectId: opened.id, path: '../outside.md' }), (error: HostRequestError) => error.code === 'invalid-argument');
  // A work item's diagrams are its .puml files; a diagram comes with its family, and documents link them under their headings.
  assert.equal(snapshot.work.find(work => work.id === 'work-0001')?.diagrams, 3);
  const diagrams = await connection.request('project.diagrams', { projectId: opened.id, work: 'work-0001' });
  assert.deepEqual(diagrams.map(diagram => [diagram.path, diagram.role]), [['diagrams/checkout-alternative.puml', 'proposal'], ['diagrams/checkout-capture.puml', 'capture'], ['diagrams/checkout-proposal.puml', 'proposal']]);
  const payload = await connection.request('project.diagram', { projectId: opened.id, work: 'work-0001', path: 'diagrams/checkout-proposal.puml' }) as { family?: string; siblings?: { path: string }[] };
  assert.equal(payload.family, 'diagrams/checkout-capture.puml');
  assert.equal(payload.siblings?.length, 2);
  const references = await connection.request('project.references', { projectId: opened.id, work: 'work-0001', path: 'active/0001-saved-payment-methods/plan.md' });
  assert.deepEqual(references.find(reference => reference.element === 'CardSession'), { workId: 'work-0001', path: 'diagrams/checkout-capture.puml', title: 'Checkout · captured TypeScript', provenance: diagrams[1].provenance, section: 'current-checkout', element: 'CardSession' });
  assert.equal((await connection.request('project.diagramIndex', { projectId: opened.id })).length, 8);
  for (const path of ['../planning.json', 'plan.md', '/etc/x.puml'])
    await assert.rejects(connection.request('project.diagram', { projectId: opened.id, work: 'work-0001', path }), (error: HostRequestError) => error.code === 'invalid-argument', path);
  await assert.rejects(connection.request('project.snapshot', { projectId: 'f-' + 'a'.repeat(32) }), (error: HostRequestError) => error.code === 'forbidden');
  await assert.rejects(connection.request('projects.update' as never, { projectId: 42 } as never), (error: HostRequestError) => error.code === 'invalid-argument');
  // Files in documents come over authenticated HTTP.
  const image = await connection.fetch(`/api/projects/${opened.id}/files/active/0001-saved-payment-methods/plan.md`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'application/octet-stream', 'only images keep their type');
  assert.match(image.headers.get('content-security-policy') ?? '', /sandbox/);
  // Paths stay inside the folder: an encoded escape and hidden folders are refused.
  assert.equal((await connection.fetch(`/api/projects/${opened.id}/files/..%2F..%2Fpackage.json`)).status, 403);
  assert.equal((await connection.fetch(`/api/projects/${opened.id}/files/active/0001-saved-payment-methods/.cache/x.json`)).status, 403);
  // A change on disk reaches the subscriber, and the folder's view shows it.
  writeFileSync(path.join(planning, 'README.md'), '# Changed\n');
  const readme = async () => (await connection.request('project.snapshot', { projectId: opened.id })).documents.find(document => document.path === 'README.md')?.title;
  let title = await readme();
  for (const deadline = Date.now() + 10000; title !== 'Changed' && Date.now() < deadline;) { await new Promise(resolve => setTimeout(resolve, 100)); title = await readme(); }
  assert.equal(title, 'Changed', JSON.stringify({ state, events }));
  assert.ok(events.some(event => event.projectId === opened.id && event.revision > state.revision));
});

test('an unsubscribe sent while the subscribe is still opening the folder undoes it', async t => {
  const { host, origin } = await start(t);
  const { connection } = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const opened = await projectNamed(connection);
  const subscribing = connection.request('projects.subscribe', { projectId: opened.id });
  await connection.request('projects.unsubscribe', { projectId: opened.id });
  assert.equal((await subscribing).projectId, opened.id);
  await assert.rejects(connection.request('project.snapshot', { projectId: opened.id }), (error: HostRequestError) => error.code === 'forbidden');
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

  // The device sees the computer's projects, with their real paths, and reads them.
  const device = client(t, remote, pairing.token, descriptor.hostId);
  const opened = await projectNamed(device.connection);
  assert.equal(opened.path, planning, 'a device sees real paths');
  const folder = await device.connection.follow(opened.id);
  assert.equal(folder.status, 'ready');
  const snapshot = await device.connection.request('project.snapshot', { projectId: folder.projectId });
  assert.equal(snapshot.work.length, 4);
  assert.equal(snapshot.root, planning);
  assert.equal(snapshot.name, 'Northwind', 'the project\'s name, from its planning.json');
  // A folder that is not a project's is out of reach.
  await assert.rejects(device.connection.request('projects.subscribe', { projectId: 'f-' + 'a'.repeat(32) }), (error: HostRequestError) => error.code === 'not-found');
  // Only the owner changes the remote-access settings; managing access needs Manage access.
  await assert.rejects(device.connection.request('access.update', { settings: { network: { enabled: false, address: null, port } } }), (error: HostRequestError) => error.code === 'forbidden' && /Only the Atlas app on/.test(error.message));
  await assert.rejects(device.connection.request('access.devices', {}), (error: HostRequestError) => error.code === 'forbidden' && /may not manage access/.test(error.message));
  await assert.rejects(device.connection.request('access.pairingCreate', { address: null, ...noGrant }), (error: HostRequestError) => error.code === 'forbidden');
  assert.deepEqual((await owner.connection.request('access.devices', {})).map(entry => [entry.name, entry.connected]), [['Work laptop', true]]);
  // The device's token works only on the remote address: the loopback port is the app's own.
  const onLoopback = client(t, origin, pairing.token, descriptor.hostId);
  await until(() => onLoopback.connection.status === 'revoked');
  assert.equal((await fetch(origin + '/api/projects/' + folder.projectId + '/files/README.md', { headers: { Authorization: 'Bearer ' + pairing.token } })).status, 401);

  await owner.connection.request('access.deviceRevoke', { deviceId: pairing.deviceId });
  await until(() => device.connection.status === 'revoked');
  assert.match(device.connection.detail!, /revoked/);
  const again = client(t, remote, pairing.token, descriptor.hostId);
  await until(() => again.connection.status === 'revoked');
  assert.equal((await fetch(remote + '/api/projects/' + folder.projectId + '/files/README.md', { headers: { Authorization: 'Bearer ' + pairing.token } })).status, 401);

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

test('a client sends no credential to another host answering on a known address', async t => {
  const first = await start(t);
  const second = await start(t);
  const confused = client(t, second.origin, 'atl_secret', first.host.descriptor.hostId);
  await until(() => confused.connection.status === 'mismatch');
  assert.match(confused.connection.detail!, /different computer/);
});

test('pairing codes expire, can be revoked, and too many wrong codes pause pairing', async t => {
  const directory = temporary(t, 'atlas-access-');
  const store = accessStore(directory);
  assert.equal(await store.lock(), null);
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
  assert.ok(!readFileSync(path.join(directory, 'atlas.db')).includes(paired.token));
  // Another process on this computer cannot take over remote access while this one manages it, and takes over once it stops.
  const second = accessStore(directory, 'another test');
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

test('the host keeps its identity, and device names are trimmed and never blank', async t => {
  const directory = temporary(t, 'atlas-access-');
  const store = accessStore(directory);
  await store.lock();
  const first = store.pair(store.createPairing(null).code, { name: 'Desk', platform: 'win32' });
  store.unlock();
  assert.throws(() => pairRequest({ code: 'AAAA-AAAA-AAAA-AAAA', device: { name: '   ', platform: 'linux' } }), /not blank/);
  assert.equal(pairRequest({ code: 'AAAA-AAAA-AAAA-AAAA', device: { name: '  Laptop ', platform: 'linux' } }).device.name, 'Laptop');
  assert.throws(() => accessSettings({ network: { enabled: true, address: '0.0.0.0', port: 7346 } }), /not every address/);
  const reread = accessStore(directory);
  assert.equal(reread.hostId, store.hostId, 'the identity stays');
  assert.equal(reread.projectIdKey, store.projectIdKey);
  assert.equal(reread.deviceForToken(first.token)?.name, 'Desk', 'devices stay paired');
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
  const opened = await projectNamed(owner.connection);
  await owner.connection.follow(opened.id);
  // The host stops (a crash) and starts again with the same identity: the project's folder comes back by its ID.
  await current.host.stop();
  rmSync(current.planning, { recursive: true, force: true, maxRetries: 10 });
  const restarted = await start(t, { data });
  current = restarted;
  // Remove the shared data folder only once the running host has let go of it, whatever order cleanup runs in.
  t.after(async () => { await restarted.host.stop(); rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });
  owner.connection.wake();
  await until(() => owner.events.some(event => event.projectId === opened.id && event.status === 'ready'), 15000);
  assert.equal((await owner.connection.request('project.snapshot', { projectId: opened.id })).work.length, 4);
  const { request } = await import('node:http');
  const upgrade = await new Promise<number>((resolve, reject) => request({ host: '127.0.0.1', port: current.port, path: '/api/connect', headers: { Origin: 'https://evil.example', Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': Buffer.from('the sample nonce').toString('base64'), 'Sec-WebSocket-Version': '13', Authorization: 'Bearer ' + current.host.ownerToken } })
    .on('response', response => { response.resume(); resolve(response.statusCode!); }).on('upgrade', () => resolve(101)).on('error', reject).end());
  assert.equal(upgrade, 403);
});

test('waking a client while it connects opens one connection, not two', async t => {
  const { host, origin } = await start(t);
  const slow = client(t, origin, async () => { await new Promise(resolve => setTimeout(resolve, 100)); return host.ownerToken; }, host.descriptor.hostId);
  slow.connection.wake();
  slow.connection.wake();
  await until(() => slow.connection.status === 'connected');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal((host as unknown as { connections: Set<unknown> }).connections.size, 1);
  slow.connection.close();
  await until(() => (host as unknown as { connections: Set<unknown> }).connections.size === 0);
});

test('an identity changed under a running host needs a restart before remote access works again', async t => {
  const directory = temporary(t, 'atlas-access-');
  const manager = accessStore(directory);
  assert.equal(await manager.lock(), null);
  const paired = manager.pair(manager.createPairing(null).code, { name: 'Desk', platform: 'win32' });
  manager.unlock();
  const reader = accessStore(directory);
  manager.database.setSetting('host.secret', 'T'.repeat(43));
  assert.equal(await reader.lock(), 'nobody');
  assert.match(reader.problem ?? '', /Quit and start Atlas again/);
  assert.throws(() => reader.createPairing(null), /Quit and start Atlas again/);
  const restarted = accessStore(directory);
  assert.equal(await restarted.lock(), null);
  assert.equal(restarted.problem, null);
  assert.equal(restarted.deviceForToken(paired.token)?.name, 'Desk');
});

test('a process taking over remote access starts from what the previous manager saved', async t => {
  const directory = temporary(t, 'atlas-access-');
  const serve = accessStore(directory, '`atlas serve`');
  assert.equal(await serve.lock(), null);
  const old = serve.pair(serve.createPairing(null).code, { name: 'Old laptop', platform: 'linux' });
  const app = accessStore(directory, 'the Atlas app');
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
  const store = accessStore(directory);
  const { address } = lockAddress(store.projectIdKey);
  // It holds the name but cannot prove it read the data folder's secret.
  const connections = new Set<import('node:net').Socket>();
  const squatter = createServer(socket => { connections.add(socket); socket.on('error', () => undefined); socket.end(JSON.stringify({ owner: 'the Atlas app', pid: 1, proof: 'guess' })); });
  await new Promise<void>(resolve => squatter.listen(address, resolve));
  t.after(() => new Promise(resolve => { for (const socket of connections) socket.destroy(); squatter.close(resolve); }));
  assert.equal(await store.lock(), 'a program that is not Atlas');
});
