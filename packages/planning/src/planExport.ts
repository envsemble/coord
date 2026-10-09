// Portable plan export: one self-contained HTML file carrying a whole work folder
// losslessly, and its import into a planning folder as new work.
//
// The diagram package and the HTML parser load lazily, so the command's planning
// checks stay light when they import the package entry.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, realpath, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AtlasDocument } from '@envsemble/atlas-diagrams';
import { validatePlanning } from './check.ts';
import { PlanningError, loadPlanning } from './planning.ts';
import { resolveRecordPath, samePath, workRelative } from './paths.ts';
import { describeProvenance, type Provenance } from './provenance.ts';
import { appendRegistryEntries, RegistryFormatError } from './registryText.ts';
import type { Work } from './types.ts';

const require = createRequire(import.meta.url);
const { version: atlasVersion } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export const planExportFormat = 'atlas/plan-export';
export const planExportVersion = 1;
/** Exports above this size are written with a warning; there is no hard cap. */
export const planExportWarningBytes = 50 * 1024 * 1024;
const payloadId = 'atlas-plan-export';
const viewId = 'atlas-plan-view';
const modelFile = /^\.atlas\/models\/(m-[a-f0-9]{24})\.json$/;
const workIdentity = /^work-([0-9]{4,})$/;

export interface PlanExportRepository { id: string; name: string; remote?: string }
export interface PlanExportSource {
  /** Name of the planning folder the work was exported from. */
  planningFolder: string;
  workId: string;
  title: string;
  location: 'active' | 'archive';
  /** Planning-relative work folder at export time. */
  path: string;
  /** The registered main plan, relative to the work folder, or null. */
  currentPlan: string | null;
  /** The work's repository scope, with the names registered at export time. */
  repositories: PlanExportRepository[];
}
export interface PlanExportFile { path: string; size: number; sha256: string }
export interface PlanExportManifest {
  format: typeof planExportFormat;
  version: typeof planExportVersion;
  atlasVersion: string;
  exportedAt: string;
  source: PlanExportSource;
  /** Every file of the work folder, by work-folder-relative POSIX path. */
  files: PlanExportFile[];
}
export interface PlanExportDiagram { title: string; provenance: Provenance }
export interface PlanExportPreview {
  manifest: PlanExportManifest;
  files: { path: string; size: number }[];
  diagrams: PlanExportDiagram[];
  totalBytes: number;
}
export interface PlanExportResult { html: string; manifest: PlanExportManifest; bytes: number; warnings: string[] }
export interface PlanImportTarget { workId: string; path: string }
export interface PlanImportResult {
  workId: string;
  /** Planning-relative folder of the new work item. */
  path: string;
  files: number;
  notes: string[];
}
export type PlanExportErrorCode =
  | 'FORMAT' // not a plan export, malformed payload or manifest
  | 'VERSION' // a plan export of an unknown version
  | 'PATH' // an unsafe or non-portable file path
  | 'DUPLICATE' // the same path more than once
  | 'INTEGRITY' // a size or SHA-256 mismatch
  | 'SOURCE' // the folder to export from is not a readable planning folder
  | 'WORK' // the work item to export was not found or cannot be exported
  | 'TARGET' // the folder to import into is not a valid planning repository
  | 'CONFLICT'; // the target changed during the import

