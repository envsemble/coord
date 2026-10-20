// The planning-state operations: create and register work, accept its design, start implementation
// with its steps, change them and `blocked`, close it once nothing is open, and archive or reopen
// it. The atlas command and the MCP server both call these. Each validates its input, refuses with
// the reason when the work is not in a state that allows it, records the date in the plan's
// `updated`, and changes files the way a careful person would (only the lines that change). Nothing
// is committed: agents commit planning changes themselves.
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, type Metadata } from '../check/check.ts';
import { appendToSection, setFields, setSteps, yamlValue } from './headerText.ts';
import { HandoffGraph, parseHandoff, type HandoffReference } from '../handoffs/handoffs.ts';
import { agreed, ledgerStatus, ledgerStepStatuses, stepCounts, stepSummary } from './ledger.ts';
import { normalTag, tagCounts, tagsOf } from './tags.ts';
import { appendRegistryEntries, RegistryFormatError, updateRegistryEntry } from '../registry/registryText.ts';
import { stepLimit, workStatistics } from '../reports/reports.ts';
import type { LedgerStep, LedgerStepStatus } from '../types.ts';

export class WorkError extends Error {
  /** What stands in the way, one item each (the open items of a work item that cannot close). */
  readonly problems: string[];
  constructor(message: string, problems: string[] = []) { super(message); this.name = 'WorkError'; this.problems = problems; }
}

export interface WorkStatus {
  planningFolder: string; workId: string; title: string; path: string;
  /** The plan's `summary` header: a few plain sentences on what the work is, why, and where it stands. */
  summary: string | null;
  /** The plan's `tags`: the release it ships in and the areas it touches. */
  tags: string[];
  location: 'active' | 'archive' | 'other';
  plan: string;
  designStatus: string | null; implementationStatus: string | null;
  created: string | null; updated: string | null; acceptedAt: string | null; completedAt: string | null;
  /** The ledger's path, or null before implementation starts. */
  ledger: string | null;
  steps: LedgerStep[]; progress: string | null; blocked: string | null;
  /** What the hooks measured for the work so far. */
  statistics: { reports: number; agentMinutes: number; tokens: number | null; primaryModel: string | null };
}
export interface WorkResult extends WorkStatus {
  /** Files the operation wrote, relative to the planning folder. */
  changed: string[];
  warnings: string[];
}
/** `today` replaces the local date (tests). */
export interface OperationOptions { today?: string }

const BOM = String.fromCharCode(0xfeff);
const workIdentity = /^work-([0-9]{4,})$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ignoredFolders = new Set(['node_modules', '__pycache__', 'dist', 'build']);

/** Today's local date as YYYY-MM-DD. */
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function dateOf(options: OperationOptions) {
  const value = options.today ?? localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new WorkError('The date must be YYYY-MM-DD.');
  return value;
}

function oneLine(value: unknown, label: string, limit = stepLimit): string {
  if (typeof value !== 'string' || !value.trim()) throw new WorkError(`${label} must be nonempty text.`);
  const text = value.trim();
  if (/[\r\n\p{Zl}\p{Zp}]/u.test(text)) throw new WorkError(`${label} must be one line.`);
  if (text.length > limit) throw new WorkError(`${label} must be at most ${limit} characters.`);
  return text;
}
function stepTitles(values: unknown, label = 'Steps'): string[] {
  if (!Array.isArray(values)) throw new WorkError(label + ' must be a list of step titles.');
  const titles = values.map((value, index) => oneLine(value, `Step ${index + 1}`));
  const seen = new Set<string>();
  for (const title of titles) { if (seen.has(title)) throw new WorkError('Step titles must be unique: ' + title + '.'); seen.add(title); }
  return titles;
}

/** Write a file whole or not at all: a temporary file beside it, renamed over it. */
export async function writeText(file: string, text: string) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, text, { flag: 'wx' });
    await renameWithRetry(temporary, file);
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}
async function renameWithRetry(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; }
    catch (error) {
      // Windows briefly refuses to move entries that indexers or scanners have open.
      if (attempt >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 + attempt * 25));
    }
  }
}
const exists = (target: string) => stat(target).then(() => true, () => false);
const file = (root: string, relative: string) => path.join(root, ...relative.split('/'));

interface Entry { id: string; path: string; current_plan: string | null }
interface Loaded {
  root: string; registryText: string; entry: Entry; plan: string;
  planText: string; planMetadata: Metadata;
  ledgerText: string; ledgerSteps: LedgerStep[]; blocked: string | null;
}

async function planningRoot(input: string) {
  return realpath(input).catch(() => { throw new WorkError('The planning folder does not exist: ' + input); });
}
async function registryOf(root: string) {
  let text: string;
  try { text = await readFile(path.join(root, 'planning.json'), 'utf8'); }
  catch { throw new WorkError('The planning folder has no readable planning.json: ' + root); }
  let registry: { schema_version?: unknown; work_items?: unknown };
  try { registry = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text); } catch (error) { throw new WorkError('planning.json is not valid JSON: ' + (error as Error).message); }
  if (registry?.schema_version !== 2) throw new WorkError('planning.json is not schema version 2; atlas check says what to change.');
  if (!Array.isArray(registry.work_items)) throw new WorkError('planning.json needs a work_items list.');
  return { text, workItems: registry.work_items as Partial<Entry>[] };
}

