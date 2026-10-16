// The host end to end on 127.0.0.1: authentication and scopes, pairing with a one-time code, the
// whole computer for a paired device (its projects, import), projects (listed, created, renamed,
// hidden, archived and ordered), Manage access, revocation, and the checks that keep browsers and
// other hosts out.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { createReport, HomeDatabase, insertReport } from '@envsemble/atlas-planning';
import { AccessStore, hostRunning, lockAddress, normalizeCode } from './access.ts';
import { HostClient, HostRequestError, describeHost, pairWithHost, parsePairing, type ClientStatus } from './client.ts';
import { closeCodes, type FolderState, type Project } from './contract.ts';
import { readTemplates } from '@envsemble/atlas-planning';
import { Host, acceptableHost, attachment } from './host.ts';
import { pairRequest, accessSettings } from './validate.ts';
import type { WorkerLike } from './planWorkerClient.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, '../../../app/e2e/fixtures/planning');
const templates = path.resolve(here, '../../../plugin/skills/atlas/assets/planning');
const started = Date.now();
/** Quiet, unless ATLAS_TEST_LOG is set to follow what the host does while a test runs. */
const print = (level: string) => (message: string, detail?: unknown) => { if (process.env.ATLAS_TEST_LOG) console.log(Date.now() - started, level, message, JSON.stringify(detail ?? '')); };
const quiet = { info: print('info'), warn: print('warn'), error: print('error') };

