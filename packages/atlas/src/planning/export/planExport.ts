// Portable plan export: one self-contained HTML file carrying a whole work folder
// losslessly, and its import into a planning folder as new work.
//
// The diagram layout loads lazily, so the command's planning checks stay light
// when they import the package entry.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, realpath, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';
import { parseFrontmatter, validatePlanning } from '../check/check.ts';
import { PlanningError, loadPlanning } from '../reading/planning.ts';
import { samePath, workRelative } from '../system/paths.ts';
import type { Provenance } from '../reading/provenance.ts';
import { describeFiles, isDiagram } from '../reading/diagrams.ts';
import { appendRegistryEntries, RegistryFormatError } from '../work/registryText.ts';
import { acquireImportLock, ImportLockBusyError } from '../home/importLock.ts';
import { localDate, planningLedger } from '../work/work.ts';
import type { HandoffLink, Work } from '../types.ts';
import { handoffLinksAt } from '../work/handoffs.ts';
import { packageJson, planViewerFile } from '../../packageFiles.ts';

const { version: atlasVersion } = JSON.parse(readFileSync(packageJson, 'utf8')) as { version: string };

export const planExportFormat = 'atlas/plan-export';
export const planExportVersion = 1;
/** Exports above this size are written with a warning. */
export const planExportWarningBytes = 50 * 1024 * 1024;
/**
 * The practical limit on a work folder's total file size. Base64 makes the HTML a third
 * larger, and one JavaScript string holds at most about 512 million characters, so a
 * larger export could be neither written nor read back.
 */
export const planExportMaxBytes = 300 * 1024 * 1024;
/**
 * Seams for tests: the longest HTML an import reads, and faults injected into an
 * import and its rollback. Not part of the public entry.
 */
