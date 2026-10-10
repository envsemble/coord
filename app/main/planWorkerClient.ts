// Talks to the plan export worker (planWorker.ts). The worker starts on first use and stops after
// a quiet period, but never while it holds something a window still needs: a prepared export
// waiting for its save dialog, or an import preview waiting for confirmation.
import { AtlasError } from './errors.ts';
import type { ErrorCode } from '../shared/contract.ts';
import type { PreparedExport, PlanImportResult, ReadImport, WorkerRequest, WorkerResponse } from './planWorker.ts';

/** The part of a worker_threads Worker this client uses. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): Promise<number> | void;
  on(event: 'message', listener: (response: WorkerResponse) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
}

type Request = WorkerRequest extends infer R ? R extends { id: number } ? Omit<R, 'id'> : never : never;

/** PlanExportError codes, as the window's error codes. */
const codes: Record<string, ErrorCode> = {
  FORMAT: 'invalid-argument', VERSION: 'invalid-argument', PATH: 'invalid-argument', DUPLICATE: 'invalid-argument', INTEGRITY: 'invalid-argument', LIMIT: 'invalid-argument',
  ROLLBACK: 'internal', SOURCE: 'folder-invalid', WORK: 'not-found', TARGET: 'folder-invalid', CONFLICT: 'unavailable',
};

export class PlanWorkerClient {
  private worker: WorkerLike | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>();
  /** Tokens of prepared exports and previews the worker holds. */
  private readonly held = new Set<string>();
  private readonly create: () => WorkerLike;
  private readonly idleMs: number;

  constructor(create: () => WorkerLike, idleMs = 60000) {
    this.create = create;
    this.idleMs = idleMs;
  }

  get running() { return this.worker !== null; }

  private start(): WorkerLike {
    if (this.worker) return this.worker;
    const created = this.create();
    created.on('message', response => {
      const waiting = this.pending.get(response.id);
      if (!waiting) return;
      this.pending.delete(response.id);
      if (response.ok) waiting.resolve(response.value);
      else waiting.reject(new AtlasError(response.error.code ? codes[response.error.code] ?? 'invalid-argument' : 'invalid-argument', response.error.message, response.error.code));
    });
    // Only the current worker's end fails the current requests; a stopped worker's late exit does not.
    const ended = (error: Error) => {
      if (this.worker !== created) return;
      this.worker = null;
      this.held.clear();
      for (const waiting of this.pending.values()) waiting.reject(error);
      this.pending.clear();
    };
    created.on('error', ended);
    created.on('exit', () => ended(new AtlasError('internal', 'The plan export stopped unexpectedly. Try again.')));
    this.worker = created;
    return created;
  }

  private run<T>(request: Request): Promise<T> {
    const current = this.start();
    if (this.idle) { clearTimeout(this.idle); this.idle = null; }
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      current.postMessage({ ...request, id });
    }).finally(() => this.scheduleStop());
  }

  private scheduleStop() {
    if (this.pending.size || this.held.size || this.idle || !this.worker) return;
    this.idle = setTimeout(() => {
      this.idle = null;
      if (this.pending.size || this.held.size || !this.worker) return;
      const stopping = this.worker;
      this.worker = null;
      void stopping.terminate();
    }, this.idleMs);
  }

  /** Prepare an export; its bytes stay in the worker until written or dropped. */
  async prepare(root: string, work: string) {
    const prepared = await this.run<PreparedExport>({ op: 'export', root, work });
    this.held.add(prepared.token);
    return prepared;
  }
  async write(token: string, file: string) {
    await this.run<null>({ op: 'write', token, file });
    this.release(token);
  }
  /** Read and validate an export; its preview stays in the worker until imported or dropped. */
  async read(root: string, file: string) {
    const read = await this.run<ReadImport>({ op: 'read', root, file });
    this.held.add(read.token);
    return read;
  }
  async import(root: string, token: string) {
    try { return await this.run<PlanImportResult>({ op: 'import', root, token }); }
    finally { this.release(token); }
  }
  async drop(token: string) {
    if (!this.held.has(token)) return;
    try { await this.run<null>({ op: 'drop', token }); } finally { this.release(token); }
  }
  private release(token: string) {
    this.held.delete(token);
    this.scheduleStop();
  }
}
