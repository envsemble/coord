// The plan export's embedded data. Both elements are inert JSON; nothing in them is executed.
import type { Provenance } from '../src/planning/reading/provenance.ts';
import type { HandoffLink, WorkProgress } from '../src/planning/types.ts';

export interface ExportFile { path: string; size: number; sha256: string; data: string }
export interface ExportPayload {
  format: string; version: number; atlasVersion: string; exportedAt: string;
  source: { planningFolder: string; workId: string; title: string; location: 'active' | 'archive'; path: string; currentPlan: string | null; repositories: { id: string; name: string }[] };
  files: ExportFile[];
}
export interface ViewDocument { path: string; title: string; category: string; format: string }
/** A link to a diagram from a document of the work folder: under its `section` heading, naming `element`. */
export interface ViewReference { path: string; section: string | null; element: string | null }
/** A diagram file of the work folder, by its path there, with its payload or why it cannot be drawn. */
export interface ViewDiagram {
  path: string; title: string; provenance: Provenance; payload: unknown | null; error: string | null; references: ViewReference[];
}
export type { WorkProgress };
export interface PlanView {
  work: {
    id: string; title: string; path: string; design: string; implementation: string; location: string;
    created: string | null; updated: string | null; accepted: string | null; completed: string | null;
    progress: WorkProgress | null; repositories: { id: string; name: string }[];
    /** The work it continues and the work continuing it, as they stood at export time; absent in older exports. */
    continues?: HandoffLink[]; continuedIn?: HandoffLink[];
  };
  plan: string | null; ledger: string | null; documents: ViewDocument[]; diagrams: ViewDiagram[];
}
export interface PlanData { payload: ExportPayload; view: PlanView; files: Map<string, ExportFile> }

function json<T>(id: string): T {
  const element = document.getElementById(id);
  if (!element || element.getAttribute('type') !== 'application/json') throw new Error('This plan export is missing its ' + id + ' data.');
  return JSON.parse(element.textContent ?? '') as T;
}
export function readData(): PlanData {
  const payload = json<ExportPayload>('atlas-plan-export');
  if (payload.format !== 'atlas/plan-export' || payload.version !== 1) throw new Error('This file uses a plan export format this viewer does not read.');
  const view = json<PlanView>('atlas-plan-view');
  return { payload, view, files: new Map(payload.files.map(file => [file.path, file])) };
}

const decoded = new Map<string, Uint8Array>();
export function bytesOf(file: ExportFile): Uint8Array {
  let bytes = decoded.get(file.path);
  if (!bytes) {
    const binary = atob(file.data);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    decoded.set(file.path, bytes);
  }
  return bytes;
}
const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
export function imageType(name: string) { return imageTypes[name.split('.').pop()?.toLowerCase() ?? ''] ?? null; }
const urls = new Map<string, string>();
/** A blob URL for viewing (images) or downloading (everything else) an exported file. */
export function blobURL(file: ExportFile, purpose: 'view' | 'download') {
  const type = purpose === 'view' ? imageType(file.path) ?? 'application/octet-stream' : 'application/octet-stream';
  const key = purpose + '\0' + file.path;
  let url = urls.get(key);
  if (!url) { url = URL.createObjectURL(new Blob([bytesOf(file) as BlobPart], { type })); urls.set(key, url); }
  return url;
}
export function textOf(file: ExportFile) {
  const text = new TextDecoder('utf-8').decode(bytesOf(file));
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