/** A rejected export or import. Nothing has been written when this is thrown. */
export class PlanExportError extends Error {
  readonly code: PlanExportErrorCode;
  constructor(code: PlanExportErrorCode, message: string) {
    super(message);
    this.name = 'PlanExportError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Paths

const reservedName = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;
/** Why a work-folder-relative path is not safe and portable, or null when it is. */
export function planExportPathProblem(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return 'is empty';
  if (value.length > 1024) return 'is longer than 1024 characters';
  if (value.startsWith('/') || /^[a-z]:/i.test(value) || value.startsWith('\\')) return 'is absolute';
  if (value.includes('\\')) return 'uses a backslash; paths use forward slashes';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f:*?"<>|]/.test(value)) return 'contains a character that is not portable';
  const segments = value.split('/');
  for (const [index, segment] of segments.entries()) {
    if (!segment) return 'has an empty segment';
    if (segment === '.' || segment === '..') return 'has a dot segment';
    if (segment.startsWith('.') && !(index === 0 && segment === '.atlas' && segments.length > 1)) return 'has a hidden segment outside .atlas/';
    if (/[. ]$/.test(segment)) return 'ends a segment with a dot or a space';
    if (reservedName.test(segment)) return 'uses a reserved device name';
    if (Buffer.byteLength(segment) > 255) return 'has a segment longer than 255 bytes';
  }
  return null;
}
const pathKey = (value: string) => value.normalize('NFC').toLowerCase();

// ---------------------------------------------------------------------------
// Reading an export

interface Decoded { preview: PlanExportPreview; contents: Map<string, Buffer> }
type ParsedNode = { nodeName: string; tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: ParsedNode[]; value?: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const base64 = /^[A-Za-z0-9+/]*={0,2}$/;

function payloadText(input: string | Uint8Array): string {
  let html: string;
  if (typeof input === 'string') html = input;
  else if (input instanceof Uint8Array) {
    try { html = new TextDecoder('utf-8', { fatal: true }).decode(input); }
    catch { throw new PlanExportError('FORMAT', 'This file is not UTF-8 text, so it is not an Atlas plan export.'); }
  } else throw new PlanExportError('FORMAT', 'Provide the plan export as HTML text or bytes.');
  const { parse } = require('parse5') as typeof import('parse5');
  let tree: ParsedNode;
  try {
    tree = parse(html, { onParseError: error => { if (error.code === 'duplicate-attribute') throw new PlanExportError('FORMAT', 'The plan export repeats an HTML attribute, so its payload is ambiguous.'); } }) as unknown as ParsedNode;
  } catch (error) {
    if (error instanceof PlanExportError) throw error;
    throw new PlanExportError('FORMAT', 'This file could not be read as HTML.');
  }
  const found: ParsedNode[] = [];
  let modelExport = false;
  const pending: ParsedNode[] = [tree];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.tagName === 'script') {
      const id = node.attrs?.find(attribute => attribute.name === 'id')?.value;
      if (id === payloadId) found.push(node);
      if (id === 'atlas-document') modelExport = true;
    }
    pending.push(...node.childNodes ?? []);
  }
  if (!found.length) {
    throw new PlanExportError('FORMAT', modelExport
      ? 'This is a single-model export, not a plan export. Reopen it with atlas model import.'
      : 'This file is not an Atlas plan export: it has no plan payload.');
  }
  if (found.length > 1) throw new PlanExportError('FORMAT', 'The plan export has more than one payload.');
  if (found[0].attrs?.find(attribute => attribute.name === 'type')?.value !== 'application/json') throw new PlanExportError('FORMAT', 'The plan payload must be inert JSON.');
  return (found[0].childNodes ?? []).map(node => node.value ?? '').join('');
}

function stringField(record: Record<string, unknown>, field: string, label: string, optional = false): string {
  const value = record[field];
  if (optional && value === undefined) return undefined as unknown as string;
  if (typeof value !== 'string' || !value.trim()) throw new PlanExportError('FORMAT', `The plan export's ${label} must be a nonempty string.`);
  return value;
}

function decodePlanExport(input: string | Uint8Array): Decoded {
  let payload: unknown;
  try { payload = JSON.parse(payloadText(input)); }
  catch (error) {
    if (error instanceof PlanExportError) throw error;
    throw new PlanExportError('FORMAT', 'The plan payload is not valid JSON.');
  }
  if (!isObject(payload) || payload.format !== planExportFormat) throw new PlanExportError('FORMAT', `This file is not an ${planExportFormat} payload.`);
  if (payload.version !== planExportVersion) throw new PlanExportError('VERSION', `This plan export uses version ${JSON.stringify(payload.version)}; this Atlas reads version ${planExportVersion}. Use an Atlas release that supports it.`);
  const exportedAt = stringField(payload, 'exportedAt', 'export time');
  if (!Number.isFinite(Date.parse(exportedAt))) throw new PlanExportError('FORMAT', "The plan export's export time is not a date.");
  const version = stringField(payload, 'atlasVersion', 'Atlas version');
  if (!isObject(payload.source)) throw new PlanExportError('FORMAT', 'The plan export does not describe its source work item.');
  const source = payload.source;
  const workId = stringField(source, 'workId', 'work ID');
  if (!workIdentity.test(workId)) throw new PlanExportError('FORMAT', "The plan export's work ID is not a work-NNNN identity.");
  if (source.location !== 'active' && source.location !== 'archive') throw new PlanExportError('FORMAT', "The plan export's location must be active or archive.");
  const sourcePath = stringField(source, 'path', 'source folder');
  const sourceProblem = planExportPathProblem(sourcePath);
  if (sourceProblem) throw new PlanExportError('PATH', `The source folder ${JSON.stringify(sourcePath)} ${sourceProblem}.`);
  if (source.currentPlan !== null && typeof source.currentPlan !== 'string') throw new PlanExportError('FORMAT', "The plan export's main plan must be a path or null.");
  if (!Array.isArray(source.repositories)) throw new PlanExportError('FORMAT', "The plan export's repositories must be a list.");
  const repositories: PlanExportRepository[] = source.repositories.map(item => {
    if (!isObject(item)) throw new PlanExportError('FORMAT', 'A repository in the plan export is not an object.');
    const id = stringField(item, 'id', 'repository ID');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new PlanExportError('FORMAT', `The repository ID ${JSON.stringify(id)} is invalid.`);
    const remote = stringField(item, 'remote', 'repository remote', true);
    return { id, name: stringField(item, 'name', 'repository name'), ...(remote === undefined ? {} : { remote }) };
  });
  if (new Set(repositories.map(item => item.id)).size !== repositories.length) throw new PlanExportError('DUPLICATE', 'The plan export lists a repository twice.');
  if (!Array.isArray(payload.files)) throw new PlanExportError('FORMAT', 'The plan export has no file list.');

  const files: PlanExportFile[] = [];
  const contents = new Map<string, Buffer>();
  const seen = new Map<string, string>();
  for (const item of payload.files) {
    if (!isObject(item)) throw new PlanExportError('FORMAT', 'A file entry in the plan export is not an object.');
    const filePath = item.path;
    const problem = planExportPathProblem(filePath);
    if (problem) throw new PlanExportError('PATH', `The path ${JSON.stringify(filePath)} ${problem}.`);
    const name = filePath as string;
    const key = pathKey(name);
    if (seen.has(key)) throw new PlanExportError('DUPLICATE', `The plan export contains ${name} more than once${seen.get(key) === name ? '' : ` (also as ${seen.get(key)})`}.`);
    seen.set(key, name);
    if (typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 0) throw new PlanExportError('FORMAT', `The size of ${name} is invalid.`);
    if (typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)) throw new PlanExportError('FORMAT', `The SHA-256 of ${name} is invalid.`);
    if (typeof item.data !== 'string' || item.data.length % 4 !== 0 || !base64.test(item.data)) throw new PlanExportError('INTEGRITY', `The contents of ${name} are not valid base64.`);
    const bytes = Buffer.from(item.data, 'base64');
    if (bytes.length !== item.size) throw new PlanExportError('INTEGRITY', `${name} has ${bytes.length} bytes, but the manifest records ${item.size}.`);
    if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new PlanExportError('INTEGRITY', `${name} does not match its recorded SHA-256; the file was changed after export.`);
    files.push({ path: name, size: item.size, sha256: item.sha256 });
    contents.set(name, bytes);
  }
  // A path cannot be both a file and a folder.
  for (const name of seen.keys()) {
    const segments = name.split('/');
    for (let index = 1; index < segments.length; index++) {
      const folder = segments.slice(0, index).join('/');
      if (seen.has(folder)) throw new PlanExportError('PATH', `${seen.get(folder)} is both a file and a folder in the plan export.`);
    }
  }
  const currentPlan = source.currentPlan as string | null;
  if (currentPlan !== null && !contents.has(currentPlan)) throw new PlanExportError('FORMAT', `The main plan ${currentPlan} is not among the exported files.`);