function ledgerOf(text: string, workId: string) {
  let metadata: Metadata | null;
  try { metadata = parseFrontmatter(text, { entryLists: ['steps'] }); }
  catch (error) { throw new WorkError('The ledger header cannot be read: ' + (error as Error).message); }
  if (!metadata) throw new WorkError('The ledger has no status header; add one (PLANS.md, "Ledger status") first.');
  let status;
  try { status = ledgerStatus(metadata, workId); } catch (error) { throw new WorkError('The ledger header is invalid: ' + (error as Error).message); }
  return { steps: status.steps, blocked: status.blocked };
}

async function load(input: string, workId: string): Promise<Loaded> {
  if (typeof workId !== 'string' || !workIdentity.test(workId)) throw new WorkError('Give the work item as its ID, such as work-0001.');
  const root = await planningRoot(input);
  const registry = await registryOf(root);
  const entry = registry.workItems.find(item => item?.id === workId);
  if (!entry) throw new WorkError(`${workId} is not registered in ${root}.`);
  if (typeof entry.path !== 'string' || !entry.path || entry.path.includes('\\') || entry.path.split('/').includes('..')) throw new WorkError(`${workId} has an invalid path in planning.json.`);
  const folder = entry.path.replace(/\/+$/, ''), plan = folder + '/plan.md';
  // The plan is written: it is the work folder's plan.md, as `atlas check` requires.
  if (entry.current_plan !== plan) throw new WorkError(`${workId}'s current_plan must be ${plan}; fix planning.json first.`);
  let planText: string;
  try { planText = await readFile(file(root, plan), 'utf8'); } catch { throw new WorkError(`The plan ${plan} cannot be read.`); }
  let planMetadata: Metadata | null;
  try { planMetadata = parseFrontmatter(planText); } catch (error) { throw new WorkError(`The plan header of ${plan} cannot be read: ${(error as Error).message}`); }
  if (!planMetadata) throw new WorkError(`The plan ${plan} has no metadata header.`);
  if (planMetadata.id !== workId) throw new WorkError(`The plan ${plan} has the id ${String(planMetadata.id)}, not ${workId}.`);
  let ledgerText: string;
  try { ledgerText = await readFile(file(root, folder + '/ledger.md'), 'utf8'); } catch { throw new WorkError(`${workId} has no readable ledger.md; atlas check says what to fix.`); }
  const ledger = ledgerOf(ledgerText, workId);
  return {
    root, registryText: registry.text, entry: { id: workId, path: folder, current_plan: plan },
    plan, planText, planMetadata, ledgerText, ledgerSteps: ledger.steps, blocked: ledger.blocked,
  };
}

const text = (value: unknown) => typeof value === 'string' ? value : null;
function locationOf(relative: string): WorkStatus['location'] {
  return relative.startsWith('active/') ? 'active' : relative.startsWith('archive/') ? 'archive' : 'other';
}

/** A work item's plan statuses and dates, ledger steps and `blocked`, and a summary of its statistics. */
export async function workStatus(root: string, workId: string): Promise<WorkStatus> {
  return describe(await load(root, workId));
}
async function describe(loaded: Loaded): Promise<WorkStatus> {
  const { entry, planMetadata: plan } = loaded;
  const statistics = (await workStatistics(loaded.root, [{ id: entry.id, path: entry.path, currentPlan: loaded.plan, completed: text(plan.completed_at) }]).catch(() => ({})) as Record<string, { reports: number; agentMs: number; tokens: number | null; primaryModel: string | null }>)[entry.id];
  return {
    planningFolder: loaded.root, workId: entry.id, title: text(plan.title) ?? path.posix.basename(entry.path), summary: text(plan.summary)?.trim() || null, tags: tagsOf(plan.tags), path: entry.path, location: locationOf(entry.path),
    plan: loaded.plan,
    designStatus: text(plan.design_status), implementationStatus: text(plan.implementation_status),
    created: text(plan.created), updated: text(plan.updated), acceptedAt: text(plan.accepted_at), completedAt: text(plan.completed_at),
    ledger: entry.path + '/ledger.md',
    steps: loaded.ledgerSteps, progress: stepSummary(stepCounts(loaded.ledgerSteps)), blocked: loaded.blocked,
    statistics: { reports: statistics?.reports ?? 0, agentMinutes: Math.round((statistics?.agentMs ?? 0) / 60000), tokens: statistics?.tokens ?? null, primaryModel: statistics?.primaryModel ?? null },
  };
}
async function result(root: string, workId: string, changed: string[], warnings: string[] = []): Promise<WorkResult> {
  return { ...await workStatus(root, workId), changed, warnings };
}

