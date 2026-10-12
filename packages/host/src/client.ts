// A client of an Atlas host: the desktop app's connection to its own host, or to another computer's.
// Before it sends a credential it checks that the address still answers with the host ID it paired
// with; that keeps the credential from a different Atlas at the same address (the ID is public, so it
// is no defence against a deliberate impostor: use Tailscale for that). It pings to notice a dead
// connection, reconnects on its own with jittered exponential backoff (capped at 30 seconds),
// subscribes to its folders again, and stops for good when its access is revoked. No dependency on
// the planning reader, so other clients (a phone) can use it too.
import { WebSocket } from 'ws';
import {
  closeCodes, protocolVersion, routes,
  type ErrorCode, type EventMessage, type EventName, type Events, type FolderState, type HostDescriptor, type MethodName, type Methods,
  type PairResponse, type ResponseMessage,
} from './contract.ts';

export class HostRequestError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) { super(message); this.name = 'HostRequestError'; this.code = code; }
}

export type ClientStatus = 'connecting' | 'connected' | 'offline' | 'revoked' | 'mismatch' | 'incompatible' | 'closed';
export interface ClientOptions {
  /** The host's origin, such as http://100.64.1.2:7346; read again for each connection attempt. */
  origin: string | (() => string);
  /** The credential, read again for every connection attempt (a restarted local host has a new one). */
  token(): string | Promise<string>;
  /** The host this client paired with; another host answering on the address gets no credential. Read for each attempt. */
  hostId: string | null | (() => string | null);
  onEvent?<E extends EventName>(event: E, data: Events[E]): void;
  onStatus?(status: ClientStatus, detail: string | null): void;
  /** Delay before the first attempt and the cap for retries (tests shorten them). */
  retry?: { first: number; cap: number };
  /** How often the connection is checked for life (tests shorten it). */
  heartbeat?: number;
}

const descriptorTimeout = 5000;
const requestTimeout = 60000;

/** Read a host's public descriptor. */
export async function describeHost(origin: string, timeout = descriptorTimeout): Promise<HostDescriptor> {
  let response: Response;
  try { response = await fetch(origin + routes.host, { signal: AbortSignal.timeout(timeout), redirect: 'error' }); }
  catch (error) { throw new HostRequestError('unavailable', 'Atlas could not reach ' + origin + ' (' + ((error as Error).cause as Error | undefined ?? error as Error).message + ').'); }
  if (!response.ok) throw new HostRequestError('unavailable', origin + ' did not answer as an Atlas host (HTTP ' + response.status + ').');
  const value = await response.json().catch(() => null) as HostDescriptor | null;
  if (!value || typeof value.hostId !== 'string' || typeof value.name !== 'string' || typeof value.protocol !== 'number') throw new HostRequestError('unavailable', origin + ' did not answer as an Atlas host.');
  if (value.protocol !== protocolVersion) throw new HostRequestError('unavailable', `${value.name} runs Atlas ${value.version}, which this version of Atlas cannot connect to. Update Atlas on both computers.`);
  return value;
}

