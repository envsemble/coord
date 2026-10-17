// Who may connect to this host, and how it can be reached. Kept in the home database: the host's
// identity (host.id, host.name), a secret for folder IDs (host.secret) and its remote-access settings
// (host.network) as settings, and its paired devices (each device's token only as a SHA-256 hash). A
// paired device gets the whole computer; a pairing link may also grant it Manage access (pair and
// revoke devices). One process on this computer manages remote access for a home (the desktop app or
// `atlas serve`): it holds a local lock socket that the system releases when the process ends,
// however it ends. The socket is named after the home's secret, so every spelling of the home (a
// link, a short name) finds the same lock and other users, who cannot read the secret, cannot take
// its name. Pairing codes live in memory only: they expire after five minutes, are used once, and a
// restart forgets them.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { createConnection, createServer, type Server } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import type { HomeDatabase } from '../../planning/index.ts';
import { defaultPort, pairingLifetime, type AccessSettings, type PairedDevice, type PairingGrant, type Scope } from '../contract.ts';
import type { Logger } from '../errors.ts';
import { HostError } from '../errors.ts';
import { accessSettings } from '../validate.ts';

/** A paired device's scopes: always `computer`, and `access:manage` when its pairing link granted it. */
export type DeviceScope = Exclude<Scope, 'owner'>;
export interface DeviceRecord { deviceId: string; name: string; platform: string; tokenHash: string; scopes: DeviceScope[]; pairedAt: string; lastSeenAt: string | null }
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
 * Whether a host from before the home database runs from the folder `directory` (the old data
 * folder, or a home whose files wait to be imported): something answers at the remote-access lock
 * named after the secret in its host/access.json.
 */
export async function hostRunning(directory: string): Promise<boolean> {
  let secret: unknown;
  try { secret = (JSON.parse(readFileSync(path.join(directory, 'host', 'access.json'), 'utf8')) as { secret?: unknown }).secret; }
  catch { return false; }
  if (typeof secret !== 'string' || !secret) return false;
  return await lockHolder(lockAddress(secret).address, secret) !== null;
}

type Row = Record<string, unknown>;
const deviceRecord = (row: Row): DeviceRecord => ({
  deviceId: String(row.id), name: String(row.name), platform: String(row.platform), tokenHash: String(row.secret_hash),
  scopes: row.manage_access ? ['computer', 'access:manage'] : ['computer'], pairedAt: String(row.paired_at), lastSeenAt: (row.last_seen_at as string | null) ?? null,
});

export class AccessStore {
  readonly database: HomeDatabase;
  private readonly log: Logger;
  private readonly owner: string;
  private readonly pairings = new Map<string, PendingPairing>();
  private readonly failures = new Map<string, number[]>();
  private lastSeenWrites = new Map<string, number>();
  private lockServer: Server | null = null;
  /** Whether this process manages remote access: null when it does, else who does. Nobody until lock(). */
  managedBy: string | null = 'nobody yet (the host has not started)';
  /** The settings changed under this process (another identity or secret): only a restart can use them. */
  private restartNeeded: string | null = null;
  /** Why remote access cannot be used at all; null when it can. */
  get problem(): string | null { return this.restartNeeded; }
  /** The secret this process read first: it names the lock and keys folder IDs, and never changes while the process runs. */
  private readonly secret: string;

  constructor(database: HomeDatabase, log: Logger, owner: string) {
    this.database = database;
    this.log = log;
    this.owner = owner;
    // Processes starting together agree on one identity: the first to write it wins.
    database.transaction(() => {
      if (database.setting('host.secret') !== null) return;
      database.setSetting('host.id', randomUUID());
      database.setSetting('host.name', hostname().slice(0, 80) || 'Atlas');
      database.setSetting('host.secret', randomBytes(32).toString('base64url'));
    });
    this.secret = database.setting('host.secret')!;
  }

  /** Read the settings again, to show what the managing process saved; a changed identity needs a restart. */
  reload() {
    if (this.database.setting('host.secret') !== this.secret) this.restartNeeded = `Remote access settings in ${this.database.file} changed while Atlas was running. Quit and start Atlas again to use them.`;
  }

  /** Take the lock unless another live process holds it. Returns who manages remote access: null when this process does. */
  async lock(): Promise<string | null> {
    if (this.lockServer) return null;
    // Settings that changed under this process need a restart first.
    this.reload();
    if (this.problem) {
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

  get hostId() { return this.database.setting('host.id')!; }
  get name() { return this.database.setting('host.name') ?? 'Atlas'; }
  /** The key that turns a folder's path into its ID, so IDs cannot be guessed from paths. Fixed for the process's life. */
  get folderKey() { return this.secret; }
  get settings(): AccessSettings {
    try { return accessSettings({ network: JSON.parse(this.database.setting('host.network') ?? 'null') }); }
    catch { return structuredClone(defaultSettings); }
  }
  /** Remote access is configurable here only in the process that manages it. */
  private manage() {
    if (this.problem) throw new HostError('unavailable', this.problem);
    if (this.managedBy !== null) throw new HostError('unavailable', `Remote access on this computer is managed by ${this.managedBy}. Quit it, then open Remote Access here again.`);
  }

  updateSettings(settings: AccessSettings) {
    this.manage();
    this.database.setSetting('host.network', JSON.stringify(settings.network));
  }

  /** A device by its ID. */
  device(id: string): DeviceRecord | null {
    const row = this.database.db.prepare('SELECT * FROM device WHERE id = ?').get(id) as Row | undefined;
    return row ? deviceRecord(row) : null;
  }
  private allDevices(): DeviceRecord[] { return (this.database.db.prepare('SELECT * FROM device ORDER BY paired_at, id').all() as Row[]).map(deviceRecord); }
  devices(connected: Set<string>): PairedDevice[] {
    return this.allDevices().map(device => ({ deviceId: device.deviceId, name: device.name, platform: device.platform, scopes: [...device.scopes], pairedAt: device.pairedAt, lastSeenAt: device.lastSeenAt, connected: connected.has(device.deviceId) }));
  }
  /** The device a token belongs to, or null. Compares hashes in constant time. */
  deviceForToken(token: string): DeviceRecord | null {
    if (!token.startsWith('atl_') || token.length > 100) return null;
    const presented = Buffer.from(hash(token), 'hex');
    return this.allDevices().find(device => timingSafeEqual(Buffer.from(device.tokenHash, 'hex'), presented)) ?? null;
  }
  /** Record that a device connected; written at most once a minute per device, by the managing process. */
  seen(deviceId: string) {
    const last = this.lastSeenWrites.get(deviceId) ?? 0;
    if (Date.now() - last < 60000 || this.managedBy !== null) return;
    this.lastSeenWrites.set(deviceId, Date.now());
    try { this.database.db.prepare('UPDATE device SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), deviceId); }
    catch (error) { this.log.warn('Device activity not saved', error); }
  }
  revokeDevice(id: string) {
    this.manage();
    if (!this.database.db.prepare('DELETE FROM device WHERE id = ?').run(id).changes) throw new HostError('not-found', 'This device is not paired.');
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
    this.database.db.prepare('INSERT INTO device (id, name, secret_hash, paired_at, last_seen_at, platform, manage_access) VALUES (?, ?, ?, ?, NULL, ?, ?)')
      .run(record.deviceId, record.name, record.tokenHash, record.pairedAt, record.platform, pending.manageAccess ? 1 : 0);
    this.log.info('Device paired', { deviceId: record.deviceId, name: record.name, platform: record.platform, manageAccess: pending.manageAccess });
    return { device: record, token };
  }
}
