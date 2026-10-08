import type { Document } from './types';

export type Route = { view: string; work: string | null; file: string | null; anchor: string | null; tab?: string | null; diagram?: string | null; element?: string | null };

export function routeHref(route: Partial<Route>) {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries({ view: 'work', ...route })) if (value) parameters.set(name, value);
  return '#' + parameters.toString();
}

export function documentRoute(file: Document, anchor?: string | null): Partial<Route> {
  return { view: file.category === 'knowledge' ? 'knowledge' : file.workId ? 'work' : 'records', work: file.workId, file: file.path, anchor: anchor ?? null };
}
