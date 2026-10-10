// File › Import Plan… / Export Plan…: the plan export and import from @envsemble/atlas-planning,
// run in a worker thread (main/planWorker.ts) so large files never block the windows.
import createPlanWorker from './planWorker.ts?nodeWorker';
import { PlanWorkerClient } from './planWorkerClient.ts';
import type { ImportPreview } from '../shared/contract.ts';
import type { ReadImport } from './planWorker.ts';
export { exportFileName } from './planExportName.ts';

export const planExport = new PlanWorkerClient(() => createPlanWorker({}));

/** What the import preview dialog shows (the token is the window's, not the worker's). */
export function describePreview(read: ReadImport, file: string, token: string): ImportPreview {
  const { manifest, files, totalBytes, diagrams } = read.preview;
  return {
    token, file,
    title: manifest.source.title,
    originalId: manifest.source.workId,
    origin: manifest.source.planningFolder,
    location: manifest.source.location,
    exportedAt: manifest.exportedAt,
    atlasVersion: manifest.atlasVersion,
    newId: read.target.workId,
    newFolder: read.target.path,
    files: files.length,
    bytes: totalBytes,
    diagrams: diagrams.map(item => item.title),
    warnings: [],
  };
}
