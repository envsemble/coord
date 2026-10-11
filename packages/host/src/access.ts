// Who may connect to this host, and how it can be reached. Kept in <Atlas data folder>/host/:
// access.json holds the host's identity, its settings and its paired devices (each device's token
// only as a SHA-256 hash), and host.lock marks the one process on this computer that manages remote
// access (the desktop app or `atlas serve`). Pairing codes live in memory only: they expire after
// five minutes, are used once, and a host restart forgets them.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { defaultPort, pairingLifetime, type AccessSettings, type PairedDevice, type Scope } from './contract.ts';
import type { Logger } from './errors.ts';
import { HostError } from './errors.ts';
import { accessSettings, array, deviceId, integer, nullable, object, oneOf, string } from './validate.ts';

export interface DeviceRecord { deviceId: string; name: string; platform: string; tokenHash: string; scopes: Scope[]; pairedAt: string; lastSeenAt: string | null }
interface AccessFile { version: 1; hostId: string; name: string; settings: AccessSettings; devices: DeviceRecord[] }
export interface PendingPairing { code: string; expiresAt: number; address: string | null }

const defaultSettings: AccessSettings = { network: { enabled: false, address: null, port: defaultPort }, sharedFolders: [] };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Crockford base32: no I, L, O or U, so a code read aloud or typed is unambiguous. */
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

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

const deviceRecord = object<DeviceRecord>({
  deviceId, name: string({ min: 1, max: 80 }), platform: string({ min: 1, max: 40 }), tokenHash: string({ min: 64, max: 64, pattern: /^[a-f0-9]{64}$/ }),
  scopes: array(oneOf(['planning:read', 'owner'] as const), 2), pairedAt: string({ min: 1, max: 40 }), lastSeenAt: nullable(string({ max: 40 })),
});
const accessFile = object<AccessFile>({
  version: integer(1, 1) as unknown as (value: unknown, at?: string) => 1,
  hostId: string({ min: 8, max: 64, pattern: /^[a-zA-Z0-9-]+$/ }), name: string({ min: 1, max: 80 }),
  settings: accessSettings, devices: array(deviceRecord, 1000),
});

/** Locks this process holds, so a second store in the same process sees the first one's lock. */
const heldLocks = new Set<string>();

function processAlive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

export class AccessStore {
  readonly directory: string;
  private readonly file: string;
  private readonly lockFile: string;
  private readonly log: Logger;
  private state: AccessFile;
  private readonly pairings = new Map<string, PendingPairing>();
  private failures: number[] = [];
  private lastSeenWrites = new Map<string, number>();
  /** Whether this process manages remote access; null when it does, else who does. */
  managedBy: string | null = null;

  constructor(directory: string, log: Logger, owner: string) {
    this.directory = directory;
    this.file = path.join(directory, 'access.json');
    this.lockFile = path.join(directory, 'host.lock');
    this.log = log;
    mkdirSync(directory, { recursive: true });
    this.state = this.read();
    this.managedBy = this.lock(owner);
  }

  private read(): AccessFile {
    let parsed: AccessFile | null = null;
    try { parsed = accessFile(JSON.parse(readFileSync(this.file, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log.error('Access settings unreadable; remote access stays off until they are saved again', error);
        // Keep the damaged file for diagnosis; never silently keep paired devices that cannot be checked.
        try { renameSync(this.file, this.file + '.damaged-' + Date.now()); } catch { /* Best effort. */ }
      }
    }
    if (parsed) return parsed;
    const created: AccessFile = { version: 1, hostId: randomUUID(), name: hostname().slice(0, 80) || 'Atlas', settings: structuredClone(defaultSettings), devices: [] };
    this.state = created;
    this.write();
    return created;
  }
  private write() {
    const temporary = this.file + '.' + process.pid + '.tmp';
    writeFileSync(temporary, JSON.stringify(this.state, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, this.file);
  }

  /** Take host.lock unless a live process holds it; returns who holds it, or null when this process does. */
  private lock(owner: string): string | null {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const descriptor = openSync(this.lockFile, 'wx', 0o600);
        writeSync(descriptor, JSON.stringify({ pid: process.pid, owner, since: new Date().toISOString() }));
        closeSync(descriptor);
        heldLocks.add(this.lockFile);
        return null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { this.log.warn('Remote access lock unavailable', error); return 'another Atlas process'; }
        let holder: { pid?: unknown; owner?: unknown } = {};
        try { holder = JSON.parse(readFileSync(this.lockFile, 'utf8')); } catch { /* Unreadable: treat as stale. */ }
        const live = typeof holder.pid === 'number' && (holder.pid === process.pid ? heldLocks.has(this.lockFile) : processAlive(holder.pid));
        if (live) return `${typeof holder.owner === 'string' ? holder.owner : 'another Atlas process'} (process ${holder.pid})`;
        rmSync(this.lockFile, { force: true });
      }
    }
    return 'another Atlas process';
  }
  unlock() {
    if (this.managedBy !== null) return;
    try {
      const holder = JSON.parse(readFileSync(this.lockFile, 'utf8')) as { pid?: unknown };
      if (holder.pid === process.pid) { rmSync(this.lockFile, { force: true }); heldLocks.delete(this.lockFile); }
    } catch { /* Already gone. */ }
  }

  get hostId() { return this.state.hostId; }
  get name() { return this.state.name; }
  get settings(): AccessSettings { return structuredClone(this.state.settings); }
  /** Remote access is configurable here only in the process that manages it. */
  private manage() {
    if (this.managedBy !== null) throw new HostError('unavailable', `Remote access on this computer is managed by ${this.managedBy}. Stop it to change remote access here.`);
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
  private purge() {
    const now = Date.now();
    for (const [key, pairing] of this.pairings) if (pairing.expiresAt <= now) this.pairings.delete(key);
  }

  /**
   * Exchange a pairing code for a new device and its token. The code is used once. Failures are
   * rate limited: after 20 wrong codes in five minutes, pairing is refused until the window passes.
   */
  pair(code: string, device: { name: string; platform: string }): { device: DeviceRecord; token: string } {
    this.manage();
    const now = Date.now();
    this.failures = this.failures.filter(time => now - time < 5 * 60000);
    if (this.failures.length >= 20) throw new HostError('unavailable', 'Too many wrong pairing codes. Wait a few minutes and create a new pairing link.');
    this.purge();
    const key = normalizeCode(code);
    const pending = this.pairings.get(key);
    if (!pending) {
      this.failures.push(now);
      throw new HostError('unauthorized', 'This pairing code is wrong, expired or already used. Create a new pairing link on the host.');
    }
    this.pairings.delete(key);
    const token = newToken();
    const record: DeviceRecord = { deviceId: 'd-' + randomBytes(16).toString('hex'), name: device.name.trim(), platform: device.platform.trim(), tokenHash: hash(token), scopes: ['planning:read'], pairedAt: new Date().toISOString(), lastSeenAt: null };
    this.state.devices.push(record);
    this.write();
    this.log.info('Device paired', { deviceId: record.deviceId, name: record.name, platform: record.platform });
    return { device: record, token };
  }
}