export const planExportTesting: {
  maxInputLength: number;
  afterRegister?: () => void | Promise<void>;
  removeFolder?: (folder: string) => Promise<void>;
} = { maxInputLength: Math.ceil(planExportMaxBytes / 3) * 4 + 64 * 1024 * 1024 };
const payloadId = 'atlas-plan-export';
const viewId = 'atlas-plan-view';
const workIdentity = /^work-([0-9]{4,})$/;
const BOM = String.fromCharCode(0xfeff);
const leftoverPrefix = '.atlas-import-';
const leftoverName = /^\.atlas-import-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export interface PlanExportRepository { id: string; name: string; remote?: string }
export interface PlanExportSource {
  /** Name of the planning folder the work was exported from. */
  planningFolder: string;
  workId: string;
  title: string;
  location: 'active' | 'archive';
  /** Planning-relative work folder at export time. */
  path: string;
  /** The registered main plan, a Markdown file relative to the work folder, or null. */
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
export interface PlanExportDiagram { path: string; title: string; provenance: Provenance }
/** A validated plan export. It is frozen; pass it to `importPlan` to import without reading the file again. */
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
export interface PlanImportOptions {
  /** How long to wait for another import into the same planning folder to finish (default 30 s). */
  lockWaitMs?: number;
}
export type PlanExportErrorCode =
  | 'FORMAT' // not a plan export, malformed payload or manifest
  | 'VERSION' // a plan export of an unknown version
  | 'PATH' // an unsafe or non-portable file path
  | 'DUPLICATE' // the same path or repository more than once
  | 'INTEGRITY' // a size or SHA-256 mismatch
  | 'LIMIT' // larger than a plan export can be
  | 'SOURCE' // the folder to export from is not a readable planning folder
  | 'WORK' // the work item to export was not found or cannot be exported
  | 'TARGET' // the folder to import into is not a valid planning repository, or the import would make it invalid
  | 'CONFLICT' // another import is running, or the target changed during the import
  | 'ROLLBACK'; // an import failed and could not undo everything it wrote; the message says what is left

/** A rejected export or import. Nothing has been written (or everything was rolled back) when this is thrown, except for `ROLLBACK`. */
export class PlanExportError extends Error {
  readonly code: PlanExportErrorCode;
  constructor(code: PlanExportErrorCode, message: string) {
    super(message);
    this.name = 'PlanExportError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Paths and text

// eslint-disable-next-line no-control-regex
const controlCharacter = /[\u0000-\u001f\u007f-\u009f]/;
// Invisible direction controls that could make a path read differently from what it is.
const bidiControl = new RegExp('[' + String.fromCharCode(0x61c, 0x200e, 0x200f, 0x202a) + '-' + String.fromCharCode(0x202e, 0x2066) + '-' + String.fromCharCode(0x2069) + ']');
const reservedName = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;
/** Why a work-folder-relative path is not safe and portable, or null when it is. */
export function planExportPathProblem(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return 'is empty';
  if (value.length > 1024) return 'is longer than 1024 characters';
  if (value.startsWith('/') || /^[a-z]:/i.test(value) || value.startsWith('\\')) return 'is absolute';
  if (value.includes('\\')) return 'uses a backslash; paths use forward slashes';
  if (controlCharacter.test(value) || /[:*?"<>|]/.test(value)) return 'contains a character that is not portable';
  if (bidiControl.test(value)) return 'contains an invisible text-direction control';
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
/** Paths that one case-insensitive or normalizing filesystem would store as the same entry. */
const pathKey = (value: string) => value.normalize('NFC').toLowerCase();
const printableTitle = (value: string) => value.replace(new RegExp(controlCharacter.source, 'g'), String.fromCharCode(0xfffd));
const isMarkdown = (name: string) => /\.md$/i.test(name) && !name.startsWith('.atlas/');
/** The work folder's diagram files: every `.puml` outside `.atlas/`. */
const isDiagramFile = (name: string) => isDiagram(name) && !name.startsWith('.atlas/');

// ---------------------------------------------------------------------------
// Reading an export

interface Decoded { preview: PlanExportPreview; contents: Map<string, Buffer> }
type ParsedNode = { nodeName: string; tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: ParsedNode[]; value?: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const base64 = /^[A-Za-z0-9+/]*={0,2}$/;
const tooLarge = () => new PlanExportError('LIMIT', `This file is too large to be a plan export; plan exports carry at most ${planExportMaxBytes / 1048576} MB of files.`);
/** Decoded contents of validated previews, so an import need not read the file again. */
const decodedPreviews = new WeakMap<PlanExportPreview, Map<string, Buffer>>();

function payloadText(input: string | Uint8Array): string {
  let html: string;
  if (typeof input === 'string') {
    if (input.length > planExportTesting.maxInputLength) throw tooLarge();
    html = input;
  } else if (input instanceof Uint8Array) {
    if (input.length > planExportTesting.maxInputLength) throw tooLarge();
    try { html = new TextDecoder('utf-8', { fatal: true }).decode(input); }
    catch (error) {
      if (error instanceof RangeError) throw tooLarge();
      throw new PlanExportError('FORMAT', 'This file is not UTF-8 text, so it is not an Atlas plan export.');
    }
  } else throw new PlanExportError('FORMAT', 'Provide the plan export as HTML text or bytes.');
  let tree: ParsedNode;
  try {
    tree = parse(html, { onParseError: error => { if (error.code === 'duplicate-attribute') throw new PlanExportError('FORMAT', 'The plan export repeats an HTML attribute, so its payload is ambiguous.'); } }) as unknown as ParsedNode;
  } catch (error) {
    if (error instanceof PlanExportError) throw error;
    if (error instanceof RangeError) throw tooLarge();
    throw new PlanExportError('FORMAT', 'This file could not be read as HTML.');
  }
  const found: ParsedNode[] = [];
  let diagramExport = false;
  const pending: ParsedNode[] = [tree];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.tagName === 'script') {
      const id = node.attrs?.find(attribute => attribute.name === 'id')?.value;
      if (id === payloadId) found.push(node);
      if (id === 'atlas-diagram' || id === 'atlas-document') diagramExport = true;
    }
    pending.push(...node.childNodes ?? []);
  }
  if (!found.length) {
    throw new PlanExportError('FORMAT', diagramExport
      ? 'This is the offline viewer of one diagram, not a plan export.'
      : 'This file is not an Atlas plan export: it has no plan payload.');
  }
  if (found.length > 1) throw new PlanExportError('FORMAT', 'The plan export has more than one payload.');
  if (found[0].attrs?.find(attribute => attribute.name === 'type')?.value !== 'application/json') throw new PlanExportError('FORMAT', 'The plan payload must be inert JSON.');
  return (found[0].childNodes ?? []).map(node => node.value ?? '').join('');
}

/** A nonempty string without control characters, which could otherwise rewrite a terminal or log. */
function textField(record: Record<string, unknown>, field: string, label: string, optional = false): string {
  const value = record[field];
  if (optional && value === undefined) return undefined as unknown as string;
  if (typeof value !== 'string' || !value.trim()) throw new PlanExportError('FORMAT', `The plan export's ${label} must be a nonempty string.`);
  if (controlCharacter.test(value)) throw new PlanExportError('FORMAT', `The plan export's ${label} contains control characters.`);
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
  return value;
}

/** Validate a parsed payload completely: format, text, paths, duplicates, sizes and hashes. */
function validatePayload(payload: unknown): Decoded {
  if (!isObject(payload) || payload.format !== planExportFormat) throw new PlanExportError('FORMAT', `This file is not an ${planExportFormat} payload.`);
  if (payload.version !== planExportVersion) throw new PlanExportError('VERSION', `This plan export uses version ${JSON.stringify(payload.version)}; this Atlas reads version ${planExportVersion}. Use an Atlas release that supports it.`);
  const exportedAt = textField(payload, 'exportedAt', 'export time');
  if (!Number.isFinite(Date.parse(exportedAt))) throw new PlanExportError('FORMAT', "The plan export's export time is not a date.");
  const version = textField(payload, 'atlasVersion', 'Atlas version');
  if (!isObject(payload.source)) throw new PlanExportError('FORMAT', 'The plan export does not describe its source work item.');
  const source = payload.source;
  const workId = textField(source, 'workId', 'work ID');
  if (!workIdentity.test(workId)) throw new PlanExportError('FORMAT', "The plan export's work ID is not a work-NNNN identity.");
  if (source.location !== 'active' && source.location !== 'archive') throw new PlanExportError('FORMAT', "The plan export's location must be active or archive.");
  const sourcePath = textField(source, 'path', 'source folder');
  const sourceProblem = planExportPathProblem(sourcePath);
  if (sourceProblem) throw new PlanExportError('PATH', `The source folder ${JSON.stringify(sourcePath)} ${sourceProblem}.`);
  const title = textField(source, 'title', 'title');
  const planningFolder = textField(source, 'planningFolder', 'planning folder');
  if (source.currentPlan !== null && typeof source.currentPlan !== 'string') throw new PlanExportError('FORMAT', "The plan export's main plan must be a path or null.");
  if (!Array.isArray(source.repositories)) throw new PlanExportError('FORMAT', "The plan export's repositories must be a list.");
  const repositories: PlanExportRepository[] = source.repositories.map(item => {
    if (!isObject(item)) throw new PlanExportError('FORMAT', 'A repository in the plan export is not an object.');
    const id = textField(item, 'id', 'repository ID');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new PlanExportError('FORMAT', `The repository ID ${JSON.stringify(id)} is invalid.`);
    const remote = textField(item, 'remote', 'repository remote', true);
    return { id, name: textField(item, 'name', 'repository name'), ...(remote === undefined ? {} : { remote }) };
  });
  if (new Set(repositories.map(item => item.id)).size !== repositories.length) throw new PlanExportError('DUPLICATE', 'The plan export lists a repository twice.');
  if (!Array.isArray(payload.files)) throw new PlanExportError('FORMAT', 'The plan export has no file list.');

  // Check every entry's shape and the declared total before decoding anything.
  let declared = 0;
  const entries = payload.files.map(item => {
    if (!isObject(item)) throw new PlanExportError('FORMAT', 'A file entry in the plan export is not an object.');
    const problem = planExportPathProblem(item.path);
    if (problem) throw new PlanExportError('PATH', `The path ${JSON.stringify(item.path)} ${problem}.`);
    const name = item.path as string;
    if (typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 0) throw new PlanExportError('FORMAT', `The size of ${name} is invalid.`);
    if (typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)) throw new PlanExportError('FORMAT', `The SHA-256 of ${name} is invalid.`);
    declared += item.size;
    return { name, size: item.size, sha256: item.sha256, data: item.data };
  });
  if (declared > planExportMaxBytes) throw tooLarge();

  // One entry per path, and no file or folder that a case-insensitive or normalizing filesystem would merge.
  const fileKeys = new Map<string, string>(), folderKeys = new Map<string, string>();
  for (const { name } of entries) {
    const key = pathKey(name);
    if (fileKeys.has(key)) throw new PlanExportError('DUPLICATE', `The plan export contains ${name} more than once${fileKeys.get(key) === name ? '' : ` (also as ${fileKeys.get(key)})`}.`);
    fileKeys.set(key, name);
    const segments = name.split('/');
    for (let index = 1; index < segments.length; index++) {
      const folder = segments.slice(0, index).join('/');
      const spelled = folderKeys.get(pathKey(folder));
      if (spelled !== undefined && spelled !== folder) throw new PlanExportError('DUPLICATE', `The plan export has the folders ${spelled}/ and ${folder}/, which one filesystem would merge.`);
      folderKeys.set(pathKey(folder), folder);
    }
  }
  for (const [key, folder] of folderKeys) if (fileKeys.has(key)) throw new PlanExportError('PATH', `${folder} is both a file and a folder in the plan export.`);

  const files: PlanExportFile[] = [];
  const contents = new Map<string, Buffer>();
  for (const { name, size, sha256, data } of entries) {
    if (typeof data !== 'string' || data.length % 4 !== 0 || !base64.test(data)) throw new PlanExportError('INTEGRITY', `The contents of ${name} are not valid base64.`);
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length !== size) throw new PlanExportError('INTEGRITY', `${name} has ${bytes.length} bytes, but the manifest records ${size}.`);
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new PlanExportError('INTEGRITY', `${name} does not match its recorded SHA-256; the file was changed after export.`);
    files.push({ path: name, size, sha256 });
    contents.set(name, bytes);
  }
  const currentPlan = source.currentPlan as string | null;
  if (currentPlan !== null) {
    if (!contents.has(currentPlan)) throw new PlanExportError('FORMAT', `The main plan ${currentPlan} is not among the exported files.`);
    if (!isMarkdown(currentPlan)) throw new PlanExportError('FORMAT', `The main plan ${currentPlan} must be a Markdown file in the work folder, outside .atlas/.`);
  }

  const manifest: PlanExportManifest = {
    format: planExportFormat, version: planExportVersion, atlasVersion: version, exportedAt,
    source: { planningFolder, workId, title, location: source.location, path: sourcePath, currentPlan, repositories },
    files,
  };
  const diagrams: PlanExportDiagram[] = describeFiles(files.filter(file => isDiagramFile(file.path)).map(file => ({ path: file.path, text: contents.get(file.path)!.toString('utf8') })))
    .map(diagram => ({ path: diagram.path, title: printableTitle(diagram.title), provenance: diagram.provenance }));
  const preview = deepFreeze({ manifest, files: files.map(({ path: name, size }) => ({ path: name, size })), diagrams, totalBytes: files.reduce((sum, file) => sum + file.size, 0) });
  decodedPreviews.set(preview, contents);
  return { preview, contents };
}

function decodePlanExport(input: string | Uint8Array): Decoded {
  let payload: unknown;
  try { payload = JSON.parse(payloadText(input)); }
  catch (error) {
    if (error instanceof PlanExportError) throw error;
    if (error instanceof RangeError) throw tooLarge();
    throw new PlanExportError('FORMAT', 'The plan payload is not valid JSON.');
  }
  return validatePayload(payload);
}

/**
 * Validate a plan export and describe it without writing anything. Throws a
 * {@link PlanExportError} for any invalid input. The frozen result can be passed to
 * `importPlan` instead of the file.
 */
export function readPlanExport(html: string | Uint8Array): PlanExportPreview {
  return decodePlanExport(html).preview;
}

// ---------------------------------------------------------------------------
// Exporting

interface ViewDocument { path: string; title: string; category: string; format: string }
/** A link to a diagram from a document of the work folder: under its `section` heading, naming `element`. */
interface ViewReference { path: string; section: string | null; element: string | null }
interface ViewDiagram {
  path: string; title: string; provenance: Provenance; payload: unknown | null; error: string | null; references: ViewReference[];
}
/** Derived viewer data. Import ignores it; the files in the payload are authoritative. */
interface PlanView {
  work: Pick<Work, 'id' | 'title' | 'path' | 'design' | 'implementation' | 'created' | 'updated' | 'accepted' | 'completed' | 'progress'> & { location: string; repositories: PlanExportRepository[]; continues: HandoffLink[]; continuedIn: HandoffLink[] };
  plan: string | null; ledger: string | null; documents: ViewDocument[]; diagrams: ViewDiagram[];
}

// Left out of exports: generated working files, and the agent-reported statistics, which describe
// how this planning folder's agents worked rather than the plan itself.
const transient = /^\.atlas\/(?:results|prepared|exports)(?:\/|$)|^\.atlas\/.*\.(?:lock|tmp)$|^\.atlas\/statistics\.jsonl$/;
async function workFiles(folder: string, warnings: string[]) {
  const result: { name: string; size: number }[] = [];
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
        result.push({ name: child, size: (await stat(path.join(directory, entry.name))).size });
      } else warnings.push(`Skipped ${child}, which is not a regular file.`);
    }
  }
  await walk(folder, '');
  return result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function inline(value: unknown) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}