  const manifest: PlanExportManifest = {
    format: planExportFormat, version: planExportVersion, atlasVersion: version, exportedAt,
    source: { planningFolder: stringField(source, 'planningFolder', 'planning folder'), workId, title: stringField(source, 'title', 'title'), location: source.location, path: sourcePath, currentPlan, repositories },
    files,
  };
  const diagrams: PlanExportDiagram[] = [];
  for (const file of files) {
    if (!modelFile.test(file.path)) continue;
    let document: Partial<AtlasDocument> | null = null;
    try { document = JSON.parse(contents.get(file.path)!.toString('utf8')); } catch { /* Listed by file name. */ }
    const title = isObject(document) && typeof document.title === 'string' && document.title.trim() ? document.title : path.posix.basename(file.path);
    diagrams.push({ title, provenance: describeProvenance(isObject(document) ? document : null) });
  }
  return {
    preview: { manifest, files: files.map(({ path: name, size }) => ({ path: name, size })), diagrams, totalBytes: files.reduce((sum, file) => sum + file.size, 0) },
    contents,
  };
}

/**
 * Validate a plan export and describe it without writing anything. Throws a
 * {@link PlanExportError} for any invalid input.
 */
export function readPlanExport(html: string | Uint8Array): PlanExportPreview {
  return decodePlanExport(html).preview;
}

