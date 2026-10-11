// Who may connect to this host, and how it can be reached. Kept in <Atlas data folder>/host/:
// access.json holds the host's identity, a secret for folder IDs, its settings and its paired
// devices (each device's token only as a SHA-256 hash). One process on this computer manages
// remote access for a data folder (the desktop app or `atlas serve`): it holds a local lock socket
// that the system releases when the process ends, however it ends. Pairing codes live in memory
// only: they expire after five minutes, are used once, and a restart forgets them.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, createServer, type Server } from 'node:net';
import { hostname } from 'node:os';
import path from 'node:path';
import { defaultPort, pairingLifetime, type AccessSettings, type PairedDevice, type Scope } from './contract.ts';
import type { Logger } from './errors.ts';
import { HostError } from './errors.ts';
import { pathKey } from './folders.ts';
import { accessSettings, array, deviceId, integer, object, oneOf, optional, string, nullable, type Validator } from './validate.ts';

export interface DeviceRecord { deviceId: string; name: string; platform: string; tokenHash: string; scopes: Scope[]; pairedAt: string; lastSeenAt: string | null }
interface AccessFile { version: 1; hostId: string; name: string; secret: string; settings: AccessSettings; devices: DeviceRecord[] }
export interface PendingPairing { code: string; expiresAt: number; address: string | null }

const defaultSettings: AccessSettings = { network: { enabled: false, address: null, port: defaultPort }, sharedFolders: [] };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Crockford base32: no I, L, O or U, so a code read aloud or typed is unambiguous. */
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const failureWindow = 5 * 60000;
/** Wrong codes allowed in five minutes from one address, and from everywhere together. */
const failureLimit = { peer: 20, total: 200 };

/** A new secret: 32 random bytes. */
export function newToken() { return 'atl_' + randomBytes(32).toString('base64url'); }

/** A pairing code: 16 characters in four groups, 80 random bits. */
export function newPairingCode() {
  const bytes = randomBytes(16);
  const characters = [...bytes].map(byte => alphabet[byte % 32]);
  return [0, 4, 8, 12].map(index => characters.slice(index, index + 4).join('')).join('-');
}
/** The canonical form of a typed code: upper case, without separators, with look-alike letters mapped. */
export function normalizeCode(code: string) {
  return code.toUpperCase().replace(/[\s-]/g, '').replaceAll('O', '0').replace(/[IL]/g, '1').replaceAll('U', 'V');
}

/** Where the remote-access lock of a data folder lives: a named pipe on Windows and an abstract socket on Linux, which the system removes with their process; a socket file elsewhere. */
export function lockAddress(directory: string, platform: NodeJS.Platform = process.platform) {
  const id = createHash('sha256').update(pathKey(path.resolve(directory), platform)).digest('hex').slice(0, 32);
  if (platform === 'win32') return '\\\\.\\pipe\\atlas-host-' + id;
  if (platform === 'linux') return String.fromCharCode(0) + 'atlas-host-' + id;
  return path.join(directory, 'host.sock');
}

/** Ask the lock's holder who it is; null when nobody holds it (a socket file left behind). */
function lockHolder(address: string): Promise<{ owner: string; pid: number | null } | null> {
  return new Promise(resolve => {
    const socket = createConnection(address);
    let text = '';
    const someone = { owner: 'another Atlas process', pid: null };
    const timer = setTimeout(() => { socket.destroy(); resolve(someone); }, 2000);
    socket.setEncoding('utf8');
    socket.on('data', chunk => { text += chunk; if (text.length > 1024) socket.destroy(); });
    socket.on('end', () => {
      clearTimeout(timer);
      try {
        const value = JSON.parse(text) as { owner?: unknown; pid?: unknown };
        resolve({ owner: typeof value.owner === 'string' ? value.owner.slice(0, 80) : someone.owner, pid: typeof value.pid === 'number' ? value.pid : null });
      } catch { resolve(someone); }
    });
    socket.on('error', error => {
      clearTimeout(timer);
      const code = (error as NodeJS.ErrnoException).code;
      resolve(code === 'ECONNREFUSED' || code === 'ENOENT' ? null : someone);
    });
  });
}

