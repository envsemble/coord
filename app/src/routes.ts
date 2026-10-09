import type { Document } from './types';

export type WorkTab = 'plan' | 'ledger' | 'diagrams' | 'files';
export type Route = { view: string; work: string | null; file: string | null; anchor: string | null; tab?: string | null; diagram?: string | null; element?: string | null };

export function routeHref(route: Partial<Route>) {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries({ view: 'work', ...route })) if (value) parameters.set(name, value);
  return '#' + parameters.toString();
}

export function currentRoute(): Route {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  return { view: parameters.get('view') ?? 'work', work: parameters.get('work'), file: parameters.get('file'), anchor: parameters.get('anchor'), tab: parameters.get('tab'), diagram: parameters.get('diagram'), element: parameters.get('element') };
}

export function navigate(route: Partial<Route>) {
  window.location.hash = routeHref(route);
}

/** A file inside a work item opens in its work page: plan and ledger in their tabs, anything else in Files. */
export function documentRoute(file: Document, anchor?: string | null): Partial<Route> {
  return { view: file.category === 'knowledge' ? 'knowledge' : file.workId ? 'work' : 'records', work: file.workId, file: file.path, anchor: anchor ?? null };
}
