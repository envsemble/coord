// The app's connections to Atlas hosts: its own host (main/host/localHost.ts), reached as the owner,
// and the hosts of other computers it paired with, reached with a device token. A paired computer
// is the same person's: its device token reaches everything Atlas can do there, and Manage access
// when its pairing link granted it. Paired computers are rows of the home database's connection
// table; tokens are encrypted with the system's credential store (Electron safeStorage) where it has
// one. A paired computer's connection stays open while a window shows its projects; other requests
// (the computer menu's check) use that connection or a short-lived one.
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { safeStorage } from 'electron';
import type { HomeDatabase } from '@envsemble/atlas/planning';
import { describeHost, HostClient, HostRequestError, pairWithHost, parsePairing, type ClientStatus, type EventName, type Events } from '@envsemble/atlas/host';
import type { Computer, ComputerStatus } from '../../shared/contract.ts';
import { boolean, object, optional, string } from '../../shared/validate.ts';
import type { LocalHost } from './localHost.ts';
import type { RotatingLog } from '../log.ts';

/** A paired computer as the connection table keeps it: `id` is the row's, `token` sealed. */
interface SavedConnection { id: string; hostId: string; name: string; origin: string; deviceId: string; token: string; pairedAt: string; manageAccess: boolean }
const hostIdPattern = /^[a-zA-Z0-9-]{8,64}$/;
const saved = object<Omit<SavedConnection, 'id' | 'manageAccess'> & { manageAccess?: boolean }>({
  hostId: string({ min: 8, max: 64, pattern: hostIdPattern }), name: string({ min: 1, max: 80 }), origin: string({ min: 10, max: 300, pattern: /^https?:\/\/[^/]+$/ }),
  deviceId: string({ min: 8, max: 64, pattern: /^d-[a-f0-9]{32}$/ }), token: string({ min: 8, max: 2000 }), pairedAt: string({ min: 1, max: 40 }),
  manageAccess: optional(boolean),
});
/** How long the computer menu waits for a paired computer to answer. */
const probeTimeout = 2500;

export interface ConnectionEvents {
  onEvent<E extends EventName>(client: HostClient, event: E, data: Events[E]): void;
  onStatus(client: HostClient, status: ClientStatus, detail: string | null): void;
}

export class Connections {
  readonly local: HostClient;
  private readonly database: HomeDatabase;
  private readonly log: RotatingLog;
  private readonly events: ConnectionEvents;
  private readonly localHost: LocalHost;
  private readonly remote = new Map<string, { saved: SavedConnection; client: HostClient | null }>();

  constructor(options: { database: HomeDatabase; localHost: LocalHost; log: RotatingLog } & ConnectionEvents) {
    this.database = options.database;
    this.log = options.log;
    this.events = options;
    this.localHost = options.localHost;
    const host = options.localHost;
    this.local = new HostClient({
      // Pinned to this computer's host once it is known, so a program squatting on its old port gets no owner token.
      origin: () => host.origin, token: () => host.token(), hostId: () => host.hostId || null,
      onEvent: (event, data) => this.events.onEvent(this.local, event, data),
      onStatus: (status, detail) => this.events.onStatus(this.local, status, detail),
    });
    this.load();
  }

  private load() {
    // Each saved computer is checked on its own, so one unreadable row costs only itself.
    for (const row of this.database.db.prepare('SELECT * FROM connection ORDER BY paired_at').all() as Record<string, unknown>[]) {
      try {
        const entry = saved({ hostId: row.host_id, name: row.name, origin: row.origin, deviceId: row.device_id, token: Buffer.from(row.token as Uint8Array).toString('utf8'), pairedAt: row.paired_at });
        this.remote.set(entry.hostId, { saved: { ...entry, id: String(row.id), manageAccess: Boolean(row.manage_access) }, client: null });
      } catch (error) { this.log.warn('A saved connection is unreadable and was skipped', { id: row.id, message: (error as Error).message }); }
    }
  }
  /** Save a paired computer, keeping its row (and so its projects' order) when it pairs again. */
  private save(entry: SavedConnection) {
    this.database.db.prepare('INSERT INTO connection (id, host_id, name, origin, device_id, token, paired_at, manage_access) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (host_id) DO UPDATE SET name = excluded.name, origin = excluded.origin, device_id = excluded.device_id, token = excluded.token, paired_at = excluded.paired_at, manage_access = excluded.manage_access')
      .run(entry.id, entry.hostId, entry.name, entry.origin, entry.deviceId, Buffer.from(entry.token, 'utf8'), entry.pairedAt, entry.manageAccess ? 1 : 0);
  }

