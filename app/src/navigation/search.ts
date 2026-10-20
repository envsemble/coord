// The search popup's results: the host's search of every active project (plans, steps, documents,
// headings, diagrams, elements, glossary terms and projects), below what the window finds itself
// (every plan from the project list, and the documents and diagrams of the open plan's project).
// They show grouped by kind. Pure, so it is unit-tested.
import type { Project, SearchKind, SearchResult } from '../types';
import { workNumber } from '../ui/format';
import { diagramTarget, hubPlace, stepTarget, workTarget, type Place } from './targets';

const searchKindLabels: Record<SearchKind, string> = {
  plan: 'Plans', step: 'Steps', document: 'Documents', heading: 'Headings', diagram: 'Diagrams', element: 'Elements', term: 'Glossary terms', project: 'Projects',
};

/** Where a result opens: a place, or a file of a project (by its path in the planning folder) that the window resolves. */
export type SearchDestination = { place: Place } | { projectId: string; path: string; anchor: string | null };

/** A result as the popup lists it: its kind, title, where it is (project and work item) and the snippet. */
export interface SearchEntry {
  id: string;
  kind: SearchKind;
  label: string;
  detail: string;
  snippet: string | null;
  destination: SearchDestination;
  /** What else finds the same thing: a plan, or a file by its path, in a project. */
  key: string | null;
}

/** A plan's or file's key, so the window's own entries do not repeat the host's. */
export const workKey = (projectId: string, work: string) => projectId + ':work:' + work;
export const pathKey = (projectId: string, path: string) => projectId + ':path:' + path;

/** Where a result of the host's search opens. */
export function resultDestination(result: SearchResult): SearchDestination {
  const { projectId } = result;
  switch (result.kind) {
    case 'project': return { place: hubPlace(projectId) };
    case 'plan':
      if (result.work) return { place: { projectId, target: workTarget(result.work) } };
      break;
    // A step opens its plan, the step pointed out in its progress.
    case 'step':
      if (result.work) return { place: { projectId, target: stepTarget(result.work, result.title) } };
      break;
    case 'diagram': case 'element':
      if (result.path) return { projectId, path: result.path, anchor: result.element ?? result.anchor };
      if (result.work) return { place: { projectId, target: diagramTarget(result.work, null, result.element) } };
      break;
    default:
      if (result.path) return { projectId, path: result.path, anchor: result.anchor };
  }
  return result.work ? { place: { projectId, target: workTarget(result.work, result.anchor) } } : { place: hubPlace(projectId) };
}

/** The host's results as the popup lists them, each with its project and work item (by number and title). */
export function hostEntries(results: SearchResult[], projects: Project[]): SearchEntry[] {
  const titles = new Map<string, string>();
  for (const project of projects) for (const work of [...project.summary?.active ?? [], ...project.summary?.closed ?? []]) titles.set(workKey(project.id, work.id), work.title);
  // An archived project stays out of the way: its results are left out, should the host send any.
  const archived = new Set(projects.filter(project => project.state !== 'active').map(project => project.id));
  return results.filter(result => !archived.has(result.projectId)).map((result, index) => {
    const work = result.work && result.kind !== 'plan' ? [workNumber(result.work), titles.get(workKey(result.projectId, result.work))].filter(Boolean).join(' ') : result.work ? workNumber(result.work) : null;
    const key = result.kind === 'plan' && result.work ? workKey(result.projectId, result.work)
      : (result.kind === 'document' || result.kind === 'diagram') && result.path && !result.anchor && !result.element ? pathKey(result.projectId, result.path) : null;
    return {
      id: 'search:' + index + ':' + result.kind + ':' + result.projectId + ':' + (result.work ?? '') + ':' + (result.path ?? '') + '#' + (result.anchor ?? result.element ?? ''),
      kind: result.kind, label: result.title, detail: [result.kind === 'project' ? null : result.projectName, work].filter(Boolean).join(' · '),
      snippet: result.snippet, destination: resultDestination(result), key,
    };
  });
}

/** A result as listed, under the heading of its group. */
export interface ListedEntry extends SearchEntry { group: string }

/** Entries grouped by kind, each group where its first entry was. */
function grouped(entries: SearchEntry[]) {
  const order: SearchKind[] = [];
  for (const entry of entries) if (!order.includes(entry.kind)) order.push(entry.kind);
  return order.flatMap(kind => entries.filter(entry => entry.kind === kind));
}

/** How many of the window's own entries of a kind show after the host's results. */
export const ownPerKind = 5;

/** The second of two parts of the list: its entries' groups, "More …" for a kind the first part has. */
function after(first: SearchEntry[], second: SearchEntry[], cap: number): ListedEntry[] {
  const keys = new Set(first.map(entry => entry.key).filter(Boolean));
  const kinds = new Set(first.map(entry => entry.kind));
  const counts = new Map<SearchKind, number>();
  const kept = second.filter(entry => {
    if (entry.key && keys.has(entry.key)) return false;
    const count = (counts.get(entry.kind) ?? 0) + 1;
    counts.set(entry.kind, count);
    return count <= cap;
  });
  return grouped(kept).map(entry => ({ ...entry, group: kinds.has(entry.kind) ? 'More ' + searchKindLabels[entry.kind].toLowerCase() : searchKindLabels[entry.kind] }));
}

/**
 * The list: what the window finds itself (as it ranked it) until the host answers. Then the host's
 * results first (as it ranked them), and the window's own entries it did not return, at most
 * `ownPerKind` of a kind; each part grouped by kind, a kind listed above already "More …" below.
 * When the user had moved the highlight before the host answered (`below`), its results go below
 * those shown instead, so the highlighted one stays where it is.
 */
export function listEntries(local: SearchEntry[], host: SearchEntry[], below = false): ListedEntry[] {
  const plain = (entries: SearchEntry[]) => grouped(entries).map(entry => ({ ...entry, group: searchKindLabels[entry.kind] }));
  if (!host.length) return plain(local);
  return below ? [...plain(local), ...after(local, host, Infinity)] : [...plain(host), ...after(host, local, ownPerKind)];
}
