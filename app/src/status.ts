import type { Work } from './types';

export type WorkStatusKey = 'superseded' | 'abandoned' | 'complete' | 'blocked' | 'draft' | 'in_progress' | 'partial' | 'not_started' | 'unknown';
export interface WorkStatus { key: WorkStatusKey; label: string; tone: 'open' | 'done' | 'danger' | 'attention' | 'muted' }

/**
 * One status per work item, in GitHub issue terms: open work is green (or muted before it starts),
 * complete work is purple, blocked work is red. Design status only shows when the plan is not accepted.
 */
export function workStatus(work: Pick<Work, 'design' | 'implementation' | 'progress'>): WorkStatus {
  if (work.design === 'superseded') return { key: 'superseded', label: 'Superseded', tone: 'muted' };
  if (work.design === 'abandoned') return { key: 'abandoned', label: 'Abandoned', tone: 'muted' };
  if (work.implementation === 'complete') return { key: 'complete', label: 'Complete', tone: 'done' };
  if (work.progress?.blocked) return { key: 'blocked', label: 'Blocked', tone: 'danger' };
  if (work.implementation === 'in_progress') return { key: 'in_progress', label: 'In progress', tone: 'open' };
  if (work.implementation === 'partial') return { key: 'partial', label: 'Partially done', tone: 'attention' };
  if (work.design === 'draft') return { key: 'draft', label: 'Draft plan', tone: 'muted' };
  if (work.implementation === 'not_started') return { key: 'not_started', label: 'Not started', tone: 'muted' };
  return { key: 'unknown', label: 'Status unknown', tone: 'muted' };
}

/** The design status, only when it adds information beyond the work status. */
export function designNote(work: Pick<Work, 'design' | 'implementation' | 'progress'>): string | null {
  const status = workStatus(work);
  if (work.design === 'draft' && status.key !== 'draft') return 'Draft plan';
  if (work.design === 'unknown' && work.implementation !== 'unknown') return 'Plan status unknown';
  return null;
}
