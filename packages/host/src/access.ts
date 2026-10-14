// Who may connect to this host, and how it can be reached. Kept in <Atlas data folder>/host/:
// access.json holds the host's identity, a secret for folder IDs, its settings and its paired
// devices (each device's token only as a SHA-256 hash). A paired device gets the whole computer;
// a pairing link may also grant it Manage access (pair and revoke devices). One process on this computer manages
// remote access for a data folder (the desktop app or `atlas serve`): it holds a local lock socket
// that the system releases when the process ends, however it ends. The socket is named after the
// data folder's secret, so every spelling of the folder (a link, a short name) finds the same lock
// and other users, who cannot read the secret, cannot take its name. Pairing codes live in memory
// only: they expire after five minutes, are used once, and a restart forgets them.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, createServer, type Server } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { defaultPort, pairingLifetime, type AccessSettings, type PairedDevice, type PairingGrant, type Scope } from './contract.ts';
import type { Logger } from './errors.ts';
import { HostError } from './errors.ts';
import { array, deviceId, integer, legacyAccessSettings, object, oneOf, string, nullable, type Validator } from './validate.ts';

/** A paired device's scopes: always `computer`, and `access:manage` when its pairing link granted it. */
export type DeviceScope = Exclude<Scope, 'owner'>;
export interface DeviceRecord { deviceId: string; name: string; platform: string; tokenHash: string; scopes: DeviceScope[]; pairedAt: string; lastSeenAt: string | null }
/**
 * Version 2: devices get the whole computer. Version 1 (the first remote access) let devices read
 * only shared folders; it is still read, and its devices and shared folders are carried over.
 */
interface AccessFile { version: 2; hostId: string; name: string; secret: string; settings: AccessSettings; devices: DeviceRecord[] }
export interface PendingPairing extends PairingGrant { code: string; expiresAt: number; address: string | null }

const defaultSettings: AccessSettings = { network: { enabled: false, address: null, port: defaultPort } };
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

/**
 * Where the remote-access lock of a data folder lives, named after its secret: a named pipe on
 * Windows and an abstract socket on Linux, which the system removes with their process; elsewhere a
 * socket file in the user's own temporary folder (short, as socket paths must be).
 */
export function lockAddress(secret: string, platform: NodeJS.Platform = process.platform): { address: string; file: boolean } {
  const id = createHash('sha256').update('atlas-host-lock:' + secret).digest('hex');
  if (platform === 'win32') return { address: '\\\\.\\pipe\\atlas-host-' + id.slice(0, 32), file: false };
  if (platform === 'linux') return { address: String.fromCharCode(0) + 'atlas-host-' + id.slice(0, 32), file: false };
  return { address: path.join(tmpdir(), 'atlas-host-' + id.slice(0, 16) + '.sock'), file: true };
}

/** The holder's proof that it knows the data folder's secret: a squatter on the lock's name cannot answer. */
const lockProof = (secret: string, challenge: string) => createHmac('sha256', secret).update('atlas-host-lock-proof:' + challenge).digest('hex');

/**
 * Ask the lock's holder who it is, with a challenge only a process that read the data folder's
 * secret can answer; null when nobody holds it (a socket file left behind).
 */
/** Who holds the lock when it cannot prove it read the data folder's secret. */
export const impostorHolder = 'a program that is not Atlas';