/** Databases the access stores below opened, closed before their folders are removed. */
const opened = new Set<{ store: AccessStore; database: HomeDatabase }>();
function temporary(t: TestContext, prefix: string) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));
  t.after(() => {
    for (const entry of opened) { entry.store.unlock(); entry.database.close(); opened.delete(entry); }
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  return directory;
}
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address() as { port: number }; server.close(() => resolve(port)); });
  });
}
/** A host on a home of its own, with the fixture as its project `planning`. */
async function start(t: TestContext, options: { data?: string; loopbackPort?: number; listingTimeout?: number } = {}) {
  const data = options.data ?? realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-host-data-')));
  const planning = path.join(data, 'planning', 'planning');
  cpSync(fixture, planning, { recursive: true });
  const host = new Host({
    home: data, version: '0.0.0-test', log: quiet, owner: 'a test', idleClose: 50,
    createPlanWorker: () => new Worker(new URL('./planWorker.ts', import.meta.url)) as unknown as WorkerLike,
    templates: () => readTemplates(templates),
    ...options,
  });
  const { port } = await host.start();
  // Stop the host (closing its database) before removing its home; a home passed in belongs to the caller.
  t.after(async () => {
    await host.stop();
    if (!options.data) rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const origin = 'http://127.0.0.1:' + port;
  return { host, planning, data, port, origin };
}
/** A project of the host by its name. */
async function projectNamed(connection: HostClient, name = 'Northwind'): Promise<Project> {
  const project = (await connection.request('projects.list', {})).find(entry => entry.name === name);
  assert.ok(project, 'no project ' + name);
  return project;
}
/** An access store on a home database of its own. */
function accessStore(directory: string, owner = 'a test') {
  const database = HomeDatabase.open(directory);
  const store = new AccessStore(database, quiet, owner);
  opened.add({ store, database });
  return store;
}
function client(t: TestContext, origin: string | (() => string), token: string | (() => string | Promise<string>), hostId: string | null = null) {
  const events: FolderState[] = [];
  const lists: Project[][] = [];
  const statuses: ClientStatus[] = [];
  const connection = new HostClient({
    origin, token: typeof token === 'function' ? token : () => token, hostId, retry: { first: 0, cap: 100 }, onStatus: status => statuses.push(status),
    onEvent: (event, data) => { if (event === 'folder.changed') events.push(data as FolderState); else if (event === 'projects.changed') lists.push((data as { projects: Project[] }).projects); },
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
  const opened = await projectNamed(connection);
  assert.deepEqual([opened.path, opened.state, opened.position], [planning, 'active', 0]);
  const state = await connection.follow(opened.folderId);
  assert.deepEqual([state.folderId, state.status], [opened.folderId, 'ready']);
  const snapshot = await connection.request('folder.snapshot', { folderId: opened.folderId });
  assert.equal(snapshot.work.length, 4);
  const plan = await connection.request('folder.document', { folderId: opened.folderId, path: 'active/0001-saved-payment-methods/plan.md' });
  assert.equal(plan.title, 'Saved payment methods');
  await assert.rejects(connection.request('folder.document', { folderId: opened.folderId, path: '../outside.md' }), (error: HostRequestError) => error.code === 'invalid-argument');
  // A work item's diagrams are its .puml files; a diagram comes with its family, and documents link them under their headings.
  assert.equal(snapshot.work.find(work => work.id === 'work-0001')?.diagrams, 3);
  const diagrams = await connection.request('folder.diagrams', { folderId: opened.folderId, work: 'work-0001' });
  assert.deepEqual(diagrams.map(diagram => [diagram.path, diagram.role]), [['diagrams/checkout-alternative.puml', 'proposal'], ['diagrams/checkout-capture.puml', 'capture'], ['diagrams/checkout-proposal.puml', 'proposal']]);
  const payload = await connection.request('folder.diagram', { folderId: opened.folderId, work: 'work-0001', path: 'diagrams/checkout-proposal.puml' }) as { family?: string; siblings?: { path: string }[] };
  assert.equal(payload.family, 'diagrams/checkout-capture.puml');
  assert.equal(payload.siblings?.length, 2);
  const references = await connection.request('folder.references', { folderId: opened.folderId, work: 'work-0001', path: 'active/0001-saved-payment-methods/plan.md' });
  assert.deepEqual(references.find(reference => reference.element === 'CardSession'), { workId: 'work-0001', path: 'diagrams/checkout-capture.puml', title: 'Checkout · captured TypeScript', provenance: diagrams[1].provenance, section: 'current-checkout', element: 'CardSession' });
  assert.equal((await connection.request('folder.diagramIndex', { folderId: opened.folderId })).length, 8);
  for (const path of ['../planning.json', 'plan.md', '/etc/x.puml'])
    await assert.rejects(connection.request('folder.diagram', { folderId: opened.folderId, work: 'work-0001', path }), (error: HostRequestError) => error.code === 'invalid-argument', path);
  await assert.rejects(connection.request('folder.snapshot', { folderId: 'f-' + 'a'.repeat(32) }), (error: HostRequestError) => error.code === 'forbidden');
  await assert.rejects(connection.request('projects.update' as never, { folderId: 42 } as never), (error: HostRequestError) => error.code === 'invalid-argument');
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

test('an unsubscribe sent while the subscribe is still opening the folder undoes it', async t => {
  const { host, origin } = await start(t);
  const { connection } = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const opened = await projectNamed(connection);
  const subscribing = connection.request('folders.subscribe', { folderId: opened.folderId });
  await connection.request('folders.unsubscribe', { folderId: opened.folderId });
  assert.equal((await subscribing).folderId, opened.folderId);
  await assert.rejects(connection.request('folder.snapshot', { folderId: opened.folderId }), (error: HostRequestError) => error.code === 'forbidden');
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
  const folder = await device.connection.follow(opened.folderId);
  assert.equal(folder.status, 'ready');
  const snapshot = await device.connection.request('folder.snapshot', { folderId: folder.folderId });
  assert.equal(snapshot.work.length, 4);
  assert.equal(snapshot.root, planning);
  assert.equal(snapshot.name, 'Northwind', 'the project\'s name, from its planning.json');
  // A folder that is not a project's is out of reach.
  await assert.rejects(device.connection.request('folders.subscribe', { folderId: 'f-' + 'a'.repeat(32) }), (error: HostRequestError) => error.code === 'not-found');
  // Its views count in this computer's document use.
  await device.connection.request('folder.recordView', { folderId: folder.folderId, event: { id: 'view-00000001', path: 'README.md', session: 'session-0001', contentHash: null } });
  // It sends its plans for import (below); it cannot make this computer read a file by path.
  await assert.rejects(device.connection.request('plan.importRead', { folderId: folder.folderId, file: path.join(planning, 'README.md') }), (error: HostRequestError) => error.code === 'forbidden');
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
  const ownerFolder = await projectNamed(owner.connection);
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

test('projects are the home\'s planning folders: created from the templates, renamed, hidden, archived and ordered', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const device = await pairDevice(t, host, owner.connection);
  assert.deepEqual((await owner.connection.request('projects.list', {})).map(project => project.name), ['Northwind']);
  // The list has what each project's card says: its repositories, its active work and where each item stands, its last change, and the work agents are on now.
  const summary = (await projectNamed(device.connection)).summary!;
  assert.deepEqual([summary.repositories, summary.active.length, summary.active.filter(item => item.state === 'blocked').length, summary.active.filter(item => item.state === 'implementing').length, summary.updated, summary.live],
    [['shop'], 3, 1, 1, null, []]);
  assert.ok(summary.active.every(item => item.title), 'each item has its title');
  // Each item's steps (none without a ledger that lists them) and last change, and the closed work with how it ended.
  assert.deepEqual(summary.active.map(item => [item.id, item.steps === null ? null : item.steps.total > 0, item.updated, item.outcome]),
    [['work-0001', true, '2026-09-30', null], ['work-0002', null, '2026-10-07', null], ['work-0003', null, '2026-10-02', null]]);
  assert.deepEqual(summary.closed.map(item => [item.id, item.state, item.updated, item.outcome]), [['work-0004', 'closed', '2026-09-24', 'complete']]);
  // A session in a turn, linked to a work item, makes it live.
  const database = HomeDatabase.open(data);
  try {
    const project = database.projectByFolder(path.join(data, 'planning', 'planning'))!;
    const now = new Date().toISOString();
    database.db.prepare('INSERT INTO session (id, harness, transcript_path, started_at, updated_at, working) VALUES (?, ?, NULL, ?, ?, 1)').run('session-1', 'claude-code', now, now);
    database.db.prepare('INSERT INTO session_work (session_id, project_id, work_id, linked_at) VALUES (?, ?, ?, ?)').run('session-1', project.id, 'work-0001', now);
  } finally { database.close(); }
  assert.deepEqual((await projectNamed(owner.connection)).summary?.live.map(item => item.workId), ['work-0001']);
  // A device creates one: a Git repository in the home with the templates, its name and its repositories.
  const coord = await device.connection.request('projects.create', { name: 'Coord', workspaces: [], repositories: [{ id: 'coord-web', name: 'Coord web', remote: 'git@github.com:example/coord-web.git' }, { id: 'platform', name: 'Platform', remote: null }] });
  assert.deepEqual([coord.name, coord.path, coord.position, coord.state], ['Coord', path.join(data, 'planning', 'coord'), 1, 'active']);
  const registry = JSON.parse(readFileSync(path.join(coord.path, 'planning.json'), 'utf8'));
  assert.deepEqual([registry.name, registry.repositories], ['Coord', [{ id: 'coord-web', name: 'Coord web', remote: 'git@github.com:example/coord-web.git' }, { id: 'platform', name: 'Platform' }]]);
  for (const file of ['AGENTS.md', 'PLANS.md', 'README.md', 'plan-frontmatter.md', '.gitattributes', '.git']) assert.ok(existsSync(path.join(coord.path, file)), file);
  const { execFileSync } = await import('node:child_process');
  assert.match(execFileSync('git', ['-C', coord.path, 'log', '--format=%s'], { encoding: 'utf8' }), /^Create the Coord project/);
  assert.equal((await device.connection.request('projects.create', { name: 'Coord', workspaces: [], repositories: [] })).path, path.join(data, 'planning', 'coord-2'), 'a taken name gets a number');
  await assert.rejects(device.connection.request('projects.create', { name: 'Bad', workspaces: [], repositories: [{ id: 'Not An ID', name: 'x', remote: null }] }), (error: HostRequestError) => error.code === 'invalid-argument');
  await until(() => owner.lists.some(list => list.length === 3), 5000, () => owner.lists);
  // The lists clients are sent have the summaries too (a new project's folder has its first commit); a single project answered has none.
  const sent = owner.lists.find(list => list.length === 3)!.find(project => project.folderId === coord.folderId)!;
  assert.deepEqual({ ...sent.summary, updated: typeof sent.summary?.updated }, { repositories: ['coord-web', 'platform'], active: [], closed: [], updated: 'string', live: [] });
  assert.equal('summary' in coord, false);
  // Renaming writes the name into its planning.json; hiding, archiving and moving change only the order and state.
  const renamed = await owner.connection.request('projects.update', { folderId: coord.folderId, name: 'Coord platform' });
  assert.equal(renamed.name, 'Coord platform');
  assert.equal('summary' in renamed, false);
  assert.equal(JSON.parse(readFileSync(path.join(coord.path, 'planning.json'), 'utf8')).name, 'Coord platform');
  await owner.connection.request('projects.update', { folderId: coord.folderId, position: 0 });
  const second = (await owner.connection.request('projects.list', {}))[2];
  await owner.connection.request('projects.update', { folderId: second.folderId, state: 'archived' });
  const planningProject = await projectNamed(owner.connection);
  await owner.connection.request('projects.update', { folderId: planningProject.folderId, state: 'hidden' });
  assert.deepEqual((await device.connection.request('projects.list', {})).map(project => [project.name, project.position, project.state]), [['Coord platform', 0, 'active'], ['Northwind', 1, 'hidden'], ['Coord', 2, 'archived']]);
  // A planning folder that appears in the home becomes the last project; one that leaves it is no longer listed.
  cpSync(fixture, path.join(data, 'planning', 'later'), { recursive: true });
  await until(() => owner.lists.some(list => list.some(project => project.path === path.join(data, 'planning', 'later'))), 5000, () => owner.lists);
  assert.equal((await owner.connection.request('projects.list', {})).find(project => project.path === path.join(data, 'planning', 'later'))?.position, 3);
  rmSync(path.join(data, 'planning', 'coord-2'), { recursive: true, force: true, maxRetries: 10 });
  assert.deepEqual((await owner.connection.request('projects.list', {})).map(project => project.name), ['Coord platform', 'Northwind', 'Northwind']);
  await assert.rejects(owner.connection.request('projects.update', { folderId: 'f-' + 'a'.repeat(32), state: 'active' }), (error: HostRequestError) => error.code === 'not-found');
});

test('a project covers workspace folders: their checkouts are found, registered when it is made, and when it gets more', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const device = await pairDevice(t, host, owner.connection);
  const { execFileSync } = await import('node:child_process');
  const checkout = (folder: string, remote: string | null) => {
    mkdirSync(folder, { recursive: true });
    execFileSync('git', ['-C', folder, 'init', '-q'], { windowsHide: true });
    if (remote) execFileSync('git', ['-C', folder, 'remote', 'add', 'origin', remote], { windowsHide: true });
  };
  const workspace = path.join(data, 'workspace'), more = path.join(data, 'more');
  checkout(path.join(workspace, 'web'), 'https://github.com/example/web.git');
  checkout(path.join(workspace, 'scratch'), null);
  mkdirSync(path.join(workspace, 'notes'));
  checkout(path.join(more, 'api'), 'git@github.com:example/api.git');
  // The app's preview: the checkouts in a folder, as a new project would register them.
  assert.deepEqual(await owner.connection.request('projects.scan', { folder: workspace }), {
    folder: workspace, repositories: [{ id: 'scratch', name: 'scratch', remote: null }, { id: 'web', name: 'web', remote: 'https://github.com/example/web.git' }],
  });
  await assert.rejects(owner.connection.request('projects.scan', { folder: path.join(data, 'missing') }), (error: HostRequestError) => error.code === 'invalid-argument' && /does not exist/.test(error.message));
  await assert.rejects(device.connection.request('projects.scan', { folder: workspace }), (error: HostRequestError) => error.code === 'forbidden', 'a folder on this computer is the app\'s to look at');
  // Made from the folder: its checkouts are registered, one without a remote by its path.
  // A paired device may not choose folders on this computer: refused before any path is looked at.
  const forbidden = (error: HostRequestError) => error.code === 'forbidden' && !error.message.includes(data);
  await assert.rejects(device.connection.request('projects.create', { name: 'Web', workspaces: [path.join(data, 'missing')] }), forbidden);
  await assert.rejects(device.connection.request('projects.create', { name: 'Web', workspaces: [workspace] }), forbidden);
  await assert.rejects(device.connection.request('projects.create', { name: 'Web' } as never), (error: HostRequestError) => error.code === 'invalid-argument', 'the folders are part of the request');
  const web = await owner.connection.request('projects.create', { name: 'Web', workspaces: [workspace] });
  assert.deepEqual(web.workspaces, [workspace]);
  const registry = () => JSON.parse(readFileSync(path.join(web.path, 'planning.json'), 'utf8'));
  assert.deepEqual([registry().workspaces, registry().repositories], [[workspace], [{ id: 'scratch', name: 'scratch', path: path.join(workspace, 'scratch') }, { id: 'web', name: 'web', remote: 'https://github.com/example/web.git' }]]);
  await assert.rejects(owner.connection.request('projects.create', { name: 'Gone', workspaces: [path.join(data, 'missing')] }), (error: HostRequestError) => error.code === 'invalid-argument');
  // Another folder registers what it holds; the list shows the folders.
  const updated = await owner.connection.request('projects.update', { folderId: web.folderId, workspaces: [workspace, more] });
  assert.deepEqual(updated.workspaces, [workspace, more]);
  assert.deepEqual(registry().repositories.map((item: { id: string }) => item.id), ['scratch', 'web', 'api']);
  assert.deepEqual((await projectNamed(owner.connection, 'Web')).workspaces, [workspace, more]);
  // A refused change changes nothing, not even the name sent with it; a device may not change the folders.
  await assert.rejects(owner.connection.request('projects.update', { folderId: web.folderId, name: 'Renamed', workspaces: [path.join(data, 'missing')] }), (error: HostRequestError) => error.code === 'invalid-argument');
  assert.equal(registry().name, 'Web');
  await assert.rejects(device.connection.request('projects.update', { folderId: web.folderId, workspaces: [] }), forbidden);
  assert.equal((await device.connection.request('projects.update', { folderId: web.folderId, name: 'Web site' })).name, 'Web site', 'the rest it may change');
  assert.deepEqual((await projectNamed(owner.connection)).workspaces, [], 'a project without workspace folders has none');
});

test('a project whose planning.json cannot be read is listed without a summary', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  mkdirSync(path.join(data, 'planning', 'broken'));
  writeFileSync(path.join(data, 'planning', 'broken', 'planning.json'), '{ "name": "Broken", ');
  const listed = await owner.connection.request('projects.list', {});
  assert.deepEqual(listed.map(project => [project.name, project.summary === null]).sort(), [['Northwind', false], ['broken', true]]);
});

test('the project list has each work item\'s step, completion and statistics from the home database\'s reports', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  await owner.connection.request('projects.list', {});
  const project = host.database.projectByFolder(path.join(data, 'planning', 'planning'))!;
  const measured = (since: string, agentMs: number, output: number) => ({ since, agentMs, models: [{ model: 'claude-opus', agentMs, input: 0, cacheRead: 0, cacheWrite: 0, output }] });
  insertReport(host.database, project.id, 'work-0001', createReport({ model: 'claude-opus', session: 's1', stage: 'planning', at: new Date('2026-10-01T10:00:00Z'), measured: measured('2026-10-01T09:00:00.000Z', 3_600_000, 1000) }));
  insertReport(host.database, project.id, 'work-0001', createReport({ model: 'claude-sonnet', session: 's2', stage: 'implementation', at: new Date('2026-10-02T10:00:00Z'), measured: { ...measured('2026-10-02T09:30:00.000Z', 1_800_000, 500), models: [{ model: 'claude-sonnet', agentMs: 1_800_000, input: 0, cacheRead: 0, cacheWrite: 0, output: 500 }] } }));
  const summary = (await projectNamed(owner.connection)).summary!;
  const work = (id: string) => [...summary.active, ...summary.closed].find(item => item.id === id)!;
  assert.deepEqual(work('work-0001').step, { title: 'Add authoriseWithToken to the acquirer gateway, with the challenge_required path (shop#58)', status: 'doing', phase: 'implementation' });
  assert.deepEqual(work('work-0001').statistics, {
    agentMs: 5_400_000, tokens: 1500, primaryModel: 'claude-opus', otherModels: 1, planning: { agentMs: 3_600_000, tokens: 1000 }, implementation: { agentMs: 1_800_000, tokens: 500 },
    subagents: 0, lastReport: '2026-10-02T10:00:00.000Z',
  });
  assert.deepEqual([work('work-0002').statistics, work('work-0003').step, work('work-0001').completed], [null, null, null], 'no reports, no steps (a ledger from before steps), open');
  assert.equal(work('work-0004').completed, '2026-09-24');
});

test('the search covers every active project, in the home or outside it, best first, and stays fresh as files change', async t => {
  const { host, origin, data, planning } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const device = await pairDevice(t, host, owner.connection);
  // Another project in the home, hidden; one outside it, active.
  const hidden = path.join(data, 'planning', 'hidden');
  cpSync(fixture, hidden, { recursive: true });
  writeFileSync(path.join(hidden, 'knowledge', 'secret.md'), '# Hidden walrus\n');
  const outside = path.join(temporary(t, 'atlas-outside-'), 'Coord planning');
  cpSync(fixture, outside, { recursive: true });
  writeFileSync(path.join(outside, 'planning.json'), readFileSync(path.join(outside, 'planning.json'), 'utf8').replace('"Northwind"', '"Coord"'));
  writeFileSync(path.join(outside, 'knowledge', 'walrus.md'), '# Outside walrus\n\nA walrus lives outside the home.\n');
  const database = HomeDatabase.open(data);
  try { database.addProject(realpathSync.native(outside), 'Coord', null, 'active'); } finally { database.close(); }
  const listed = await owner.connection.request('projects.list', {});
  const northwind = listed.find(project => project.path === planning)!, coord = listed.find(project => project.name === 'Coord')!;
  await owner.connection.request('projects.update', { folderId: listed.find(project => project.path === hidden)!.folderId, state: 'hidden' });
  const search = (query: string, limit?: number) => device.connection.request('search.query', limit === undefined ? { query } : { query, limit });
  // Each kind, where it opens (the two projects have the same plans: Northwind's best).
  const first = async (query: string, project = 'Northwind') => (await search(query)).find(hit => hit.project === project)!;
  assert.deepEqual(await first('Saved payment methods'), { kind: 'plan', title: 'Saved payment methods', snippet: null, folderId: northwind.folderId, project: 'Northwind', work: 'work-0001', path: 'active/0001-saved-payment-methods/plan.md', anchor: null, element: null });
  assert.deepEqual(await first('#0002').then(hit => [hit.kind, hit.work]), ['plan', 'work-0002']);
  assert.deepEqual(await first('Sandbox run forced').then(hit => [hit.kind, hit.work, hit.path]), ['step', 'work-0001', 'active/0001-saved-payment-methods/plan.md']);
  assert.deepEqual(await first('Order status').then(hit => [hit.kind, hit.path, hit.anchor]), ['heading', 'active/0002-order-fulfilment-model/plan.md', 'order-status']);
  assert.deepEqual((await search('carrier')).filter(hit => hit.kind === 'term' && hit.project === 'Northwind').map(hit => [hit.title, hit.path, hit.anchor]), [['Carrier', 'active/0002-order-fulfilment-model/CONTEXT.md', 'shipments']]);
  assert.deepEqual((await search('conceptual model')).filter(hit => hit.kind === 'diagram' && hit.project === 'Northwind').map(hit => [hit.title, hit.path, hit.work]), [['Fulfilment · conceptual model', 'active/0002-order-fulfilment-model/diagrams/fulfilment.puml', 'work-0002']]);
  assert.deepEqual(await first('savedpaymentmethod').then(hit => [hit.kind, hit.element, hit.work]), ['element', 'SavedPaymentMethod', 'work-0001']);
  assert.deepEqual(await first('Payments constraints').then(hit => [hit.kind, hit.path, hit.work]), ['document', 'knowledge/shop/payments-constraints.md', null]);
  assert.deepEqual(await first('Coord', 'Coord').then(hit => [hit.kind, hit.folderId, hit.path]), ['project', coord.folderId, null]);
  const text = await first('lives outside', 'Coord');
  assert.deepEqual([text.kind, text.project, text.snippet], ['document', 'Coord', 'A walrus lives outside the home.'], 'text, with its snippet');
  // Every active project, never a hidden one; best first, at most the limit.
  const walrus = await search('walrus');
  assert.deepEqual(walrus.map(hit => [hit.project, hit.title]), [['Coord', 'Outside walrus']], 'a hidden project is not searched');
  const both = await search('saved payment methods');
  assert.deepEqual([...new Set(both.slice(0, 2).map(hit => hit.kind + ':' + hit.project))].sort(), ['plan:Coord', 'plan:Northwind'], 'both active projects\' plans first');
  assert.equal((await search('e')).length, 50, 'at most 50 by default');
  assert.deepEqual(await search('e', 3), (await search('e')).slice(0, 3), 'or the limit given');
  // A file written and changed in a project no window has open, and a diagram changed: the search follows.
  const found = async (query: string) => (await search(query)).map(hit => hit.title);
  const eventually = async (query: string, expected: string[]) => {
    let seen: string[] = [];
    for (const deadline = Date.now() + 10000; JSON.stringify(seen = await found(query)) !== JSON.stringify(expected) && Date.now() < deadline;) await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(seen, expected, query);
  };
  const notes = path.join(planning, 'knowledge', 'notes.md');
  writeFileSync(notes, '# Notes\n\nThe narwhal migrates.\n');
  await eventually('narwhal', ['Notes']);
  writeFileSync(notes, '# Notes\n\nThe beluga migrates.\n');
  await eventually('narwhal', []);
  assert.deepEqual(await found('beluga'), ['Notes']);
  const diagram = path.join(planning, 'active/0002-order-fulfilment-model/diagrams/fulfilment.puml');
  writeFileSync(diagram, readFileSync(diagram, 'utf8').replace('@enduml', 'class Lighthouse\n@enduml'));
  await eventually('lighthouse', ['Lighthouse']);
  // The request is checked.
  for (const params of [{ query: '' }, { query: 'x'.repeat(201) }, { query: 'x', limit: 0 }, { query: 'x', limit: 201 }, { limit: 5 }]) {
    await assert.rejects(owner.connection.request('search.query', params as never), (error: HostRequestError) => error.code === 'invalid-argument', JSON.stringify(params));
  }
  assert.deepEqual(await search('   '), [], 'a query of spaces finds nothing');
});

test('plan and ledger edits in a project no window has open reach the project list, once they settle', async t => {
  const { host, origin, planning } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  await owner.connection.request('projects.list', {});
  const work = (list: Project[], id: string) => list.find(project => project.name === 'Northwind')?.summary?.active.find(item => item.id === id);
  const settle = () => new Promise(resolve => setTimeout(resolve, 1500));
  const plan = path.join(planning, 'active/0001-saved-payment-methods/plan.md');
  // A plan's header: its summary.
  writeFileSync(plan, readFileSync(plan, 'utf8').replace('title: Saved payment methods\n', 'title: Saved payment methods\nsummary: "Cards saved at checkout."\n'));
  await until(() => owner.lists.some(list => work(list, 'work-0001')?.summary === 'Cards saved at checkout.'), 10000, () => owner.lists.length);
  // A ledger's step.
  const ledger = path.join(planning, 'active/0001-saved-payment-methods/ledger.md');
  const before = work(owner.lists.at(-1)!, 'work-0001')!.steps!.done;
  writeFileSync(ledger, readFileSync(ledger, 'utf8').replace(/status: (?:todo|doing)/, 'status: done'));
  await until(() => work(owner.lists.at(-1)!, 'work-0001')!.steps!.done === before + 1, 10000, () => owner.lists.length);
  await settle();
  // Other files of the project change nothing the list shows.
  const told = owner.lists.length;
  writeFileSync(path.join(planning, 'active/0001-saved-payment-methods/CONTEXT.md'), '# Glossary\n\nChanged.\n');
  writeFileSync(path.join(planning, 'notes.txt'), 'notes\n');
  await settle();
  assert.equal(owner.lists.length, told, 'an unrelated edit is not told');
  // A burst of changes (a checkout rewriting many files) is one listing.
  for (let index = 0; index < 40; index++) writeFileSync(plan, readFileSync(plan, 'utf8').replace(/summary: ".*"/, `summary: "Burst ${index}."`));
  await until(() => work(owner.lists.at(-1)!, 'work-0001')?.summary === 'Burst 39.', 10000, () => owner.lists.length);
  await settle();
  assert.equal(owner.lists.length, told + 1, 'one listing for the burst');
});

test('listings for clients run one at a time, so an older and slower one never arrives last', async t => {
  const { host, origin } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  await owner.connection.request('projects.list', {});
  // The first listing takes long; the second, wanted meanwhile, is quick.
  const original = host.projects.bind(host);
  let calls = 0;
  host.projects = async (summaries?: boolean) => {
    const call = ++calls;
    if (summaries) await new Promise(resolve => setTimeout(resolve, call === 1 ? 900 : 0));
    return (await original(summaries)).map(project => ({ ...project, name: project.name + ' ' + call }));
  };
  const changed = () => (host as unknown as { projectsChanged(): void }).projectsChanged();
  changed();
  await new Promise(resolve => setTimeout(resolve, 450));
  changed();
  await until(() => owner.lists.length >= 2, 5000, () => owner.lists.length);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.deepEqual(owner.lists.map(list => list[0].name), ['Northwind 1', 'Northwind 2'], 'the newer listing last');
});

test('a listing that hangs is given up, so later changes still reach clients, and its late result is dropped', async t => {
  const { host, origin } = await start(t, { listingTimeout: 300 });
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  await owner.connection.request('projects.list', {});
  const original = host.projects.bind(host);
  let calls = 0, release = () => {};
  host.projects = async (summaries?: boolean) => {
    const call = ++calls;
    // The first never answers until released (a project on a share that does not answer).
    if (summaries && call === 1) await new Promise<void>(resolve => { release = resolve; });
    return (await original(summaries)).map(project => ({ ...project, name: project.name + ' ' + call }));
  };
  const changed = () => (host as unknown as { projectsChanged(): void }).projectsChanged();
  changed();
  await new Promise(resolve => setTimeout(resolve, 450));
  changed();
  await until(() => owner.lists.length >= 1, 5000, () => owner.lists.length);
  release();
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.deepEqual(owner.lists.map(list => list[0].name), ['Northwind 2']);
});

test('a project outside the home is watched for its plans and ledgers, and again once its folder is replaced', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const outside = path.join(temporary(t, 'atlas-outside-'), 'Shop planning');
  cpSync(fixture, outside, { recursive: true });
  const database = HomeDatabase.open(data);
  try { database.addProject(realpathSync.native(outside), 'Shop', null, 'active'); } finally { database.close(); }
  await owner.connection.request('projects.list', {});
  await new Promise(resolve => setTimeout(resolve, 500));
  const summary = () => owner.lists.at(-1)?.find(project => project.path === realpathSync.native(outside))?.summary?.active.find(item => item.id === 'work-0001')?.summary;
  const plan = path.join(outside, 'active/0001-saved-payment-methods/plan.md');
  const say = (text: string) => writeFileSync(plan, readFileSync(plan, 'utf8').replace(/^title: Saved payment methods\n(?:summary: .*\n)?/m, `title: Saved payment methods\nsummary: "${text}"\n`));
  say('Watched outside the home.');
  await until(() => summary() === 'Watched outside the home.', 10000, () => owner.lists.length);
  // The folder replaced by a copy of itself: the new one is watched.
  rmSync(outside, { recursive: true, force: true, maxRetries: 10 });
  await new Promise(resolve => setTimeout(resolve, 500));
  cpSync(fixture, outside, { recursive: true });
  await new Promise(resolve => setTimeout(resolve, 4000));
  say('Watched again.');
  await until(() => summary() === 'Watched again.', 15000, () => owner.lists.length);
  // Hidden, it is no longer watched (on Windows, a watch keeps the folders above it from being renamed).
  const watched = () => (host as unknown as { outsideWatches: Map<string, unknown> }).outsideWatches.size;
  assert.equal(watched(), 1);
  const shop = (await owner.connection.request('projects.list', {})).find(project => project.path === realpathSync.native(outside))!;
  await owner.connection.request('projects.update', { folderId: shop.folderId, state: 'hidden' });
  await owner.connection.request('projects.list', {});
  assert.equal(watched(), 0);
});

test('a project made outside the app appears when its planning.json comes, a moment after its folder', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  await owner.connection.request('projects.list', {});
  // As an agent or the command makes one: the folder first, its planning.json about a second later.
  const folder = path.join(data, 'planning', 'by-hand');
  mkdirSync(folder);
  await new Promise(resolve => setTimeout(resolve, 1000));
  writeFileSync(path.join(folder, 'planning.json'), JSON.stringify({ schema_version: 1, name: 'By hand', repositories: [], work_items: [] }));
  await until(() => owner.lists.some(list => list.some(project => project.name === 'By hand')), 10000, () => owner.lists.map(list => list.map(project => project.name)));
});

test('a project outside the home is listed, marked, until it moves into the home with its statistics', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const outside = path.join(temporary(t, 'atlas-outside-'), 'Shop planning');
  cpSync(fixture, outside, { recursive: true });
  mkdirSync(path.join(outside, 'active/0001-saved-payment-methods/.atlas'), { recursive: true });
  writeFileSync(path.join(outside, 'active/0001-saved-payment-methods/.atlas/statistics.jsonl'), JSON.stringify({ version: 1, at: '2026-10-01T10:00:00.000Z', model: 'model-a', session: null, tokens: null, step: null }) + '\n');
  // Read and written beside the host's own connection, and closed before its home is removed.
  const database = HomeDatabase.open(data);
  try {
    const row = database.addProject(realpathSync.native(outside), 'Northwind', null, 'hidden');
    // Another project, whose folder is gone, was last where the folder would go: that name stays its own.
    database.addProject(path.join(data, 'planning', 'Shop-planning'), 'Gone', null, 'archived');
    const projects = (await owner.connection.request('projects.list', {})).filter(project => project.name !== 'Gone');
    assert.deepEqual(projects.map(project => [project.path, project.outsideHome]), [[realpathSync.native(outside), true], [path.join(data, 'planning', 'planning'), false]]);
    const listed = projects[0];
    await owner.connection.follow(listed.folderId);
    // A move that is refused (not a Git repository yet) leaves the folder followed where it is.
    await assert.rejects(owner.connection.request('projects.adopt', { folderId: listed.folderId }), /not the top of a Git repository/);
    assert.equal((await owner.connection.request('folder.snapshot', { folderId: listed.folderId })).work.length, 4);
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['-C', outside, 'init', '-q']);
    const moved = await owner.connection.request('projects.adopt', { folderId: listed.folderId });
    assert.deepEqual([moved.path, moved.outsideHome, moved.state], [path.join(data, 'planning', 'Shop-planning-2'), false, 'hidden']);
    assert.ok(!existsSync(outside) && !existsSync(path.join(moved.path, 'active/0001-saved-payment-methods/.atlas')));
    assert.equal(database.projectByFolder(moved.path)?.id, row.id, 'the project keeps its row, and with it its tabs');
    assert.equal((database.db.prepare("SELECT count(*) AS n FROM work_report WHERE project_id = ? AND at = '2026-10-01T10:00:00.000Z'").get(row.id) as { n: number }).n, 1);
    assert.notEqual(moved.folderId, listed.folderId);
    await assert.rejects(owner.connection.request('folder.snapshot', { folderId: listed.folderId }), (error: HostRequestError) => error.code === 'forbidden');
    await assert.rejects(owner.connection.request('projects.adopt', { folderId: moved.folderId }), /in the Atlas home already/);
  } finally { database.close(); }
});

