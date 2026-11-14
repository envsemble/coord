// Find the planning folder for a session's folder. Every planning folder lives in the Coord home. A
// folder inside one of a project's folders (planning.json's `folders`) belongs to that project, the
// deepest folder winning when they nest; inside a planning folder, to that project. Outside every
// folder it belongs to none. Coord knows no repositories: the agent links to them itself.
// Only active projects match: archived ones (such as a folder split into others) do not.
// `where` also lists every active project of the home in brief, so an agent outside them can ask;
// a matching project's work is listed once, in full, in `matches`.
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from '../check/check.ts';
import { readRegistry, type RegistryEntry } from '../registry/registry.ts';
import { ledgerStatus, stepCounts, stepSummary } from '../work/ledger.ts';
import { coordHome, homePlanningFolders } from '../../home/home.ts';
import { folderKey, inactiveProjectFolders, planningName } from '../../home/database.ts';
import { stateOf } from '../work/state.ts';
import type { LedgerStep, WorkState } from '../types.ts';

export interface ActiveWork {
  workId: string; title: string; path: string; plan: string | null;
  /** The plan's `summary` header. */
  summary: string | null;
  designStatus: string | null; implementationStatus: string | null;
  steps: LedgerStep[]; progress: string | null; blocked: string | null;
  /** The state its plan declares (whose turn it is), and the plan's and the ledger's last updates. */
  state: WorkState | null; updated: string | null; ledgerUpdated: string | null;
  /** Why the plan or ledger could not be read, when it could not. */
  problem?: string;
}
export interface PlanningMatch {
  planningFolder: string;
  /** The project's name: its registry's `name`, else the folder's own name. */
  project: string;
  /** How the folder matched: by being in one of the project's folders, or inside the planning folder. */
  via: ('folder' | 'inside')[];
  /** The project's active work. */
  work: ActiveWork[];
}
/** One active work item in brief: its title and states, without its steps. */
export interface WorkBrief {
  workId: string; title: string; summary: string | null; designStatus: string | null; implementationStatus: string | null;
  progress: string | null; blocked: string | null; problem?: string;
}
/** An active project of the home, whether or not the folder belongs to it. */
export interface ProjectBrief {
  planningFolder: string;
  project: string;
  /** The folders it covers (planning.json's `folders`). */
  folders: string[];
  /** Whether the folder belongs to it (it is then in `matches`, with its work in full, and has no `work` here). */
  match: boolean;
  /** All of its active work, when the folder does not belong to it. */
  work?: WorkBrief[];
}
export interface Whereabouts {
  cwd: string; home: string;
  /** The projects the folder belongs to, with their active work in full. */
  matches: PlanningMatch[];
  /** Every active project in the home (archived ones never), matching or not. */
  projects: ProjectBrief[];
}

export class PlanningNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = 'PlanningNotFoundError'; }
}

/** Whether `child` is `parent` or inside it, case-insensitively where the file system usually is. */
export function insideFolder(parent: string, child: string) {
  const relative = path.relative(process.platform === 'win32' || process.platform === 'darwin' ? parent.toLowerCase() : parent, process.platform === 'win32' || process.platform === 'darwin' ? child.toLowerCase() : child);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}
const inside = insideFolder;

/** One work item's plan and ledger headers, read with the planning check's own rules. */
async function activeWork(root: string, item: RegistryEntry): Promise<ActiveWork> {
  const work: ActiveWork = { workId: String(item.id), title: path.posix.basename(String(item.path)), path: String(item.path), plan: typeof item.current_plan === 'string' ? item.current_plan : null, summary: null, designStatus: null, implementationStatus: null, steps: [], progress: null, blocked: null, state: null, updated: null, ledgerUpdated: null };
  try {
    if (work.plan) {
      const plan = parseFrontmatter(await readFile(path.join(root, work.plan), 'utf8'));
      if (plan) {
        if (typeof plan.title === 'string') work.title = plan.title;
        if (typeof plan.summary === 'string' && plan.summary.trim()) work.summary = plan.summary.trim();
        work.designStatus = typeof plan.design_status === 'string' ? plan.design_status : null;
        work.implementationStatus = typeof plan.implementation_status === 'string' ? plan.implementation_status : null;
        work.state = stateOf(plan);
        work.updated = typeof plan.updated === 'string' ? plan.updated : null;
      }
    }
    const ledgerText = await readFile(path.join(root, work.path, 'ledger.md'), 'utf8').catch(() => null);
    const metadata = ledgerText === null ? null : parseFrontmatter(ledgerText, { entryLists: ['steps'] });
    if (metadata) {
      const status = ledgerStatus(metadata, work.workId);
      work.steps = status.steps;
      work.blocked = status.blocked;
      work.ledgerUpdated = typeof metadata.updated === 'string' ? metadata.updated : null;
      work.progress = stepSummary(stepCounts(status.steps));
    }
  } catch (error) { work.problem = (error as Error).message; }
  return work;
}

