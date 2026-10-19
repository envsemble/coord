// Agent time while agents work: what the reports say, counted up live on the host's clock. Each
// working session adds its time since its last report (or its turn's start), so N agents add N
// seconds a second; a new listing, after a report, starts again from the reported time. The host
// says its clock with each listing (`ProjectSummary.now`), which corrects this computer's skew.
// Pure but for when a listing arrived, so it is unit-tested.
import type { ProjectSummary, SessionActivity, WorkActivity } from '../types';

/** What agents are doing on a work item now, with the host's clock less this computer's (`skew`, in ms). */
export type LiveActivity = WorkActivity & { skew: number };

/** When each listing arrived, on this computer's clock. */
const arrivals = new WeakMap<ProjectSummary, number>();
/** Note when a listing arrived, the first time it is seen; the window notes each one as it comes. */
export function arrived(summary: ProjectSummary, at = Date.now()): number {
  if (!arrivals.has(summary)) arrivals.set(summary, at);
  return arrivals.get(summary)!;
}
/** The host's clock less this computer's, from a listing and when it arrived. */
export const clockSkew = (summary: ProjectSummary) => (Date.parse(summary.now) - arrived(summary)) || 0;

/** A work item's activity in a listing, with the listing's clock; null when nobody is on it. */
export function liveActivity(summary: ProjectSummary | null | undefined, work: string): LiveActivity | null {
  const activity = summary?.activity.find(item => item.workId === work);
  return activity ? { ...activity, skew: clockSkew(summary!) } : null;
}

/** The host's time now, in ms. */
export const hostNow = (activity: Pick<LiveActivity, 'skew'> | null, now = Date.now()) => now + (activity?.skew ?? 0);
/** Time since an instant, never less than none (the host's instant against a clock read before it arrived). */
export const since = (value: string, now: number) => Math.max(0, now - Date.parse(value)) || 0;

/** The sessions working now, with where their unreported time begins. */
export function workingSessions(activity: WorkActivity | null): (SessionActivity & { countsFrom: string })[] {
  return activity?.state === 'working' ? activity.sessions.filter((session): session is SessionActivity & { countsFrom: string } => session.state === 'working' && Boolean(session.countsFrom)) : [];
}

/** Every agent's time: the reported sum, and each working session's time not yet reported. */
export function liveAgentMs(reported: number, activity: WorkActivity | null, now: number): number {
  return workingSessions(activity).reduce((sum, session) => sum + since(session.countsFrom, now), reported);
}

/**
 * The time at least one agent worked: the reported union, and the union of the working sessions'
 * open intervals, from the earliest of them.
 */
export function liveActiveMs(reported: number, activity: WorkActivity | null, now: number): number {
  const starts = workingSessions(activity).map(session => Date.parse(session.countsFrom)).filter(Number.isFinite);
  return starts.length ? reported + Math.max(0, now - Math.min(...starts)) : reported;
}