let template: string | undefined;
function viewerTemplate() {
  if (template) return template;
  const file = planViewerFile;
  if (!existsSync(file)) throw new Error('The plan viewer is not built. Run npm run build --workspace @envsemble/atlas.');
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

/** The work folder's diagrams, drawn as the app draws them, with the links to them from its documents. */
async function diagramsFor(files: { path: string; data: string }[], warnings: string[]): Promise<ViewDiagram[]> {
  const text = (file: { data: string }) => Buffer.from(file.data, 'base64').toString('utf8');
  const sources = files.filter(file => isDiagramFile(file.path)).map(file => ({ path: file.path, text: text(file) }));
  if (!sources.length) return [];
  const { default: atlas } = await import('@envsemble/atlas-diagrams');
  const described = describeFiles(sources);
  // Each family is laid out on its own, as the app lays it out, so one that fails leaves the rest drawn.
  const prepared = new Map<string, unknown>();
  for (const root of new Set(described.filter(diagram => diagram.valid).map(diagram => diagram.family ?? diagram.path))) {
    try { for (const [name, viewer] of (await atlas.prepareDiagrams({ files: sources, paths: [root] })).prepared) prepared.set(name, viewer.payload); }
    catch { /* The family's diagrams are reported as not drawn below. */ }
  }
  const references = new Map<string, ViewReference[]>();
  // The Markdown parser loads only for an export, so the commands that never export start faster.
  const [{ diagramLinks }, { markdownBody }] = await Promise.all([import('../reading/diagramLinks.ts'), import('../reading/headings.ts')]);
  for (const file of files) {
    if (!isMarkdown(file.path)) continue;
    for (const link of diagramLinks(markdownBody(text(file)), file.path)) references.set(link.target, [...references.get(link.target) ?? [], { path: file.path, section: link.section, element: link.element }]);
  }
  return described.map(diagram => {
    const payload = prepared.get(diagram.path) ?? null;
    const problem = diagram.problems.find(item => item.severity === 'error');
    const error = payload ? null : problem ? `Line ${problem.line}: ${problem.message}` : 'This diagram cannot be drawn.';
    if (error) warnings.push(`The diagram ${diagram.path} is exported but cannot be drawn in the viewer.`);
    return { path: diagram.path, title: diagram.title, provenance: diagram.provenance, payload, error, references: references.get(diagram.path) ?? [] };
  });
}

/**
 * Export a work item, by work ID or planning-relative folder, as one self-contained
 * HTML file. Nothing is written; the caller saves `html`. An export that no import
 * would accept (non-portable paths, control characters, a non-Markdown main plan,
 * more than {@link planExportMaxBytes}) is refused.
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
  const listed = await workFiles(actual, warnings);
  if (listed.reduce((sum, file) => sum + file.size, 0) > planExportMaxBytes) {
    throw new PlanExportError('LIMIT', `${item.id} holds more than ${planExportMaxBytes / 1048576} MB of files, more than a plan export can carry. Move large evidence elsewhere and link to it.`);
  }
  const names = listed.map(file => file.name);
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
  // Refuse what every import would refuse, rather than writing an unimportable file.
  try { validatePayload({ ...manifest, files }); }
  catch (error) {
    if (error instanceof PlanExportError) throw new PlanExportError(error.code, `${item.id} cannot be exported: ${error.message}`);
    throw error;
  }
  const view: PlanView = {
    work: { id: item.id, title: item.title, path: item.path, design: item.design, implementation: item.implementation, created: item.created, updated: item.updated, accepted: item.accepted, completed: item.completed, progress: item.progress ?? null, location, repositories, ...handoffLinksAt(index.root, item.id) },
    plan: currentPlan,
    ledger: item.ledger ? workRelative(item.ledger, item.path) : null,
    documents: item.documents.map(document => ({ path: workRelative(document.path, item.path), title: document.title, category: document.category, format: document.format })).filter(document => names.includes(document.path)),
    diagrams: await diagramsFor(files, warnings),
  };
  const limit = () => new PlanExportError('LIMIT', `${item.id} is too large for one plan export file; move large evidence elsewhere and link to it.`);
  let html: string;
  try {
    html = viewerTemplate()
      .replace('<!--ATLAS_TITLE-->', () => escapeHtml(item.title))
      .replace('<!--ATLAS_PAYLOAD-->', () => `<script id="${payloadId}" type="application/json">${inline({ ...manifest, files })}</script>\n<script id="${viewId}" type="application/json">${inline(view)}</script>`);
  } catch (error) {
    if (error instanceof RangeError) throw limit();
    throw error;
  }
  // An export no import could read is refused.
  if (html.length > planExportTesting.maxInputLength) throw limit();
  const bytes = Buffer.byteLength(html);
  if (bytes > planExportWarningBytes) warnings.push(`This export is ${(bytes / 1048576).toFixed(1)} MB, larger than 50 MB; some browsers and mail systems handle files this large slowly or not at all.`);
  return { html, manifest, bytes, warnings };
}

// ---------------------------------------------------------------------------
// Importing

interface Registry { repositories: Record<string, unknown>[]; work_items: Record<string, unknown>[] }
interface TargetState { root: string; registryText: string; registry: Registry; errors: string[] }

async function planningRoot(input: string) {
  try { return await realpath(input); }
  catch { throw new PlanExportError('TARGET', `${input} does not exist. Choose a planning folder, or create one with the atlas skill.`); }
}
async function targetState(root: string): Promise<TargetState> {
  const { errors } = validatePlanning(root);
  if (errors.length) {
    throw new PlanExportError('TARGET', `${root} is not a valid planning repository, so nothing was imported. Create one with the atlas skill, or fix what atlas check reports:\n` + errors.slice(0, 10).map(error => '  ' + error).join('\n'));
  }
  const registryText = await readFile(path.join(root, 'planning.json'), 'utf8');
  return { root, registryText, registry: JSON.parse(registryText.startsWith(BOM) ? registryText.slice(1) : registryText), errors };
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
  const slug = path.posix.basename(source.path).replace(/^[0-9]+-/, '').slice(0, 100).replace(/[-. ]+$/, '') || 'imported-plan';
  return { workId: 'work-' + number, path: source.location + '/' + number + '-' + slug };
}

/** The work ID and folder an import into `planningRoot` would use now. Writes nothing. */
export async function planImportTarget(planningRootPath: string, manifest: PlanExportManifest): Promise<PlanImportTarget> {
  return nextTarget(await targetState(await planningRoot(planningRootPath)), manifest.source);
}

/** Remove hidden temporary folders that interrupted imports left behind more than an hour ago. */
async function removeLeftovers(root: string): Promise<number> {
  let removed = 0;
  try {
  for (const location of ['active', 'archive']) {
    let entries: import('node:fs').Dirent[] = [];
    try { entries = await readdir(path.join(root, location), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !leftoverName.test(entry.name)) continue;
      const folder = path.join(root, location, entry.name);
      // Best effort: a folder that cannot be removed now is left for a later import.
      try {
        if (Date.now() - (await stat(folder)).mtimeMs < 3600000) continue;
        await rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
        removed++;
      } catch { /* Left for later. */ }
    }
  }
  } catch { /* Cleanup never stops an import. */ }
  return removed;
}

function decodeText(bytes: Buffer) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return null; }
}
/** A plan's design_status, or null when its header cannot be read. */
function designOf(bytes: Buffer) {
  const text = decodeText(bytes);
  try { return text === null ? null : parseFrontmatter(text)?.design_status ?? null; } catch { return null; }
}
/** The metadata header of a Markdown text: offsets of its block, or null. */
function header(text: string) {
  const bom = text.startsWith(BOM) ? 1 : 0;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text.slice(bom));
  if (!match) return null;
  const start = bom + 4 + (text[bom + 3] === '\r' ? 1 : 0);
  return { start, end: start + match[1].length, block: match[1] };
}
/** Rewrite one top-level metadata field whose value is `from`, keeping quoting, line endings and any byte order mark. */
function rewriteField(text: string, field: string, from: string, to: string): string | null {
  const found = header(text);
  if (!found) return null;
  const match = new RegExp(`^(${field}:[ \\t]*)(["']?)${from}\\2([ \\t]*(?:#.*)?)$`, 'm').exec(found.block);
  if (!match) return null;
  const block = found.block.slice(0, match.index) + match[1] + match[2] + to + match[2] + match[3] + found.block.slice(match.index + match[0].length);
  return text.slice(0, found.start) + block + text.slice(found.end);
}
/** Clear `supersedes`, `superseded_by` and `continues`, which name work in the source planning folder or its home. */
function clearCrossWorkReferences(text: string): { text: string; supersedes: string[]; supersededBy: string | null; continues: string[] } | null {
  let metadata;
  try { metadata = parseFrontmatter(text); } catch { return null; }
  if (!metadata) return null;
  const supersedes = Array.isArray(metadata.supersedes) ? metadata.supersedes.map(String) : [];
  const supersededBy = typeof metadata.superseded_by === 'string' ? metadata.superseded_by : null;
  const continues = Array.isArray(metadata.continues) ? metadata.continues.map(String) : [];
  if (!supersedes.length && supersededBy === null && !continues.length) return { text, supersedes, supersededBy, continues };
  const found = header(text)!;
  let block = found.block;
  if (supersedes.length) block = block.replace(/^supersedes:[^\r\n]*(?:\r?\n[ \t]*-[ \t][^\r\n]*)*/m, 'supersedes: []');
  if (supersededBy !== null) block = block.replace(/^superseded_by:[^\r\n]*/m, 'superseded_by: null');
  if (continues.length) block = block.replace(/^continues:[^\r\n]*(?:\r?\n[ \t]*-[ \t][^\r\n]*)*/m, 'continues: []');
  const result = text.slice(0, found.start) + block + text.slice(found.end);
  // Accept the edit only when exactly those fields changed.
  let after;
  try { after = parseFrontmatter(result); } catch { return null; }
  const expected = { ...metadata, supersedes: [], superseded_by: null, ...continues.length ? { continues: [] } : {} };
  if (!after || JSON.stringify(expected) !== JSON.stringify({ ...after })) return null;
  return { text: result, supersedes, supersededBy, continues };
}

