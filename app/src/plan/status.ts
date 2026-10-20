import type { Work, WorkActivity } from '../types';

export type StatusKey = 'working' | 'waiting' | 'blocked' | 'paused' | 'draft' | 'ready' | 'complete' | 'partial' | 'superseded' | 'abandoned' | 'unknown';
export interface StatusLook { key: StatusKey; label: string; tone: 'open' | 'started' | 'done' | 'danger' | 'attention' | 'muted' }

/** What agents are doing on a work item now: working, waiting for the person, or nothing. */
export type ActivityState = WorkActivity['state'] | null;

export const statuses = {
  working: { key: 'working', label: 'Working', tone: 'open' },
  waiting: { key: 'waiting', label: 'Needs you', tone: 'attention' },
  blocked: { key: 'blocked', label: 'Blocked', tone: 'danger' },
  paused: { key: 'paused', label: 'Paused', tone: 'started' },
  draft: { key: 'draft', label: 'Draft', tone: 'muted' },
  ready: { key: 'ready', label: 'Ready', tone: 'muted' },
  complete: { key: 'complete', label: 'Complete', tone: 'done' },
  partial: { key: 'partial', label: 'Partially done', tone: 'attention' },
  superseded: { key: 'superseded', label: 'Superseded', tone: 'muted' },
  abandoned: { key: 'abandoned', label: 'Abandoned', tone: 'muted' },
  unknown: { key: 'unknown', label: 'Status unknown', tone: 'muted' },
} as const satisfies Record<StatusKey, StatusLook>;

/**
 * One status per work item, what agents do on it first: Working while an agent is in a turn on it
 * (green), Needs you once one waits for the person (amber), then Blocked (red), Paused (blue: implementation
 * started, nobody on it), Draft and Ready (accepted, not started). Closed work keeps how it ended
 * (complete in purple; partly done once archived, as the hub has it), whatever a session still does
 * on it or a stale blocker says.
 */
export function statusOf(work: Pick<Work, 'design' | 'implementation' | 'progress' | 'location'>, activity: ActivityState = null): StatusLook {
  if (work.design === 'superseded') return statuses.superseded;
  if (work.design === 'abandoned') return statuses.abandoned;
  if (work.implementation === 'complete') return statuses.complete;
  if (work.implementation === 'partial' && work.location === 'archived') return statuses.partial;
  if (activity) return statuses[activity];
  if (work.progress?.blocked) return statuses.blocked;
  if (work.implementation === 'in_progress') return statuses.paused;
  if (work.implementation === 'partial') return statuses.partial;
  if (work.design === 'draft') return statuses.draft;
  if (work.implementation === 'not_started') return statuses.ready;
  return statuses.unknown;
}