/** Write the plan with these fields (and `updated`), after checking it still reads. */
async function writePlan(loaded: Loaded, fields: Record<string, string | null | string[]>, today: string) {
  const next = setFields(loaded.planText, { ...fields, updated: today });
  try { if (!parseFrontmatter(next)) throw new Error('the header disappeared'); }
  catch (error) { throw new WorkError(`The plan ${loaded.plan} could not be updated: ${(error as Error).message}`); }
  await writeText(file(loaded.root, loaded.plan), next);
  loaded.planText = next;
  return loaded.plan;
}
async function writeLedger(loaded: Loaded, next: string, location = loaded.entry.path) {
  ledgerOf(next, loaded.entry.id);
  await writeText(file(loaded.root, location + '/ledger.md'), next);
  return location + '/ledger.md';
}

function nextNumber(registered: Partial<Entry>[], folders: string[]) {
  let highest = 0;
  for (const item of registered) {
    const match = typeof item?.id === 'string' ? workIdentity.exec(item.id) : null;
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  const taken = new Set(folders.map(name => /^([0-9]+)-/.exec(name)?.[1]).filter(Boolean).map(Number));
  let next = highest + 1;
  while (taken.has(next)) next++;
  return String(next).padStart(4, '0');
}
export function slugOf(title: string) {
  return title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '') || 'work';
}

/** Tags as given, written well formed, each once; refused with the ones that cannot be tags. */
function checkedTags(values: unknown): string[] {
  if (!Array.isArray(values)) throw new WorkError('Give the tags as a list, such as ["0.8.0", "search"].');
  const bad = values.filter(value => !normalTag(value));
  if (bad.length) throw new WorkError(`Not tags: ${bad.map(value => JSON.stringify(value)).join(', ')}. A tag is lowercase letters (a-z), digits, dots and hyphens, such as 0.8.0 or tag-search.`);
  return [...new Set(values.map(value => normalTag(value)!))];
}

/** How many of the project's work items carry each tag, active and archived. */
export async function projectTags(input: string): Promise<Record<string, number>> {
  const root = await planningRoot(input);
  return tagCounts((await registeredPlans(root)).map(item => tagsOf(item.metadata.tags)));
}

/** The project's registered work items with their plan headers; ones that cannot be read are left out. */
async function registeredPlans(root: string) {
  const { workItems } = await registryOf(root);
  const plans = await Promise.all(workItems.map(async item => {
    if (typeof item?.id !== 'string' || typeof item.current_plan !== 'string' || typeof item.path !== 'string') return null;
    try {
      const metadata = parseFrontmatter(await readFile(file(root, item.current_plan), 'utf8'));
      return metadata ? { id: item.id, path: item.path, metadata } : null;
    } catch { return null; }
  }));
  return plans.filter(plan => plan !== null);
}

/**
 * Add and remove a work item's tags (removing one it lacks changes nothing); the result also
 * counts the project's tags, so agents reuse them.
 */
export async function tagWork(root: string, workId: string, request: { add?: string[]; remove?: string[] }, options: OperationOptions = {}): Promise<WorkResult & { projectTags: Record<string, number> }> {
  const add = checkedTags(request.add ?? []), remove = new Set(checkedTags(request.remove ?? []));
  if (!add.length && !remove.size) throw new WorkError('Give tags to add or remove.');
  const loaded = await load(root, workId);
  const before = tagsOf(loaded.planMetadata.tags);
  const tags = [...new Set([...before, ...add])].filter(tag => !remove.has(tag));
  // Nothing to change (adding tags it has, removing ones it lacks) writes nothing.
  const changed = JSON.stringify(tags) === JSON.stringify(before) ? [] : [await writePlan(loaded, { tags }, dateOf(options))];
  return { ...await result(loaded.root, workId, changed), projectTags: await projectTags(loaded.root) };
}

/** A found work item: what a search shows of it. */
export interface FoundWork {
  workId: string; title: string; summary: string | null; tags: string[]; location: 'active' | 'archive' | 'other';
  designStatus: string | null; implementationStatus: string | null; created: string | null; updated: string | null; completedAt: string | null;
}
const folded = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The project's work items with every given tag and every word of the query (in the id, title,
 * summary or tags, ignoring case and accents); open is active work, closed archived. Newest first.
 */
export async function searchWork(input: string, request: { query?: string; tags?: string[]; status?: 'open' | 'closed' | 'all' }): Promise<FoundWork[]> {
  const root = await planningRoot(input);
  if (request.tags !== undefined && !Array.isArray(request.tags)) throw new WorkError('Give the tags as a list, such as ["0.8.0"].');
  const wanted = (request.tags ?? []).map(tag => normalTag(tag) ?? String(tag));
  const words = folded(request.query ?? '').split(/\s+/).filter(Boolean);
  const status = request.status ?? 'all';
  const found: FoundWork[] = [];
  for (const { id, path: folder, metadata } of await registeredPlans(root)) {
    const location = locationOf(folder), tags = tagsOf(metadata.tags);
    if (status === 'open' && location !== 'active' || status === 'closed' && location !== 'archive') continue;
    if (!wanted.every(tag => tags.includes(tag))) continue;
    const title = text(metadata.title) ?? path.posix.basename(folder), summary = text(metadata.summary)?.trim() || null;
    const haystack = folded([id, title, summary ?? '', ...tags].join(' '));
    if (!words.every(word => haystack.includes(word))) continue;
    found.push({ workId: id, title, summary, tags, location, designStatus: text(metadata.design_status), implementationStatus: text(metadata.implementation_status), created: text(metadata.created), updated: text(metadata.updated), completedAt: text(metadata.completed_at) });
  }
  return found.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? '') || b.workId.localeCompare(a.workId));
}