interface Rewrite { file: string; field: string; from: string | string[] | null; to: string | string[] | null }

/**
 * Where to record this import: `evidence/import-provenance.json` in the export's own
 * spelling of the evidence folder, numbered when that name (compared as a
 * case-insensitive, normalizing filesystem would) is already taken.
 */
function provenanceFileName(names: Iterable<string>) {
  const taken = new Set<string>(), folders = new Map<string, string>();
  for (const name of names) {
    taken.add(pathKey(name));
    const segments = name.split('/');
    for (let index = 1; index < segments.length; index++) {
      const folder = segments.slice(0, index).join('/');
      folders.set(pathKey(folder), folder);
      taken.add(pathKey(folder));
    }
  }
  const evidence = folders.get('evidence') ?? (taken.has('evidence') ? null : 'evidence');
  const base = evidence === null ? 'import-provenance' : evidence + '/import-provenance';
  let name = base + '.json';
  for (let suffix = 2; taken.has(pathKey(name)); suffix++) name = `${base}-${suffix}.json`;
  return name;
}

async function renameWithRetry(from: string, to: string, replace: boolean) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; }
    catch (error) {
      // Windows briefly refuses to move or replace entries that indexers or scanners have open.
      const busy = ['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '');
      if (attempt >= 20 || !busy || (!replace && existsSync(to))) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 + attempt * 25));
    }
  }
}
async function replaceFile(file: string, text: string) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, text, { flag: 'wx' });
    await renameWithRetry(temporary, file, true);
  } finally { await rm(temporary, { force: true }); }
}

