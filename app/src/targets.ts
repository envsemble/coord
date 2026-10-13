// What a tab shows. Tabs are identified by what they show, so opening something that already
// has a tab focuses that tab (and updates its position, such as a heading or a diagram).
import type { Document, Target, ViewName, Work, WorkSection } from './types';

export function tabId(target: Target): string {
  switch (target.kind) {
    case 'view': return 'view:' + target.view;
    case 'work': return 'work:' + target.work;
    case 'file': return 'file:' + target.path;
  }
}

export const viewTarget = (view: ViewName): Target => ({ kind: 'view', view });
export const workTarget = (work: string, section: WorkSection | null = null, extra: { diagram?: string | null; element?: string | null; anchor?: string | null } = {}): Target =>
  ({ kind: 'work', work, section, diagram: extra.diagram ?? null, element: extra.element ?? null, anchor: extra.anchor ?? null });
export const fileTarget = (path: string, anchor: string | null = null): Target => ({ kind: 'file', path, anchor });

/** Where a link to a document goes: a work item's plan and ledger open in its overview, anything else as a file. */
export function documentTarget(file: Document, work: Work | undefined, anchor: string | null = null): Target {
  if (work && file.path === work.currentPlan) return workTarget(work.id, 'plan', { anchor });
  if (work && file.path === work.ledger) return workTarget(work.id, 'ledger', { anchor });
  return fileTarget(file.path, anchor);
}

export const viewLabels: Record<ViewName, string> = { work: 'Work', activity: 'Activity', statistics: 'Statistics' };

/**
 * What a tab's scroll position belongs to: its view, its work item and section, or its file. A place
 * reached at a heading has its own, so going back finds the page where it was before.
 */
export function scrollKey(target: Target): string {
  if (target.kind === 'view') return 'view:' + target.view;
  const at = target.anchor ? '#' + target.anchor : '';
  if (target.kind === 'work') return 'work:' + target.work + ':' + (target.section ?? '') + at;
  return 'file:' + target.path + at;
}