/**
 * The work items a plan continues, as its header writes them: each one registered, here
 * (`work-0023`) or in another project of the home (`project:work-0023`, by its planning folder's
 * name), never the work item itself, each once.
 */
function checkedHandoffs(root: string, values: unknown, workId: string | null): string[] {
  if (!Array.isArray(values)) throw new WorkError('Give the work it continues as a list, such as ["work-0023"].');
  const graph = new HandoffGraph();
  const written: string[] = [], references: HandoffReference[] = [];
  for (const value of values) {
    const item = parseHandoff(value);
    if (!item) throw new WorkError(`${JSON.stringify(value)} is not a work item: write work-0023, or project:work-0023 for another project of the home (its planning folder's name).`);
    const folder = graph.folder(root, item);
    if (!folder || !graph.exists(root, item)) throw new WorkError(String(value).trim() + ' names no work item' + (item.project ? ' (is ' + item.project + ' the planning folder\'s name in the home?)' : ' in this project') + '.');
    if (item.workId === workId && folder === root) throw new WorkError('A work item cannot continue itself.');
    // Written as the reference resolves: bare in its own project, by the folder's real name in another; each once.
    const text = folder === root ? item.workId : path.basename(folder) + ':' + item.workId;
    if (written.includes(text)) continue;
    written.push(text);
    references.push({ project: folder === root ? null : path.basename(folder), workId: item.workId });
  }
  if (workId !== null && written.length) {
    graph.assume(root, workId, references);
    if (graph.inLoop(root, workId)) throw new WorkError('That would make the handoffs a loop: ' + workId + ' would continue work that continues it.');
  }
  return written;
}

/** The longest plan summary: a few sentences, on one header line. */
export const summaryLimit = 1000;

/** The steps every work item starts with, designing it until the user accepts the plan; agents rename them to fit the work. */
const planningSteps = ['Understand the request', 'Settle the design', 'Write the plan', 'Accepted'];

/** A new work item's ledger: only its header, with its planning steps (by default the usual ones, the first under way). */
export function planningLedger(workId: string, today: string, steps = planningSteps.map((step, index) => ({ title: step, status: index ? 'todo' : 'doing' }))) {
  return [
    '---', 'schema_version: 2', 'kind: ledger', 'work_id: ' + workId, `updated: "${today}"`, 'blocked: null', steps.length ? 'steps:' : 'steps: []',
    ...steps.flatMap(step => ['  - title: ' + JSON.stringify(step.title), '    status: ' + step.status, '    phase: planning']),
    '---', '',
  ].join('\n');
}
/**
 * Whether the work is past planning, so new steps are implementation steps: only work whose
 * implementation is not_started, with no implementation step in its ledger, is still being planned.
 */
const implementing = (loaded: Loaded) => loaded.planMetadata.implementation_status !== 'not_started' || loaded.ledgerSteps.some(implementationStep);
/** An implementation step: neither a planning step nor a proposed one. */
const implementationStep = (step: LedgerStep) => !step.phase;

/**
 * Create and register a work item: the next unused number across active, archived and registered
 * work, `active/NNNN-slug/plan.md` with a draft plan header (with its summary, when given), its
 * ledger with the planning steps, and its planning.json entry.
 */
export async function createWork(input: string, request: { title: string; slug?: string | null; summary?: string | null; continues?: string[] | null; tags?: string[] | null }, options: OperationOptions = {}): Promise<WorkResult> {
  const today = dateOf(options);
  const title = oneLine(request.title, 'The title');
  const summary = request.summary == null || String(request.summary).trim() === '' ? null : oneLine(request.summary, 'The summary', summaryLimit);
  const root = await planningRoot(input);
  const registry = await registryOf(root);
  const continues = request.continues?.length ? checkedHandoffs(root, request.continues, null) : [];
  const tags = request.tags?.length ? checkedTags(request.tags) : [];
  const slug = request.slug ? request.slug : slugOf(title);
  if (!slugPattern.test(slug) || slug.length > 80) throw new WorkError('The slug must be lowercase letters and digits joined by hyphens.');
  const folders = (await Promise.all(['active', 'archive'].map(location => readdir(path.join(root, location)).catch(() => [] as string[])))).flat();
  const number = nextNumber(registry.workItems, folders);
  const workId = 'work-' + number, location = `active/${number}-${slug}`, plan = location + '/plan.md';
  if (await exists(file(root, location))) throw new WorkError(location + ' already exists.');
  let registryText: string;
  try { registryText = appendRegistryEntries(registry.text, 'work_items', [{ id: workId, path: location, current_plan: plan }]); }
  catch (error) { if (error instanceof RegistryFormatError) throw new WorkError(error.message); throw error; }
  const planText = ['---', 'schema_version: 2', 'kind: plan', 'id: ' + workId, 'title: ' + JSON.stringify(title), ...summary ? ['summary: ' + JSON.stringify(summary)] : [],
    `created: "${today}"`, `updated: "${today}"`, 'design_status: draft', 'implementation_status: not_started', 'accepted_at: null', 'completed_at: null', 'supersedes: []', 'superseded_by: null', ...continues.length ? ['continues: ' + yamlValue('continues', continues)] : [], ...tags.length ? ['tags: ' + yamlValue('tags', tags)] : [], '---', '', '# ' + title, ''].join('\n');
  await mkdir(file(root, location), { recursive: true });
  try {
    await writeFile(file(root, plan), planText, { flag: 'wx' });
    await writeFile(file(root, location + '/ledger.md'), planningLedger(workId, today), { flag: 'wx' });
    if (await readFile(path.join(root, 'planning.json'), 'utf8') !== registry.text) throw new WorkError('planning.json changed meanwhile; nothing was created. Try again.');
    await writeText(path.join(root, 'planning.json'), registryText);
  } catch (error) {
    await rm(file(root, location), { recursive: true, force: true });
    throw error;
  }
  return result(root, workId, [plan, location + '/ledger.md', 'planning.json']);
}

