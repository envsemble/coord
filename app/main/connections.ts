// The app's connections to Atlas hosts: its own host (main/localHost.ts), reached as the owner,
// and the hosts of other computers it paired with, reached with a read-only device token. Saved
// connections live in <Atlas data folder>/connections.json; tokens are encrypted with the
// system's credential store (Electron safeStorage) where it has one.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { safeStorage } from 'electron';
import { HostClient, HostRequestError, pairWithHost, parsePairing, type ClientStatus, type EventName, type Events, type SharedFolder } from '@envsemble/atlas-host';
import type { RemoteHost } from '../shared/contract.ts';
import { array, object, string } from '../shared/validate.ts';
import type { LocalHost } from './localHost.ts';
import type { RotatingLog } from './log.ts';

interface SavedConnection { hostId: string; name: string; origin: string; deviceId: string; token: string; pairedAt: string }
const saved = object<SavedConnection>({
  hostId: string({ min: 8, max: 64, pattern: /^[a-zA-Z0-9-]+$/ }), name: string({ min: 1, max: 80 }), origin: string({ min: 10, max: 300, pattern: /^https?:\/\/[^/]+$/ }),
  deviceId: string({ min: 8, max: 64 }), token: string({ min: 8, max: 2000 }), pairedAt: string({ min: 1, max: 40 }),
});

export interface ConnectionEvents {
  onEvent<E extends EventName>(client: HostClient, event: E, data: Events[E]): void;
  onStatus(client: HostClient, status: ClientStatus, detail: string | null): void;
}

export class Connections {
  readonly local: HostClient;
  private readonly file: string;
  private readonly log: RotatingLog;
  private readonly events: ConnectionEvents;
  private readonly localHost: LocalHost;
  private readonly remote = new Map<string, { saved: SavedConnection; client: HostClient | null }>();

  constructor(options: { dataDirectory: string; localHost: LocalHost; log: RotatingLog } & ConnectionEvents) {
    this.file = path.join(options.dataDirectory, 'connections.json');
    this.log = options.log;
    this.events = options;
    this.localHost = options.localHost;
    const host = options.localHost;
    this.local = new HostClient({
      origin: () => host.origin, token: () => host.token(), hostId: null,
      onEvent: (event, data) => this.events.onEvent(this.local, event, data),
      onStatus: (status, detail) => this.events.onStatus(this.local, status, detail),
    });
    this.load();
  }

  private load() {
    let parsed: unknown = [];
    try { parsed = JSON.parse(readFileSync(this.file, 'utf8')); } catch { /* None saved yet, or unreadable: start empty. */ }
    let entries: SavedConnection[] = [];
    try { entries = array(saved, 100)(parsed); } catch { this.log.warn('Saved connections unreadable; starting without them'); }
    for (const entry of entries) this.remote.set(entry.hostId, { saved: entry, client: null });
  }
  private save() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + process.pid + '.tmp';
    writeFileSync(temporary, JSON.stringify([...this.remote.values()].map(entry => entry.saved), null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, this.file);
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

  /** The other computers this app paired with. */
  list(): RemoteHost[] {
    return [...this.remote.values()].map(({ saved: entry, client }) => ({
      hostId: entry.hostId, name: entry.name, origin: entry.origin, pairedAt: entry.pairedAt,
      status: client?.status ?? 'closed', detail: client?.detail ?? null,
    }));
  }
  has(hostId: string) { return this.remote.has(hostId); }
  name(hostId: string) { return this.remote.get(hostId)?.saved.name ?? hostId; }

  /** The connection to a paired computer, started on first use. */
  client(hostId: string): HostClient {
    const entry = this.remote.get(hostId);
    if (!entry) throw new HostRequestError('not-found', 'This computer is not paired. Connect to it again.');
    if (entry.client && entry.client.status !== 'closed') return entry.client;
    const token = this.open(entry.saved.token);
    const client: HostClient = new HostClient({
      origin: entry.saved.origin, token: () => token, hostId: entry.saved.hostId,
      onEvent: (event, data) => this.events.onEvent(client, event, data),
      onStatus: (status, detail) => this.events.onStatus(client, status, detail),
    });
    entry.client = client;
    client.start();
    return client;
  }

  /** Pair with another computer's Atlas from its pairing link (or address and code), and save it. */
  async pair(link: string, code?: string): Promise<{ host: RemoteHost; folders: SharedFolder[] }> {
    const target = parsePairing(link, code);
    const { descriptor, pairing } = await pairWithHost(target.origin, target.code, { name: hostname().slice(0, 80) || 'Atlas', platform: process.platform });
    if (descriptor.hostId === this.localHost.hostId) throw new HostRequestError('invalid-argument', 'That pairing link belongs to this computer. Open the link on the other computer instead.');
    const previous = this.remote.get(descriptor.hostId);
    previous?.client?.close();
    const entry: SavedConnection = { hostId: descriptor.hostId, name: descriptor.name, origin: target.origin, deviceId: pairing.deviceId, token: this.seal(pairing.token), pairedAt: new Date().toISOString() };
    this.remote.set(descriptor.hostId, { saved: entry, client: null });
    this.save();
    this.log.info('Paired with another computer', { hostId: descriptor.hostId, name: descriptor.name, origin: target.origin });
    const client = this.client(descriptor.hostId);
    const folders = await client.request('folders.shared', {}, { timeout: 15000 });
    return { host: this.list().find(item => item.hostId === descriptor.hostId)!, folders };
  }

  /** Forget a paired computer here. Its host keeps the device listed until it is revoked there. */
  forget(hostId: string) {
    const entry = this.remote.get(hostId);
    if (!entry) return;
    entry.client?.close();
    this.remote.delete(hostId);
    this.save();
  }

  closeAll() {
    this.local.close();
    for (const entry of this.remote.values()) entry.client?.close();
  }
}
