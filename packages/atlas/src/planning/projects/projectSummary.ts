// What the app's project list says about a project, read from its planning folder: its work (each
// item's title, summary, steps and the step being worked on, last change and where it stands: active work blocked, being implemented, a draft plan or otherwise, and closed
// work with how and when it ended), what agents spent on each item, and when the folder last changed.
// It reads the registry and the headers of plans and ledgers only, the project's reports in the home
// database at once, and asks Git for the last commit. A registry that cannot be read is an error,
// which the list shows as a project it could not read; anything unreadable within it counts as nothing.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from '../check/check.ts';
import type { HomeDatabase } from '../home/database.ts';
import type { HandoffLink } from '../types.ts';
import { handoffsOf } from '../work/handoffs.ts';
import { runProgram } from '../system/run.ts';
import { storedReports, summarizeReports, type StatisticsReport } from '../statistics/statistics.ts';

/**
 * Where a work item stands, as the app's status decides it: blocked first, then implementing, then a
 * draft plan; `closed` is work in `archive/`.
 */
export type ProjectWorkState = 'blocked' | 'implementing' | 'draft' | 'other' | 'closed';
export interface ProjectWork {
  id: string;
  title: string;
  state: ProjectWorkState;
  /** The ledger's blocker, when it is blocked. */
  blocked: string | null;
  /** The plan's `summary` header. */
  summary: string | null;
  /** The ledger's steps, done and in all, and among them the planning steps; null without a ledger that lists steps. */
  steps: { done: number; total: number; planning: { done: number; total: number } } | null;
  /** When the plan last changed: its `updated` header, else its `completed_at`. */
  updated: string | null;
  /** How closed work ended: superseded or abandoned (the plan's design_status), else complete; null while open. */
  outcome: 'complete' | 'superseded' | 'abandoned' | null;
  /** The step being worked on (the ledger's first `doing`), else the next (its first `todo`), with its phase; null without one. */
  step: { title: string; status: 'doing' | 'todo'; phase: 'planning' | 'implementation' } | null;
  /** The plan's `completed_at`. */
  completed: string | null;
  /** What agents spent on it, from its reports in the home database; null without reports. */
  statistics: ProjectWorkStatistics | null;
  /**
   * The work items this one continues (its plan's `continues`), and those that continue it (their
   * plans' `continues` naming it, in any project of the home): handoffs, oldest work first.
   */
  continues?: HandoffLink[]; continuedIn?: HandoffLink[];
}
/**
 * A work item's statistics in brief, counted as the plan page counts them (see summarizeReports):
 * agent time (measured and estimated), tokens, the main model and how many others took part, the
 * planning and implementation stages (reports from before stages count in the totals only),
 * subagents and the last report. Plan revisions need Git, so they are left out.
 */
export interface ProjectWorkStatistics {
  agentMs: number; activeMs: number; unmergedMs: number; tokens: number | null; primaryModel: string | null; primaryEffort: string | null; otherModels: number;
  planning: { agentMs: number; tokens: number | null }; implementation: { agentMs: number; tokens: number | null };
  subagents: number; lastReport: string | null;
}
export interface ProjectSummary {
  /** Its registered work in `active/`, in the registry's order. */
  active: ProjectWork[];
  /** Its registered work in `archive/`, the latest changed first. */
  closed: ProjectWork[];
  /** When its planning folder last changed: the time of its last commit (ISO 8601), null outside Git. */
  updated: string | null;
}

const BOM = String.fromCharCode(0xfeff);
const header = async (file: string, lists: readonly string[] = []) => {
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text === null) return null;
  try { return parseFrontmatter(text.startsWith(BOM) ? text.slice(1) : text, { entryLists: lists }); } catch { return null; }
};
/** A path inside the planning folder from the registry, or null for one that leaves it. */
const inside = (root: string, relative: unknown) =>
  typeof relative === 'string' && relative && !relative.includes('\\') && !relative.split('/').includes('..') ? path.join(root, ...relative.split('/')) : null;
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

/** A work item's reports in brief; null without any. */
export function workStatisticsBrief(reports: StatisticsReport[]): ProjectWorkStatistics | null {
  if (!reports.length) return null;
  const summary = summarizeReports(reports);
  const stage = (usage: { agentMs: number; tokens: number | null }) => ({ agentMs: usage.agentMs, tokens: usage.tokens });
  // Other models as the plan page lists them: those that did anything at all.
  const others = summary.models.filter(model => model.model !== summary.primaryModel && (model.agentMs > 0 || (model.tokens ?? 0) > 0 || model.reports > 0));
  return {
    agentMs: summary.agentMs, activeMs: summary.activeMs, unmergedMs: summary.unmergedMs, tokens: summary.tokens, primaryModel: summary.primaryModel, primaryEffort: summary.primaryEffort, otherModels: others.length,
    planning: stage(summary.stages.planning), implementation: stage(summary.stages.implementation),
    subagents: summary.subagents.count, lastReport: summary.lastReport,
  };
}