// ---------------------------------------------------------------------------
// Exporting

interface ViewDocument { path: string; title: string; category: string; format: string }
interface ViewReference { path: string; section: string | null; elementId: string | null; elementName: string | null }
interface ViewDiagram {
  handle: string; file: string; title: string; provenance: Provenance; payload: unknown | null; error: string | null;
  explains: { path: string; section: string | null }[]; references: ViewReference[];
}
/** Derived viewer data. Import ignores it; the files in the payload are authoritative. */
interface PlanView {
  work: Pick<Work, 'id' | 'title' | 'path' | 'design' | 'implementation' | 'created' | 'updated' | 'accepted' | 'completed' | 'progress'> & { location: string; repositories: PlanExportRepository[] };
  plan: string | null; ledger: string | null; documents: ViewDocument[]; diagrams: ViewDiagram[];
}

const transient = /^\.atlas\/(?:results|prepared|exports)(?:\/|$)|^\.atlas\/.*\.(?:lock|tmp)$/;
async function workFiles(folder: string, warnings: string[]) {
  const result: string[] = [];
  async function walk(directory: string, relative: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const child = relative ? relative + '/' + entry.name : entry.name;
      if (transient.test(child)) continue;
      if (entry.isSymbolicLink()) { warnings.push(`Skipped the symbolic link ${child}; plan exports carry regular files only.`); continue; }
      const atlasFolder = !relative && entry.name === '.atlas' && entry.isDirectory();
      if (entry.name.startsWith('.') && !atlasFolder) { warnings.push(`Skipped the hidden ${entry.isDirectory() ? 'folder' : 'file'} ${child}.`); continue; }
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__pycache__') { warnings.push(`Skipped the ${entry.name} folder ${child}.`); continue; }
        await walk(path.join(directory, entry.name), child);
      } else if (entry.isFile()) {
        const problem = planExportPathProblem(child);
        if (problem) throw new PlanExportError('PATH', `${child} ${problem}; rename it before exporting so the plan can be imported elsewhere.`);
        result.push(child);
      } else warnings.push(`Skipped ${child}, which is not a regular file.`);
    }
  }
  await walk(folder, '');
  return result.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

function inline(value: unknown) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}
let template: string | undefined;
function viewerTemplate() {
  if (template) return template;
  const file = new URL('../dist/plan-viewer.html', import.meta.url);
  if (!existsSync(file)) throw new Error('The plan viewer is not built. Run npm run build --workspace @envsemble/atlas-planning.');
  template = readFileSync(file, 'utf8');
  if (!template.includes('<!--ATLAS_TITLE-->') || !template.includes('<!--ATLAS_PAYLOAD-->')) throw new Error('The plan viewer template is missing its markers.');
  return template;
}
function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function findWork(works: Work[], work: string, same: (a: string, b: string) => boolean) {
  if (workIdentity.test(work)) return works.find(item => item.id === work);
  const relative = work.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  return works.find(item => same(item.path, relative));
}

