// Shared by the host's tests: hosts on homes of their own with the app's fixture as their project,
// clients of them, and access stores.
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { HomeDatabase, readTemplates } from '../planning/index.ts';
import { AccessStore } from './access/access.ts';
import { HostClient, pairWithHost, parsePairing, type ClientStatus } from './client.ts';
import type { OpenProjectState, Project } from './contract.ts';
import { Host } from './host.ts';
import type { WorkerLike } from './export/planWorkerClient.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fixture = path.resolve(here, '../../../../app/e2e/fixtures/planning');
const templates = path.resolve(here, '../../templates/planning');
const started = Date.now();
/** Quiet, unless ATLAS_TEST_LOG is set to follow what the host does while a test runs. */
const print = (level: string) => (message: string, detail?: unknown) => { if (process.env.ATLAS_TEST_LOG) console.log(Date.now() - started, level, message, JSON.stringify(detail ?? '')); };
export const quiet = { info: print('info'), warn: print('warn'), error: print('error') };

/** Databases the access stores below opened, closed before their folders are removed. */
export const opened = new Set<{ store: AccessStore; database: HomeDatabase }>();
export function temporary(t: TestContext, prefix: string) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));
  t.after(() => {
    for (const entry of opened) { entry.store.unlock(); entry.database.close(); opened.delete(entry); }
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  return directory;
}
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address() as { port: number }; server.close(() => resolve(port)); });
  });
}
/** A host on a home of its own, with the fixture as its project `planning`. */
export async function start(t: TestContext, options: { data?: string; loopbackPort?: number; listingTimeout?: number; liveCheck?: number } = {}) {
  const data = options.data ?? realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-host-data-')));
  const planning = path.join(data, 'planning', 'planning');
  cpSync(fixture, planning, { recursive: true });
  const host = new Host({
    home: data, version: '0.0.0-test', log: quiet, owner: 'a test', idleClose: 50,
    createPlanWorker: () => new Worker(new URL('./export/planWorker.ts', import.meta.url)) as unknown as WorkerLike,
    templates: () => readTemplates(templates),
    // Session logs are read in the test's home, never the developer's.
    sessionLogs: { home: data, environment: {} },
    ...options,
  });
  const { port } = await host.start();
  // Stop the host (closing its database) before removing its home, once a listing still under way
  // (which runs Git in the home) is done; a home passed in belongs to the caller.
  t.after(async () => {
    await host.stop();
    await (host as unknown as { listing: Promise<void> | null }).listing;
    if (!options.data) rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const origin = 'http://127.0.0.1:' + port;
  return { host, planning, data, port, origin };
}
/** A project of the host by its name. */
export async function projectNamed(connection: HostClient, name = 'Northwind'): Promise<Project> {
  const project = (await connection.request('projects.list', {})).find(entry => entry.name === name);
  assert.ok(project, 'no project ' + name);
  return project;
}
/** An access store on a home database of its own. */
export function accessStore(directory: string, owner = 'a test') {
  const database = HomeDatabase.open(directory);
  const store = new AccessStore(database, quiet, owner);
  opened.add({ store, database });
  return store;
}
export function client(t: TestContext, origin: string | (() => string), token: string | (() => string | Promise<string>), hostId: string | null = null) {
  const events: OpenProjectState[] = [];
  const lists: Project[][] = [];
  const statuses: ClientStatus[] = [];
  const connection = new HostClient({
    origin, token: typeof token === 'function' ? token : () => token, hostId, retry: { first: 0, cap: 100 }, onStatus: status => statuses.push(status),
    onEvent: (event, data) => { if (event === 'project.changed') events.push(data as OpenProjectState); else if (event === 'projects.changed') lists.push((data as { projects: Project[] }).projects); },
  });
  connection.start();
  t.after(() => connection.close());
  return { connection, events, lists, statuses };
}
export const noGrant = { label: null, manageAccess: false };
/** Turn remote access on for 127.0.0.1 and pair a device; returns its client and pairing. */
export async function pairDevice(t: TestContext, host: Host, owner: HostClient, grant: { label: string | null; manageAccess: boolean } = noGrant, name = 'Laptop') {
  if (!host.networkStatus().listening) {
    const updated = await owner.request('access.update', { settings: { network: { enabled: true, address: '127.0.0.1', port: await freePort() } } });
    assert.equal(updated.status.listening, true, updated.status.error ?? '');
  }
  const link = await owner.request('access.pairingCreate', { address: null, ...grant });
  const { origin: remote, code } = parsePairing(link.url!);
  const { descriptor, pairing } = await pairWithHost(remote, code, { name, platform: 'linux' });
  return { ...client(t, remote, pairing.token, descriptor.hostId), pairing, remote, link };
}
export const until = async (check: () => boolean, timeout = 5000, describe?: () => unknown) => {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() > deadline) throw new Error('Timed out' + (describe ? ': ' + JSON.stringify(describe()) : '')); await new Promise(resolve => setTimeout(resolve, 20)); }
};