const brief = ({ workId, title, summary, designStatus, implementationStatus, progress, blocked, problem }: ActiveWork): WorkBrief =>
  ({ workId, title, summary, designStatus, implementationStatus, progress, blocked, ...problem ? { problem } : {} });

/**
 * The planning folders of the home that the folder `cwd` belongs to, with their active work, and
 * every active project of the home in brief.
 */
export async function findPlanning(cwd: string, options: { home?: string } = {}): Promise<Whereabouts> {
  const home = options.home ?? coordHome();
  const resolvedCwd = await realpath(cwd).catch(() => path.resolve(cwd));
  const candidates: (PlanningMatch & { depth: number })[] = [];
  const projects: ProjectBrief[] = [];
  const inactive = await inactiveProjectFolders(home);
  // A folder's path segments, its root counting as one, so that `/` is a folder like any other.
  const depthOf = (folder: string) => folder.split(/[\\/]+/).filter(Boolean).length + 1;
  for (const folder of await homePlanningFolders(home)) {
    const root = await realpath(folder).catch(() => folder);
    if (inactive.has(folderKey(root))) continue;
    let registry;
    try { registry = await readRegistry(root); } catch { continue; }
    const via = new Set<PlanningMatch['via'][number]>();
    // The deepest of its folders the session is in (by their path segments), or 0.
    let depth = 0;
    for (const covered of registry.folders) {
      const resolved = await realpath(covered).catch(() => path.resolve(covered));
      if (inside(resolved, resolvedCwd)) depth = Math.max(depth, depthOf(resolved));
    }
    if (depth) via.add('folder');
    const within = inside(root, resolvedCwd);
    if (within) via.add('inside');
    // Inside the planning folder counts as a folder of its own depth: a broader folder around it does not win.
    const level = Math.max(depth, within ? depthOf(root) : 0);
    const active = registry.work_items.filter(item => typeof item?.id === 'string' && typeof item.path === 'string' && item.path.startsWith('active/'));
    const work = await Promise.all(active.map(item => activeWork(root, item)));
    const project = await planningName(root);
    projects.push({ planningFolder: root, project, folders: registry.folders, match: false, work: work.map(brief) });
    if (via.size) candidates.push({ planningFolder: root, project, via: [...via], work, depth: level });
  }
  // The deepest folder (or the planning folder itself) decides: only the projects with the deepest one the session is in match.
  const deepest = Math.max(0, ...candidates.map(candidate => candidate.depth));
  const matches = candidates.filter(candidate => candidate.depth === deepest).map(({ depth: _, ...match }) => match);
  for (const project of projects) {
    project.match = matches.some(match => match.planningFolder === project.planningFolder);
    if (project.match) delete project.work;
  }
  return { cwd: resolvedCwd, home, matches, projects };
}

/**
 * The planning folder an operation works in: the one given, else the one the folder `cwd` belongs
 * to. Several are narrowed to the one registering `work`; still several, or none, is an
 * error naming what to do.
 */
export async function resolvePlanningFolder(options: { planningFolder?: string | null; cwd?: string; home?: string; work?: string | null }): Promise<string> {
  if (options.planningFolder) return realpath(path.resolve(options.planningFolder)).catch(() => { throw new PlanningNotFoundError('The planning folder does not exist: ' + options.planningFolder); });
  const where = await findPlanning(options.cwd ?? process.cwd(), { home: options.home });
  let candidates = where.matches.map(match => match.planningFolder);
  if (candidates.length > 1 && options.work) {
    const registering: string[] = [];
    for (const folder of candidates) {
      const registry = await readRegistry(folder).catch(() => null);
      if (registry?.work_items.some(item => item?.id === options.work)) registering.push(folder);
    }
    candidates = registering;
  }
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) throw new PlanningNotFoundError(`No project in the Coord home (${where.home}) covers ${where.cwd}. Ask the user which project to use and give its planning folder, or add a folder this one is in to that project's folders (planning.json's folders, or the project menu of the app's plans).`);
  const named = where.matches.filter(match => candidates.includes(match.planningFolder)).map(match => `${match.project} (${match.planningFolder})`);
  throw new PlanningNotFoundError('Several projects cover this folder: ' + named.join(', ') + '. Ask the user which project to plan in, then give its planning folder (--planning-dir, or planningFolder in the Coord tools).');
}