async function diagramsFor(folder: string, work: Work, documents: Work['documents'], same: (a: string, b: string) => boolean, warnings: string[]): Promise<ViewDiagram[]> {
  const models = path.join(folder, '.atlas', 'models');
  if (!existsSync(models)) return [];
  const handles = readdirSync(models).filter(name => /^m-[a-f0-9]{24}\.json$/.test(name)).sort().map(name => name.slice(0, -5));
  if (!handles.length) return [];
  const { default: atlas } = await import('@envsemble/atlas-diagrams');
  const workspace = atlas.createWorkspace(folder);
  const result: ViewDiagram[] = [];
  for (const handle of handles) {
    const file = '.atlas/models/' + handle + '.json';
    let document: AtlasDocument;
    try { document = workspace.load(handle); }
    catch {
      warnings.push(`The model ${file} has an invalid or unrecorded update; it is exported as-is but not shown.`);
      let title = handle;
      try { const claimed = JSON.parse(readFileSync(path.join(models, handle + '.json'), 'utf8')); if (typeof claimed?.title === 'string') title = claimed.title; } catch { /* Shown by handle. */ }
      result.push({ handle, file, title, provenance: describeProvenance(null), payload: null, error: 'This model has an invalid or unrecorded update and cannot be shown.', explains: [], references: [] });
      continue;
    }
    let payload: unknown = null, error: string | null = null;
    try { payload = (await atlas.prepareViewer({ document, includeArtifacts: false })).payload; }
    catch (failure) {
      error = 'This model cannot be drawn: ' + (failure instanceof Error ? failure.message.split('\n')[0] : 'unknown error');
      warnings.push(`The model ${file} is exported but cannot be drawn in the viewer.`);
    }
    const names = new Map<string, string>();
    const visit = (value: unknown, depth: number) => {
      if (depth > 6 || !value || typeof value !== 'object') return;
      if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
      const record = value as Record<string, unknown>;
      if (typeof record.id === 'string' && typeof record.name === 'string' && !names.has(record.id)) names.set(record.id, record.name);
      for (const child of Object.values(record)) visit(child, depth + 1);
    };
    visit(document.model, 0);
    const explains: ViewDiagram['explains'] = [], references: ViewReference[] = [];
    for (const record of document.context.records) {
      const resolved = resolveRecordPath(record.path, work.path, documents, same);
      if (!resolved || resolved.workId !== work.id) continue;
      const target = workRelative(resolved.path, work.path);
      const section = typeof record.section === 'string' && record.section.trim() ? record.section.trim() : null;
      if (!explains.some(item => item.path === target && item.section === section)) explains.push({ path: target, section });
      const links = document.context.links.filter(link => link.recordId === record.id);
      if (!links.length) references.push({ path: target, section, elementId: null, elementName: null });
      for (const link of links) references.push({ path: target, section, elementId: link.elementId, elementName: names.get(link.elementId) ?? null });
    }
    result.push({ handle, file, title: document.title, provenance: describeProvenance(document), payload, error, explains, references });
  }
  return result;
}

/**
 * Export a work item, by work ID or planning-relative folder, as one self-contained
 * HTML file. Nothing is written; the caller saves `html`.
 */
export async function exportPlan(planningRoot: string, work: string, options: { now?: Date } = {}): Promise<PlanExportResult> {
  let index;
  try { index = await loadPlanning(planningRoot); }
  catch (error) {
    if (error instanceof PlanningError) throw new PlanExportError('SOURCE', error.message);
    throw error;
  }
  const same = (a: string, b: string) => samePath(a, b, index.caseSensitivePaths, index.normalizationInsensitivePaths);
  const item = findWork(index.work, work, same);
  if (!item) throw new PlanExportError('WORK', `No registered work item matches ${work}. Use a work ID such as work-0001 or the work folder's planning-relative path.`);
  const folder = path.resolve(index.root, item.path);
  let actual: string;
  try { actual = await realpath(folder); }
  catch { throw new PlanExportError('WORK', `The folder of ${item.id} (${item.path}) is missing.`); }
  const relative = path.relative(index.root, actual);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !(await stat(actual)).isDirectory()) {
    throw new PlanExportError('WORK', `${item.id} is not a folder inside the planning folder, so it cannot be exported.`);
  }
  const warnings: string[] = [];
  const names = await workFiles(actual, warnings);
  const files: (PlanExportFile & { data: string })[] = [];
  for (const name of names) {
    const bytes = await readFile(path.join(actual, ...name.split('/')));
    files.push({ path: name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), data: bytes.toString('base64') });
  }
  const location = item.path.startsWith('archive/') ? 'archive' : 'active';
  if (!item.path.startsWith('archive/') && !item.path.startsWith('active/')) warnings.push(`${item.path} is neither active nor archived work; an import places it under active/.`);
  const currentPlan = item.currentPlan && item.currentPlan.startsWith(item.path + '/') ? item.currentPlan.slice(item.path.length + 1) : null;
  if (currentPlan && !names.includes(currentPlan)) throw new PlanExportError('WORK', `The main plan ${item.currentPlan} could not be exported.`);
  const repositories = item.repositories.map(id => {
    const registered = index.repositories.find(repository => repository.id === id) as (PlanExportRepository & Record<string, unknown>) | undefined;
    return { id, name: registered?.name ?? id, ...(typeof registered?.remote === 'string' ? { remote: registered.remote } : {}) };
  });
  const manifest: PlanExportManifest = {
    format: planExportFormat, version: planExportVersion, atlasVersion, exportedAt: (options.now ?? new Date()).toISOString(),
    source: { planningFolder: path.basename(index.root), workId: item.id, title: item.title, location, path: item.path, currentPlan, repositories },
    files: files.map(({ path: name, size, sha256 }) => ({ path: name, size, sha256 })),
  };
  const view: PlanView = {
    work: { id: item.id, title: item.title, path: item.path, design: item.design, implementation: item.implementation, created: item.created, updated: item.updated, accepted: item.accepted, completed: item.completed, progress: item.progress ?? null, location, repositories },
    plan: currentPlan,
    ledger: item.ledger ? workRelative(item.ledger, item.path) : null,
    documents: item.documents.map(document => ({ path: workRelative(document.path, item.path), title: document.title, category: document.category, format: document.format })).filter(document => names.includes(document.path)),
    diagrams: await diagramsFor(actual, item, item.documents, same, warnings),
  };
  const html = viewerTemplate()
    .replace('<!--ATLAS_TITLE-->', () => escapeHtml(item.title))
    .replace('<!--ATLAS_PAYLOAD-->', () => `<script id="${payloadId}" type="application/json">${inline({ ...manifest, files })}</script>\n<script id="${viewId}" type="application/json">${inline(view)}</script>`);
  const bytes = Buffer.byteLength(html);
  if (bytes > planExportWarningBytes) warnings.push(`This export is ${(bytes / 1048576).toFixed(1)} MB, larger than 50 MB; some browsers and mail systems handle files this large slowly or not at all.`);
  return { html, manifest, bytes, warnings };
}