const scopes = array(oneOf(['planning:read'] as const), 1) as Validator<Scope[]>;
const deviceRecord = object<DeviceRecord>({
  deviceId, name: string({ min: 1, max: 80 }), platform: string({ min: 1, max: 40 }), tokenHash: string({ min: 64, max: 64, pattern: /^[a-f0-9]{64}$/ }),
  scopes, pairedAt: string({ min: 1, max: 40 }), lastSeenAt: nullable(string({ max: 40 })),
});
/** Everything but the devices, which are checked one by one so one bad record cannot cost the others. */
const accessHeader = object<Omit<AccessFile, 'devices' | 'secret'> & { secret?: string; devices: unknown[] }>({
  version: integer(1, 1) as unknown as Validator<1>,
  hostId: string({ min: 8, max: 64, pattern: /^[a-zA-Z0-9-]+$/ }), name: string({ min: 1, max: 80 }),
  secret: optional(string({ min: 32, max: 64, pattern: /^[a-zA-Z0-9_-]+$/ })),
  settings: accessSettings, devices: array((value: unknown) => value, 1000),
});

export class AccessStore {
  readonly directory: string;
  private readonly file: string;
  private readonly log: Logger;
  private readonly owner: string;
  private state: AccessFile;
  private readonly pairings = new Map<string, PendingPairing>();
  private readonly failures = new Map<string, number[]>();
  private lastSeenWrites = new Map<string, number>();
  private lockServer: Server | null = null;
  /** Another process held the lock when this one asked, so its saved state may have changed since. */
  private waited = false;
  /** Whether this process manages remote access: null when it does, else who does. Nobody until lock(). */
  managedBy: string | null = 'nobody yet (the host has not started)';

  constructor(directory: string, log: Logger, owner: string) {
    this.directory = directory;
    this.file = path.join(directory, 'access.json');
    this.log = log;
    this.owner = owner;
    mkdirSync(directory, { recursive: true });
    this.state = this.read();
  }