/** Accept the design: `design_status: accepted`, `accepted_at` today, and every planning step done. */
export async function acceptWork(root: string, workId: string, options: OperationOptions = {}): Promise<WorkResult> {
  const today = dateOf(options);
  const loaded = await load(root, workId);
  const design = loaded.planMetadata.design_status;
  if (design === 'accepted') return result(loaded.root, workId, [], [`The design was already accepted${loaded.planMetadata.accepted_at ? ' on ' + String(loaded.planMetadata.accepted_at) : ''}.`]);
  if (design !== 'draft') throw new WorkError(`The design is ${String(design)}; only a draft can be accepted.`);
  const changed = [await writePlan(loaded, { design_status: 'accepted', accepted_at: today }, today)];
  if (loaded.ledgerSteps.some(step => step.phase === 'planning' && step.status !== 'done')) {
    const steps = loaded.ledgerSteps.map(step => step.phase === 'planning' ? { ...step, status: 'done' as const } : step);
    changed.push(await writeLedger(loaded, setFields(setSteps(loaded.ledgerText, steps), { updated: today })));
  }
  return result(loaded.root, workId, changed);
}

/** The ledger with these todo steps after its steps. */
const withSteps = (loaded: Loaded, titles: string[], today: string) =>
  setFields(setSteps(loaded.ledgerText, [...loaded.ledgerSteps, ...titles.map(title => ({ title, status: 'todo' as const }))]), { updated: today });

/**
 * Start implementation: `implementation_status: in_progress` and the given steps after the ledger's
 * planning steps, in place of the proposed ones; without steps, the proposed steps become them.
 */
export async function startWork(root: string, workId: string, request: { steps?: string[] }, options: OperationOptions = {}): Promise<WorkResult> {
  const today = dateOf(options);
  const loaded = await load(root, workId);
  const proposed = loaded.ledgerSteps.filter(step => step.phase === 'proposed').map(step => step.title);
  const titles = request.steps === undefined ? proposed : stepTitles(request.steps);
  if (!titles.length) throw new WorkError('Give the agreed steps: implementation starts with at least one.');
  if (loaded.planMetadata.design_status !== 'accepted') throw new WorkError(`The design is ${String(loaded.planMetadata.design_status)}; accept it before implementation starts.`);
  if (loaded.planMetadata.implementation_status === 'complete') throw new WorkError('The implementation is already complete; reopen the work instead.');
  // Started once already: the ledger has its implementation steps.
  if (loaded.ledgerSteps.some(implementationStep)) {
    throw new WorkError('The implementation has started already; add steps with step add instead.');
  }
  const kept = { ...loaded, ledgerSteps: loaded.ledgerSteps.filter(step => step.phase !== 'proposed') };
  const taken = titles.filter(title => kept.ledgerSteps.some(step => step.title === title));
  if (taken.length) throw new WorkError('The ledger already has these steps: ' + taken.join(', ') + '. Give new titles.');
  if (locationOf(loaded.entry.path) === 'archive') throw new WorkError('The work is archived; reopen it instead.');
  const ledger = await writeLedger(loaded, withSteps(kept, titles, today));
  const plan = await writePlan(loaded, { implementation_status: 'in_progress' }, today);
  return result(loaded.root, workId, [ledger, plan]);
}

/** Change the ledger's steps (and fields), and record the date. */
async function changeLedger(root: string, workId: string, options: OperationOptions, change: (steps: LedgerStep[], loaded: Loaded) => { steps?: LedgerStep[]; fields?: Record<string, string | null> }) {
  const today = dateOf(options);
  const loaded = await load(root, workId);
  const { steps, fields } = change(loaded.ledgerSteps.map(step => ({ ...step })), loaded);
  let next = loaded.ledgerText;
  if (steps) next = setSteps(next, steps);
  next = setFields(next, { ...fields, updated: today });
  const ledger = await writeLedger(loaded, next);
  const plan = await writePlan(loaded, {}, today);
  return result(loaded.root, workId, [ledger, plan]);
}
function find(steps: LedgerStep[], title: unknown) {
  const wanted = oneLine(title, 'The step');
  const index = steps.findIndex(step => step.title === wanted);
  if (index < 0) throw new WorkError(`The ledger has no step "${wanted}". Its steps: ${steps.map(step => '"' + step.title + '"').join(', ') || 'none'}.`);
  return index;
}

