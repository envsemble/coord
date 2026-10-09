// Adapter between the File › Import Plan… / Export Plan… menus and work-0012's portable plan export
// (`exportPlan`, `readPlanExport`, `importPlan`, `planImportTarget` in @envsemble/atlas-planning).
// The work runs in a worker thread (main/planWorker.ts), so large files never block the windows.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Worker } from 'node:worker_threads';
import createPlanWorker from './planWorker.ts?nodeWorker';
import { AtlasError } from './errors.ts';
import type { WorkerRequest, WorkerResponse } from './planWorker.ts';

export const unavailableMessage = 'Plan export is not available in this build.';

type Request = WorkerRequest extends infer R ? R extends { id: number } ? Omit<R, 'id'> : never : never;

let worker: Worker | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;
let sequence = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>();

/** PlanExportError codes from work-0012, as the window's error codes. */
const codes: Record<string, AtlasError['code']> = {
  FORMAT: 'invalid-argument', VERSION: 'invalid-argument', PATH: 'invalid-argument', DUPLICATE: 'invalid-argument', INTEGRITY: 'invalid-argument',
  SOURCE: 'folder-invalid', WORK: 'not-found', TARGET: 'folder-invalid', CONFLICT: 'unavailable',
};

function start(): Worker {
  if (worker) return worker;
  const created = createPlanWorker({});
  created.on('message', (response: WorkerResponse) => {
    const waiting = pending.get(response.id);
    if (!waiting) return;
    pending.delete(response.id);
    if (response.ok) { waiting.resolve(response.value); return; }
    const { name, code, message } = response.error;
    if (name === 'Unavailable') waiting.reject(new AtlasError('unavailable', unavailableMessage));
    else if (code && codes[code]) waiting.reject(new AtlasError(codes[code], message));
    else waiting.reject(new AtlasError('invalid-argument', message));
  });
  const fail = (error: Error) => {
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
    worker = null;
  };
  created.on('error', fail);
  created.on('exit', () => fail(new AtlasError('internal', 'The plan export stopped unexpectedly.')));
  worker = created;
  return created;
}

function run<T>(request: Request): Promise<T> {
  const current = start();
  if (idle) { clearTimeout(idle); idle = null; }
  const id = ++sequence;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    current.postMessage({ ...request, id });
  }).finally(() => {
    // Stop the worker after a quiet minute; it holds nothing a later request needs.
    if (!pending.size && !idle) idle = setTimeout(() => { if (!pending.size) { void worker?.terminate(); worker = null; } idle = null; }, 60000);
  });
}

export const planExport = {
  available: () => run<boolean>({ op: 'available' }),
  /** Prepare an export; the bytes stay in the worker until written or discarded. */
  prepare: (root: string, work: string) => run<{ token: string; bytes: number; warnings: string[] }>({ op: 'export', root, work }),
  write: (token: string, file: string) => run<null>({ op: 'write', token, file }),
  discard: (token: string) => run<null>({ op: 'discard', token }),
  read: (root: string, file: string) => run<{ preview: Record<string, unknown>; target: { workId: string; path: string } | null; size: number; modified: number }>({ op: 'read', root, file }),
  import: (root: string, file: string, size: number, modified: number) => run<Record<string, unknown>>({ op: 'import', root, file, size, modified }),
};

/** The next free work number and folder, when the export code cannot say (used only for the preview). */
export function expectedTarget(root: string, title: string, location: string | null) {
  try {
    const registry = JSON.parse(readFileSync(path.join(root, 'planning.json'), 'utf8').replace(/^﻿/, '')) as { work_items?: { id?: unknown }[] };
    const numbers = (registry.work_items ?? []).map(item => typeof item?.id === 'string' ? Number(/^work-(\d+)$/.exec(item.id)?.[1] ?? 0) : 0);
    const next = String(Math.max(0, ...numbers) + 1).padStart(4, '0');
    const slug = title.toLowerCase().normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'imported-plan';
    return { workId: 'work-' + next, path: (location === 'archive' || location === 'archived' ? 'archive' : 'active') + '/' + next + '-' + slug };
  } catch { return null; }
}

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const record = (value: unknown) => (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;

/** Map work-0012's PlanExportPreview (manifest, files, diagrams, totalBytes) onto the preview dialog. */
export function describePreview(preview: Record<string, unknown>) {
  const manifest = record(preview.manifest);
  const source = record(manifest.source);
  const files = Array.isArray(preview.files) ? preview.files : Array.isArray(manifest.files) ? manifest.files : [];
  const diagrams = Array.isArray(preview.diagrams) ? preview.diagrams.map(item => typeof item === 'string' ? item : text(record(item).title) ?? 'Untitled diagram') : [];
  return {
    title: text(source.title) ?? 'Untitled plan',
    originalId: text(source.workId),
    origin: text(source.planningFolder),
    location: text(source.location),
    exportedAt: text(manifest.exportedAt),
    atlasVersion: text(manifest.atlasVersion),
    files: files.length,
    bytes: number(preview.totalBytes) || files.reduce((sum: number, file) => sum + number(record(file).size), 0),
    diagrams,
  };
}

export function describeImport(result: Record<string, unknown>) {
  return {
    workId: String(result.workId),
    path: String(result.path),
    files: typeof result.files === 'number' ? result.files : Array.isArray(result.files) ? result.files.length : 0,
    notes: Array.isArray(result.notes) ? result.notes.map(String) : [],
  };
}
