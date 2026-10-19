// Agent time while agents work: what the reports say, counted up live on the host's clock. Each
// working session adds its time since its last report (or its turn's start), so N agents add N
// seconds a second; a session waiting for the person keeps that time, no longer growing, until its
// report is in; a new listing, after a report, starts again from the reported time. The host
// says its clock with each listing (`ProjectSummary.now`), which corrects this computer's skew.
// Pure but for when a listing arrived, so it is unit-tested.
import type { ProjectSummary, WorkActivity } from '../types';

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

/**
 * The time of each session not yet reported, as a span: a working session's runs from its
 * `countsFrom` to now; a waiting one's stopped when it began to wait (its time kept until its report
 * is in, when its `countsFrom` is gone).
 */
export function openSpans(activity: WorkActivity | null, now: number): { start: number; end: number }[] {
  return (activity?.sessions ?? []).flatMap(session => {
    const start = session.countsFrom ? Date.parse(session.countsFrom) : NaN;
    const end = session.state === 'working' ? now : Date.parse(session.since);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [{ start, end }] : [];
  });
}

/** Whether any session on the work item has time not yet reported. */
export const unreported = (activity: WorkActivity | null) => Boolean(activity?.sessions.some(session => session.countsFrom));

/** Every agent's time: the reported sum, and each session's time not yet reported. */
export function liveAgentMs(reported: number, activity: WorkActivity | null, now: number): number {
  return openSpans(activity, now).reduce((sum, span) => sum + span.end - span.start, reported);
}

/**
 * The time at least one agent worked: the reported union, and of the sessions' open spans the part
 * no report can have covered yet, merged. A report covers time up to when it was made, so every
 * reported interval ends by the latest report (`lastReport`, of any session), while the reported
 * union before it is unknown here: another session may have reported time inside an open span. So
 * the spans count only from the latest report on, which never counts a moment twice; what that
 * leaves out comes with the sessions' own reports. Never more than every agent's time added up
 * (`agentMs`).
 */
export function liveActiveMs(reported: number, activity: WorkActivity | null, now: number, lastReport: string | null, agentMs: number): number {
  const from = lastReport ? Date.parse(lastReport) || 0 : 0;
  const spans = openSpans(activity, now).map(span => ({ start: Math.max(span.start, from), end: span.end })).filter(span => span.end > span.start).sort((a, b) => a.start - b.start);
  let open = 0, reached = -Infinity;
  for (const span of spans) {
    open += Math.max(0, span.end - Math.max(span.start, reached));
    reached = Math.max(reached, span.end);
  }
  return Math.min(reported + open, Math.max(agentMs, reported));
}
