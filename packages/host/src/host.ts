// The Atlas host: owns the planning folders and serves them over HTTP and one WebSocket per client.
// It always listens on 127.0.0.1 (an ephemeral port) for the desktop app on this computer, which
// holds the owner token. When the owner turns remote access on, it also listens on one chosen
// address (this machine, a local network, or Tailscale) for paired devices, which hold read-only
// device tokens. Every request is authenticated and every method's scope is checked first.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { isIPv4, isIPv6 } from 'node:net';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { createAdaptorServer, type HttpBindings } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { WebSocketServer, type WebSocket } from 'ws';
import { readFile } from 'node:fs/promises';
import { resolveDocument } from '@envsemble/atlas-planning';
import { AccessStore, newToken } from './access.ts';
import { hostAddresses } from './addresses.ts';
import {
  closeCodes, methodScopes, pairingUrl, protocolVersion, routes,
  type AccessState, type EventName, type Events, type FolderState, type HostDescriptor, type MethodName, type Methods,
  type NetworkStatus, type PairResponse, type Scope, type SharedFolder,
} from './contract.ts';
import { HostError, toErrorValue, type Logger } from './errors.ts';
import type { FolderSession } from './folder.ts';
import { canonicalFolder, folderIdOf, FolderRegistry, pathKey } from './folders.ts';
import { exportFileName } from './planExportName.ts';
import { PlanWorkerClient, type WorkerLike } from './planWorkerClient.ts';
import { methodParams, pairRequest, ValidationError } from './validate.ts';

export interface HostOptions {
  /** The Atlas data folder; the host keeps its identity and paired devices in its `host/` folder. */
  dataDirectory: string;
  version: string;
  log: Logger;
  createPlanWorker(): WorkerLike;
  /** Who runs this host, for messages such as "managed by the Atlas app (process 1234)". */
  owner: string;
  /** Overrides where usage statistics are kept (tests). */
  dataBase?: string;
  watchDelay?: { debounce: number; maxWait: number };
  idleClose?: number;
  /** Folders shared by this process only (`atlas serve --folder`), besides the saved ones. */
  extraShared?: string[];
  /** Remote access settings for this process only (`atlas serve --address/--port`), instead of the saved ones. */
  networkOverride?: { address: string; port: number };
  /** The loopback port to try first (the desktop keeps its host's port across restarts); 0 picks one. */
  loopbackPort?: number;
}

interface Credential { scopes: Set<Scope>; deviceId: string | null; label: string }
interface Listener { server: Server; address: string; port: number; local: boolean; sockets: Set<WebSocket> }
interface Held { owner: string; folderId: string; workerToken: string; fileName?: string; expires: number }

const exportLifetime = 10 * 60 * 1000;
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

class Connection {
  readonly id = randomBytes(8).toString('hex');
  readonly subscriptions = new Set<string>();
  readonly ws: WebSocket;
  readonly credential: Credential;
  readonly listener: Listener;
  constructor(ws: WebSocket, credential: Credential, listener: Listener) { this.ws = ws; this.credential = credential; this.listener = listener; }
  get owner() { return this.credential.scopes.has('owner'); }
  can(scope: Scope) { return this.owner || this.credential.scopes.has(scope); }
  send(message: unknown) { if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(message)); }
}

export class Host {
  readonly ownerToken = newToken();
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
  private readonly extraShared: string[];
  private stopped = false;

  constructor(options: HostOptions) {
    this.options = options;
    this.access = new AccessStore(path.join(options.dataDirectory, 'host'), options.log, options.owner);
    this.exports = new PlanWorkerClient(options.createPlanWorker);
    this.extraShared = options.extraShared ?? [];
    this.folders = new FolderRegistry({ dataBase: options.dataBase, log: options.log, watchDelay: options.watchDelay, idleClose: options.idleClose, onChange: state => this.folderChanged(state) });
    setInterval(() => this.expireHeld(), 60000).unref();
  }

  get descriptor(): HostDescriptor { return { protocol: protocolVersion, hostId: this.access.hostId, name: this.access.name, version: this.options.version }; }
  get port() { return this.loopback?.port ?? null; }