function lockHolder(address: string, secret: string): Promise<{ owner: string; pid: number | null; genuine: boolean } | null> {
  return new Promise(resolve => {
    const challenge = randomBytes(16).toString('hex');
    const socket = createConnection(address, () => socket.write(challenge + '\n'));
    let text = '';
    const someone = { owner: 'another Atlas process', pid: null, genuine: true };
    const impostor = { owner: impostorHolder, pid: null, genuine: false };
    // No answer in time is a busy holder, not proof of an impostor.
    const timer = setTimeout(() => { socket.destroy(); resolve({ owner: 'another process that did not answer', pid: null, genuine: true }); }, 2000);
    socket.setEncoding('utf8');
    socket.on('data', chunk => { text += chunk; if (text.length > 1024) socket.destroy(); });
    socket.on('end', () => {
      clearTimeout(timer);
      socket.destroy();
      try {
        const value = JSON.parse(text) as { owner?: unknown; pid?: unknown; proof?: unknown };
        const expected = Buffer.from(lockProof(secret, challenge));
        const proof = Buffer.from(typeof value.proof === 'string' ? value.proof : '');
        if (proof.length !== expected.length || !timingSafeEqual(proof, expected)) { resolve(impostor); return; }
        resolve({ owner: typeof value.owner === 'string' ? value.owner.slice(0, 80) : someone.owner, pid: typeof value.pid === 'number' ? value.pid : null, genuine: true });
      } catch { resolve(impostor); }
    });
    socket.on('error', error => {
      clearTimeout(timer);
      const code = (error as NodeJS.ErrnoException).code;
      // Nobody there (a stale socket file); refused access (another user's pipe, never this user's Atlas); or busy.
      resolve(code === 'ECONNREFUSED' || code === 'ENOENT' ? null : code === 'EPERM' || code === 'EACCES' ? impostor : someone);
    });
  });
}

/**
 * Whether a host runs from the data folder `directory`: something answers at the remote-access lock
 * named after the secret in its host/access.json. A host started while another process held that
 * lock (and one whose settings are unreadable) holds none, so it is not seen.
 */
export async function hostRunning(directory: string): Promise<boolean> {
  let secret: unknown;
  try { secret = (JSON.parse(readFileSync(path.join(directory, 'host', 'access.json'), 'utf8')) as { secret?: unknown }).secret; }
  catch { return false; }
  if (typeof secret !== 'string' || !secret) return false;
  return await lockHolder(lockAddress(secret).address, secret) !== null;
}