// ---------------------------------------------------------------------------
// Importing

interface TargetState { root: string; registryText: string; registry: { repositories: Record<string, unknown>[]; work_items: Record<string, unknown>[] } }

async function targetState(planningRoot: string): Promise<TargetState> {
  let root: string;
  try { root = await realpath(planningRoot); }
  catch { throw new PlanExportError('TARGET', `${planningRoot} does not exist. Choose a planning folder, or create one with the atlas-bootstrap skill.`); }
  const { errors } = validatePlanning(root);
  if (errors.length) {
    throw new PlanExportError('TARGET', `${root} is not a valid planning repository, so nothing was imported. Create one with the atlas-bootstrap skill, or fix what atlas planning check reports:\n` + errors.slice(0, 10).map(error => '  ' + error).join('\n'));
  }
  const registryText = await readFile(path.join(root, 'planning.json'), 'utf8');
  return { root, registryText, registry: JSON.parse(registryText.replace(/^﻿/, '')) };
}

function nextTarget(state: TargetState, source: PlanExportSource): PlanImportTarget {
  let highest = 0;
  for (const item of state.registry.work_items) {
    const match = typeof item.id === 'string' ? workIdentity.exec(item.id) : null;
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  // A number an unregistered folder already uses is not free either.
  const taken = new Set<number>();
  for (const location of ['active', 'archive']) {
    let names: string[] = [];
    try { names = readdirSync(path.join(state.root, location)); } catch { /* No such folder yet. */ }
    for (const name of names) { const match = /^([0-9]+)-/.exec(name); if (match) taken.add(Number(match[1])); }
  }
  let next = highest + 1;
  while (taken.has(next)) next++;
  const number = String(next).padStart(4, '0');
  const slug = path.posix.basename(source.path).replace(/^[0-9]+-/, '') || 'imported-plan';
  return { workId: 'work-' + number, path: source.location + '/' + number + '-' + slug };
}

/** The work ID and folder an import into `planningRoot` would use now. Writes nothing. */
export async function planImportTarget(planningRoot: string, manifest: PlanExportManifest): Promise<PlanImportTarget> {
  return nextTarget(await targetState(planningRoot), manifest.source);
}

/** Rewrite one top-level frontmatter field whose value is `from`, keeping quoting and line endings. */
function rewriteFrontmatter(bytes: Buffer, field: string, from: string, to: string): Buffer | null {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text.slice(bom.length));
  if (!header) return null;
  const start = bom.length + 4 + (text[bom.length + 3] === '\r' ? 1 : 0);
  const block = header[1];
  const line = new RegExp(`^(${field}:[ \\t]*)(["']?)${from}\\2([ \\t]*(?:#.*)?)$`, 'm');
  const match = line.exec(block);
  if (!match) return null;
  const replaced = block.slice(0, match.index) + match[1] + match[2] + to + match[2] + match[3] + block.slice(match.index + match[0].length);
  return Buffer.from(text.slice(0, start) + replaced + text.slice(start + block.length), 'utf8');
}

interface Rewrite { file: string; field: string; from: string; to: string; revision?: string }
interface PathRewrite { file: string; recordId: string; from: string; to: string }

