// The Atlas host: owns this computer's projects (the planning folders in its Atlas home) and serves
// them over HTTP and one WebSocket per client. It always listens on 127.0.0.1 (an ephemeral port) for
// the desktop app on this computer, which holds the owner token. When the owner turns remote access
// on, it also listens on one chosen address (this machine, a local network, or Tailscale) for paired
// devices. A paired device belongs to the same person and may do what the app can do here: list,
// create and change the projects, read them, import and export; only the remote-access settings stay
// with the owner, and managing pairings with the devices granted it. Every request is authenticated
// and every method's scope is checked first.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, Server } from 'node:http';
import { isIPv4, isIPv6 } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { createAdaptorServer, type HttpBindings } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { WebSocketServer, type WebSocket } from 'ws';
import { readFile, stat } from 'node:fs/promises';
import {
  adoptPlanningFolder, canonicalProjectFolderSync, createProject, folderKey, HomeDatabase, homePlanningDirectory, homePlanningFolders, isPlanningFolder, planningName, projectOf, projectSummary,
  readRegistry, resolveDocument, scanWorkspace, setProjectWorkspaces, setRegistryName, WorkError, type ProjectRow, type ProjectTemplates,
} from '@envsemble/atlas-planning';
import { AccessStore, newToken } from './access.ts';
import { hostAddresses } from './addresses.ts';
import {
  closeCodes, methodScopes, pairingUrl, protocolVersion, routes,
  type AccessState, type EventName, type Events, type FolderState, type HostDescriptor, type ImportPreviewValue, type MethodName, type Methods,
  type NetworkStatus, type PairResponse, type Project, type ProjectRepository, type ProjectSummary, type Scope, type WorkspaceScan,
} from './contract.ts';
import { HostError, toErrorValue, type Logger } from './errors.ts';
import type { FolderSession } from './folder.ts';
import { FolderRegistry, pathKey } from './folders.ts';
import { ProjectListWatch } from './projectWatch.ts';
import { exportFileName } from './planExportName.ts';
import { PlanWorkerClient, type WorkerLike } from './planWorkerClient.ts';
import { methodParams, pairRequest, ValidationError } from './validate.ts';

export interface HostOptions {
  /**
   * The Atlas home: its database holds the host's identity, paired devices, projects and statistics;
   * its `planning/` folder holds the projects' planning folders.
   */
  home: string;
  version: string;
  log: Logger;
  createPlanWorker(): WorkerLike;
  /** Who runs this host, for messages such as "managed by the Atlas app (process 1234)". */
  owner: string;
  watchDelay?: { debounce: number; maxWait: number };
  idleClose?: number;
  /** The templates new projects are made from (plugin/skills/atlas/assets/planning); without them, projects are not created here. */
  templates?: () => Promise<ProjectTemplates>;
  /** Remote access settings for this process only (`atlas serve --address/--port`), instead of the saved ones. */
  networkOverride?: { address: string; port: number };
  /** The loopback port to try first (the desktop keeps its host's port across restarts); 0 picks one. */
  loopbackPort?: number;
  /** How often connections are checked for life (tests shorten it). */
  heartbeat?: number;
  /** How long a listing for clients may take before the next one goes ahead without it (60 s). */
  listingTimeout?: number;
  /** Milliseconds between checks of the work agents are working on, for the projects' live dots (15 s). */
  liveCheck?: number;
}

interface Credential { scopes: Set<Scope>; deviceId: string | null; label: string }
interface Listener { server: Server; address: string; port: number; local: boolean; sockets: Set<WebSocket> }
interface Held { owner: string; folderId: string; workerToken: string; fileName?: string; expires: number }

const exportLifetime = 10 * 60 * 1000;
/** A plan export sent for import: the largest an export can be (see planExportMaxBytes), with room for its encoding. */
const importLimit = 512 * 1024 * 1024;
/** Prepared exports one client may hold at once; preparing another drops the oldest. */
const exportsPerHolder = 2;
/** Files in documents served over HTTP: images and attachments, never whole archives. */
const fileLimit = 64 * 1024 * 1024;
/**
 * How often the home's planning folder is listed again while it has a new folder that is not a
 * planning folder yet: after a quarter of a second, then twice as long each time, about a minute in all.
 */
