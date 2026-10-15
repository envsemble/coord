// What a project's card in the app says about it, read from its planning folder: the repositories it
// plans for, its active work (each item's title and where it stands: blocked, being implemented, a
// draft plan or otherwise), and when the folder last changed. It reads the registry and the headers
// of active work only, and asks Git for the last commit; anything unreadable counts as nothing rather
// than failing the project list.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from './check.ts';
import { runProgram } from './run.ts';

/** Where an active work item stands, as the app's status decides it: blocked first, then implementing, then a draft plan. */
export type ActiveWorkState = 'blocked' | 'implementing' | 'draft' | 'other';
export interface ActiveWork {
  id: string;
  title: string;
  state: ActiveWorkState;
  /** The ledger's blocker, when it is blocked. */
  blocked: string | null;
}
export interface ProjectSummary {
  /** The IDs of the repositories it plans for, without the planning folder's own entry. */
  repositories: string[];
  /** Its registered work in `active/`, in the registry's order. */
  active: ActiveWork[];
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

/** A planning folder's summary for its project card. */
export async function projectSummary(root: string): Promise<ProjectSummary> {
  let registry: { repositories?: unknown; work_items?: unknown } = {};
  try { const source = await readFile(path.join(root, 'planning.json'), 'utf8'); registry = JSON.parse(source.startsWith(BOM) ? source.slice(1) : source); } catch { /* an empty summary */ }
  const repositories = (Array.isArray(registry.repositories) ? registry.repositories : [])
    .filter(entry => typeof entry?.id === 'string' && entry.path !== '.').map(entry => entry.id as string);
  const entries = (Array.isArray(registry.work_items) ? registry.work_items : [])
    .filter(entry => typeof entry?.id === 'string' && typeof entry.path === 'string' && entry.path.startsWith('active/'));
  const active = await Promise.all(entries.map(async (entry): Promise<ActiveWork> => {
    const folder = inside(root, entry.path), plan = inside(root, entry.current_plan);
    const [ledger, planHeader] = await Promise.all([folder ? header(path.join(folder, 'ledger.md'), ['steps']) : null, plan ? header(plan) : null]);
    const blocked = text(ledger?.blocked);
    const implementation = planHeader?.implementation_status;
    const state: ActiveWorkState = blocked ? 'blocked' : implementation === 'in_progress' ? 'implementing'
      : !['partial', 'complete'].includes(String(implementation)) && planHeader?.design_status === 'draft' ? 'draft' : 'other';
    return { id: entry.id as string, title: text(planHeader?.title) ?? text(entry.title) ?? (entry.path as string).split('/').at(-1)!, state, blocked };
  }));
  const updated = await runProgram('git', ['-C', root, 'log', '-1', '--format=%cI'], { timeout: 10_000 }).then(({ stdout }) => stdout.trim() || null, () => null);
  return { repositories, active, updated };
}