/** Rewrite a record path that reaches into the source work folder through the planning root. */
function relocatedRecordPath(raw: unknown, sourcePath: string, contents: Map<string, Buffer>): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) return null;
  const hash = raw.indexOf('#');
  const fragment = hash < 0 ? '' : raw.slice(hash);
  const clean = (hash < 0 ? raw : raw.slice(0, hash)).replaceAll('\\', '/');
  if (!clean || clean.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
  const inside = (candidate: string) => contents.has(candidate) ? candidate : null;
  // `active/0003-x/plan.md`: written relative to the planning root.
  if (clean.startsWith(sourcePath + '/')) {
    const target = inside(clean.slice(sourcePath.length + 1));
    if (target && !contents.has(clean)) return target + fragment;
  }
  // `../../active/0003-x/plan.md`: up to the planning root and back into the source folder.
  if (!clean.split('/').includes('..')) return null;
  const resolved = path.posix.normalize(sourcePath + '/' + clean);
  if (resolved.startsWith(sourcePath + '/')) {
    const target = inside(resolved.slice(sourcePath.length + 1));
    if (target) return target + fragment;
  }
  return null;
}

async function renameWithRetry(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; }
    catch (error) {
      // Windows briefly refuses to move folders that indexers or scanners have open.
      if (attempt >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') || existsSync(to)) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 + attempt * 25));
    }
  }
}

/**
 * Import a plan export as new work under the next free number. The work folder is
 * written to a temporary folder and renamed into place, then registered in
 * planning.json. Nothing is committed and the README index is left for the user.
 */
