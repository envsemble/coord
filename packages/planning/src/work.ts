// The planning-state operations: create and register work, accept its design, start implementation
// with a ledger, change its steps and `blocked`, close it once nothing is open, and archive or reopen
// it. The atlas command and the MCP server both call these. Each validates its input, refuses with
// the reason when the work is not in a state that allows it, records the date in the plan's
// `updated`, and changes files the way a careful person would (only the lines that change). Nothing
// is committed: agents commit planning changes themselves.
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, type Metadata } from './check.ts';
import { appendToSection, setFields, setSteps } from './headerText.ts';
import { ledgerStatus, ledgerStepStatuses, stepCounts, stepSummary } from './ledger.ts';
import { appendRegistryEntries, RegistryFormatError, updateRegistryEntry } from './registryText.ts';
import { runProgram } from './run.ts';
import { stepLimit, workStatistics } from './statistics.ts';
import type { LedgerStep, LedgerStepStatus } from './types.ts';

export class WorkError extends Error {
  /** What stands in the way, one item each (the open items of a work item that cannot close). */
  readonly problems: string[];
  constructor(message: string, problems: string[] = []) { super(message); this.name = 'WorkError'; this.problems = problems; }
}

export interface WorkStatus {
  planningFolder: string; workId: string; title: string; path: string;
  /** The plan's `summary` header: a few plain sentences on what the work is, why, and where it stands. */
  summary: string | null;
  location: 'active' | 'archive' | 'other';
  plan: string; repositories: string[];
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

async function writeText(file: string, text: string) {
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

interface Entry { id: string; path: string; repositories: string[]; current_plan: string | null }
interface Loaded {
  root: string; registryText: string; entry: Entry; plan: string;
  planText: string; planMetadata: Metadata;
  ledgerText: string | null; ledgerSteps: LedgerStep[] | null; blocked: string | null;
}

async function planningRoot(input: string) {
  return realpath(input).catch(() => { throw new WorkError('The planning folder does not exist: ' + input); });
}
async function registryOf(root: string) {
  let text: string;
  try { text = await readFile(path.join(root, 'planning.json'), 'utf8'); }
  catch { throw new WorkError('The planning folder has no readable planning.json: ' + root); }
  let registry: { repositories?: unknown; work_items?: unknown };
  try { registry = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text); } catch (error) { throw new WorkError('planning.json is not valid JSON: ' + (error as Error).message); }
  if (!Array.isArray(registry?.repositories) || !Array.isArray(registry?.work_items)) throw new WorkError('planning.json needs repositories and work_items lists.');
  return { text, repositories: registry.repositories as { id?: unknown }[], workItems: registry.work_items as Partial<Entry>[] };
}

function ledgerOf(text: string, workId: string) {
  let metadata: Metadata | null;
  try { metadata = parseFrontmatter(text, { entryLists: ['steps'] }); }
  catch (error) { throw new WorkError('The ledger header cannot be read: ' + (error as Error).message); }
  if (!metadata) throw new WorkError('The ledger has no status header; add one (PLANS.md, "Ledger status version 2") first.');
  let status;
  try { status = ledgerStatus(metadata, workId); } catch (error) { throw new WorkError('The ledger header is invalid: ' + (error as Error).message); }
  if (status.version !== 2) throw new WorkError('The ledger uses status version 1; rewrite its header as version 2 (PLANS.md) first.');
  return { steps: status.steps!, blocked: status.blocked };
}

async function load(input: string, workId: string): Promise<Loaded> {
  if (typeof workId !== 'string' || !workIdentity.test(workId)) throw new WorkError('Give the work item as its ID, such as work-0001.');
  const root = await planningRoot(input);
  const registry = await registryOf(root);
  const entry = registry.workItems.find(item => item?.id === workId);
  if (!entry) throw new WorkError(`${workId} is not registered in ${root}.`);
  if (typeof entry.path !== 'string' || !entry.path || entry.path.includes('\\') || entry.path.split('/').includes('..')) throw new WorkError(`${workId} has an invalid path in planning.json.`);
  if (typeof entry.current_plan !== 'string') throw new WorkError(`${workId} has no main plan (current_plan is null).`);
  const plan = entry.current_plan, folder = entry.path.replace(/\/+$/, '');
  // The plan is written: it must be in the work folder, as `atlas check` requires.
  if (plan.includes('\\') || plan.split('/').includes('..') || (plan !== folder && !plan.startsWith(folder + '/'))) throw new WorkError(`${workId}'s current_plan ${plan} is outside its work folder ${folder}; fix planning.json first.`);
  let planText: string;
  try { planText = await readFile(file(root, plan), 'utf8'); } catch { throw new WorkError(`The plan ${plan} cannot be read.`); }
  let planMetadata: Metadata | null;
  try { planMetadata = parseFrontmatter(planText); } catch (error) { throw new WorkError(`The plan header of ${plan} cannot be read: ${(error as Error).message}`); }
  if (!planMetadata) throw new WorkError(`The plan ${plan} has no metadata header.`);
  if (planMetadata.id !== workId) throw new WorkError(`The plan ${plan} has the id ${String(planMetadata.id)}, not ${workId}.`);
  const ledgerText = await readFile(file(root, entry.path + '/ledger.md'), 'utf8').catch(() => null);
  const ledger = ledgerText === null ? null : ledgerOf(ledgerText, workId);
  return {
    root, registryText: registry.text, entry: { id: workId, path: entry.path.replace(/\/+$/, ''), repositories: Array.isArray(entry.repositories) ? entry.repositories as string[] : [], current_plan: plan },
    plan, planText, planMetadata, ledgerText, ledgerSteps: ledger?.steps ?? null, blocked: ledger?.blocked ?? null,
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
    planningFolder: loaded.root, workId: entry.id, title: text(plan.title) ?? path.posix.basename(entry.path), summary: text(plan.summary)?.trim() || null, path: entry.path, location: locationOf(entry.path),
    plan: loaded.plan, repositories: entry.repositories,
    designStatus: text(plan.design_status), implementationStatus: text(plan.implementation_status),
    created: text(plan.created), updated: text(plan.updated), acceptedAt: text(plan.accepted_at), completedAt: text(plan.completed_at),
    ledger: loaded.ledgerText === null ? null : entry.path + '/ledger.md',
    steps: loaded.ledgerSteps ?? [], progress: loaded.ledgerSteps ? stepSummary(stepCounts(loaded.ledgerSteps)) : null, blocked: loaded.blocked,
    statistics: { reports: statistics?.reports ?? 0, agentMinutes: Math.round((statistics?.agentMs ?? 0) / 60000), tokens: statistics?.tokens ?? null, primaryModel: statistics?.primaryModel ?? null },
  };
}
async function result(root: string, workId: string, changed: string[], warnings: string[] = []): Promise<WorkResult> {
  return { ...await workStatus(root, workId), changed, warnings };
}

/** Write the plan with these fields (and `updated`), after checking it still reads. */
async function writePlan(loaded: Loaded, fields: Record<string, string | null>, today: string) {
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

/** The longest plan summary: a few sentences, on one header line. */
export const summaryLimit = 1000;

/**
 * Create and register a work item: the next unused number across active, archived and registered
 * work, `active/NNNN-slug/plan.md` with a draft plan header (with its summary, when given), and its
 * planning.json entry.
 */
export async function createWork(input: string, request: { title: string; repositories: string[]; slug?: string | null; summary?: string | null }, options: OperationOptions = {}): Promise<WorkResult> {
  const today = dateOf(options);
  const title = oneLine(request.title, 'The title');
  const summary = request.summary == null || String(request.summary).trim() === '' ? null : oneLine(request.summary, 'The summary', summaryLimit);
  const root = await planningRoot(input);
  const registry = await registryOf(root);
  const known = new Set(registry.repositories.map(item => item?.id).filter((id): id is string => typeof id === 'string'));
  if (!Array.isArray(request.repositories) || !request.repositories.length) throw new WorkError('Name the repositories the work applies to; registered ones are: ' + [...known].join(', ') + '.');
  const repositories = [...new Set(request.repositories)];
  const unknown = repositories.filter(id => !known.has(id));
  if (unknown.length) throw new WorkError('Not registered in planning.json: ' + unknown.join(', ') + '. Registered repositories: ' + [...known].join(', ') + '.');
  const slug = request.slug ? request.slug : slugOf(title);
  if (!slugPattern.test(slug) || slug.length > 80) throw new WorkError('The slug must be lowercase letters and digits joined by hyphens.');
  const folders = (await Promise.all(['active', 'archive'].map(location => readdir(path.join(root, location)).catch(() => [] as string[])))).flat();
  const number = nextNumber(registry.workItems, folders);
  const workId = 'work-' + number, location = `active/${number}-${slug}`, plan = location + '/plan.md';
  if (await exists(file(root, location))) throw new WorkError(location + ' already exists.');
  let registryText: string;
  try { registryText = appendRegistryEntries(registry.text, 'work_items', [{ id: workId, path: location, repositories, current_plan: plan }]); }
  catch (error) { if (error instanceof RegistryFormatError) throw new WorkError(error.message); throw error; }
  const planText = ['---', 'schema_version: 1', 'kind: plan', 'id: ' + workId, 'title: ' + JSON.stringify(title), ...summary ? ['summary: ' + JSON.stringify(summary)] : [], 'repositories: ' + JSON.stringify(repositories).replaceAll('","', '", "'),
    `created: "${today}"`, `updated: "${today}"`, 'design_status: draft', 'implementation_status: not_started', 'accepted_at: null', 'completed_at: null', 'supersedes: []', 'superseded_by: null', '---', '', '# ' + title, ''].join('\n');
  await mkdir(file(root, location), { recursive: true });
  try {
    await writeFile(file(root, plan), planText, { flag: 'wx' });
    if (await readFile(path.join(root, 'planning.json'), 'utf8') !== registry.text) throw new WorkError('planning.json changed meanwhile; nothing was created. Try again.');
    await writeText(path.join(root, 'planning.json'), registryText);
  } catch (error) {
    await rm(file(root, location), { recursive: true, force: true });
    throw error;
  }
  return result(root, workId, [plan, 'planning.json']);
}

/** Accept the design: `design_status: accepted`, `accepted_at` today. */
export async function acceptWork(root: string, workId: string, options: OperationOptions = {}): Promise<WorkResult> {
  const today = dateOf(options);
  const loaded = await load(root, workId);
  const design = loaded.planMetadata.design_status;
  if (design === 'accepted') return result(loaded.root, workId, [], [`The design was already accepted${loaded.planMetadata.accepted_at ? ' on ' + String(loaded.planMetadata.accepted_at) : ''}.`]);
  if (design !== 'draft') throw new WorkError(`The design is ${String(design)}; only a draft can be accepted.`);
  return result(loaded.root, workId, [await writePlan(loaded, { design_status: 'accepted', accepted_at: today }, today)]);
}

async function planningRevision(root: string, plan: string) {
  const warnings: string[] = [];
  let revision: string | null = null;
  try {
    revision = (await runProgram('git', ['-C', root, 'rev-parse', 'HEAD'], { timeout: 15000 })).stdout.trim() || null;
    const changes = (await runProgram('git', ['-C', root, 'status', '--porcelain', '--', plan], { timeout: 15000 })).stdout.trim();
    if (changes) warnings.push(`The plan ${plan} has uncommitted changes; the selection records the revision before them. Commit the plan so the selection names what is implemented.`);
  } catch { warnings.push('The planning folder has no Git history, so the selection records no revision.'); }
  return { revision, warnings };
}
function newLedger(loaded: Loaded, titles: string[], today: string, revision: string | null) {
  const title = text(loaded.planMetadata.title) ?? loaded.entry.id;
  const accepted = text(loaded.planMetadata.accepted_at);
  const planLink = path.posix.relative(loaded.entry.path, loaded.plan);
  return [
    '---', 'schema_version: 2', 'kind: ledger', 'work_id: ' + loaded.entry.id, `updated: "${today}"`, 'blocked: null',
    ...(titles.length ? ['steps:', ...titles.flatMap(step => ['  - title: ' + JSON.stringify(step), '    status: todo'])] : ['steps: []']),
    '---', '', '# Ledger: ' + title, '', '## Selection', '',
    `- **Work item:** ${loaded.entry.id}, [plan](${planLink})${accepted ? ', accepted on ' + accepted : ''}.`,
    `- **Selected plan:** \`${loaded.plan}\`${revision ? ' at planning revision `' + revision + '`' : ' (no planning Git revision)'}.`,
    '', '## Progress', '', `- ${today}: implementation started.`, '',
  ].join('\n');
}

/**
 * Start implementation: `implementation_status: in_progress` and a new ledger with the given steps
 * and a Selection section naming the plan and the planning folder's Git revision.
 */
export async function startWork(root: string, workId: string, request: { steps: string[] }, options: OperationOptions = {}): Promise<WorkResult> {
  const today = dateOf(options);
  const titles = stepTitles(request.steps);
  if (!titles.length) throw new WorkError('Give the agreed steps: implementation starts with at least one.');
  const loaded = await load(root, workId);
  if (loaded.planMetadata.design_status !== 'accepted') throw new WorkError(`The design is ${String(loaded.planMetadata.design_status)}; accept it before implementation starts.`);
  if (loaded.planMetadata.implementation_status === 'complete') throw new WorkError('The implementation is already complete; reopen the work instead.');
  if (loaded.ledgerText !== null) throw new WorkError('The work already has a ledger; change its steps instead.');
  if (locationOf(loaded.entry.path) === 'archive') throw new WorkError('The work is archived; reopen it instead.');
  const { revision, warnings } = await planningRevision(loaded.root, loaded.plan);
  const ledger = await writeLedger(loaded, newLedger(loaded, titles, today, revision));
  const plan = await writePlan(loaded, { implementation_status: 'in_progress' }, today);
  return result(loaded.root, workId, [ledger, plan], warnings);
}

/** Change the ledger's steps (and fields), noting `note` in its Progress section, and record the date. */
async function changeLedger(root: string, workId: string, options: OperationOptions, change: (steps: LedgerStep[], loaded: Loaded) => { steps?: LedgerStep[]; fields?: Record<string, string | null>; note?: string }) {
  const today = dateOf(options);
  const loaded = await load(root, workId);
  if (loaded.ledgerText === null || loaded.ledgerSteps === null) throw new WorkError(`${workId} has no ledger yet; start its implementation first.`);
  const { steps, fields, note } = change(loaded.ledgerSteps.map(step => ({ ...step })), loaded);
  let next = loaded.ledgerText;
  if (steps) next = setSteps(next, steps);
  next = setFields(next, { ...fields, updated: today });
  if (note) next = appendToSection(next, `- ${today}: ${note}`);
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

/** Add steps, as todo, at the end of the ledger's list. */
export async function addSteps(root: string, workId: string, titles: string[], options: OperationOptions = {}) {
  const added = stepTitles(titles);
  if (!added.length) throw new WorkError('Give at least one step to add.');
  return changeLedger(root, workId, options, steps => {
    const taken = added.filter(title => steps.some(step => step.title === title));
    if (taken.length) throw new WorkError('The ledger already has these steps: ' + taken.join(', ') + '.');
    return { steps: [...steps, ...added.map(title => ({ title, status: 'todo' as const }))] };
  });
}

/** Set a step's status: todo, doing or done. */
export async function setStepStatus(root: string, workId: string, title: string, status: LedgerStepStatus, options: OperationOptions = {}) {
  if (!ledgerStepStatuses.includes(status)) throw new WorkError('A step status is todo, doing or done.');
  return changeLedger(root, workId, options, steps => {
    steps[find(steps, title)].status = status;
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

/** Remove a step, writing why into the ledger's Progress section: an agreed step is never dropped silently. */
export async function removeStep(root: string, workId: string, title: string, reason: string, options: OperationOptions = {}) {
  const why = oneLine(reason, 'The reason', 1000);
  return changeLedger(root, workId, options, steps => {
    const index = find(steps, title);
    const [removed] = steps.splice(index, 1);
    return { steps, note: `removed the step "${removed.title}" (${removed.status}): ${why.replace(/\.$/, '')}.` };
  });
}

/** Set `blocked` to a reason, or clear it with null. */
export async function setBlocked(root: string, workId: string, reason: string | null, options: OperationOptions = {}) {
  const value = reason === null ? null : oneLine(reason, 'The reason', 1000);
  return changeLedger(root, workId, options, () => ({ fields: { blocked: value }, ...value && { note: 'blocked: ' + value.replace(/\.$/, '') + '.' } }));
}

/** What keeps a work item open: steps not done, and `blocked`. */
function openItems(loaded: Loaded) {
  return [
    ...(loaded.ledgerSteps ?? []).filter(step => step.status !== 'done').map(step => `Step "${step.title}" is ${step.status}.`),
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
  if (loaded.ledgerText !== null) loaded.ledgerText = await readFile(file(loaded.root, target + '/ledger.md'), 'utf8');
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
 * reason goes into the ledger, or the plan without one, so archiving never hides open work. A reason
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
    if (loaded.ledgerText !== null) changed.push(await writeLedger(loaded, appendToSection(setFields(loaded.ledgerText, { updated: today }), `- ${today}: ${note}`)));
    else loaded.planText = appendToSection(loaded.planText, `- ${today}: ${note[0].toUpperCase() + note.slice(1)}`, '## Outcome');
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
  if (loaded.ledgerSteps === null) throw new WorkError(`${workId} has no ledger: its implementation never started. Start it with its steps, or archive it as superseded or abandoned.`);
  if (!loaded.ledgerSteps.length) throw new WorkError(`${workId}'s ledger has no steps: add the agreed steps and finish them before closing.`);
  const open = openItems(loaded);
  if (open.length) throw new WorkError(`${workId} cannot close while items are open. Finish them, or record in the ledger why one is dropped and remove it.`, open);
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
  const taken = titles.filter(title => loaded.ledgerSteps?.some(step => step.title === title));
  if (taken.length) throw new WorkError('The ledger already has these steps: ' + taken.join(', ') + '. Give new titles.');
  const changed = await move(loaded, 'active');
  if (loaded.ledgerText === null) {
    const { revision } = await planningRevision(loaded.root, loaded.plan);
    changed.push(await writeLedger(loaded, newLedger(loaded, titles, today, revision)));
  } else {
    let next = setSteps(loaded.ledgerText, [...loaded.ledgerSteps!, ...titles.map(title => ({ title, status: 'todo' as const }))]);
    next = setFields(next, { updated: today });
    next = appendToSection(next, `- ${today}: reopened with ${titles.length === 1 ? 'the step' : 'the steps'} ${titles.map(title => '"' + title + '"').join(', ')}.`);
    changed.push(await writeLedger(loaded, next));
  }
  changed.push(await writePlan(loaded, { implementation_status: 'in_progress', completed_at: null, ...disposed && { design_status: 'accepted', superseded_by: null } }, today));
  return result(loaded.root, workId, changed);
}