/** A device's scopes as stored; `planning:read` (version 1, shared folders only) becomes the whole computer. */
const scopes: Validator<DeviceScope[]> = (value, at) => {
  const stored = array(oneOf(['planning:read', 'computer', 'access:manage'] as const), 3)(value, at);
  return stored.includes('access:manage') ? ['computer', 'access:manage'] : ['computer'];
};
const deviceRecord = object<DeviceRecord>({
  deviceId, name: string({ min: 1, max: 80 }), platform: string({ min: 1, max: 40 }), tokenHash: string({ min: 64, max: 64, pattern: /^[a-f0-9]{64}$/ }),
  scopes, pairedAt: string({ min: 1, max: 40 }), lastSeenAt: nullable(string({ max: 40 })),
});
/** Everything but the devices, which are checked one by one so one bad record cannot cost the others. */
const accessHeader = object<Omit<AccessFile, 'devices' | 'version' | 'settings'> & { version: 1 | 2; settings: AccessSettings & { sharedFolders?: string[] }; devices: unknown[] }>({
  version: integer(1, 2) as unknown as Validator<1 | 2>,
  hostId: string({ min: 8, max: 64, pattern: /^[a-zA-Z0-9-]+$/ }), name: string({ min: 1, max: 80 }),
  secret: string({ min: 32, max: 64, pattern: /^[a-zA-Z0-9_-]+$/ }),
  settings: legacyAccessSettings, devices: array((value: unknown) => value, 1000),
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
  /** Whether this process manages remote access: null when it does, else who does. Nobody until lock(). */
  managedBy: string | null = 'nobody yet (the host has not started)';
  /** Why access.json could not be read the last time it was read. */
  private loadProblem: string | null = null;
  /** The settings changed under this process (another identity or secret): only a restart can use them. */
  private restartNeeded: string | null = null;
  /** Why remote access cannot be used at all; null when it can. */
  get problem(): string | null { return this.restartNeeded ?? this.loadProblem; }
  /** The secret this process read first: it names the lock and keys folder IDs, and never changes while the process runs. */
  private readonly secret: string;
  /** Folders version 1 shared, when that is what was read: the folder list starts with them. */
  legacySharedFolders: string[] = [];

  constructor(directory: string, log: Logger, owner: string) {
    this.directory = directory;
    this.file = path.join(directory, 'access.json');
    this.log = log;
    this.owner = owner;
    mkdirSync(directory, { recursive: true });
    const loaded = this.load();
    // An unreadable file is left alone: this process works on a placeholder that is never saved.
    this.state = loaded ?? { version: 2, hostId: randomUUID(), name: hostname().slice(0, 80) || 'Atlas', secret: randomBytes(32).toString('base64url'), settings: structuredClone(defaultSettings), devices: [] };
    this.secret = this.state.secret;
  }

  /**
   * Read access.json without changing it, or null (with `problem` set) when it cannot be read. A
   * missing file is created atomically, so processes starting together agree on one identity and
   * secret. A file this version cannot read (damaged, or written by a newer Atlas) is never
   * replaced: remote access stays off until it can be read again.
   */
  private load(): AccessFile | null {
    for (let attempt = 0; attempt < 3; attempt++) {
      let text: string;
      try { text = readFileSync(this.file, 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.create(); continue; }
        this.loadProblem = `Remote access settings in ${this.file} cannot be read (${(error as Error).message}). Remote access stays off until they can be read.`;
        this.log.error('Access settings unreadable', error);
        return null;
      }
      try {
        const header = accessHeader(JSON.parse(text));
        const devices: DeviceRecord[] = [];
        for (const [index, value] of header.devices.entries()) {
          try { devices.push(deviceRecord(value, 'devices[' + index + ']')); }
          catch (error) { this.log.warn('A paired device record is unreadable and is ignored', { index, message: (error as Error).message }); }
        }
        this.loadProblem = null;
        const { sharedFolders, ...settings } = header.settings;
        if (header.version === 1) this.legacySharedFolders = sharedFolders ?? [];
        // Saved as version 2 the next time the managing process writes it.
        return { ...header, version: 2, settings, devices };
      } catch (error) {
        this.loadProblem = `Remote access settings in ${this.file} are not in a form this version of Atlas can read (${(error as Error).message}). A newer Atlas may have written them. Remote access stays off; to start over, remove the file (paired devices then pair again).`;
        this.log.error('Access settings not readable by this version', { message: (error as Error).message });
        return null;
      }
    }
    this.loadProblem = `Remote access settings in ${this.file} could not be created.`;
    return null;
  }
  /** Create access.json with a new identity, unless another process just did. */
  private create() {
    const created: AccessFile = { version: 2, hostId: randomUUID(), name: hostname().slice(0, 80) || 'Atlas', secret: randomBytes(32).toString('base64url'), settings: structuredClone(defaultSettings), devices: [] };
    const temporary = this.file + '.' + process.pid + '.new';
    writeFileSync(temporary, JSON.stringify(created, null, 2) + '\n', { mode: 0o600 });
    try { linkSync(temporary, this.file); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return;
      // A file system without hard links: create exclusively instead.
      try { writeFileSync(this.file, JSON.stringify(created, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); }
      catch (fallback) { if ((fallback as NodeJS.ErrnoException).code !== 'EEXIST') throw fallback; }
    } finally { rmSync(temporary, { force: true }); }
  }
  private replace(state: AccessFile) {
    const temporary = this.file + '.' + process.pid + '.tmp';
    writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, this.file);
  }
  /** Save the state. Only the process that manages remote access writes access.json. */
  private write() {
    if (this.managedBy !== null) throw new HostError('unavailable', 'Remote access settings are saved only by the process that manages remote access.');
    this.replace(this.state);
  }
  /** Read access.json again, to show what the managing process saved. Changes nothing. */
  reload() {
    if (this.managedBy === null) return;
    this.adopt(this.load());
  }
  /**
   * Take what was read as this process's state, if it is the same identity this process started
   * with; otherwise only a restart can use it (folder IDs and the lock name come from the secret).
   */
  private adopt(fresh: AccessFile | null): boolean {
    if (!fresh) return false;
    if (fresh.secret !== this.secret) {
      this.restartNeeded = `Remote access settings in ${this.file} changed while Atlas was running. Quit and start Atlas again to use them.`;
      return false;
    }
    this.state = fresh;
    return true;
  }

  /** Take the lock unless another live process holds it. Returns who manages remote access: null when this process does. */
  async lock(): Promise<string | null> {
    if (this.lockServer) return null;
    // Settings that could not be read, or changed under this process, need a restart first. Read
    // them again anyway, so the reason given is current (readable again means: restart Atlas).
    if (this.problem) {
      if (!this.restartNeeded) this.adopt(this.load());
      this.managedBy = 'nobody';
      return this.managedBy;
    }
    const secret = this.secret;
    const { address, file } = lockAddress(secret);
    for (let attempt = 0; attempt < 2; attempt++) {
      // The holder answers a challenge with proof that it read this data folder's secret.
      const server = createServer(socket => {
        let challenge = '';
        socket.setEncoding('utf8');
        socket.setTimeout(2000, () => socket.destroy());
        socket.on('data', chunk => {
          challenge += chunk;
          if (challenge.length > 128) { socket.destroy(); return; }
          if (!challenge.includes('\n')) return;
          socket.end(JSON.stringify({ owner: this.owner, pid: process.pid, proof: lockProof(secret, challenge.trim()) }));
        });
        socket.on('error', () => undefined);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(address, () => { server.off('error', reject); resolve(); });
        });
        server.unref();
        // Start from what the previous manager saved (pairings, revocations), not from what this process read earlier.
        if (!this.adopt(this.load())) {
          server.close();
          this.managedBy = 'nobody';
          return this.managedBy;
        }
        this.lockServer = server;
        this.managedBy = null;
        return null;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EADDRINUSE') { this.log.warn('Remote access lock unavailable', error); break; }
        const holder = await lockHolder(address, secret);
        if (holder) {
          if (!holder.genuine) this.log.warn('Another program holds the name of Atlas\'s remote access lock; remote access stays off', { address: file ? address : 'a system object' });
          this.managedBy = holder.owner + (holder.pid ? ` (process ${holder.pid})` : '');
          return this.managedBy;
        }
        // A socket file left behind by a process that ended (only where the lock is a file).
        if (!file) break;
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
  /** The key that turns a folder's path into its ID, so IDs cannot be guessed from paths. Fixed for the process's life. */
  get folderKey() { return this.secret; }
  get settings(): AccessSettings { return structuredClone(this.state.settings); }
  /** Remote access is configurable here only in the process that manages it. */
  private manage() {
    if (this.problem) throw new HostError('unavailable', this.problem);
    if (this.managedBy !== null) throw new HostError('unavailable', `Remote access on this computer is managed by ${this.managedBy}. Quit it, then open Remote Access here again.`);
  }

  updateSettings(settings: AccessSettings) {
    this.manage();
    this.state.settings = structuredClone(settings);
    this.write();
  }

  /** A device by its ID. */
  device(id: string): DeviceRecord | null { return this.state.devices.find(device => device.deviceId === id) ?? null; }
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

  /** A one-time pairing link for one device: the whole computer, and Manage access if granted. */
  createPairing(address: string | null, grant: PairingGrant = { label: null, manageAccess: false }): PendingPairing {
    this.manage();
    this.purge();
    if (this.pairings.size >= 20) throw new HostError('unavailable', 'Too many pairing links are open. Revoke one or let them expire.');
    const pairing: PendingPairing = { code: newPairingCode(), expiresAt: Date.now() + pairingLifetime, address, label: grant.label, manageAccess: grant.manageAccess };
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
    // The label the owner gave the link names the device; otherwise the name the device reports.
    const record: DeviceRecord = {
      deviceId: 'd-' + randomBytes(16).toString('hex'), name: pending.label ?? device.name, platform: device.platform, tokenHash: hash(token),
      scopes: pending.manageAccess ? ['computer', 'access:manage'] : ['computer'], pairedAt: new Date().toISOString(), lastSeenAt: null,
    };
    this.state.devices.push(record);
    this.write();
    this.log.info('Device paired', { deviceId: record.deviceId, name: record.name, platform: record.platform, manageAccess: pending.manageAccess });
    return { device: record, token };
  }
}