/**
 * Add steps, as todo: before implementation starts, planning steps after the other planning steps;
 * from then on, implementation steps at the end of the list.
 */
export async function addSteps(root: string, workId: string, titles: string[], options: OperationOptions = {}) {
  const added = stepTitles(titles);
  if (!added.length) throw new WorkError('Give at least one step to add.');
  return changeLedger(root, workId, options, (steps, loaded) => {
    const taken = added.filter(title => steps.some(step => step.title === title));
    if (taken.length) throw new WorkError('The ledger already has these steps: ' + taken.join(', ') + '.');
    if (implementing(loaded)) return { steps: [...steps, ...added.map(title => ({ title, status: 'todo' as const }))] };
    const after = steps.findLastIndex(step => step.phase === 'planning') + 1;
    return { steps: [...steps.slice(0, after), ...added.map(title => ({ title, status: 'todo' as const, phase: 'planning' as const })), ...steps.slice(after)] };
  });
}

/**
 * Propose the plan's implementation steps while it is designed: they replace the proposed steps,
 * after the planning steps, and `work_start` without steps adopts them. An empty list removes them.
 */
export async function proposeSteps(root: string, workId: string, titles: string[], options: OperationOptions = {}) {
  const proposed = stepTitles(titles);
  return changeLedger(root, workId, options, (steps, loaded) => {
    if (implementing(loaded)) throw new WorkError('The implementation has started; add steps with step add instead.');
    if (locationOf(loaded.entry.path) !== 'active') throw new WorkError(`${workId} is not active work (${loaded.entry.path}).`);
    const kept = steps.filter(step => step.phase !== 'proposed');
    const taken = proposed.filter(title => kept.some(step => step.title === title));
    if (taken.length) throw new WorkError('The ledger already has these steps: ' + taken.join(', ') + '. Give new titles.');
    return { steps: [...kept, ...proposed.map(title => ({ title, status: 'todo' as const, phase: 'proposed' as const }))] };
  });
}

/** Set a step's status: todo, doing or done. */
export async function setStepStatus(root: string, workId: string, title: string, status: LedgerStepStatus, options: OperationOptions = {}) {
  if (!ledgerStepStatuses.includes(status)) throw new WorkError('A step status is todo, doing or done.');
  return changeLedger(root, workId, options, steps => {
    const index = find(steps, title);
    if (steps[index].phase === 'proposed') throw new WorkError(`"${steps[index].title}" is only proposed: work_start makes the proposed steps agreed ones; once the work has started, remove it with step remove.`);
    steps[index].status = status;
    return { steps };
  });
}

/** Rename a step, keeping its place and status. */
export async function renameStep(root: string, workId: string, title: string, to: string, options: OperationOptions = {}) {
  const renamed = oneLine(to, 'The new title');
  return changeLedger(root, workId, options, steps => {
    const index = find(steps, title);
    if (steps.some((step, other) => other !== index && step.title === renamed)) throw new WorkError(`The ledger already has a step "${renamed}".`);
    steps[index].title = renamed;
    return { steps };
  });
}

/** Remove a step that was transferred or dropped. */
export async function removeStep(root: string, workId: string, title: string, options: OperationOptions = {}) {
  return changeLedger(root, workId, options, steps => {
    steps.splice(find(steps, title), 1);
    return { steps };
  });
}

/** Set `blocked` to a reason, or clear it with null. */
/**
 * Record the work a plan continues (its header's `continues`): the handoff from earlier work, such as
 * follow-ups moved off work that closed, or a next phase. An empty list records none.
 */
export async function setContinues(input: string, workId: string, continues: string[], options: OperationOptions = {}) {
  const loaded = await load(input, workId);
  const written = checkedHandoffs(loaded.root, continues, workId);
  const changed = [await writePlan(loaded, { continues: written }, dateOf(options))];
  return { ...await result(loaded.root, workId, changed), continues: written };
}

export async function setBlocked(root: string, workId: string, reason: string | null, options: OperationOptions = {}) {
  const value = reason === null ? null : oneLine(reason, 'The reason', 1000);
  return changeLedger(root, workId, options, () => ({ fields: { blocked: value } }));
}

/** What keeps a work item open: agreed steps not done, and `blocked`; proposed steps only preview. */
function openItems(loaded: Loaded) {
  return [
    ...agreed(loaded.ledgerSteps).filter(step => step.status !== 'done').map(step => `Step "${step.title}" is ${step.status}.`),
    ...loaded.blocked ? ['Blocked: ' + loaded.blocked] : [],
  ];
}

// ---- Moves --------------------------------------------------------------------------------------

