// What the app's project list says about a project, read from its planning folder: the repositories
// it plans for, its work (each item's title, summary, steps, last change and where it stands: active
// work blocked, being implemented, a draft plan or otherwise, and closed work with how it ended), and
// when the folder last changed. It reads the registry and the headers of plans and ledgers only, and
// asks Git for the last commit. A registry that cannot be read is an error, which the list shows as
// a project it could not read; anything unreadable within it counts as nothing.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from './check.ts';
import { runProgram } from './run.ts';

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
}
export interface ProjectSummary {
  /** The IDs of the repositories it plans for, without the planning folder's own entry. */
  repositories: string[];
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

/** A work item from its registry entry, plan header and ledger header. */
async function workOf(root: string, entry: { id: string; path: string; title?: unknown; current_plan?: unknown }, closed: boolean): Promise<ProjectWork> {
  const folder = inside(root, entry.path), plan = inside(root, entry.current_plan);
  const [ledger, planHeader] = await Promise.all([folder ? header(path.join(folder, 'ledger.md'), ['steps']) : null, plan ? header(plan) : null]);
  const blocked = closed ? null : text(ledger?.blocked);
  const implementation = planHeader?.implementation_status, design = planHeader?.design_status;
  const state: ProjectWorkState = closed ? 'closed' : blocked ? 'blocked' : implementation === 'in_progress' ? 'implementing'
    : !['partial', 'complete'].includes(String(implementation)) && design === 'draft' ? 'draft' : 'other';
  const outcome = !closed ? null : design === 'superseded' || design === 'abandoned' ? design : implementation === 'complete' ? 'complete' : null;
  const steps = Array.isArray(ledger?.steps) ? (ledger.steps as { status?: unknown; phase?: unknown }[]) : null;
  const counted = (list: { status?: unknown }[]) => ({ done: list.filter(step => step?.status === 'done').length, total: list.length });
  return {
    id: entry.id, title: text(planHeader?.title) ?? text(entry.title) ?? entry.path.split('/').at(-1)!, state, blocked,
    summary: text(planHeader?.summary), steps: steps && { ...counted(steps), planning: counted(steps.filter(step => step?.phase === 'planning')) },
    updated: text(planHeader?.updated) ?? text(planHeader?.completed_at), outcome,
  };
}

/** A planning folder's summary for the project list; throws when its planning.json cannot be read. */
export async function projectSummary(root: string): Promise<ProjectSummary> {
  const source = await readFile(path.join(root, 'planning.json'), 'utf8');
  const registry = JSON.parse(source.startsWith(BOM) ? source.slice(1) : source) as { repositories?: unknown; work_items?: unknown } | null;
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) throw new Error('planning.json is not an object.');
  const repositories = (Array.isArray(registry.repositories) ? registry.repositories : [])
    .filter(entry => typeof entry?.id === 'string' && entry.path !== '.').map(entry => entry.id as string);
  const entries = (Array.isArray(registry.work_items) ? registry.work_items : []).filter(entry => typeof entry?.id === 'string' && typeof entry.path === 'string');
  const [active, closed] = await Promise.all(['active/', 'archive/'].map(location =>
    Promise.all(entries.filter(entry => entry.path.startsWith(location)).map(entry => workOf(root, entry, location === 'archive/')))));
  // The latest change first; on the same day, the later registration.
  const number = (id: string) => Number(/[0-9]+$/.exec(id)?.[0] ?? 0);
  closed.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? '') || number(b.id) - number(a.id));
  const updated = await runProgram('git', ['-C', root, 'log', '-1', '--format=%cI'], { timeout: 10_000 }).then(({ stdout }) => stdout.trim() || null, () => null);
  return { repositories, active, closed, updated };
}
