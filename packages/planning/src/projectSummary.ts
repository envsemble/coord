// What a project's card in the app says about it, read from its planning folder: the repositories it
// plans for, how much of its work is active, blocked or being implemented, and when the folder last
// changed. It reads the registry and the headers of active work only, and asks Git for the last
// commit; anything unreadable counts as nothing rather than failing the project list.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from './check.ts';
import { runProgram } from './run.ts';

export interface ProjectSummary {
  /** The IDs of the repositories it plans for, without the planning folder's own entry. */
  repositories: string[];
  /** Its registered work in `active/`; of that, the work whose ledger says it is blocked, and the work being implemented. */
  active: number;
  blocked: number;
  implementing: number;
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

/** A planning folder's summary for its project card. */
export async function projectSummary(root: string): Promise<ProjectSummary> {
  let registry: { repositories?: unknown; work_items?: unknown } = {};
  try { const text = await readFile(path.join(root, 'planning.json'), 'utf8'); registry = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text); } catch { /* an empty summary */ }
  const repositories = (Array.isArray(registry.repositories) ? registry.repositories : [])
    .filter(entry => typeof entry?.id === 'string' && entry.path !== '.').map(entry => entry.id as string);
  const active = (Array.isArray(registry.work_items) ? registry.work_items : []).filter(entry => typeof entry?.path === 'string' && entry.path.startsWith('active/'));
  const states = await Promise.all(active.map(async entry => {
    const folder = inside(root, entry.path), plan = inside(root, entry.current_plan);
    const [ledger, planHeader] = await Promise.all([folder ? header(path.join(folder, 'ledger.md'), ['steps']) : null, plan ? header(plan) : null]);
    return { blocked: typeof ledger?.blocked === 'string' && ledger.blocked.trim() !== '', implementing: planHeader?.implementation_status === 'in_progress' };
  }));
  const updated = await runProgram('git', ['-C', root, 'log', '-1', '--format=%cI'], { timeout: 10_000 }).then(({ stdout }) => stdout.trim() || null, () => null);
  return {
    repositories, active: active.length, updated,
    blocked: states.filter(state => state.blocked).length,
    implementing: states.filter(state => state.implementing && !state.blocked).length,
  };
}