/** Move a work folder between active/ and archive/, updating planning.json and the links that cross the move. */
async function move(loaded: Loaded, to: 'active' | 'archive') {
  const from = loaded.entry.path;
  const parts = from.split('/');
  if (parts.length !== 2 || !['active', 'archive'].includes(parts[0])) throw new WorkError(`${from} is not directly in active/ or archive/; move it by hand.`);
  const target = to + '/' + parts[1];
  if (await exists(file(loaded.root, target))) throw new WorkError(target + ' already exists.');
  const plan = loaded.plan.startsWith(from + '/') ? target + loaded.plan.slice(from.length) : loaded.plan;
  let registryText: string;
  try { registryText = updateRegistryEntry(loaded.registryText, 'work_items', loaded.entry.id, { path: target, current_plan: plan }); }
  catch (error) { if (error instanceof RegistryFormatError) throw new WorkError(error.message); throw error; }
  if (await readFile(path.join(loaded.root, 'planning.json'), 'utf8') !== loaded.registryText) throw new WorkError('planning.json changed meanwhile; nothing was moved. Try again.');
  await mkdir(path.join(loaded.root, to), { recursive: true });
  await renameWithRetry(file(loaded.root, from), file(loaded.root, target));
  try { await writeText(path.join(loaded.root, 'planning.json'), registryText); }
  catch (error) { await renameWithRetry(file(loaded.root, target), file(loaded.root, from)).catch(() => undefined); throw error; }
  loaded.entry.path = target; loaded.plan = plan; loaded.registryText = registryText;
  const repaired = await repairLinks(loaded.root, from, target);
  // The repair may have changed the plan and the ledger: later changes start from what is there now.
  loaded.planText = await readFile(file(loaded.root, plan), 'utf8');
  loaded.ledgerText = await readFile(file(loaded.root, target + '/ledger.md'), 'utf8');
  return ['planning.json', ...repaired];
}

async function markdownFiles(root: string, relative = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.') || ignoredFolders.has(entry.name) || entry.isSymbolicLink()) continue;
    const child = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) found.push(...await markdownFiles(root, child));
    else if (entry.isFile() && /\.md$/i.test(entry.name)) found.push(child);
  }
  return found;
}

/** A link target rewritten for its file's move and the moved folder's, or null when it still works. */
function relinked(target: string, fileNow: string, fileBefore: string, from: string, to: string): string | null {
  const angle = target.startsWith('<') && target.endsWith('>');
  const raw = angle ? target.slice(1, -1) : target;
  const cut = raw.search(/[?#]/);
  const address = cut < 0 ? raw : raw.slice(0, cut), suffix = cut < 0 ? '' : raw.slice(cut);
  if (!address || address.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(address)) return null;
  let decoded: string;
  try { decoded = decodeURI(address); } catch { decoded = address; }
  const before = path.posix.normalize(path.posix.join(path.posix.dirname(fileBefore), decoded));
  if (before === '..' || before.startsWith('../')) return null;
  const now = before === from || before.startsWith(from + '/') ? to + before.slice(from.length) : before;
  if (path.posix.normalize(path.posix.join(path.posix.dirname(fileNow), decoded)) === now) return null;
  let relative = path.posix.relative(path.posix.dirname(fileNow), now) || path.posix.basename(now);
  if (!angle && (address.includes('%20') || /\s/.test(relative))) relative = relative.replace(/ /g, '%20');
  return angle ? '<' + relative + suffix + '>' : relative + suffix;
}

/**
 * Repair the relative Markdown links in the planning folder after `from` moved to `to`: links from
 * elsewhere into the moved folder, and links from the moved folder out of it. Returns the files changed.
 */
export async function repairLinks(root: string, from: string, to: string): Promise<string[]> {
  const changed: string[] = [];
  for (const relative of await markdownFiles(root)) {
    const before = relative === to || relative.startsWith(to + '/') ? from + relative.slice(to.length) : relative;
    const original = await readFile(file(root, relative), 'utf8');
    let fence: string | null = null;
    const lines = original.split('\n').map(line => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker && (fence === null || marker[0] === fence[0] && marker.length >= fence.length)) { fence = fence === null ? marker : null; return line; }
      if (fence !== null) return line;
      const swap = (whole: string, lead: string, target: string) => { const next = relinked(target, relative, before, from, to); return next === null ? whole : lead + next; };
      return line
        .replace(/^( {0,3}\[[^\]]+\]:[ \t]*)(<[^>]*>|[^\s]+)/, swap)
        .replace(/(\]\()(<[^>]*>|[^)\s]+)/g, swap);
    });
    const next = lines.join('\n');
    if (next !== original) { await writeText(file(root, relative), next); changed.push(relative); }
  }
  return changed;
}

/** Why work is archived without completing it: replaced by other work, or dropped for a reason. */
export interface ArchiveRequest { disposition?: 'superseded' | 'abandoned' | null; supersededBy?: string | null; reason?: string | null }

/**
 * Archive the work: move its folder from active/ to archive/. Work that is not complete needs a
 * disposition: `superseded` by another registered work item (naming it implies superseded), or
 * `abandoned` with the reason. It becomes the plan's design_status (and superseded_by), and the
 * reason goes into the plan's Outcome, so archiving never hides open work. A reason
 * comes only with a disposition, so it is never dropped.
 */
