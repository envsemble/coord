// Runs plan export and import (@envsemble/atlas-planning) off the host's main thread: parsing a large
// export takes seconds, and the windows must stay responsive meanwhile. A prepared export and
// an import preview stay here, under a token, until they are written, imported or dropped.
import { readFile } from 'node:fs/promises';
import { parentPort } from 'node:worker_threads';
import { exportPlan, importPlan, planImportTarget, PlanExportError, readPlanExport, type PlanExportPreview, type PlanImportResult, type PlanImportTarget } from '../../planning/index.ts';

export type WorkerRequest =
  | { id: number; op: 'export'; root: string; work: string }
  | { id: number; op: 'take'; token: string }
  | { id: number; op: 'read'; root: string; file: string }
  | { id: number; op: 'import'; root: string; token: string }
  | { id: number; op: 'drop'; token: string };
export type WorkerResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: { code: string | null; message: string } };

export interface PreparedExport { token: string; bytes: number; warnings: string[] }
export interface ReadImport {
  token: string;
  preview: Pick<PlanExportPreview, 'manifest' | 'files' | 'totalBytes'> & { diagrams: { title: string }[] };
  target: PlanImportTarget;
}
export type { PlanImportResult };

const exports = new Map<string, string>();
const previews = new Map<string, PlanExportPreview>();
let next = 0;

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.op) {
    case 'export': {
      const result = await exportPlan(request.root, request.work);
      const token = 'export-' + ++next;
      exports.set(token, result.html);
      return { token, bytes: result.bytes, warnings: result.warnings } satisfies PreparedExport;
    }
    case 'take': {
      // The export leaves the worker once: the host streams it to the client that saves it.
      const html = exports.get(request.token);
      if (html === undefined) throw new Error('This export is no longer available. Export the plan again.');
      exports.delete(request.token);
      return html;
    }
    case 'read': {
      const preview = readPlanExport(await readFile(request.file));
      const target = await planImportTarget(request.root, preview.manifest);
      const token = 'import-' + ++next;
      previews.set(token, preview);
      // Only what the preview dialog shows crosses back; the file's contents stay here.
      return { token, preview: { manifest: preview.manifest, files: preview.files, totalBytes: preview.totalBytes, diagrams: preview.diagrams.map(item => ({ title: item.title })) }, target } satisfies ReadImport;
    }
    case 'import': {
      const preview = previews.get(request.token);
      if (preview === undefined) throw new Error('This import preview expired. Choose the file again.');
      previews.delete(request.token);
      return importPlan(request.root, preview) satisfies Promise<PlanImportResult>;
    }
    case 'drop':
      exports.delete(request.token);
      previews.delete(request.token);
      return null;
  }
}

parentPort?.on('message', (request: WorkerRequest) => {
  handle(request).then(
    value => parentPort!.postMessage({ id: request.id, ok: true, value } satisfies WorkerResponse),
    (error: unknown) => parentPort!.postMessage({
      id: request.id, ok: false,
      error: { code: error instanceof PlanExportError ? error.code : null, message: error instanceof Error ? error.message : 'The plan export failed.' },
    } satisfies WorkerResponse),
  );
});