test('another computer imports a plan by sending its file', async t => {
  const { host, origin, planning } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId).connection;
  const device = await pairDevice(t, host, owner);
  const opened = await projectNamed(device.connection);
  assert.equal(opened.path, planning);
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

test('a host from before the home database is seen by its remote-access lock', async t => {
  const data = temporary(t, 'atlas-access-');
  assert.equal(await hostRunning(data), false, 'no host/access.json');
  const secret = 'S'.repeat(43);
  mkdirSync(path.join(data, 'host'));
  writeFileSync(path.join(data, 'host', 'access.json'), JSON.stringify({ version: 2, hostId: 'host-1234-abcd', secret }));
  // The process holding the lock named after that secret, as an older atlas serve would.
  const database = HomeDatabase.open(path.join(data, 'home'));
  database.setSetting('host.secret', secret);
  const store = new AccessStore(database, quiet, 'atlas serve');
  opened.add({ store, database });
  assert.equal(await hostRunning(data), false, 'nobody holds the lock');
  assert.equal(await store.lock(), null);
  assert.equal(await hostRunning(data), true);
  store.unlock();
  assert.equal(await hostRunning(data), false, 'the lock went with it');
  writeFileSync(path.join(data, 'host', 'access.json'), '{ broken');
  assert.equal(await hostRunning(data), false);
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
  assert.equal(reread.folderKey, store.folderKey);
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
  await owner.connection.follow(opened.folderId);
  // The host stops (a crash) and starts again with the same identity: the project's folder comes back by its ID.
  await current.host.stop();
  rmSync(current.planning, { recursive: true, force: true, maxRetries: 10 });
  const restarted = await start(t, { data });
  current = restarted;
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
