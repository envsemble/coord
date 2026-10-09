// Runs work-0012's portable plan export and import (from @envsemble/atlas-planning) off the main
// thread: parsing a large export takes seconds, and the windows must stay responsive meanwhile.
// The functions are looked up at runtime, so a build without them answers "unavailable".
import { readFile, stat, writeFile } from 'node:fs/promises';
import { parentPort } from 'node:worker_threads';
import * as planning from '@envsemble/atlas-planning';

export type WorkerRequest =
  | { id: number; op: 'available' }
  | { id: number; op: 'export'; root: string; work: string }
  | { id: number; op: 'write'; token: string; file: string }
  | { id: number; op: 'discard'; token: string }
  | { id: number; op: 'read'; root: string; file: string }
  | { id: number; op: 'import'; root: string; file: string; size: number; modified: number };
export type WorkerResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: { name: string; code: string | null; message: string } };

type Functions = {
  exportPlan(root: string, work: string): Promise<{ html: string | Uint8Array; bytes?: number; warnings?: string[] }>;
  readPlanExport(html: string | Uint8Array): unknown;
  importPlan(root: string, html: string | Uint8Array): Promise<unknown>;
  planImportTarget?(root: string, manifest: unknown): Promise<{ workId: string; path: string }>;
};

class Unavailable extends Error { constructor() { super('Plan export is not available in this build.'); this.name = 'Unavailable'; } }

function functions(): Functions {
  const module = planning as Record<string, unknown>;
  if (typeof module.exportPlan !== 'function' || typeof module.readPlanExport !== 'function' || typeof module.importPlan !== 'function') throw new Unavailable();
  return module as unknown as Functions;
}

const exports = new Map<string, Uint8Array | string>();
let next = 0;

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.op) {
    case 'available':
      try { functions(); return true; } catch { return false; }
    case 'export': {
      const result = await functions().exportPlan(request.root, request.work);
      const token = 'export-' + ++next;
      exports.set(token, result.html);
      const bytes = typeof result.bytes === 'number' ? result.bytes : typeof result.html === 'string' ? Buffer.byteLength(result.html) : result.html.byteLength;
      return { token, bytes, warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [] };
    }
    case 'write': {
      const html = exports.get(request.token);
      exports.delete(request.token);
      if (html === undefined) throw new Error('This export is no longer available. Export the plan again.');
      await writeFile(request.file, html);
      return null;
    }
    case 'discard':
      exports.delete(request.token);
      return null;
    case 'read': {
      const { readPlanExport, planImportTarget } = functions();
      const information = await stat(request.file);
      const preview = readPlanExport(await readFile(request.file)) as Record<string, unknown>;
      const manifest = (preview.manifest ?? preview) as unknown;
      const target = planImportTarget ? await planImportTarget(request.root, manifest).catch(() => null) : null;
      return { preview, target, size: information.size, modified: information.mtimeMs };
    }
    case 'import': {
      const information = await stat(request.file);
      if (information.size !== request.size || information.mtimeMs !== request.modified) throw new Error('The file changed after the preview. Choose it again to import.');
      return functions().importPlan(request.root, await readFile(request.file));
    }
  }
}

parentPort?.on('message', (request: WorkerRequest) => {
  handle(request).then(
    value => parentPort!.postMessage({ id: request.id, ok: true, value } satisfies WorkerResponse),
    (error: unknown) => {
      const failure = error as { name?: string; code?: unknown; message?: string };
      parentPort!.postMessage({ id: request.id, ok: false, error: { name: failure?.name ?? 'Error', code: typeof failure?.code === 'string' ? failure.code : null, message: failure?.message ?? 'The plan export failed.' } } satisfies WorkerResponse);
    },
  );
});
