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
 * The time at least one agent worked: the reported union, and of the working sessions' open spans
 * (each from its `countsFrom` to now; their union runs from the earliest) the part no report can
 * have covered yet. A report covers time up to when it was made, so every reported interval ends by
 * the latest report (`lastReport`, of any session), while the reported union before it is unknown
 * here: another session may have reported time inside an open span. Counting from the later of the
 * earliest `countsFrom` and the latest report never counts a moment twice; what it leaves out comes
 * with the working sessions' own reports. Never more than every agent's time added up (`agentMs`).
 */
export function liveActiveMs(reported: number, activity: WorkActivity | null, now: number, lastReport: string | null, agentMs: number): number {
  const starts = workingSessions(activity).map(session => Date.parse(session.countsFrom)).filter(Number.isFinite);
  if (!starts.length) return reported;
  const from = Math.max(Math.min(...starts), lastReport ? Date.parse(lastReport) || 0 : 0);
  return Math.min(reported + Math.max(0, now - from), Math.max(agentMs, reported));
}

/** A live value as last shown: its value, when (on this computer's clock, in ms), and how fast it may grow (ms a ms: the agents working). */
export interface Shown { value: number; at: number; rate: number }
/**
 * A live value while what it counts from settles: a new listing (where each session's time counts
 * from) and new statistics (the reported time) arrive apart, so for a moment the value would drop or
 * count a report's time twice. Meanwhile it neither drops below what was shown nor grows faster than
 * its agents work; once both have arrived it is as counted again.
 */
export const held = (value: number, shown: Shown, at: number) => Math.min(Math.max(value, shown.value), shown.value + Math.max(0, at - shown.at) * shown.rate);