/**
 * Import a plan export as new work under the next free number. Imports into one
 * planning folder take turns through a lock. The work folder is written to a
 * temporary folder and renamed into place, its identity is rewritten and its
 * references to other work are cleared, then it is registered in planning.json.
 * When the result would not pass `atlas planning check`, everything is rolled back.
 * Nothing is committed and the README index is left for the user.
 */
export async function importPlan(planningRootPath: string, html: string | Uint8Array | PlanExportPreview, options: PlanImportOptions = {}): Promise<PlanImportResult> {
  const known = isObject(html) && !(html instanceof Uint8Array) ? decodedPreviews.get(html as PlanExportPreview) : undefined;
  if (isObject(html) && !(html instanceof Uint8Array) && !known) throw new PlanExportError('FORMAT', 'Pass the plan export file, or a preview returned by readPlanExport.');
  const { preview, contents } = known ? { preview: html as PlanExportPreview, contents: known } : decodePlanExport(html as string | Uint8Array);
  const { manifest } = preview;
  const root = await planningRoot(planningRootPath);
  let release: () => Promise<void>;
  try { release = await acquireImportLock(root, options.lockWaitMs ?? 30000); }
  catch (error) {
    if (error instanceof ImportLockBusyError) throw new PlanExportError('CONFLICT', error.message);
    throw error;
  }
  try {
    return await importLocked(root, manifest, contents);
  } finally { await release(); }
}