  /** Start listening on 127.0.0.1 for this computer, and on the remote access address when it is on. */
  async start(): Promise<{ port: number }> {
    const preferred = this.options.loopbackPort ?? 0;
    this.loopback = await this.listen('127.0.0.1', preferred, true).catch(error => {
      if (!preferred) throw error;
      return this.listen('127.0.0.1', 0, true);
    });
    await this.applyNetwork();
    this.options.log.info('Host started', { port: this.loopback.port, hostId: this.access.hostId, managedBy: this.access.managedBy });
    return { port: this.loopback.port };
  }

  async stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    for (const connection of this.connections) connection.ws.close(closeCodes.shuttingDown, 'The host is stopping');
    await Promise.all([this.loopback, this.network].map(listener => listener && this.closeListener(listener)));
    this.loopback = this.network = null;
    this.folders.closeAll();
    for (const held of this.held.values()) void this.exports.drop(held.workerToken).catch(() => undefined);
    this.held.clear();
    this.access.unlock();
  }

  // ---- Listeners -------------------------------------------------------------------------------

  private listen(address: string, port: number, local: boolean): Promise<Listener> {
    const listener = { address, port, local, sockets: new Set<WebSocket>() } as Listener;
    const server = createAdaptorServer({ fetch: this.app(listener).fetch, overrideGlobalObjects: false }) as Server;
    listener.server = server;
    server.headersTimeout = 20000;
    server.requestTimeout = 60000;
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

  /** Listen for paired devices on the chosen address, or stop, as the settings say. */
  async applyNetwork() {
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
    this.networkError = null;
    if (wanted && !this.network) {
      try {
        this.network = await this.listen(wanted.address, wanted.port, false);
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

  private credential(token: string | null, listener: Listener, peer: string | undefined): Credential | null {
    if (!token) return null;
    if (listener.local && loopbackPeer(peer) && token.length === this.ownerToken.length && token === this.ownerToken) return { scopes: new Set(['owner']), deviceId: null, label: 'owner' };
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
    app.get('/pair', c => c.html('<!doctype html><meta charset="utf-8"><title>Atlas</title><p>This is an Atlas pairing link. It works in Atlas, not in a browser: in Atlas on the other computer, choose <b>File › Connect to Another Atlas…</b> and paste this link.</p>'));
    app.post(routes.pair, bodyLimit({ maxSize: 4096, onError: c => c.json({ code: 'invalid-argument', message: 'The request is too large.' }, 413) }), async c => {
      let request;
      try { request = pairRequest(await c.req.json()); }
      catch { return c.json({ code: 'invalid-argument', message: 'Send a pairing code and this device\'s name.' }, 400); }
      try {
        const { device, token } = this.access.pair(request.code, request.device);
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
    const relative = decodeURIComponent(c.req.path.replace(/^\/api\/folders\/[^/]+\/files\//, ''));
    try {
      const folder = await this.accessibleFolder(credential, folderId);
      const file = await resolveDocument(folder.root, relative);
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
    return c.body(html, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${held.fileName}"`, 'Content-Security-Policy': 'sandbox' });
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
    this.websockets.handleUpgrade(request, socket, head, ws => this.connected(ws, credential, listener));
  }

  private connected(ws: WebSocket, credential: Credential, listener: Listener) {
    const connection = new Connection(ws, credential, listener);
    this.connections.add(connection);
    listener.sockets.add(ws);
    if (credential.deviceId) this.access.seen(credential.deviceId);
    this.options.log.info('Client connected', { client: credential.deviceId ? 'device' : 'owner', deviceId: credential.deviceId, address: listener.address });
    if (credential.deviceId) this.broadcastAccess();
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
      if (!connection.can(methodScopes[method])) throw new HostError('forbidden', methodScopes[method] === 'owner' ? 'Only the Atlas app on the host computer may do this.' : 'This device may not do this.');
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
  }
  private broadcastAccess() {
    const owners = [...this.connections].filter(connection => connection.owner);
    if (!owners.length) return;
    void this.accessState().then(state => { for (const connection of owners) this.event(connection, 'access.changed', state); }).catch(() => undefined);
  }

  // ---- Folders and access ----------------------------------------------------------------------

  /** Shared folders as canonical paths: the saved ones and this process's own. */
  private async sharedPaths() {
    return Promise.all([...this.access.settings.sharedFolders, ...this.extraShared].map(canonicalFolder));
  }
  private async shared(): Promise<SharedFolder[]> {
    const seen = new Set<string>();
    return (await this.sharedPaths()).flatMap(root => {
      const folderId = folderIdOf(root);
      if (seen.has(folderId)) return [];
      seen.add(folderId);
      return [{ folderId, name: path.basename(root) || root }];
    });
  }
  /** Open a folder the credential may read: the owner any open folder, a device only shared ones. */
  private async accessibleFolder(credential: Credential, folderId: string): Promise<FolderSession> {
    if (credential.scopes.has('owner')) {
      if (this.folders.has(folderId)) return this.folders.get(folderId);
      const known = this.folders.pathOf(folderId);
      if (known) return this.folders.open(known);
    }
    const root = (await this.sharedPaths()).find(candidate => folderIdOf(candidate) === folderId);
    if (!root) throw new HostError('forbidden', 'This planning folder is not shared with this device.');
    return this.folders.open(root);
  }
  private subscribed(connection: Connection, folderId: string): FolderSession {
    if (!connection.subscriptions.has(folderId)) throw new HostError('forbidden', 'Open this planning folder first.');
    return this.folders.get(folderId);
  }

  async accessState(): Promise<AccessState> {
    const settings = this.access.settings;
    if (this.options.networkOverride) settings.network = { enabled: true, ...this.options.networkOverride };
    settings.sharedFolders = [...new Set([...settings.sharedFolders, ...this.extraShared])];
    return { settings, status: this.networkStatus(), addresses: await hostAddresses(), managedBy: this.access.managedBy };
  }

  private async handle<M extends MethodName>(connection: Connection, method: M, params: Methods[M]['params']): Promise<Methods[M]['result']> {
    const p = params as Record<string, unknown>;
    switch (method) {
      case 'host.session':
        return { ...this.descriptor, scopes: [...connection.credential.scopes], deviceId: connection.credential.deviceId } as never;
      case 'folders.shared':
        return this.shared() as never;
      case 'folders.open': {
        const folder = await this.folders.open((p as { path: string }).path);
        return folder.state() as never;
      }
      case 'folders.subscribe': {
        const { folderId } = p as { folderId: string };
        const folder = await this.accessibleFolder(connection.credential, folderId);
        if (!connection.subscriptions.has(folderId)) { this.folders.acquire(folderId); connection.subscriptions.add(folderId); }
        return folder.state() as never;
      }
      case 'folders.unsubscribe': {
        const { folderId } = p as { folderId: string };
        if (connection.subscriptions.delete(folderId)) this.folders.release(folderId);
        return null as never;
      }
      case 'folder.snapshot': {
        const folder = this.subscribed(connection, (p as { folderId: string }).folderId);
        const snapshot = folder.snapshot();
        // A paired device sees the folder's name, not where it lives on this computer.
        return (connection.owner ? snapshot : { ...snapshot, root: folder.name }) as never;
      }
      case 'folder.document': { const { folderId, path: file } = p as { folderId: string; path: string }; return this.subscribed(connection, folderId).document(file) as never; }
      case 'folder.models': { const { folderId, work } = p as { folderId: string; work: string }; return this.subscribed(connection, folderId).models(work) as never; }
      case 'folder.model': { const { folderId, work, handle } = p as { folderId: string; work: string; handle: string }; return this.subscribed(connection, folderId).model(work, handle) as never; }
      case 'folder.references': { const { folderId, work, path: file } = p as { folderId: string; work: string | null; path: string }; return this.subscribed(connection, folderId).references(work, file) as never; }
      case 'folder.diagrams': return this.subscribed(connection, (p as { folderId: string }).folderId).diagrams() as never;
      case 'folder.recordView': { const { folderId, event } = p as unknown as Methods['folder.recordView']['params']; await this.subscribed(connection, folderId).recordView(event); return null as never; }
      case 'plan.exportPrepare': {
        const { folderId, work } = p as { folderId: string; work: string };
        const folder = this.subscribed(connection, folderId);
        const item = folder.snapshot().work.find(entry => entry.id === work);
        if (!item) throw new HostError('not-found', 'This work item is not in the planning folder.');
        const prepared = await this.exports.prepare(folder.root, work);
        const token = randomBytes(16).toString('hex');
        const fileName = exportFileName(item.path, item.id);
        this.held.set(token, { owner: this.holder(connection.credential), folderId, workerToken: prepared.token, fileName, expires: Date.now() + exportLifetime });
        return { token, bytes: prepared.bytes, warnings: prepared.warnings, fileName } as never;
      }
      case 'plan.exportDrop':
      case 'plan.importDrop': {
        const { token } = p as { token: string };
        const held = this.held.get(token);
        if (held && held.owner === this.holder(connection.credential)) { this.held.delete(token); await this.exports.drop(held.workerToken).catch(() => undefined); }
        return null as never;
      }
      case 'plan.importRead': {
        const { folderId, file } = p as { folderId: string; file: string };
        const folder = this.subscribed(connection, folderId);
        const read = await this.exports.read(folder.root, file);
        const token = randomBytes(16).toString('hex');
        this.held.set(token, { owner: connection.id, folderId, workerToken: read.token, expires: Date.now() + 30 * 60000 });
        const { manifest, files, totalBytes, diagrams } = read.preview;
        return {
          token, title: manifest.source.title, originalId: manifest.source.workId, origin: manifest.source.planningFolder, location: manifest.source.location,
          exportedAt: manifest.exportedAt, atlasVersion: manifest.atlasVersion, newId: read.target.workId, newFolder: read.target.path,
          files: files.length, bytes: totalBytes, diagrams: diagrams.map(item => item.title),
        } as never;
      }
      case 'plan.importConfirm': {
        const { folderId, token } = p as { folderId: string; token: string };
        const held = this.held.get(token);
        if (!held || held.owner !== connection.id || held.folderId !== folderId || held.expires < Date.now()) throw new HostError('invalid-argument', 'This import preview expired. Choose the file again.');
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
        const sharedFolders = [...new Set(await Promise.all(settings.sharedFolders.map(canonicalFolder)))];
        this.access.updateSettings({ network: settings.network, sharedFolders });
        await this.applyNetwork();
        // Devices lose folders that are no longer shared.
        const allowed = new Set((await this.shared()).map(folder => folder.folderId));
        for (const other of this.connections) {
          if (other.owner) continue;
          for (const folderId of [...other.subscriptions]) {
            if (allowed.has(folderId)) continue;
            other.subscriptions.delete(folderId);
            this.folders.release(folderId);
            this.event(other, 'folder.changed', { folderId, name: '', status: 'missing', error: 'This planning folder is no longer shared.', notice: null, revision: Date.now() });
          }
        }
        const state = await this.accessState();
        this.broadcastAccess();
        return state as never;
      }
      case 'access.pairingCreate': {
        const { address } = p as { address: string | null };
        const status = this.networkStatus();
        if (!status.listening) throw new HostError('unavailable', 'Turn on remote access first, so other devices can reach this computer.');
        const pairing = this.access.createPairing(address ?? status.address);
        const host = pairing.address ?? status.address!;
        return { code: pairing.code, expiresAt: new Date(pairing.expiresAt).toISOString(), url: pairingUrl(host, status.port!, pairing.code), address: host, port: status.port } as never;
      }
      case 'access.pairingRevoke': this.access.revokePairing((p as { code: string }).code); return null as never;
      case 'access.devices': return this.devices() as never;
      case 'access.deviceRevoke': this.revokeDevice((p as { deviceId: string }).deviceId); return null as never;
    }
    throw new HostError('not-found', 'This host does not know that request.');
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