export async function importPlan(planningRoot: string, html: string | Uint8Array): Promise<PlanImportResult> {
  const { preview, contents } = decodePlanExport(html);
  const { manifest } = preview;
  const source = manifest.source;
  const state = await targetState(planningRoot);
  const target = nextTarget(state, source);
  const notes: string[] = [];

  // Prepare the registry text first, so a registry Atlas cannot extend is refused before anything is written.
  const known = new Set(state.registry.repositories.map(item => item.id));
  const addedRepositories = source.repositories.filter(item => !known.has(item.id));
  let registryText: string;
  try {
    registryText = appendRegistryEntries(state.registryText, 'repositories', addedRepositories.map(item => ({ ...item })));
    registryText = appendRegistryEntries(registryText, 'work_items', [{ id: target.workId, path: target.path, repositories: source.repositories.map(item => item.id), current_plan: source.currentPlan === null ? null : target.path + '/' + source.currentPlan }]);
  } catch (error) {
    if (error instanceof RegistryFormatError) throw new PlanExportError('TARGET', error.message);
    throw error;
  }

  const finalFolder = path.join(state.root, ...target.path.split('/'));
  const parent = path.dirname(finalFolder);
  if (existsSync(finalFolder)) throw new PlanExportError('CONFLICT', `${target.path} already exists; nothing was imported.`);
  const createdParent = await mkdir(parent, { recursive: true });
  const temporary = path.join(parent, '.atlas-import-' + randomUUID());
  let moved = false;
  try {
    for (const [name, bytes] of contents) {
      const file = path.join(temporary, ...name.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: 'wx' });
    }
    const rewrites: Rewrite[] = [];
    const write = async (name: string, bytes: Buffer) => writeFile(path.join(temporary, ...name.split('/')), bytes);
    if (source.currentPlan) {
      const rewritten = rewriteFrontmatter(contents.get(source.currentPlan)!, 'id', source.workId, target.workId);
      if (rewritten) { await write(source.currentPlan, rewritten); rewrites.push({ file: source.currentPlan, field: 'id', from: source.workId, to: target.workId }); }
      else notes.push(`The main plan ${source.currentPlan} has no id: ${source.workId} metadata line, so its identity was not rewritten.`);
    } else notes.push('This work item has no registered main plan.');
    if (contents.has('ledger.md')) {
      const rewritten = rewriteFrontmatter(contents.get('ledger.md')!, 'work_id', source.workId, target.workId);
      if (rewritten) { await write('ledger.md', rewritten); rewrites.push({ file: 'ledger.md', field: 'work_id', from: source.workId, to: target.workId }); }
      else notes.push(`ledger.md has no work_id: ${source.workId} status line, so it was kept as exported.`);
    }

    const pathRewrites: PathRewrite[] = [];
    let revisions = 0;
    const handles = [...contents.keys()].map(name => modelFile.exec(name)?.[1]).filter((handle): handle is string => Boolean(handle));
    if (handles.length) {
      const { default: atlas } = await import('@envsemble/atlas-diagrams');
      const workspace = atlas.createWorkspace(temporary);
      for (const handle of handles) {
        const file = '.atlas/models/' + handle + '.json';
        let document: AtlasDocument;
        try { document = workspace.load(handle); }
        catch { notes.push(`The model ${file} has an invalid or unrecorded update; it was imported unchanged.`); continue; }
        const reassign = document.workId === source.workId;
        if (document.workId && !reassign) notes.push(`The model ${file} is assigned to ${document.workId}, not ${source.workId}; its work ID was kept.`);
        const records = document.context.records.map(record => {
          const relocated = relocatedRecordPath(record.path, source.path, contents);
          if (!relocated) return record;
          pathRewrites.push({ file, recordId: record.id, from: record.path as string, to: relocated });
          return { ...record, path: relocated };
        });
        const relocated = records.some((record, position) => record !== document.context.records[position]);
        if (!reassign && !relocated) continue;
        const revised = atlas.reviseDocument(document, {
          ...(reassign ? { workId: target.workId } : {}),
          ...(relocated ? { context: { ...document.context, records } } : {}),
          reason: 'Imported as ' + target.workId,
        }, document.revision.id);
        workspace.save(revised, document.revision.id);
        revisions++;
        if (reassign) rewrites.push({ file, field: 'workId', from: source.workId, to: target.workId, revision: revised.revision.id });
      }
    }

    let provenanceName = 'evidence/import-provenance.json';
    for (let suffix = 2; contents.has(provenanceName); suffix++) provenanceName = `evidence/import-provenance-${suffix}.json`;
    if (provenanceName !== 'evidence/import-provenance.json') notes.push(`The export already carried an import record; this import is recorded in ${provenanceName}.`);
    const provenance = {
      format: 'atlas/import-provenance', version: 1, importedAt: new Date().toISOString(),
      importedAs: target,
      source: { planningFolder: source.planningFolder, workId: source.workId, title: source.title, location: source.location, path: source.path },
      export: { exportedAt: manifest.exportedAt, atlasVersion: manifest.atlasVersion, importedWith: atlasVersion },
      identityRewrites: rewrites,
      recordPathRewrites: pathRewrites,
    };
    const provenanceFile = path.join(temporary, ...provenanceName.split('/'));
    await mkdir(path.dirname(provenanceFile), { recursive: true });
    await writeFile(provenanceFile, JSON.stringify(provenance, null, 2) + '\n', { flag: 'wx' });

    // Place the folder, then register it, checking that nobody changed the registry meanwhile.
    if (existsSync(finalFolder)) throw new PlanExportError('CONFLICT', `${target.path} appeared during the import; nothing was imported.`);
    await renameWithRetry(temporary, finalFolder);
    moved = true;
    const registryFile = path.join(state.root, 'planning.json');
    if (await readFile(registryFile, 'utf8') !== state.registryText) throw new PlanExportError('CONFLICT', 'planning.json changed during the import; nothing was imported. Try again.');
    const registryTemporary = registryFile + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(registryTemporary, registryText, { flag: 'wx' });
      await renameWithRetry(registryTemporary, registryFile);
    } finally { await rm(registryTemporary, { force: true }); }

    const count = contents.size + 1 + revisions;
    notes.unshift(
      `Imported ${source.workId} “${source.title}” from ${source.planningFolder} as ${target.workId} in ${target.path}.`,
      ...rewrites.map(item => `Rewrote ${item.field} in ${item.file} from ${item.from} to ${item.to}${item.revision ? ' through a recorded model revision' : ''}.`),
      ...pathRewrites.map(item => `Rewrote the reference ${item.from} in ${item.file} to ${item.to}.`),
      ...addedRepositories.map(item => `Registered the repository ${item.id} (${item.name}) in planning.json.`),
      `Registered ${target.workId} in planning.json and recorded the origin in ${provenanceName}.`,
    );
    for (const error of validatePlanning(state.root).errors) notes.push('atlas planning check: ' + error);
    notes.push('Add the work item to the planning README index yourself or ask an agent; the import does not edit it.', 'Nothing was committed.');
    return { workId: target.workId, path: target.path, files: count, notes };
  } catch (error) {
    await rm(moved ? finalFolder : temporary, { recursive: true, force: true });
    // Remove a location folder this import created; rmdir leaves it if anything else appeared there.
    if (createdParent) await rmdir(createdParent).catch(() => undefined);
    throw error;
  }
}

/** Planning-relative work folder for a filesystem path, when it lies inside `planningRoot`. */
export function planningRelative(planningRoot: string, location: string): string | null {
  try {
    const root = realpathSync(planningRoot);
    const target = realpathSync(path.resolve(location));
    if (!statSync(target).isDirectory()) return null;
    const relative = path.relative(root, target);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : null;
  } catch { return null; }
}