async function importLocked(root: string, manifest: PlanExportManifest, contents: Map<string, Buffer>): Promise<PlanImportResult> {
  const source = manifest.source;
  const notes: string[] = [];
  const leftovers = await removeLeftovers(root);
  if (leftovers) notes.push(`Removed ${leftovers} temporary folder${leftovers === 1 ? '' : 's'} left by interrupted imports.`);
  const state = await targetState(root);
  const target = nextTarget(state, source);

  // Prepare the registry text first, so a registry Atlas cannot extend is refused before anything is written.
  const registered = new Map(state.registry.repositories.map(item => [item.id, item]));
  const addedRepositories = source.repositories.filter(item => !registered.has(item.id));
  for (const item of source.repositories) {
    const existing = registered.get(item.id);
    if (!existing) continue;
    const differences = [existing.name !== item.name && `named “${String(existing.name)}” here and “${item.name}” in the export`, item.remote !== undefined && existing.remote !== item.remote && `with remote ${existing.remote === undefined ? 'unset' : String(existing.remote)} here and ${item.remote} in the export`].filter(Boolean);
    if (differences.length) notes.push(`The repository ${item.id} is already registered here, ${differences.join(' and ')}; the work uses the registered entry.`);
  }
  let registryText: string;
  try {
    registryText = appendRegistryEntries(state.registryText, 'repositories', addedRepositories.map(item => ({ ...item })));
    registryText = appendRegistryEntries(registryText, 'work_items', [{ id: target.workId, path: target.path, repositories: source.repositories.map(item => item.id), current_plan: source.currentPlan === null ? null : target.path + '/' + source.currentPlan }]);
  } catch (error) {
    if (error instanceof RegistryFormatError) throw new PlanExportError('TARGET', error.message);
    throw error;
  }

  const finalFolder = path.join(root, ...target.path.split('/'));
  const parent = path.dirname(finalFolder);
  if (existsSync(finalFolder)) throw new PlanExportError('CONFLICT', `${target.path} already exists; nothing was imported.`);
  const createdParent = await mkdir(parent, { recursive: true });
  const temporary = path.join(parent, leftoverPrefix + randomUUID());
  const registryFile = path.join(root, 'planning.json');
  let moved = false, registeredWork = false;
  try {
    for (const [name, bytes] of contents) {
      const file = path.join(temporary, ...name.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: 'wx' });
    }
    const rewrites: Rewrite[] = [];
    const write = (name: string, text: string) => writeFile(path.join(temporary, ...name.split('/')), text);
    if (source.currentPlan) {
      const original = decodeText(contents.get(source.currentPlan)!);
      let text = original === null ? null : rewriteField(original, 'id', source.workId, target.workId);
      if (text !== null) rewrites.push({ file: source.currentPlan, field: 'id', from: source.workId, to: target.workId });
      else { notes.push(`The main plan ${source.currentPlan} has no id: ${source.workId} metadata line, so its identity was not rewritten.`); text = original; }
      const cleared = text === null ? null : clearCrossWorkReferences(text);
      if (cleared && cleared.text !== text) {
        text = cleared.text;
        if (cleared.supersedes.length) rewrites.push({ file: source.currentPlan, field: 'supersedes', from: cleared.supersedes, to: [] });
        if (cleared.supersededBy !== null) rewrites.push({ file: source.currentPlan, field: 'superseded_by', from: cleared.supersededBy, to: null });
        if (cleared.continues.length) rewrites.push({ file: source.currentPlan, field: 'continues', from: cleared.continues, to: [] });
      }
      if (text !== null && text !== original) await write(source.currentPlan, text);
    } else notes.push('This work item has no registered main plan.');
    if (contents.has('ledger.md')) {
      const original = decodeText(contents.get('ledger.md')!);
      const text = original === null ? null : rewriteField(original, 'work_id', source.workId, target.workId);
      if (text !== null) { await write('ledger.md', text); rewrites.push({ file: 'ledger.md', field: 'work_id', from: source.workId, to: target.workId }); }
      else notes.push(`ledger.md has no work_id: ${source.workId} status line, so it was kept as exported.`);
    } else if (target.path.startsWith('active/') && source.currentPlan && designOf(contents.get(source.currentPlan)!) === 'draft') {
      // A draft without a ledger is planned from here, as new work is: with the planning steps.
      await writeFile(path.join(temporary, 'ledger.md'), planningLedger(target.workId, localDate()), { flag: 'wx' });
      notes.push('The draft had no ledger; it got one with the planning steps.');
    }

    const provenanceName = provenanceFileName(contents.keys());
    if (!/^evidence\/import-provenance\.json$/i.test(provenanceName)) notes.push(`The export already carried an import record; this import is recorded in ${provenanceName}.`);
    const provenance = {
      format: 'atlas/import-provenance', version: 1, importedAt: new Date().toISOString(),
      importedAs: target,
      source: { planningFolder: source.planningFolder, workId: source.workId, title: source.title, location: source.location, path: source.path },
      export: { exportedAt: manifest.exportedAt, atlasVersion: manifest.atlasVersion, importedWith: atlasVersion },
      identityRewrites: rewrites,
      addedRepositories,
    };
    const provenanceFile = path.join(temporary, ...provenanceName.split('/'));
    await mkdir(path.dirname(provenanceFile), { recursive: true });
    await writeFile(provenanceFile, JSON.stringify(provenance, null, 2) + '\n', { flag: 'wx' });

    // Place the folder, then register it, checking that nobody changed the registry meanwhile.
    if (existsSync(finalFolder)) throw new PlanExportError('CONFLICT', `${target.path} appeared during the import; nothing was imported.`);
    await renameWithRetry(temporary, finalFolder, false);
    moved = true;
    if (await readFile(registryFile, 'utf8') !== state.registryText) throw new PlanExportError('CONFLICT', 'planning.json changed during the import; nothing was imported. Try again.');
    await replaceFile(registryFile, registryText);
    registeredWork = true;
    await planExportTesting.afterRegister?.();

    // The import must not make the planning folder invalid.
    const before = new Set(state.errors);
    const introduced = validatePlanning(root).errors.filter(error => !before.has(error));
    if (introduced.length) throw new PlanExportError('TARGET', `Importing would leave ${root} failing atlas planning check, so nothing was imported:\n` + introduced.slice(0, 10).map(error => '  ' + error).join('\n'));

    const count = contents.size + 1;
    const describe = (value: Rewrite['from']) => Array.isArray(value) ? `[${value.join(', ')}]` : String(value);
    notes.unshift(
      `Imported ${source.workId} “${source.title}” from ${source.planningFolder} as ${target.workId} in ${target.path}.`,
      ...rewrites.map(item => ['supersedes', 'superseded_by', 'continues'].includes(item.field)
        ? `Cleared ${item.field} in ${item.file} (was ${describe(item.from)}): it named work in ${source.planningFolder}.`
        : `Rewrote ${item.field} in ${item.file} from ${describe(item.from)} to ${describe(item.to)}.`),
      ...addedRepositories.map(item => `Registered the repository ${item.id} (${item.name}${item.remote ? ', remote ' + item.remote : ''}) in planning.json.`),
      `Registered ${target.workId} in planning.json and recorded the origin in ${provenanceName}.`,
    );
    notes.push('Add the work item to the planning README index yourself or ask an agent; the import does not edit it.', 'Nothing was committed.');
    return { workId: target.workId, path: target.path, files: count, notes };
  } catch (error) {
    // Undo every step on its own, so one failure does not hide what else is left.
    const left: string[] = [];
    if (registeredWork) {
      try {
        if (await readFile(registryFile, 'utf8') === registryText) await replaceFile(registryFile, state.registryText);
        else left.push('planning.json, which changed after this import registered the work; remove the ' + target.workId + ' entry from it');
      } catch { left.push('the ' + target.workId + ' entry in planning.json; restore it with git checkout -- planning.json if it was committed, or remove the entry'); }
    }
    const folder = moved ? finalFolder : temporary;
    try { await (planExportTesting.removeFolder ?? (target => rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))(folder); }
    catch { left.push('the folder ' + folder + '; delete it'); }
    // Remove a location folder this import created; rmdir leaves it if anything else is there.
    if (createdParent) await rmdir(createdParent).catch(() => undefined);
    if (left.length) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new PlanExportError('ROLLBACK', `${reason}\nThe import could not be fully undone. Left behind: ${left.join('; ')}. Then run atlas planning check.`);
    }
    throw error;
  }
}

/** Planning-relative work folder for a filesystem path, when it lies inside `planningRoot`. */
export function planningRelative(planningRootPath: string, location: string): string | null {
  try {
    const root = realpathSync(planningRootPath);
    const target = realpathSync(path.resolve(location));
    if (!statSync(target).isDirectory()) return null;
    const relative = path.relative(root, target);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : null;
  } catch { return null; }
}