  private read(): AccessFile {
    let parsed: AccessFile | null = null;
    try {
      const header = accessHeader(JSON.parse(readFileSync(this.file, 'utf8')));
      const devices: DeviceRecord[] = [];
      for (const [index, value] of header.devices.entries()) {
        try { devices.push(deviceRecord(value, 'devices[' + index + ']')); }
        catch (error) { this.log.warn('A paired device record is unreadable and was dropped', { index, message: (error as Error).message }); }
      }
      parsed = { ...header, secret: header.secret ?? randomBytes(32).toString('base64url'), devices };
      if (!header.secret || devices.length !== header.devices.length) { this.state = parsed; this.write(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log.error('Access settings unreadable; remote access stays off until they are saved again', error);
        // Keep the damaged file for diagnosis; never silently keep paired devices that cannot be checked.
        try { renameSync(this.file, this.file + '.damaged-' + Date.now()); } catch { /* Best effort. */ }
      }
    }
    if (parsed) return parsed;
    const created: AccessFile = { version: 1, hostId: randomUUID(), name: hostname().slice(0, 80) || 'Atlas', secret: randomBytes(32).toString('base64url'), settings: structuredClone(defaultSettings), devices: [] };
    this.state = created;
    this.write();
    return created;
  }
  private write() {
    const temporary = this.file + '.' + process.pid + '.tmp';
    writeFileSync(temporary, JSON.stringify(this.state, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, this.file);
  }
  /** Read access.json again, for a process that does not manage remote access and shows what the manager saved. */
  reload() {
    if (this.managedBy !== null) this.state = this.read();
  }

  /** Take the lock unless another live process holds it. Returns who manages remote access: null when this process does. */
  async lock(): Promise<string | null> {
    if (this.lockServer) return null;
    const address = lockAddress(this.directory);
    for (let attempt = 0; attempt < 2; attempt++) {
      const server = createServer(socket => { socket.end(JSON.stringify({ owner: this.owner, pid: process.pid })); });
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(address, () => { server.off('error', reject); resolve(); });
        });
        server.unref();
        this.lockServer = server;
        this.managedBy = null;
        // What the previous manager saved while this process waited.
        if (this.waited) { this.waited = false; this.state = this.read(); }
        return null;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EADDRINUSE') { this.log.warn('Remote access lock unavailable', error); break; }
        const holder = await lockHolder(address);
        if (holder) { this.waited = true; this.managedBy = holder.owner + (holder.pid ? ` (process ${holder.pid})` : ''); return this.managedBy; }
        // A socket file left behind by a process that ended (only where the lock is a file).
        if (!path.isAbsolute(address)) break;
        rmSync(address, { force: true });
      }
    }
    this.managedBy = 'another Atlas process';
    return this.managedBy;
  }
  unlock() {
    const server = this.lockServer;
    if (!server) return;
    this.lockServer = null;
    this.managedBy = 'nobody (the host stopped)';
    server.close();
  }

  get hostId() { return this.state.hostId; }
  get name() { return this.state.name; }
  /** The key that turns a folder's path into its ID, so IDs cannot be guessed from paths. */
  get folderKey() { return this.state.secret; }
  get settings(): AccessSettings { return structuredClone(this.state.settings); }
  /** Remote access is configurable here only in the process that manages it. */
  private manage() {
    if (this.managedBy !== null) throw new HostError('unavailable', `Remote access on this computer is managed by ${this.managedBy}. Quit it, then open Remote Access here again.`);
  }

  updateSettings(settings: AccessSettings) {
    this.manage();
    this.state.settings = structuredClone(settings);
    this.write();
  }

  devices(connected: Set<string>): PairedDevice[] {
    return this.state.devices.map(device => ({ deviceId: device.deviceId, name: device.name, platform: device.platform, scopes: [...device.scopes], pairedAt: device.pairedAt, lastSeenAt: device.lastSeenAt, connected: connected.has(device.deviceId) }));
  }
  /** The device a token belongs to, or null. Compares hashes in constant time. */
  deviceForToken(token: string): DeviceRecord | null {
    if (!token.startsWith('atl_') || token.length > 100) return null;
    const presented = Buffer.from(hash(token), 'hex');
    return this.state.devices.find(device => timingSafeEqual(Buffer.from(device.tokenHash, 'hex'), presented)) ?? null;
  }
  /** Record that a device connected; written at most once a minute per device. */
  seen(deviceId: string) {
    const device = this.state.devices.find(entry => entry.deviceId === deviceId);
    if (!device) return;
    device.lastSeenAt = new Date().toISOString();
    const last = this.lastSeenWrites.get(deviceId) ?? 0;
    if (Date.now() - last < 60000 || this.managedBy !== null) return;
    this.lastSeenWrites.set(deviceId, Date.now());
    try { this.write(); } catch (error) { this.log.warn('Device activity not saved', error); }
  }
  revokeDevice(id: string) {
    this.manage();
    const before = this.state.devices.length;
    this.state.devices = this.state.devices.filter(device => device.deviceId !== id);
    if (this.state.devices.length === before) throw new HostError('not-found', 'This device is not paired.');
    this.write();
  }

  createPairing(address: string | null): PendingPairing {
    this.manage();
    this.purge();
    if (this.pairings.size >= 20) throw new HostError('unavailable', 'Too many pairing links are open. Revoke one or let them expire.');
    const pairing = { code: newPairingCode(), expiresAt: Date.now() + pairingLifetime, address };
    this.pairings.set(normalizeCode(pairing.code), pairing);
    return pairing;
  }
  revokePairing(code: string) {
    this.pairings.delete(normalizeCode(code));
  }
  /** Forget every open pairing link (remote access was turned off). */
  clearPairings() {
    this.pairings.clear();
  }
  private purge() {
    const now = Date.now();
    for (const [key, pairing] of this.pairings) if (pairing.expiresAt <= now) this.pairings.delete(key);
  }

  /**
   * Exchange a pairing code for a new device and its token. The code is used once. Wrong codes are
   * rate limited per address (20 in five minutes) and overall (200), so guessing stays hopeless and
   * one address cannot block pairing for everyone.
   */
  pair(code: string, device: { name: string; platform: string }, peer = 'unknown'): { device: DeviceRecord; token: string } {
    this.manage();
    const now = Date.now();
    for (const [key, times] of this.failures) {
      const recent = times.filter(time => now - time < failureWindow);
      if (recent.length) this.failures.set(key, recent); else this.failures.delete(key);
    }
    const total = [...this.failures.values()].reduce((sum, times) => sum + times.length, 0);
    if ((this.failures.get(peer)?.length ?? 0) >= failureLimit.peer || total >= failureLimit.total) throw new HostError('unavailable', 'Too many wrong pairing codes. Wait a few minutes and create a new pairing link.');
    this.purge();
    const key = normalizeCode(code);
    const pending = this.pairings.get(key);
    if (!pending) {
      this.failures.set(peer, [...(this.failures.get(peer) ?? []), now]);
      throw new HostError('unauthorized', 'This pairing code is wrong, expired or already used. Create a new pairing link on the host.');
    }
    this.pairings.delete(key);
    const token = newToken();
    const record: DeviceRecord = { deviceId: 'd-' + randomBytes(16).toString('hex'), name: device.name, platform: device.platform, tokenHash: hash(token), scopes: ['planning:read'], pairedAt: new Date().toISOString(), lastSeenAt: null };
    this.state.devices.push(record);
    this.write();
    this.log.info('Device paired', { deviceId: record.deviceId, name: record.name, platform: record.platform });
    return { device: record, token };
  }
}
