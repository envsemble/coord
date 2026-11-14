import type { Work, WorkState } from '../types';

export type StatusKey = 'your_turn' | 'working' | 'planning' | 'waiting' | 'blocked' | 'draft' | 'ready' | 'nostate' | 'complete' | 'partial' | 'superseded' | 'abandoned' | 'unknown';
export interface StatusLook { key: StatusKey; label: string; tone: 'open' | 'started' | 'done' | 'danger' | 'attention' | 'muted' }

export const statuses = {
  your_turn: { key: 'your_turn', label: 'Your turn', tone: 'attention' },
  working: { key: 'working', label: 'Working', tone: 'open' },
  planning: { key: 'planning', label: 'Planning', tone: 'open' },
  waiting: { key: 'waiting', label: 'Waiting', tone: 'started' },
  blocked: { key: 'blocked', label: 'Blocked', tone: 'danger' },
  draft: { key: 'draft', label: 'Draft', tone: 'muted' },
  ready: { key: 'ready', label: 'Ready', tone: 'muted' },
  nostate: { key: 'nostate', label: 'No state', tone: 'muted' },
  complete: { key: 'complete', label: 'Complete', tone: 'done' },
  partial: { key: 'partial', label: 'Partially done', tone: 'attention' },
  superseded: { key: 'superseded', label: 'Superseded', tone: 'muted' },
  abandoned: { key: 'abandoned', label: 'Abandoned', tone: 'muted' },
  unknown: { key: 'unknown', label: 'Status unknown', tone: 'muted' },
} as const satisfies Record<StatusKey, StatusLook>;

/**
 * One status per work item: how closed work ended (complete in purple; partly done once archived),
 * else whose turn its agents declare it is (Your turn in amber, Working and Planning in green,
 * Waiting in blue, Blocked in red), else what its plan's statuses say: a draft nobody has declared,
 * accepted work not started (Ready), or work under way that declares nothing (No state, which its
 * next agent sets right). Atlas never guesses it from what sessions do.
 */
export function statusOf(work: Pick<Work, 'design' | 'implementation' | 'progress' | 'location'> & { state?: WorkState | null }): StatusLook {
  if (work.design === 'superseded') return statuses.superseded;
  if (work.design === 'abandoned') return statuses.abandoned;
  if (work.implementation === 'complete') return statuses.complete;
  if (work.implementation === 'partial' && work.location === 'archived') return statuses.partial;
  if (work.state) return statuses[work.state.kind] ?? statuses.unknown;
  if (work.progress?.blocked) return statuses.blocked;
  if (work.design === 'draft') return statuses.draft;
  if (work.implementation === 'in_progress' || work.implementation === 'partial') return statuses.nostate;
  if (work.implementation === 'not_started') return statuses.ready;
  return statuses.unknown;
}
