// The search popup's results: the host's search of every active project (plans, steps, documents,
// headings, diagrams, elements, glossary terms and projects), below what the window finds itself
// (every plan from the project list, and the documents and diagrams of the open plan's project).
// They show grouped by kind. Pure, so it is unit-tested.
import type { Project, SearchKind, SearchResult } from './types';
import { workNumber } from './format';
import { diagramTarget, hubPlace, stepTarget, workTarget, type Place } from './targets';

export const searchKindLabels: Record<SearchKind, string> = {
  plan: 'Plans', step: 'Steps', document: 'Documents', heading: 'Headings', diagram: 'Diagrams', element: 'Elements', term: 'Glossary terms', project: 'Projects',
};

/** Where a result opens: a place, or a file of a project (by its path in the planning folder) that the window resolves. */
export type SearchDestination = { place: Place } | { project: string; path: string; anchor: string | null };

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
export const workKey = (project: string, work: string) => project + ':work:' + work;
export const pathKey = (project: string, path: string) => project + ':path:' + path;

/** Where a result of the host's search opens. */
export function resultDestination(result: SearchResult): SearchDestination {
  const project = result.folderId;
  switch (result.kind) {
    case 'project': return { place: hubPlace(project) };
    case 'plan':
      if (result.work) return { place: { project, target: workTarget(result.work) } };
      break;
    // A step opens its plan, the step pointed out in its progress.
    case 'step':
      if (result.work) return { place: { project, target: stepTarget(result.work, result.title) } };
      break;
    case 'diagram': case 'element':
      if (result.path) return { project, path: result.path, anchor: result.element ?? result.anchor };
      if (result.work) return { place: { project, target: diagramTarget(result.work, null, result.element) } };
      break;
    default:
      if (result.path) return { project, path: result.path, anchor: result.anchor };
  }
  return result.work ? { place: { project, target: workTarget(result.work, result.anchor) } } : { place: hubPlace(project) };
}

/** The host's results as the popup lists them, each with its project and work item (by number and title). */
export function hostEntries(results: SearchResult[], projects: Project[]): SearchEntry[] {
  const titles = new Map<string, string>();
  for (const project of projects) for (const work of [...project.summary?.active ?? [], ...project.summary?.closed ?? []]) titles.set(workKey(project.folderId, work.id), work.title);
  return results.map((result, index) => {
    const work = result.work && result.kind !== 'plan' ? [workNumber(result.work), titles.get(workKey(result.folderId, result.work))].filter(Boolean).join(' ') : result.work ? workNumber(result.work) : null;
    const key = result.kind === 'plan' && result.work ? workKey(result.folderId, result.work)
      : (result.kind === 'document' || result.kind === 'diagram') && result.path && !result.anchor && !result.element ? pathKey(result.folderId, result.path) : null;
    return {
      id: 'search:' + index + ':' + result.kind + ':' + result.folderId + ':' + (result.work ?? '') + ':' + (result.path ?? '') + '#' + (result.anchor ?? result.element ?? ''),
      kind: result.kind, label: result.title, detail: [result.kind === 'project' ? null : result.project, work].filter(Boolean).join(' · '),
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

/**
 * What the window finds itself (as it ranked it), then the host's results it does not list already
 * (as the host ranked them), each part grouped by kind; a kind listed above already is "More …"
 * below. The host answers later, so its results go below those shown and the highlighted one stays
 * where it is.
 */
export function listEntries(local: SearchEntry[], host: SearchEntry[]): ListedEntry[] {
  const keys = new Set(local.map(entry => entry.key).filter(Boolean));
  const kinds = new Set(local.map(entry => entry.kind));
  const more = grouped(host.filter(entry => !entry.key || !keys.has(entry.key)));
  return [
    ...grouped(local).map(entry => ({ ...entry, group: searchKindLabels[entry.kind] })),
    ...more.map(entry => ({ ...entry, group: kinds.has(entry.kind) ? 'More ' + searchKindLabels[entry.kind].toLowerCase() : searchKindLabels[entry.kind] })),
  ];
}