export async function archiveWork(root: string, workId: string, request: ArchiveRequest = {}, options: OperationOptions = {}): Promise<WorkResult> {
  const today = dateOf(options);
  const { supersededBy = null } = request;
  const disposition = request.disposition ?? (supersededBy ? 'superseded' : null);
  if (disposition !== null && disposition !== 'superseded' && disposition !== 'abandoned') throw new WorkError('The disposition is superseded or abandoned.');
  const reason = request.reason ? oneLine(request.reason, 'The reason', 1000) : null;
  if (reason && !disposition) throw new WorkError('A reason is recorded only with a disposition: archive the work as superseded or abandoned, or leave the reason out.');
  const loaded = await load(root, workId);
  if (locationOf(loaded.entry.path) !== 'active') throw new WorkError(`${workId} is not in active/ (${loaded.entry.path}).`);
  const complete = loaded.planMetadata.implementation_status === 'complete' && !openItems(loaded).length;
  if (!disposition && !complete) throw new WorkError(`${workId} is not complete: archive it as superseded (by the work that replaces it) or abandoned (with the reason), or close it once its items are done.`, openItems(loaded));
  if (disposition === 'superseded') {
    if (typeof supersededBy !== 'string' || !workIdentity.test(supersededBy) || supersededBy === workId) throw new WorkError('Name the work item that supersedes it, such as work-0012.');
    const registry = await registryOf(loaded.root);
    if (!registry.workItems.some(item => item?.id === supersededBy)) throw new WorkError(`${supersededBy} is not registered in ${loaded.root}.`);
  } else if (supersededBy) throw new WorkError('Only superseded work names the work that supersedes it.');
  if (disposition === 'abandoned' && !reason) throw new WorkError('Give the reason the work is abandoned.');
  const moved = await move(loaded, 'archive');
  const changed = [...moved];
  if (disposition) {
    const note = `archived as ${disposition}${supersededBy ? ' by ' + supersededBy : ''}${reason ? ': ' + reason.replace(/\.$/, '') : ''}.`;
    loaded.planText = appendToSection(loaded.planText, `- ${today}: ${note[0].toUpperCase() + note.slice(1)}`, '## Outcome');
  }
  changed.push(await writePlan(loaded, disposition ? { design_status: disposition, ...supersededBy && { superseded_by: supersededBy } } : {}, today));
  return result(loaded.root, workId, [...new Set(changed)]);
}

/**
 * Close the work: refused, with the list of open items, unless its ledger has steps, every one done,
 * and nothing is blocked; then `implementation_status: complete`, `completed_at` today, and the
 * folder is archived.
 */
export async function closeWork(root: string, workId: string, options: OperationOptions = {}): Promise<WorkResult> {
  const today = dateOf(options);
  const loaded = await load(root, workId);
  if (loaded.planMetadata.design_status !== 'accepted') throw new WorkError(`The design is ${String(loaded.planMetadata.design_status)}; only accepted work is closed as complete. Archive it instead.`);
  if (locationOf(loaded.entry.path) !== 'active') throw new WorkError(`${workId} is not in active/ (${loaded.entry.path}).`);
  if (!loaded.ledgerSteps.some(implementationStep)) throw new WorkError(`${workId}'s ledger has no implementation steps: start it with the agreed steps and finish them before closing.`);
  const open = openItems(loaded);
  if (open.length) throw new WorkError(`${workId} cannot close while items are open. Finish them, or remove a dropped one with step remove.`, open);
  const moved = await move(loaded, 'archive');
  return result(loaded.root, workId, [...moved, await writePlan(loaded, { implementation_status: 'complete', completed_at: today }, today)]);
}

/** Reopen archived work: move it back to active/, set it in progress and add the given todo steps. */
export async function reopenWork(root: string, workId: string, request: { steps: string[] }, options: OperationOptions = {}): Promise<WorkResult> {
  const today = dateOf(options);
  const titles = stepTitles(request.steps);
  if (!titles.length) throw new WorkError('Give the steps that reopen the work.');
  const loaded = await load(root, workId);
  if (locationOf(loaded.entry.path) !== 'archive') throw new WorkError(`${workId} is not archived (${loaded.entry.path}).`);
  // Superseded or abandoned work that had been accepted is accepted again once reopened.
  const design = loaded.planMetadata.design_status, disposed = design === 'superseded' || design === 'abandoned';
  if (design !== 'accepted' && !(disposed && loaded.planMetadata.accepted_at)) throw new WorkError(`The design is ${String(design)}; accept it before reopening its implementation.`);
  const taken = titles.filter(title => loaded.ledgerSteps.some(step => step.title === title));
  if (taken.length) throw new WorkError('The ledger already has these steps: ' + taken.join(', ') + '. Give new titles.');
  const changed = await move(loaded, 'active');
  changed.push(await writeLedger(loaded, withSteps(loaded, titles, today)));
  changed.push(await writePlan(loaded, { implementation_status: 'in_progress', completed_at: null, ...disposed && { design_status: 'accepted', superseded_by: null } }, today));
  return result(loaded.root, workId, changed);
}