  /** Whether the system has a credential store. Linux without a keyring falls back to a fixed key, which protects nothing. */
  private canSeal() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend());
  }
  private seal(token: string) {
    return this.canSeal() ? 'safe:' + safeStorage.encryptString(token).toString('base64') : 'plain:' + token;
  }
  private open(sealed: string) {
    if (sealed.startsWith('safe:')) return safeStorage.decryptString(Buffer.from(sealed.slice(5), 'base64'));
    if (sealed.startsWith('plain:')) return sealed.slice(6);
    throw new HostRequestError('unauthorized', 'The saved credential cannot be read. Pair again.');
  }

  /** This computer's name, as its host gives it. */
  get localName() { return this.local.descriptor?.name ?? (hostname().trim() || 'This computer'); }
  has(hostId: string) { return this.remote.has(hostId); }
  name(hostId: string) { return this.remote.get(hostId)?.saved.name ?? hostId; }
  /** The connection row of a paired computer, which its projects' rows and windows name. */
  idOf(hostId: string) { return this.entry(hostId).saved.id; }
  /** The paired computer of a connection row, if it is still paired. */
  hostIdFor(connectionId: string): string | null {
    for (const [hostId, entry] of this.remote) if (entry.saved.id === connectionId) return hostId;
    return null;
  }
  /** The paired computer a connection belongs to; null for this computer's own. */
  hostIdOf(client: HostClient): string | null {
    for (const [hostId, entry] of this.remote) if (entry.client === client) return hostId;
    return null;
  }

  /**
   * This computer and the paired ones, each with whether it answers now: the open connection's
   * status, or a quick look at its public descriptor.
   */
  async computers(): Promise<Computer[]> {
    const local: Computer = { hostId: null, name: this.localName, status: 'online', detail: null, manageAccess: true, origin: null };
    const others = await Promise.all([...this.remote.values()].map(async ({ saved: entry, client }): Promise<Computer> => {
      const base = { hostId: entry.hostId, name: entry.name, manageAccess: entry.manageAccess, origin: entry.origin };
      if (client && client.status !== 'closed') return { ...base, status: statusOf(client.status), detail: client.status === 'connected' ? null : client.detail };
      try {
        const described = await describeHost(entry.origin, probeTimeout);
        if (described.hostId !== entry.hostId) return { ...base, status: 'mismatch', detail: `${entry.origin} now answers as a different computer (${described.name}).` };
        return { ...base, status: 'online', detail: null };
      } catch (error) {
        return { ...base, status: /cannot connect to/.test((error as Error).message) ? 'incompatible' : 'offline', detail: (error as Error).message };
      }
    }));
    return [local, ...others];
  }

  private entry(hostId: string) {
    const entry = this.remote.get(hostId);
    if (!entry) throw new HostRequestError('not-found', 'This computer is not paired. Connect to it again.');
    return entry;
  }
  private create(entry: { saved: SavedConnection }, events: boolean): HostClient {
    const token = this.open(entry.saved.token);
    const client: HostClient = new HostClient({
      origin: entry.saved.origin, token: () => token, hostId: entry.saved.hostId,
      onEvent: events ? (event, data) => this.events.onEvent(client, event, data) : undefined,
      onStatus: events ? (status, detail) => this.events.onStatus(client, status, detail) : undefined,
    });
    client.start();
    return client;
  }

  /** The connection to a paired computer for its windows, started on first use. */
  client(hostId: string): HostClient {
    const entry = this.entry(hostId);
    if (entry.client && entry.client.status !== 'closed') return entry.client;
    entry.client = this.create(entry, true);
    return entry.client;
  }
  /** A connection to a computer for one task: this computer's own, a paired computer's open one, or a short-lived one. */
  async use<T>(hostId: string | null, task: (client: HostClient) => Promise<T>): Promise<T> {
    if (hostId === null) return task(this.local);
    const entry = this.entry(hostId);
    if (entry.client && entry.client.status !== 'closed') return task(entry.client);
    const client = this.create(entry, false);
    try { return await task(client); }
    finally { client.close(); }
  }
  /** No window shows this computer's projects any more: close its connection. */
  release(hostId: string) {
    const entry = this.remote.get(hostId);
    entry?.client?.close();
    if (entry) entry.client = null;
  }

  /** Pair with another computer's Atlas from its pairing link (or address and code), and save it. */
  async pair(link: string, code?: string): Promise<Computer> {
    const target = parsePairing(link, code);
    // Check whose link it is before spending its one-time code.
    const described = await describeHost(target.origin);
    if (described.hostId === this.localHost.hostId) throw new HostRequestError('invalid-argument', 'That pairing link belongs to this computer. Open the link on the other computer instead.');
    const { descriptor, pairing } = await pairWithHost(target.origin, target.code, { name: hostname().trim().slice(0, 80) || 'Atlas', platform: process.platform });
    if (descriptor.hostId !== described.hostId) throw new HostRequestError('unavailable', 'The host changed while pairing. Try again.');
    // Everything saved comes from the other computer: keep only what fits.
    let entry: SavedConnection;
    const previous = this.remote.get(descriptor.hostId);
    try {
      const checked = saved({
        hostId: descriptor.hostId, name: descriptor.name.trim().slice(0, 80) || 'Another computer', origin: target.origin,
        deviceId: pairing.deviceId, token: this.seal(pairing.token), pairedAt: new Date().toISOString(),
      });
      entry = { ...checked, id: previous?.saved.id ?? randomUUID(), manageAccess: Array.isArray(pairing.scopes) && pairing.scopes.includes('access:manage') };
    } catch (error) { throw new HostRequestError('unavailable', 'The other computer answered with something Atlas cannot use (' + (error as Error).message + ').'); }
    previous?.client?.close();
    this.remote.set(descriptor.hostId, { saved: entry, client: null });
    this.save(entry);
    this.log.info('Paired with another computer', { hostId: descriptor.hostId, name: entry.name, origin: target.origin, manageAccess: entry.manageAccess });
    return { hostId: entry.hostId, name: entry.name, status: 'online', detail: null, manageAccess: entry.manageAccess, origin: entry.origin };
  }

  /** Forget a paired computer here, with the rows kept for its projects. Its host keeps the device listed until it is revoked there. */
  forget(hostId: string) {
    const entry = this.remote.get(hostId);
    if (!entry) return;
    entry.client?.close();
    this.remote.delete(hostId);
    this.database.db.prepare('DELETE FROM connection WHERE id = ?').run(entry.saved.id);
  }

  /** Try every connection again now (the computer woke up, or the network changed). */
  wakeAll() {
    this.local.wake();
    for (const entry of this.remote.values()) entry.client?.wake();
  }

  closeAll() {
    this.local.close();
    for (const entry of this.remote.values()) entry.client?.close();
  }
}

function statusOf(status: ClientStatus): ComputerStatus {
  switch (status) {
    case 'connected': return 'online';
    case 'connecting': return 'connecting';
    case 'revoked': return 'revoked';
    case 'mismatch': return 'mismatch';
    case 'incompatible': return 'incompatible';
    default: return 'offline';
  }
}