/** What a pairing link or a typed address and code say: where the host is, and the one-time code. */
export function parsePairing(input: string, code?: string): { origin: string; code: string } {
  const text = input.trim();
  let url: URL;
  try { url = new URL(/^[a-z]+:\/\//i.test(text) ? text : 'http://' + text); }
  catch { throw new HostRequestError('invalid-argument', 'Paste the pairing link from the other computer, or its address and port.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HostRequestError('invalid-argument', 'A pairing link starts with http://.');
  if (!url.port) throw new HostRequestError('invalid-argument', 'The address needs its port, such as 100.64.1.2:7346.');
  const fromLink = new URLSearchParams(url.hash.replace(/^#/, '')).get('token');
  const chosen = (code ?? fromLink ?? '').trim();
  if (!chosen) throw new HostRequestError('invalid-argument', 'Enter the pairing code shown on the other computer.');
  return { origin: url.origin, code: chosen };
}

/** Pair with a host: exchange its one-time code for this device's token. */
export async function pairWithHost(origin: string, code: string, device: { name: string; platform: string }): Promise<{ descriptor: HostDescriptor; pairing: PairResponse }> {
  const descriptor = await describeHost(origin);
  let response: Response;
  try {
    response = await fetch(origin + routes.pair, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, device }), signal: AbortSignal.timeout(15000), redirect: 'error' });
  } catch (error) { throw new HostRequestError('unavailable', 'Atlas could not reach ' + origin + ' (' + (error as Error).message + ').'); }
  const value = await response.json().catch(() => null) as (PairResponse & { code?: ErrorCode; message?: string }) | null;
  if (!response.ok || !value || typeof value.token !== 'string') throw new HostRequestError(value?.code ?? 'unavailable', value?.message ?? 'Pairing failed (HTTP ' + response.status + ').');
  if (value.hostId !== descriptor.hostId) throw new HostRequestError('unavailable', 'The host changed while pairing. Try again.');
  return { descriptor, pairing: value };
}

interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
/** Opens a folder again on a host that restarted and no longer knows it (the owner opens by path). */
export type Reopen = () => Promise<unknown>;

const errorCodes = new Set(['invalid-argument', 'not-found', 'forbidden', 'unauthorized', 'unavailable', 'folder-missing', 'folder-invalid', 'cancelled', 'internal']);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class HostClient {
  status: ClientStatus = 'connecting';
  detail: string | null = null;
  descriptor: HostDescriptor | null = null;
  private readonly options: ClientOptions;
  private socket: WebSocket | null = null;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly waiting = new Set<() => void>();
  private readonly folders = new Map<string, Reopen | null>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  /** A connection attempt is under way (it may be waiting for the token or the descriptor). */
  private attempting = false;
  /** The current connection answered since the last check. */
  private alive = true;
  /** A wake-up check is waiting for an answer (kept apart from the heartbeat's own flag). */
  private probing = false;
  private attempts = 0;
  /** The origin of the current connection, which answered with the expected host ID. */
  private connectedOrigin: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(options: ClientOptions) {
    this.options = options;
  }
  get origin() { return typeof this.options.origin === 'function' ? this.options.origin() : this.options.origin; }

  /** Start connecting; reconnection is automatic until close() or revocation. */
  start(delay = this.options.retry?.first ?? 0) {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.connect(); }, delay);
  }
  /**
   * Retry now, for example when the computer woke up or the network changed. A connection that
   * looks connected is checked with a ping: one that died during sleep does not answer, and is
   * replaced within five seconds.
   */
  wake() {
    if (this.closed || this.status === 'revoked') return;
    const socket = this.socket;
    if (this.status === 'connected' && socket) {
      this.probing = true;
      try { socket.ping(); } catch { /* Closing already. */ }
      setTimeout(() => { if (this.probing && this.socket === socket) socket.terminate(); }, 5000).unref?.();
      return;
    }
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.attempts = 0;
    void this.connect();
  }

  private setStatus(status: ClientStatus, detail: string | null = null) {
    if (this.status === status && this.detail === detail) return;
    this.status = status; this.detail = detail;
    this.options.onStatus?.(status, detail);
    if (status === 'connected') for (const resume of [...this.waiting]) resume();
  }

  private expectedHost() { return typeof this.options.hostId === 'function' ? this.options.hostId() : this.options.hostId; }

  /** One attempt at a time: a wake or retry while one is under way does not start another. */
  private async connect() {
    if (this.closed || this.socket || this.attempting) return;
    this.attempting = true;
    try { await this.attempt(); }
    finally { this.attempting = false; }
  }
  private async attempt() {
    this.setStatus('connecting', this.detail);
    // The credential first: a local host that restarted has a new address once its token is ready.
    let token: string;
    try { token = await this.options.token(); }
    catch (error) { this.retry((error as Error).message); return; }
    if (this.closed) return;
    const origin = this.origin;
    let descriptor: HostDescriptor;
    try { descriptor = await describeHost(origin); }
    catch (error) { this.retry((error as Error).message, (error as HostRequestError).message.includes('cannot connect to') ? 'incompatible' : 'offline'); return; }
    if (this.closed) return;
    const expected = this.expectedHost();
    if (expected && descriptor.hostId !== expected) { this.retry(`${origin} now answers as a different computer (${descriptor.name}). Atlas did not send it this computer's credentials.`, 'mismatch'); return; }
    this.descriptor = descriptor;
    const url = origin.replace(/^http/, 'ws') + routes.connect;
    const socket = new WebSocket(url, { headers: { Authorization: 'Bearer ' + token }, handshakeTimeout: 10000, maxPayload: 512 * 1024 * 1024, perMessageDeflate: false });
    this.socket = socket;
    let opened = false;
    this.alive = true;
    const answered = () => { if (this.socket === socket) { this.alive = true; this.probing = false; } };
    socket.on('pong', answered);
    // Any bytes from the host, such as part of a large answer still arriving, show it is alive.
    let raw: { bytesWritten?: number; writableLength?: number } | null = null;
    socket.on('upgrade', response => { raw = response.socket; response.socket.on('data', answered); });
    socket.on('open', () => {
      opened = true;
      this.attempts = 0;
      this.connectedOrigin = origin;
      // A connection that misses a ping is dead (a sleeping host, a dropped network): end it and reconnect.
      let written = 0;
      let missed = 0;
      this.heartbeat = setInterval(() => {
        // Bytes that actually left since the last check, while more wait, mean a slow link, not a dead
        // one. (Node counts queued bytes in bytesWritten, so the queue is taken off.)
        const now = (raw?.bytesWritten ?? 0) - (raw?.writableLength ?? 0);
        const draining = socket.bufferedAmount > 0 && now > written;
        written = now;
        if (draining) this.alive = true;
        // One missed answer can be a large answer still in flight: end the connection only after
        // three checks in a row without a sign of life.
        if (this.alive) missed = 0;
        else if (++missed >= 3) { socket.terminate(); return; }
        this.alive = false;
        try { socket.ping(); } catch { /* Closing already. */ }
      }, this.options.heartbeat ?? 30000);
      this.heartbeat.unref?.();
      this.setStatus('connected');
      void this.resubscribe();
    });
    socket.on('unexpected-response', (_request, response) => {
      const revoked = response.statusCode === 401;
      socket.terminate();
      this.socket = null;
      if (revoked) { this.stop('revoked', 'This computer is no longer paired with ' + descriptor.name + '. Pair again to reconnect.'); return; }
      this.retry(`${descriptor.name} refused the connection (HTTP ${response.statusCode}).`);
    });
    socket.on('message', data => this.message(data.toString()));
    socket.on('error', () => { /* The close event follows and decides what to do. */ });
    socket.on('close', (code, reason) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopHeartbeat();
      this.failPending(new HostRequestError('unavailable', 'The connection to ' + descriptor.name + ' was lost.'));
      if (code === closeCodes.revoked) { this.stop('revoked', 'Access to ' + descriptor.name + ' was revoked. Pair again to reconnect.'); return; }
      if (code === closeCodes.protocol) { this.stop('incompatible', reason.toString() || 'The host closed the connection.'); return; }
      this.retry(opened ? 'The connection to ' + descriptor.name + ' was lost; reconnecting.' : 'Atlas could not connect to ' + descriptor.name + '.');
    });
  }

  private retry(detail: string, status: ClientStatus = 'offline') {
    if (this.closed) return;
    this.setStatus(status, detail);
    const cap = this.options.retry?.cap ?? 30000;
    const base = Math.min(cap, 500 * 2 ** Math.min(this.attempts++, 10));
    this.start(base / 2 + Math.random() * base / 2);
  }
  private stopHeartbeat() {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    this.connectedOrigin = null;
  }
  private stop(status: ClientStatus, detail: string) {
    this.closed = true;
    this.setStatus(status, detail);
    this.failPending(new HostRequestError(status === 'revoked' ? 'unauthorized' : 'unavailable', detail));
    for (const resume of [...this.waiting]) resume();
  }

  /** A message from the host; anything that is not a well-formed answer or a known event is ignored. */
  private message(text: string) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return; }
    if (!isRecord(parsed)) return;
    if ('event' in parsed) {
      const { event, data } = parsed as unknown as EventMessage;
      if ((event !== 'folder.changed' && event !== 'folders.changed' && event !== 'access.changed') || !isRecord(data)) return;
      if (event === 'folder.changed' && (typeof (data as Record<string, unknown>).folderId !== 'string' || typeof (data as Record<string, unknown>).status !== 'string')) return;
      if (event === 'folders.changed' && !Array.isArray((data as Record<string, unknown>).folders)) return;
      try { this.options.onEvent?.(event, data as never); } catch { /* A listener's failure is its own. */ }
      return;
    }
    const message = parsed as unknown as ResponseMessage;
    if (!Number.isSafeInteger(message.id) || typeof message.ok !== 'boolean') return;
    const waiting = this.pending.get(message.id);
    if (!waiting) return;
    this.pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.ok) { waiting.resolve((message as { value?: unknown }).value ?? null); return; }
    const reported: unknown = (message as { error?: unknown }).error;
    const error: Record<string, unknown> = isRecord(reported) ? reported : {};
    const code = typeof error.code === 'string' && errorCodes.has(error.code) ? error.code as ErrorCode : 'internal';
    waiting.reject(new HostRequestError(code, typeof error.message === 'string' ? error.message.slice(0, 2000) : 'The host could not answer.'));
  }
  private failPending(error: Error) {
    for (const waiting of this.pending.values()) { clearTimeout(waiting.timer); waiting.reject(error); }
    this.pending.clear();
  }

  private ready(timeout: number) {
    if (this.status === 'connected' && this.socket) return Promise.resolve();
    if (this.closed) return Promise.reject(new HostRequestError(this.status === 'revoked' ? 'unauthorized' : 'unavailable', this.detail ?? 'The connection is closed.'));
    return new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); this.waiting.delete(done); this.status === 'connected' ? resolve() : reject(new HostRequestError('unavailable', this.detail ?? 'Not connected.')); };
      const timer = setTimeout(() => { this.waiting.delete(done); reject(new HostRequestError('unavailable', this.detail ?? 'Atlas could not reach the host.')); }, timeout);
      this.waiting.add(done);
    });
  }

  /** Send a request once connected, and wait for its answer. */
  async request<M extends MethodName>(method: M, params: Methods[M]['params'], options: { timeout?: number } = {}): Promise<Methods[M]['result']> {
    const timeout = options.timeout ?? requestTimeout;
    await this.ready(Math.min(timeout, 15000));
    const socket = this.socket!;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new HostRequestError('unavailable', 'The host did not answer in time.')); }, timeout);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Follow a folder: subscribe now and again after every reconnection. `reopen` opens it again first
   * when the host may have restarted without it (the owner's folders, opened by path).
   */
  async follow(folderId: string, reopen: Reopen | null = null): Promise<FolderState> {
    this.folders.set(folderId, reopen);
    return this.request('folders.subscribe', { folderId });
  }
  /** Whether this client follows a folder (it subscribes again after reconnecting). */
  follows(folderId: string) { return this.folders.has(folderId); }
  async unfollow(folderId: string) {
    this.folders.delete(folderId);
    if (this.status === 'connected') await this.request('folders.unsubscribe', { folderId }).catch(() => undefined);
  }
  /** After reconnecting, subscribe to every followed folder again, all at once. */
  private async resubscribe() {
    await Promise.all([...this.folders].map(async ([folderId, reopen]) => {
      try {
        if (reopen) await reopen();
        this.options.onEvent?.('folder.changed', await this.request('folders.subscribe', { folderId }));
      } catch (error) {
        if (!this.folders.has(folderId)) return;
        this.options.onEvent?.('folder.changed', { folderId, name: '', status: 'missing', error: (error as Error).message, notice: null, revision: Date.now() });
      }
    }));
  }

  /**
   * An authenticated HTTP request to the host (files in documents, plan exports, a plan sent for
   * import). It waits for a connection, so the credential goes only to an address that answered
   * with the expected host ID.
   */
  async fetch(pathname: string, timeout = 60000, send?: { method: 'POST'; body: ReadableStream<Uint8Array> | Uint8Array; length: number }): Promise<Response> {
    await this.ready(Math.min(timeout, 15000));
    const token = await this.options.token();
    const origin = this.connectedOrigin;
    if (!origin || this.status !== 'connected') throw new HostRequestError('unavailable', this.detail ?? 'Not connected.');
    const headers: Record<string, string> = { Authorization: 'Bearer ' + token };
    if (send) { headers['Content-Type'] = 'application/octet-stream'; headers['Content-Length'] = String(send.length); }
    // A streamed body needs `duplex: 'half'` in Node's fetch.
    const init = { headers, signal: AbortSignal.timeout(timeout), redirect: 'error', ...(send ? { method: send.method, body: send.body, duplex: 'half' } : {}) } as RequestInit;
    return fetch(origin + pathname, init);
  }

  close() {
    if (this.closed && !this.socket) return;
    this.closed = true;
    this.stopHeartbeat();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.failPending(new HostRequestError('cancelled', 'The connection was closed.'));
    this.socket?.close(1000);
    this.socket = null;
    this.setStatus('closed');
  }
}