type Step = { title?: unknown; status?: unknown; phase?: unknown };
/** The first step being worked on, else the first to do. */
function currentStep(steps: Step[]): ProjectWork['step'] {
  const titled = steps.filter(step => text(step?.title));
  const step = titled.find(item => item.status === 'doing') ?? titled.find(item => item.status === 'todo');
  return step ? { title: text(step.title)!, status: step.status as 'doing' | 'todo', phase: step.phase === 'planning' ? 'planning' : 'implementation' } : null;
}

/** A work item from its registry entry, plan header, ledger header and reports. */
async function workOf(root: string, entry: { id: string; path: string; title?: unknown; current_plan?: unknown }, closed: boolean, reports: StatisticsReport[]): Promise<ProjectWork> {
  const folder = inside(root, entry.path), plan = inside(root, entry.current_plan);
  const [ledger, planHeader] = await Promise.all([folder ? header(path.join(folder, 'ledger.md'), ['steps']) : null, plan ? header(plan) : null]);
  const blocked = closed ? null : text(ledger?.blocked);
  const implementation = planHeader?.implementation_status, design = planHeader?.design_status;
  const state: ProjectWorkState = closed ? 'closed' : blocked ? 'blocked' : implementation === 'in_progress' ? 'implementing'
    : !['partial', 'complete'].includes(String(implementation)) && design === 'draft' ? 'draft' : 'other';
  const outcome = !closed ? null : design === 'superseded' || design === 'abandoned' ? design : implementation === 'complete' ? 'complete' : null;
  const steps = Array.isArray(ledger?.steps) ? (ledger.steps as Step[]) : null;
  const counted = (list: Step[]) => ({ done: list.filter(step => step?.status === 'done').length, total: list.length });
  return {
    id: entry.id, title: text(planHeader?.title) ?? text(entry.title) ?? entry.path.split('/').at(-1)!, state, blocked,
    summary: text(planHeader?.summary), steps: steps && { ...counted(steps), planning: counted(steps.filter(step => step?.phase === 'planning')) },
    updated: text(planHeader?.updated) ?? text(planHeader?.completed_at), outcome,
    step: steps && currentStep(steps), completed: text(planHeader?.completed_at), statistics: workStatisticsBrief(reports),
    // As the plan names them; linkHandoffs finds them in the home's projects, and the work continuing this.
    continues: handoffsOf(planHeader?.continues).references.map((item): HandoffLink => ({ folderId: null, project: item.project ?? '', projectName: '', workId: item.workId, title: null, state: null, outcome: null })),
    continuedIn: [],
  };
}

/**
 * A planning folder's summary for the project list; throws when its planning.json cannot be read.
 * With the home database and the project's row in it, or the project's reports read already, each
 * work item has its statistics; reports that cannot be read count as none.
 */
export async function projectSummary(root: string, options: { database?: HomeDatabase; projectId?: number; reports?: Map<string, StatisticsReport[]> } = {}): Promise<ProjectSummary> {
  const source = await readFile(path.join(root, 'planning.json'), 'utf8');
  const registry = JSON.parse(source.startsWith(BOM) ? source.slice(1) : source) as { work_items?: unknown } | null;
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) throw new Error('planning.json is not an object.');
  const entries = (Array.isArray(registry.work_items) ? registry.work_items : []).filter(entry => typeof entry?.id === 'string' && typeof entry.path === 'string');
  // Every work item's reports in one query.
  let reports = options.reports ?? new Map<string, StatisticsReport[]>();
  if (!options.reports && options.database && options.projectId !== undefined) {
    try { reports = storedReports(options.database, options.projectId); } catch { /* No statistics then. */ }
  }
  const [active, closed] = await Promise.all(['active/', 'archive/'].map(location =>
    Promise.all(entries.filter(entry => entry.path.startsWith(location)).map(entry => workOf(root, entry, location === 'archive/', reports.get(entry.id) ?? [])))));
  // The latest change first; on the same day, the later registration.
  const number = (id: string) => Number(/[0-9]+$/.exec(id)?.[0] ?? 0);
  closed.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? '') || number(b.id) - number(a.id));
  const updated = await runProgram('git', ['-C', root, 'log', '-1', '--format=%cI'], { timeout: 10_000 }).then(({ stdout }) => stdout.trim() || null, () => null);
  return { active, closed, updated };
}