const projectLooks = 8;
const securityHeaders = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
const imageTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const loopbackPeer = (address: string | undefined) => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
/** A Host header naming an IP literal or localhost (with a port): never a name that could be re-pointed elsewhere. */
export function acceptableHost(value: string | undefined) {
  if (!value) return false;
  const match = /^(?:\[([0-9a-fA-F:.]+)\]|([^:]+))(?::(\d{1,5}))?$/.exec(value);
  if (!match) return false;
  const host = match[1] ?? match[2];
  return host === 'localhost' || isIPv4(host) || isIPv6(host);
}
const bearer = (header: string | undefined) => /^Bearer (\S{1,200})$/.exec(header ?? '')?.[1] ?? null;
/** A download name for Content-Disposition: plain ASCII, plus the exact UTF-8 name (RFC 6266). */
export function attachment(fileName: string) {
  const ascii = fileName.replace(/[^ -~]/g, '_').replace(/["\\]/g, '_');
  const exact = encodeURIComponent(fileName).replace(/['()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${exact}`;
}

class Connection {
  readonly id = randomBytes(8).toString('hex');
  readonly subscriptions = new Set<string>();
  readonly ws: WebSocket;
  readonly credential: Credential;
  readonly listener: Listener;
  /** Answered since the last check. */
  alive = true;
  /** Checks in a row without an answer; a connection that misses three is ended. */
  missed = 0;
  /** Bytes the connection had sent at the last check, to tell a slow link that drains from a dead one. */
  written = 0;
  /** The connection's socket, whose byte counts show whether a large answer is still moving. */
  raw: { bytesWritten?: number; writableLength?: number } | null = null;
  /** Each folder's subscribe and unsubscribe requests, applied one after another in the order they came. */
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(ws: WebSocket, credential: Credential, listener: Listener) { this.ws = ws; this.credential = credential; this.listener = listener; }
  inOrder<T>(folderId: string, run: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(folderId) ?? Promise.resolve()).then(run);
    const settled = next.catch(() => undefined);
    this.queues.set(folderId, settled);
    void settled.then(() => { if (this.queues.get(folderId) === settled) this.queues.delete(folderId); });
    return next;
  }
  get owner() { return this.credential.scopes.has('owner'); }
  can(scope: Scope) { return this.owner || this.credential.scopes.has(scope); }
  send(message: unknown) { if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(message)); }
}

export class Host {
  readonly ownerToken = newToken();
  readonly database: HomeDatabase;
  readonly access: AccessStore;
  readonly folders: FolderRegistry;
  private readonly options: HostOptions;
  private readonly exports: PlanWorkerClient;
  private readonly connections = new Set<Connection>();
  private readonly held = new Map<string, Held>();
  private readonly websockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  private loopback: Listener | null = null;
  private network: Listener | null = null;
  private networkError: string | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  /** Network changes run one at a time, so overlapping updates cannot leave a listener behind. */
  private networkQueue: Promise<void> = Promise.resolve();
  /** Watches the home's planning folder, where projects appear. */
  private projectsWatcher: ProjectListWatch | null = null;
  /** The projects outside the home that are watched, by folder key. */
  private readonly outsideWatches = new Map<string, ProjectListWatch>();
  /** The listing being sent to clients, and whether another is wanted once it is done. */
  private listing: Promise<void> | null = null;
  private listAgain = false;
  /** The listing whose result may still reach clients. */
  private listingTurn = 0;
  private projectsTimer: ReturnType<typeof setTimeout> | null = null;
  /** Folders in the home's planning folder that are not planning folders, by name, with how often the projects were listed again for them. */
  private readonly unfinishedProjects = new Map<string, number>();
  private projectsLookAgain: ReturnType<typeof setTimeout> | null = null;
  /** Clients preparing an export or reading an import now; each does one at a time. */
  private readonly preparing = new Set<string>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private lockRetry: ReturnType<typeof setInterval> | null = null;
  private retaking = false;
  private stopped = false;

  constructor(options: HostOptions) {
    this.options = options;
    this.database = HomeDatabase.open(options.home);
    this.access = new AccessStore(this.database, options.log, options.owner);
    this.exports = new PlanWorkerClient(options.createPlanWorker);
    this.folders = new FolderRegistry({ key: () => this.access.folderKey, database: this.database, log: options.log, watchDelay: options.watchDelay, idleClose: options.idleClose, onChange: state => this.folderChanged(state) });
  }

  get descriptor(): HostDescriptor { return { protocol: protocolVersion, hostId: this.access.hostId, name: this.access.name, version: this.options.version }; }
  get port() { return this.loopback?.port ?? null; }

  /** Start listening on 127.0.0.1 for this computer, and on the remote access address when it is on. */
  async start(): Promise<{ port: number }> {
    // Manage remote access unless another process does; if one does, take over once it quits.
    if (await this.access.lock() !== null) {
      this.lockRetry = setInterval(() => { void this.retakeLock(); }, 15000);
      this.lockRetry.unref?.();
    }
    this.watchProjects();
    const preferred = this.options.loopbackPort ?? 0;
    this.loopback = await this.listen('127.0.0.1', preferred, true).catch(error => {
      if (!preferred) throw error;
      return this.listen('127.0.0.1', 0, true);
    });
    await this.applyNetwork();
    this.timers.push(setInterval(() => this.expireHeld(), 60000), setInterval(() => this.checkConnections(), this.options.heartbeat ?? 30000),
      setInterval(() => this.checkLiveWork(), this.options.liveCheck ?? 15000));
    for (const timer of this.timers) timer.unref?.();
    this.options.log.info('Host started', { port: this.loopback.port, hostId: this.access.hostId, managedBy: this.access.managedBy });
    return { port: this.loopback.port };
  }

  async stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.lockRetry) clearInterval(this.lockRetry);
    for (const timer of this.timers.splice(0)) clearInterval(timer);
    await this.networkQueue;
    for (const connection of this.connections) connection.ws.close(closeCodes.shuttingDown, 'The host is stopping');
    await Promise.all([this.loopback, this.network].map(listener => listener && this.closeListener(listener)));
    this.loopback = this.network = null;
    this.folders.closeAll();
    this.projectsWatcher?.close();
    for (const watcher of this.outsideWatches.values()) watcher.close();
    this.outsideWatches.clear();
    if (this.projectsTimer) clearTimeout(this.projectsTimer);
    if (this.projectsLookAgain) clearTimeout(this.projectsLookAgain);
    this.held.clear();
    this.exports.stop();
    this.access.clearPairings();
    this.access.unlock();
    this.database.close();
  }

  /** Another process managed remote access when this host started: take over if it has quit. */
  private async retakeLock() {
    if (this.access.managedBy === null || this.stopped || this.retaking) return;
    this.retaking = true;
    try {
      if (await this.access.lock() !== null) return;
      // Stopped while waiting for the lock: let it go again.
      if (this.stopped) { this.access.unlock(); return; }
      if (this.lockRetry) { clearInterval(this.lockRetry); this.lockRetry = null; }
      this.options.log.info('Remote access is managed by this process now');
      await this.applyNetwork();
      this.broadcastAccess();
    } finally { this.retaking = false; }
  }

  /**
   * End connections that stopped answering (a sleeping computer, a dropped network), so both sides
   * notice. Anything received counts as an answer, and a connection still sending a large answer is
   * not judged by a pong queued behind it.
   */
  private checkConnections() {
    for (const connection of this.connections) {
      // Bytes that actually left since the last check, while more wait, mean a slow link, not a dead
      // one. (Node counts queued bytes in bytesWritten, so the queue is taken off.)
      const written = (connection.raw?.bytesWritten ?? 0) - (connection.raw?.writableLength ?? 0);
      const draining = connection.ws.bufferedAmount > 0 && written > connection.written;
      connection.written = written;
      if (draining) connection.alive = true;
      // One missed answer can be a large answer still in flight ahead of the pong: end the
      // connection only after three checks in a row without a sign of life.
      if (connection.alive) connection.missed = 0;
      else if (++connection.missed >= 3) { connection.ws.terminate(); continue; }
      connection.alive = false;
      try { connection.ws.ping(); } catch { /* Closing already. */ }
    }
  }

  // ---- Listeners -------------------------------------------------------------------------------

  private listen(address: string, port: number, local: boolean): Promise<Listener> {
    const listener = { address, port, local, sockets: new Set<WebSocket>() } as Listener;
    const server = createAdaptorServer({ fetch: this.app(listener).fetch, overrideGlobalObjects: false }) as Server;
    listener.server = server;
    server.headersTimeout = 20000;
    // A plan sent for import over a slow link can take many minutes, so the network listener allows
    // a whole request two hours (the app gives an upload one); the routes that take a body also end
    // one that stalls.
    server.requestTimeout = local ? 60000 : 2 * 60 * 60 * 1000;
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => this.upgrade(listener, request, socket, head));
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, address, () => {
        server.off('error', reject);
        server.on('error', error => this.options.log.error('Listener error', { address, error: (error as Error).message }));
        listener.port = (server.address() as { port: number }).port;
        resolve(listener);
      });
    });
  }
  private async closeListener(listener: Listener) {
    for (const socket of listener.sockets) socket.terminate();
    listener.server.closeAllConnections?.();
    await new Promise<void>(resolve => listener.server.close(() => resolve()));
  }

  /** Listen for paired devices on the chosen address, or stop, as the settings say. Changes run one at a time. */
  applyNetwork(): Promise<void> {
    const run = this.networkQueue.then(() => this.applyNetworkNow());
    this.networkQueue = run.catch(() => undefined);
    return run;
  }
  private async applyNetworkNow() {
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    if (this.stopped) return;
    const settings = this.options.networkOverride ? { enabled: true, ...this.options.networkOverride } : this.access.settings.network;
    const wanted = this.access.managedBy === null && settings.enabled && settings.address ? { address: settings.address, port: settings.port } : null;
    if (this.network && (!wanted || this.network.address !== wanted.address || this.network.port !== wanted.port)) {
      const closing = this.network;
      this.network = null;
      for (const connection of [...this.connections]) if (connection.listener === closing) connection.ws.close(closeCodes.shuttingDown, 'Remote access was turned off');
      await this.closeListener(closing);
      this.options.log.info('Remote access stopped', { address: closing.address, port: closing.port });
    }
    // Pairing links lead to the listener; without it they lead nowhere, and they must not work again later.
    if (!this.network || !wanted) this.access.clearPairings();
    this.networkError = null;
    if (wanted && !this.network) {
      try {
        const listener = await this.listen(wanted.address, wanted.port, false);
        if (this.stopped) { await this.closeListener(listener); return; }
        this.network = listener;
        this.options.log.info('Remote access listening', wanted);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        this.networkError = code === 'EADDRINUSE' ? `Port ${wanted.port} is already in use on ${wanted.address}. Choose another port.`
          : code === 'EADDRNOTAVAIL' ? `This computer does not have the address ${wanted.address} right now (is the network or Tailscale connected?). Atlas tries again every 30 seconds.`
          : code === 'EACCES' ? `Atlas may not listen on port ${wanted.port}. Choose a port above 1024.`
          : `Remote access could not start: ${(error as Error).message}`;
        this.options.log.warn('Remote access could not listen', { ...wanted, code });
        // Addresses come and go (Wi-Fi, Tailscale): try again.
        this.retry = setTimeout(() => { void this.applyNetwork().then(() => this.broadcastAccess()); }, 30000);
        this.retry.unref?.();
      }
    }
  }
  networkStatus(): NetworkStatus {
    return { listening: Boolean(this.network), address: this.network?.address ?? null, port: this.network?.port ?? null, error: this.networkError };
  }

  // ---- HTTP ------------------------------------------------------------------------------------

  /** The loopback listener admits only this computer's Atlas app (the owner); the network listener only paired devices. */
  private credential(token: string | null, listener: Listener, peer: string | undefined): Credential | null {
    if (!token) return null;
    if (listener.local) {
      if (!loopbackPeer(peer)) return null;
      const presented = Buffer.from(token);
      const expected = Buffer.from(this.ownerToken);
      return presented.length === expected.length && timingSafeEqual(presented, expected) ? { scopes: new Set(['owner']), deviceId: null, label: 'owner' } : null;
    }
    const device = this.access.deviceForToken(token);
    return device ? { scopes: new Set(device.scopes), deviceId: device.deviceId, label: device.name } : null;
  }

  private app(listener: Listener) {
    const app = new Hono<{ Bindings: HttpBindings }>();
    app.use('*', async (c, next) => {
      // Browsers send Origin: no web page may talk to the host. Host names could be re-pointed (DNS rebinding).
      if (c.req.header('origin') !== undefined) return c.json({ code: 'forbidden', message: 'Browsers may not use the Atlas host.' }, 403, securityHeaders);
      if (!acceptableHost(c.req.header('host'))) return c.json({ code: 'forbidden', message: 'Connect to the host by its address.' }, 421, securityHeaders);
      await next();
      for (const [name, value] of Object.entries(securityHeaders)) c.header(name, value);
      if (!c.res.headers.get('Content-Security-Policy')) c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    });
    app.get(routes.host, c => c.json(this.descriptor));
    app.get('/pair', c => c.html('<!doctype html><meta charset="utf-8"><title>Atlas</title><p>This is an Atlas pairing link. It works in Atlas, not in a browser: in Atlas on the other computer, choose <b>Connect to Another Atlas…</b> in the menu (☰) and paste this link.</p>'));
    app.post(routes.pair, bodyLimit({ maxSize: 4096, onError: c => c.json({ code: 'invalid-argument', message: 'The request is too large.' }, 413) }), async c => {
      // Devices pair over the remote access address, never through the app's own loopback port.
      if (listener.local) return c.json({ code: 'not-found', message: 'Not found.' }, 404);
      let request;
      try { request = pairRequest(await stalls(c.req.json(), bodyStall)); }
      catch { return c.json({ code: 'invalid-argument', message: 'Send a pairing code and this device\'s name.' }, 400); }
      try {
        const { device, token } = this.access.pair(request.code, request.device, c.env.incoming.socket.remoteAddress ?? 'unknown');
        this.options.log.info('Paired over', { address: listener.address, peer: c.env.incoming.socket.remoteAddress });
        this.broadcastAccess();
        const response: PairResponse = { hostId: this.access.hostId, name: this.access.name, deviceId: device.deviceId, token, scopes: device.scopes };
        return c.json(response);
      } catch (error) {
        const { value } = toErrorValue(error);
        return c.json(value, value.code === 'unauthorized' ? 401 : value.code === 'unavailable' ? 429 : 400);
      }
    });
    app.get(routes.files, c => this.serveFile(c, listener));
    app.post(routes.imports, c => this.receiveImport(c, listener));
    app.get(routes.exports, c => this.serveExport(c, listener));
    app.notFound(c => c.json({ code: 'not-found', message: 'Not found.' }, 404));
    app.onError((error, c) => { this.options.log.error('Request failed', error); return c.json({ code: 'internal', message: 'The host could not answer.' }, 500); });
    return app;
  }

  private authorize(c: Context<{ Bindings: HttpBindings }>, listener: Listener) {
    return this.credential(bearer(c.req.header('authorization')), listener, c.env.incoming.socket.remoteAddress);
  }

  private async serveFile(c: Context<{ Bindings: HttpBindings }>, listener: Listener) {
    const credential = this.authorize(c, listener);
    if (!credential) return c.json({ code: 'unauthorized', message: 'Pair with this host first.' }, 401);
    const folderId = c.req.param('folderId') ?? '';
    try {
      let relative: string;
      try { relative = decodeURIComponent(c.req.path.replace(/^\/api\/folders\/[^/]+\/files\//, '')); }
      catch { return c.json({ code: 'invalid-argument', message: 'This file path is not valid.' }, 400); }
      const folder = await this.accessibleFolder(credential, folderId);
      const file = await resolveDocument(folder.root, relative);
      if ((await stat(file)).size > fileLimit) return c.json({ code: 'unavailable', message: 'This file is too large to show here.' }, 413);
      const type = imageTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      return c.body(new Uint8Array(await readFile(file)), 200, { 'Content-Type': type, 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" });
    } catch (error) {
      const status = (error as { status?: number }).status;
      const { value } = toErrorValue(error);
      return c.json(value, status === 403 || value.code === 'forbidden' ? 403 : 404);
    }
  }

  private async serveExport(c: Context<{ Bindings: HttpBindings }>, listener: Listener) {
    const credential = this.authorize(c, listener);
    if (!credential) return c.json({ code: 'unauthorized', message: 'Pair with this host first.' }, 401);
    const token = c.req.param('token') ?? '';
    const held = this.held.get(token);
    if (!held || held.owner !== this.holder(credential) || !held.fileName) return c.json({ code: 'not-found', message: 'This export is no longer available. Export the plan again.' }, 404);
    this.held.delete(token);
    const html = await this.exports.take(held.workerToken);
    return c.body(html, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': attachment(held.fileName), 'Content-Security-Policy': 'sandbox' });
  }

  /**
   * A plan export sent from another computer, to import into a planning folder here: kept in a
   * private temporary file while the worker reads it, then removed. Answers with the preview; the
   * import itself is confirmed over the connection (plan.importConfirm), as for a local file.
   */
  private async receiveImport(c: Context<{ Bindings: HttpBindings }>, listener: Listener) {
    const credential = this.authorize(c, listener);
    if (!credential) return c.json({ code: 'unauthorized', message: 'Pair with this host first.' }, 401);
    if (!credential.scopes.has('owner') && !credential.scopes.has('computer')) return c.json({ code: 'forbidden', message: 'This device may not do this.' }, 403);
    const declared = Number(c.req.header('content-length') ?? NaN);
    if (declared > importLimit) return c.json({ code: 'invalid-argument', message: 'This file is too large to be a plan export.' }, 413);
    const holder = 'import:' + this.holder(credential);
    if (this.preparing.has(holder)) return c.json({ code: 'unavailable', message: 'Another plan is being read. Try again when it is done.' }, 429);
    this.preparing.add(holder);
    const file = path.join(tmpdir(), 'atlas-import-' + process.pid + '-' + randomBytes(8).toString('hex') + '.html');
    try {
      const folder = await this.accessibleFolder(credential, c.req.param('folderId') ?? '');
      const body = c.req.raw.body;
      if (!body) return c.json({ code: 'invalid-argument', message: 'Send the plan export file.' }, 400);
      const handle = await open(file, 'wx', 0o600);
      const reader = body.getReader();
      let size = 0;
      try {
        // However slow the link, the file must keep arriving: a minute without data ends the upload.
        const stalled = 'The plan stopped arriving. Send it again.';
        for (let next = await stalls(reader.read(), bodyStall, stalled); !next.done; next = await stalls(reader.read(), bodyStall, stalled)) {
          size += next.value.byteLength;
          if (size > importLimit) return c.json({ code: 'invalid-argument', message: 'This file is too large to be a plan export.' }, 413);
          await handle.write(next.value);
        }
      } finally {
        await handle.close();
        void reader.cancel().catch(() => undefined);
      }
      return c.json(await this.readImport(folder, file, holder.slice('import:'.length)));
    } catch (error) {
      const { value, expected } = toErrorValue(error);
      if (!expected) {
        // A device that stops sending (its user cancelled, or it went offline) is not a host failure.
        const ended = /terminated|aborted|ECONNRESET/i.test(String((error as Error).message) + String((error as NodeJS.ErrnoException).code));
        if (ended) this.options.log.info('Plan upload ended early', { message: (error as Error).message }); else this.options.log.error('Plan upload failed', error);
      }
      return c.json(value, value.code === 'forbidden' ? 403 : value.code === 'not-found' ? 404 : 400);
    } finally {
      this.preparing.delete(holder);
      await rm(file, { force: true }).catch(() => undefined);
    }
  }
  /** Read a plan export for import into a folder; the preview is held for its reader until confirmed. */
  private async readImport(folder: FolderSession, file: string, owner: string): Promise<ImportPreviewValue> {
    const read = await this.exports.read(folder.root, file);
    const token = randomBytes(16).toString('hex');
    this.held.set(token, { owner, folderId: folder.state().folderId, workerToken: read.token, expires: Date.now() + 30 * 60000 });
    const { manifest, files, totalBytes, diagrams } = read.preview;
    return {
      token, title: manifest.source.title, originalId: manifest.source.workId, origin: manifest.source.planningFolder, location: manifest.source.location,
      exportedAt: manifest.exportedAt, atlasVersion: manifest.atlasVersion, newId: read.target.workId, newFolder: read.target.path,
      files: files.length, bytes: totalBytes, diagrams: diagrams.map(item => item.title),
    };
  }

  // ---- WebSocket RPC ---------------------------------------------------------------------------

  private upgrade(listener: Listener, request: IncomingMessage, socket: Duplex, head: Buffer) {
    const refuse = (status: number, text: string) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (new URL(request.url ?? '/', 'http://host').pathname !== routes.connect) return refuse(404, 'Not Found');
    if (request.headers.origin !== undefined) return refuse(403, 'Forbidden');
    if (!acceptableHost(request.headers.host)) return refuse(421, 'Misdirected Request');
    const credential = this.credential(bearer(request.headers.authorization), listener, request.socket.remoteAddress);
    if (!credential) return refuse(401, 'Unauthorized');
    this.websockets.handleUpgrade(request, socket, head, ws => this.connected(ws, credential, listener, socket));
  }

  private connected(ws: WebSocket, credential: Credential, listener: Listener, socket: Duplex) {
    const connection = new Connection(ws, credential, listener);
    connection.raw = socket as unknown as { bytesWritten?: number; writableLength?: number };
    // Any bytes from the client, such as the rest of a large request, show it is alive.
    socket.on('data', () => { connection.alive = true; });
    this.connections.add(connection);
    listener.sockets.add(ws);
    if (credential.deviceId) this.access.seen(credential.deviceId);
    this.options.log.info('Client connected', { client: credential.deviceId ? 'device' : 'owner', deviceId: credential.deviceId, address: listener.address });
    if (credential.deviceId) this.broadcastAccess();
    ws.on('pong', () => { connection.alive = true; });
    ws.on('message', (data, binary) => {
      if (binary) { ws.close(closeCodes.protocol, 'Send JSON text'); return; }
      void this.message(connection, data.toString());
    });
    ws.on('close', () => {
      this.connections.delete(connection);
      listener.sockets.delete(ws);
      for (const folderId of connection.subscriptions) this.folders.release(folderId);
      for (const [token, held] of this.held) if (held.owner === connection.id || (held.owner === this.holder(credential) && !this.connectedHolder(held.owner))) { this.held.delete(token); void this.exports.drop(held.workerToken).catch(() => undefined); }
      if (credential.deviceId) this.broadcastAccess();
    });
    ws.on('error', error => this.options.log.warn('Connection error', { message: error.message }));
  }
  private connectedHolder(holder: string) { return [...this.connections].some(connection => this.holder(connection.credential) === holder); }
  /** Who an export or import belongs to: the owner, or one paired device. */
  private holder(credential: Credential) { return credential.deviceId ?? 'owner'; }

  private async message(connection: Connection, text: string) {
    let id = 0;
    try {
      let envelope: unknown;
      try { envelope = JSON.parse(text); } catch { throw new ValidationError('A request must be JSON.'); }
      const request = envelope as { id?: unknown; method?: unknown; params?: unknown };
      if (!request || typeof request !== 'object' || !Number.isSafeInteger(request.id) || (request.id as number) < 1) { connection.ws.close(closeCodes.protocol, 'Requests need a positive integer id'); return; }
      id = request.id as number;
      if (typeof request.method !== 'string' || !Object.hasOwn(methodScopes, request.method)) throw new HostError('not-found', 'This host does not know that request.');
      const method = request.method as MethodName;
      if (!connection.can(methodScopes[method])) {
        throw new HostError('forbidden', methodScopes[method] === 'owner' ? (method.startsWith('access.') ? `Only the Atlas app on ${this.access.name} may change its remote access settings.` : `Only the Atlas app on ${this.access.name} may do this.`)
          : methodScopes[method] === 'access:manage' ? `This device may not manage access to ${this.access.name}. Pair it again with Manage access to pair and revoke devices from it.`
          : 'This device may not do this.');
      }
      const params = methodParams[method](request.params ?? {}, 'params');
      const value = await this.handle(connection, method, params as never);
      connection.send({ id, ok: true, value: value ?? null });
    } catch (error) {
      const { value, expected } = toErrorValue(error instanceof ValidationError ? new HostError('invalid-argument', error.message) : error);
      if (!expected) this.options.log.error('Request failed', error);
      connection.send({ id, ok: false, error: value });
    }
  }

  private event<E extends EventName>(connection: Connection, event: E, data: Events[E]) { connection.send({ event, data }); }
  private folderChanged(state: FolderState) {
    for (const connection of this.connections) if (connection.subscriptions.has(state.folderId)) this.event(connection, 'folder.changed', state);
    // A project's name lives in its planning.json.
    this.projectsChanged();
  }
  /** Remote access changed: tell the connections that may manage it. */
  private broadcastAccess() {
    const managers = [...this.connections].filter(connection => connection.can('access:manage'));
    if (!managers.length) return;
    void this.accessState().then(state => { for (const connection of managers) this.event(connection, 'access.changed', state); }).catch(() => undefined);
  }
  /** The projects changed (or may have): every client sees them, once the changes settle. */
  private projectsChanged() {
    if (this.projectsTimer || this.stopped) return;
    this.projectsTimer = setTimeout(() => {
      this.projectsTimer = null;
      if (!this.connections.size || this.stopped) return;
      // One listing at a time, so an older and slower one never reaches clients after a newer one.
      // One that hangs (a project on an unreachable share) is given up after a while: the queue moves
      // on, and its late result is dropped.
      if (this.listing) { this.listAgain = true; return; }
      const turn = ++this.listingTurn;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const run = this.projects(true).then(projects => { if (!this.stopped && turn === this.listingTurn) for (const connection of this.connections) this.event(connection, 'projects.changed', { projects }); }).catch(() => undefined)
        .then(() => turn === this.listingTurn ? this.lookForUnfinishedProjects() : undefined);
      const late = new Promise<void>(resolve => { timer = setTimeout(resolve, this.options.listingTimeout ?? 60_000); timer.unref?.(); });
      this.listing = Promise.race([run, late]).finally(() => {
        clearTimeout(timer);
        this.listingTurn++;
        this.listing = null;
        if (this.listAgain) { this.listAgain = false; this.projectsChanged(); }
      });
    }, 300);
    this.projectsTimer.unref?.();
  }
  /**
   * A folder appearing in the home is often a project being made, whose planning.json comes a moment
   * later, and a change inside a folder does not reach the watcher everywhere. While the home has a
   * new folder that is not a planning folder, list the projects again, less often each time, a
   * bounded number of times. Folders there when watching starts are not waited for (`settled`).
   */
  private async lookForUnfinishedProjects(settled = false) {
    const base = homePlanningDirectory(this.options.home);
    const unfinished = new Set<string>();
    for (const entry of await readdir(base, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !await isPlanningFolder(path.join(base, entry.name))) unfinished.add(entry.name);
    }
    for (const name of this.unfinishedProjects.keys()) if (!unfinished.has(name)) this.unfinishedProjects.delete(name);
    let fewest = projectLooks;
    for (const name of unfinished) {
      const looks = settled ? projectLooks : this.unfinishedProjects.get(name) ?? 0;
      this.unfinishedProjects.set(name, Math.min(projectLooks, looks + 1));
      fewest = Math.min(fewest, looks);
    }
    if (fewest >= projectLooks || this.projectsLookAgain || this.stopped) return;
    this.projectsLookAgain = setTimeout(() => { this.projectsLookAgain = null; this.projectsChanged(); }, 250 * 2 ** fewest);
    this.projectsLookAgain.unref?.();
  }
  /**
   * Watch the home's planning folder for what the project list shows (see projectWatch.ts), whether
   * or not a window has a project open. Projects outside the home are watched as they are listed.
   */
  private watchProjects() {
    this.projectsWatcher = new ProjectListWatch(homePlanningDirectory(this.options.home), true, { log: this.options.log, changed: () => this.projectsChanged() });
    void mkdir(homePlanningDirectory(this.options.home), { recursive: true }).then(() => this.lookForUnfinishedProjects(true), () => undefined);
  }
  /** Watch the listed active projects outside the home, and stop watching the rest. */
  private watchOutsideProjects(rows: ProjectRow[]) {
    if (this.stopped) return;
    // Only active ones: on Windows a watched folder, and the folders above it, cannot be renamed while
    // it is watched, so a hidden or archived project's folder is left free.
    const wanted = new Map(rows.filter(row => row.state === 'active' && !this.inHome(row.folder)).map(row => [folderKey(row.folder), row.folder]));
    for (const [key, watcher] of this.outsideWatches) if (!wanted.has(key)) { watcher.close(); this.outsideWatches.delete(key); }
    for (const [key, folder] of wanted) if (!this.outsideWatches.has(key)) this.outsideWatches.set(key, new ProjectListWatch(folder, false, { log: this.options.log, changed: () => this.projectsChanged() }));
  }

  // ---- Folders and access ----------------------------------------------------------------------

  // ---- Projects --------------------------------------------------------------------------------

  /** A project as clients see it, by the ID of its folder, with the workspace folders its planning.json lists. */
  private async project(row: ProjectRow): Promise<Project> {
    const workspaces = (await readRegistry(row.folder).catch(() => null))?.workspaces ?? [];
    return { folderId: this.folders.idOf(row.folder), name: row.name, path: row.folder, position: row.position, state: row.state, outsideHome: !this.inHome(row.folder), workspaces };
  }
  /** Whether a project's folder is one of the home's planning folders. */
  private inHome(folder: string) {
    return folderKey(path.dirname(folder)) === folderKey(canonicalProjectFolderSync(homePlanningDirectory(this.options.home)));
  }
  /**
   * The computer's projects in their order: every planning folder in the home is one (a folder that
   * appears becomes the last), with its name read again from its planning.json; projects whose
   * folder is no longer a planning folder are left out. Projects outside the home (from before it)
   * are listed too, marked, until they are moved in. The list clients show has each project's summary.
   */
  async projects(summaries = false): Promise<Project[]> {
    for (const folder of await homePlanningFolders(this.options.home)) await projectOf(this.database, folder);
    const listed: ProjectRow[] = [];
    for (const row of this.database.projects()) {
      if (!await isPlanningFolder(row.folder)) continue;
      const name = await planningName(row.folder);
      if (name !== row.name) this.database.updateProject(row.id, { name });
      listed.push({ ...row, name });
    }
    this.watchOutsideProjects(listed);
    if (!summaries) return Promise.all(listed.map(row => this.project(row)));
    const live = this.readLiveWork();
    return Promise.all(listed.map(async row => ({ ...await this.project(row), summary: await this.summaryOf(row, live.get(row.id) ?? []) })));
  }
  /** What the hub shows of a project's plans: from its planning folder, with the work agents are working on now. */
  private async summaryOf(row: ProjectRow, live: ProjectSummary['live']): Promise<ProjectSummary | null> {
    try { return { ...await projectSummary(row.folder), live }; } catch { return null; }
  }
  /** The work agents are working on now, by project row, as the hooks record it; none when it cannot be read. */
  private readLiveWork() {
    try { return this.database.liveWork(); } catch { return new Map<number, ProjectSummary['live']>(); }
  }
  /** The work agents are working on, as last told to clients: when it changes, the projects are told again. */
  private liveKey = '';
  private checkLiveWork() {
    const key = JSON.stringify([...this.readLiveWork()].map(([project, work]) => [project, work.map(item => item.workId)]));
    if (key === this.liveKey) return;
    this.liveKey = key;
    this.projectsChanged();
  }
  /** A project by its folder's ID. */
  private async projectRow(folderId: string): Promise<ProjectRow> {
    await this.projects();
    const row = this.database.projects().find(entry => this.folders.idOf(entry.folder) === folderId);
    if (!row) throw new HostError('not-found', `This project is not on ${this.access.name}.`);
    return row;
  }
  /** The path of a folder by its ID: one this process opened, or a project's. */
  private async pathOf(folderId: string): Promise<string | null> {
    return this.folders.pathOf(folderId) ?? (await this.projectRow(folderId).catch(() => null))?.folder ?? null;
  }
  private async createProject(params: Methods['projects.create']['params']): Promise<Project> {
    if (!this.options.templates) throw new HostError('unavailable', `New projects cannot be created on ${this.access.name} by this Atlas.`);
    try {
      const row = await createProject(this.database, params, await this.options.templates());
      this.options.log.info('Project created', { folder: row.folder });
      if (row.skipped.length) this.options.log.warn('Checkouts skipped in the workspace folders', { skipped: row.skipped });
      this.projectsChanged();
      return this.project(row);
    } catch (error) { throw error instanceof WorkError ? new HostError('invalid-argument', error.message) : error; }
  }
  /** Refuse a request only the app on this computer may make, before it touches any path. */
  private ownerOnly(connection: Connection, what: string) {
    if (!connection.owner) throw new HostError('forbidden', `Only the Atlas app on ${this.access.name} may ${what}.`);
  }
  /** The Git checkouts in a folder, as a new project would register them. */
  private async scanFolder(folder: string): Promise<WorkspaceScan> {
    try {
      const scan = await scanWorkspace(folder);
      if (scan.skipped.length) this.options.log.warn('Checkouts skipped in a folder', { skipped: scan.skipped });
      return { folder: scan.folder, repositories: scan.repositories.map(({ id, name, remote }): ProjectRepository => ({ id, name, remote })) };
    } catch (error) { throw error instanceof WorkError ? new HostError('invalid-argument', error.message) : error; }
  }
  private async updateProject(params: Methods['projects.update']['params']): Promise<Project> {
    const row = await this.projectRow(params.folderId);
    // The workspace folders first: when they are refused, nothing has changed.
    if (params.workspaces !== undefined) {
      try {
        const { added, skipped } = await setProjectWorkspaces(row.folder, params.workspaces);
        this.options.log.info('Project folders set', { folder: row.folder, workspaces: params.workspaces.length, repositories: added.length });
        if (skipped.length) this.options.log.warn('Checkouts skipped in the workspace folders', { skipped });
      } catch (error) { throw error instanceof WorkError ? new HostError('invalid-argument', error.message) : error; }
    }
    if (params.name !== undefined && params.name !== row.name) {
      const file = path.join(row.folder, 'planning.json');
      try { await writeFile(file, setRegistryName(await readFile(file, 'utf8'), params.name)); }
      catch (error) { throw new HostError('unavailable', `The project could not be renamed: ${(error as Error).message}`); }
    }
    this.database.updateProject(row.id, { name: params.name, state: params.state, position: params.position });
    this.projectsChanged();
    return this.project(this.database.project(row.id)!);
  }

  /**
   * Move a project outside the home into it (as `atlas home adopt` does, with its statistics), under
   * its folder's name or the first free name after it. Its folder closes here first, as an open
   * watcher would keep it from moving; clients follow it again under its new folder ID, or keep
   * following it when it could not move.
   */
  private async adoptProject(folderId: string): Promise<Project> {
    const row = await this.projectRow(folderId);
    if (this.inHome(row.folder)) throw new HostError('invalid-argument', 'This project is in the Atlas home already.');
    const base = path.basename(row.folder).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 90) || 'project';
    let name = base;
    // A name another project (its folder gone) was last at stays its own.
    const taken = (folder: string) => this.database.projectByFolder(folder) !== null || stat(folder).then(() => true, () => false);
    for (let number = 2; await taken(path.join(homePlanningDirectory(this.options.home), name)); number++) name = base + '-' + number;
    const subscribers = [...this.connections].filter(connection => connection.subscriptions.delete(folderId));
    this.folders.forget(folderId);
    try {
      const adopted = await adoptPlanningFolder(row.folder, { home: this.options.home, name });
      this.options.log.info('Project moved into the home', { from: adopted.from, to: adopted.to, reports: adopted.statistics.reports });
    } catch (error) {
      // A folder that did not move opens again for the clients that followed it.
      if (await stat(row.folder).then(() => true, () => false)) {
        await this.folders.open(row.folder).catch(() => undefined);
        for (const connection of subscribers) {
          if (!this.connections.has(connection) || !this.folders.has(folderId) || connection.subscriptions.has(folderId)) continue;
          this.folders.acquire(folderId);
          connection.subscriptions.add(folderId);
        }
      }
      throw error instanceof WorkError ? new HostError('invalid-argument', error.message) : error;
    } finally { this.projectsChanged(); }
    const moved = (await this.projects()).find(project => this.database.projectByFolder(project.path)?.id === row.id);
    if (!moved) throw new HostError('not-found', 'The project moved, but is no longer listed.');
    return moved;
  }

  /**
   * Open a folder by its ID: one that is open, one this process opened before, or a project's. A
   * device reaches planning folders only, so their files are all a device can read.
   */
  private async accessibleFolder(credential: Credential, folderId: string): Promise<FolderSession> {
    let folder: FolderSession;
    if (this.folders.has(folderId)) folder = this.folders.get(folderId);
    else {
      const root = await this.pathOf(folderId);
      if (!root) throw new HostError('not-found', `This project is not on ${this.access.name}.`);
      folder = await this.folders.open(root);
    }
    if (!credential.scopes.has('owner') && !await isPlanningFolder(folder.root)) throw new HostError('forbidden', 'Only planning folders open on another device.');
    return folder;
  }
  /** A folder the connection subscribed to. */
  private subscribed(connection: Connection, folderId: string): FolderSession {
    if (!connection.subscriptions.has(folderId)) throw new HostError('forbidden', 'Open this planning folder first.');
    return this.folders.get(folderId);
  }

  async accessState(): Promise<AccessState> {
    // Another process managed remote access: take over if it has quit, else show what it saved.
    if (this.access.managedBy !== null && !this.stopped) {
      this.access.reload();
      await this.retakeLock();
    }
    const settings = this.access.settings;
    if (this.options.networkOverride) settings.network = { enabled: true, ...this.options.networkOverride };
    return { settings, status: this.networkStatus(), addresses: await hostAddresses(), managedBy: this.access.problem ? null : this.access.managedBy, problem: this.access.problem };
  }

  private async handle<M extends MethodName>(connection: Connection, method: M, params: Methods[M]['params']): Promise<Methods[M]['result']> {
    const p = params as Record<string, unknown>;
    switch (method) {
      case 'host.session':
        return { ...this.descriptor, scopes: [...connection.credential.scopes], deviceId: connection.credential.deviceId } as never;
      case 'projects.list': return this.projects(true) as never;
      // Workspace folders are paths on this computer, which it scans: the app's to choose, like projects.scan.
      case 'projects.create': {
        const params = p as Methods['projects.create']['params'];
        if (params.workspaces?.length) this.ownerOnly(connection, 'choose the folders a project covers');
        return this.createProject(params) as never;
      }
      case 'projects.scan': return this.scanFolder((p as Methods['projects.scan']['params']).folder) as never;
      case 'projects.update': {
        const params = p as Methods['projects.update']['params'];
        if (params.workspaces !== undefined) this.ownerOnly(connection, 'choose the folders a project covers');
        return this.updateProject(params) as never;
      }
      case 'projects.adopt': return this.adoptProject((p as { folderId: string }).folderId) as never;
      case 'folders.subscribe': {
        const { folderId } = p as { folderId: string };
        return connection.inOrder(folderId, async () => {
          const folder = await this.accessibleFolder(connection.credential, folderId);
          // Opening can take a while: the connection may have gone since.
          if (!this.connections.has(connection)) throw new HostError('cancelled', 'The connection closed.');
          if (!connection.subscriptions.has(folderId)) { this.folders.acquire(folderId); connection.subscriptions.add(folderId); }
          return folder.state();
        }) as never;
      }
      case 'folders.unsubscribe': {
        const { folderId } = p as { folderId: string };
        // After a subscribe still opening the folder, which it undoes.
        await connection.inOrder(folderId, async () => { if (connection.subscriptions.delete(folderId)) this.folders.release(folderId); });
        return null as never;
      }
      case 'folder.snapshot': return this.subscribed(connection, (p as { folderId: string }).folderId).snapshot() as never;
      case 'folder.document': { const { folderId, path: file } = p as { folderId: string; path: string }; return this.subscribed(connection, folderId).document(file) as never; }
      case 'folder.diagrams': { const { folderId, work } = p as { folderId: string; work: string }; return this.subscribed(connection, folderId).diagrams(work) as never; }
      case 'folder.diagram': { const { folderId, work, path: file } = p as { folderId: string; work: string; path: string }; return this.subscribed(connection, folderId).diagram(work, file) as never; }
      case 'folder.references': { const { folderId, work, path: file } = p as { folderId: string; work: string | null; path: string }; return this.subscribed(connection, folderId).references(work, file) as never; }
      case 'folder.diagramIndex': return this.subscribed(connection, (p as { folderId: string }).folderId).diagramIndex() as never;
      case 'folder.recordView': { const { folderId, event } = p as unknown as Methods['folder.recordView']['params']; await this.subscribed(connection, folderId).recordView(event); return null as never; }
      case 'plan.exportPrepare': {
        const { folderId, work } = p as { folderId: string; work: string };
        const folder = this.subscribed(connection, folderId);
        const item = folder.snapshot().work.find(entry => entry.id === work);
        if (!item) throw new HostError('not-found', 'This work item is not in the planning folder.');
        // Exports are large and held in memory: a device prepares one at a time and holds a few. The
        // owner (this computer's app, with a save dialog per window) is not limited.
        const holder = this.holder(connection.credential);
        if (!connection.owner) {
          if (this.preparing.has(holder)) throw new HostError('unavailable', 'Another plan export is being prepared. Try again when it is done.');
          const mine = [...this.held].filter(([, held]) => held.owner === holder && held.fileName).sort((a, b) => a[1].expires - b[1].expires);
          for (const [stale, held] of mine.slice(0, Math.max(0, mine.length - exportsPerHolder + 1))) { this.held.delete(stale); void this.exports.drop(held.workerToken).catch(() => undefined); }
        }
        if (!connection.owner) this.preparing.add(holder);
        let prepared;
        try { prepared = await this.exports.prepare(folder.root, work); }
        finally { if (!connection.owner) this.preparing.delete(holder); }
        const token = randomBytes(16).toString('hex');
        const fileName = exportFileName(item.path, item.id);
        this.held.set(token, { owner: holder, folderId, workerToken: prepared.token, fileName, expires: Date.now() + exportLifetime });
        return { token, bytes: prepared.bytes, warnings: prepared.warnings, fileName } as never;
      }
      case 'plan.exportDrop':
      case 'plan.importDrop': {
        const { token } = p as { token: string };
        const held = this.held.get(token);
        if (held && (held.owner === this.holder(connection.credential) || held.owner === connection.id)) { this.held.delete(token); await this.exports.drop(held.workerToken).catch(() => undefined); }
        return null as never;
      }
      case 'plan.importRead': {
        // A file on this computer; another computer sends its file to routes.imports instead.
        const { folderId, file } = p as { folderId: string; file: string };
        return this.readImport(this.subscribed(connection, folderId), file, connection.id) as never;
      }
      case 'plan.importConfirm': {
        const { folderId, token } = p as { folderId: string; token: string };
        const held = this.held.get(token);
        // A preview belongs to the connection that read it, or to the device that sent its file.
        const mine = held && (held.owner === connection.id || held.owner === this.holder(connection.credential));
        if (!held || !mine || held.folderId !== folderId || held.expires < Date.now()) throw new HostError('invalid-argument', 'This import preview expired. Choose the file again.');
        this.held.delete(token);
        const folder = this.subscribed(connection, folderId);
        try {
          const result = await this.exports.import(folder.root, held.workerToken);
          this.options.log.info('Plan imported', { workId: result.workId, files: result.files });
          return { workId: result.workId, path: result.path, files: result.files, notes: result.notes } as never;
        } finally { await folder.reload(); }
      }
      case 'access.state': return this.accessState() as never;
      case 'access.update': {
        const { settings } = p as unknown as Methods['access.update']['params'];
        this.access.updateSettings({ network: settings.network });
        await this.applyNetwork();
        const state = await this.accessState();
        this.broadcastAccess();
        return state as never;
      }
      case 'access.pairingCreate': {
        const { address, label, manageAccess } = p as unknown as Methods['access.pairingCreate']['params'];
        return this.createPairing(address, { label, manageAccess }) as never;
      }
      case 'access.pairingRevoke': this.access.revokePairing((p as { code: string }).code); return null as never;
      case 'access.devices': return this.devices() as never;
      case 'access.deviceRevoke': this.revokeDevice((p as { deviceId: string }).deviceId); return null as never;
    }
    throw new HostError('not-found', 'This host does not know that request.');
  }

  /** A one-time pairing link for a device: the whole computer, and Manage access if granted. */
  createPairing(address: string | null, grant: { label: string | null; manageAccess: boolean }): Methods['access.pairingCreate']['result'] {
    const status = this.networkStatus();
    if (!status.listening) throw new HostError('unavailable', 'Turn on remote access first, so other devices can reach this computer.');
    const pairing = this.access.createPairing(address ?? status.address, grant);
    const host = pairing.address ?? status.address!;
    return { code: pairing.code, expiresAt: new Date(pairing.expiresAt).toISOString(), url: pairingUrl(host, status.port!, pairing.code), address: host, port: status.port, label: pairing.label, manageAccess: pairing.manageAccess };
  }

  /** Paired devices, with whether each is connected now. */
  devices() {
    return this.access.devices(new Set([...this.connections].flatMap(other => other.credential.deviceId ? [other.credential.deviceId] : [])));
  }
  /** Remove a paired device and close its connections at once. */
  revokeDevice(deviceId: string) {
    this.access.revokeDevice(deviceId);
    for (const other of this.connections) if (other.credential.deviceId === deviceId) other.ws.close(closeCodes.revoked, 'Access was revoked');
    this.options.log.info('Device revoked', { deviceId });
    this.broadcastAccess();
  }

  private expireHeld() {
    const now = Date.now();
    for (const [token, held] of this.held) if (held.expires < now) { this.held.delete(token); void this.exports.drop(held.workerToken).catch(() => undefined); }
  }
}

/** Compare two folder paths as this platform does. */
export const sameFolder = (a: string, b: string) => pathKey(a) === pathKey(b);
/** Whether a folder has a planning.json (it may still be unreadable; the folder then explains why). */
/** How long a request body may stall. */
const bodyStall = 60000;
/** A promise that fails when it takes longer than `limit`. */
function stalls<T>(pending: Promise<T>, limit: number, message = 'This took too long.'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new HostError('unavailable', message)), limit); });
  return Promise.race([pending, late]).finally(() => clearTimeout(timer));
}
