// What the plan page and a plan's statistics say of its sessions and its time: how long it took
// ("Planned 1 day · implementing 4 days · waited on you 3 h"), the beginning of a waiting session's
// message, and the timeline's span and scale. Pure, so it is unit-tested.
import type { Work, WorkSession, WorkTimeline } from '../types';
import { duration } from '../ui/format';

export const harnessNames: Record<WorkSession['harness'], string> = { 'claude-code': 'Claude Code', codex: 'Codex', unknown: 'Agent' };

const hour = 3600000, day = 24 * hour;
/** A stage's length as people say it: minutes, hours under a day, else days ("4 days"). */
export function roughDuration(ms: number) {
  if (ms < hour) return duration(ms);
  if (ms < day) return Math.round(ms / hour) + ' h';
  const days = Math.round(ms / day);
  return days + (days === 1 ? ' day' : ' days');
}

const at = (value: string | null | undefined) => value ? Date.parse(value.length === 10 ? value + 'T12:00:00' : value) : NaN;
/**
 * How long the work was planned and implemented and waited for the person, in one line. Where the host
 * does not say (before its first report), the plan's dates do: created to accepted, accepted to
 * completed or now.
 */
export function timelineLine(timeline: WorkTimeline | null, work: Pick<Work, 'created' | 'accepted' | 'completed'>, now = Date.now()): string | null {
  const planned = timeline?.plannedMs ?? (Number.isFinite(at(work.created)) && Number.isFinite(at(work.accepted)) ? Math.max(0, at(work.accepted) - at(work.created)) : null);
  const implementing = timeline?.implementingMs ?? (Number.isFinite(at(work.accepted)) ? Math.max(0, (Number.isFinite(at(work.completed)) ? at(work.completed) : now) - at(work.accepted)) : null);
  const parts = [
    planned !== null && 'Planned ' + roughDuration(planned),
    implementing !== null && (planned !== null ? 'implementing ' : 'Implementing ') + roughDuration(implementing),
    timeline?.waitedMs ? 'waited on you ' + roughDuration(timeline.waitedMs) : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(' · ') : null;
}

/** The session waiting for the person with its message, the latest when several wait. */
export function waitingSession(sessions: WorkSession[]): WorkSession | null {
  return sessions.filter(session => session.state === 'waiting' && session.message?.trim()).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0] ?? null;
}

/**
 * The beginning of a message, as Markdown: its first paragraph whole (so its formatting stays intact;
 * the page clamps a long one to a few lines), and whether there is more to show.
 */
export function excerpt(message: string, limit = 280): { text: string; more: boolean } {
  const whole = message.trim();
  const first = whole.split(/\n\s*\n/)[0].trim();
  return { text: first, more: first.length < whole.length || first.length > limit };
}

/**
 * The span a timeline shows: from its first stretch (or the zoom's start) to its last, or to now while
 * agents work on the plan or wait for the person (`live`), so past work is not squeezed to the left.
 */
export function timelineSpan(timeline: WorkTimeline, now: number, zoom: 'all' | 'week' | 'day', live = false): { start: number; end: number } {
  const times = timeline.lanes.flatMap(lane => [...lane.working, ...lane.waiting].flatMap(([start, end]) => [Date.parse(start), Date.parse(end)])).filter(Number.isFinite);
  const end = live || !times.length ? Math.max(now, ...times) : Math.max(...times);
  const first = times.length ? Math.min(...times) : end - hour;
  const start = zoom === 'day' ? end - day : zoom === 'week' ? end - 7 * day : first;
  return { start: Math.min(start, end - 60000), end };
}

/** Ticks for a span: minutes or hours for a day or less, days for weeks, weeks beyond; at most about eight. */
export function timelineTicks(start: number, end: number): { at: number; label: string }[] {
  const span = end - start;
  const minute = 60000;
  const steps = [minute, 5 * minute, 15 * minute, 30 * minute, hour, 3 * hour, 6 * hour, 12 * hour, day, 2 * day, 7 * day, 14 * day, 28 * day];
  const step = steps.find(value => span / value <= 8) ?? 56 * day;
  const offset = new Date(start).getTimezoneOffset() * 60000;
  const ticks: { at: number; label: string }[] = [];
  for (let tick = Math.ceil((start - offset) / step) * step + offset; tick <= end; tick += step) {
    const date = new Date(tick);
    ticks.push({ at: tick, label: step < day ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
  }
  return ticks;
}

/** What part of time a timeline shows, in ms. */
export interface TimeView { start: number; end: number }
/** The shortest span a timeline zooms to. */
const shortest = 60_000;
/** A view kept within the whole of a timeline (`limit`): never wider, never past its ends. */
function within(start: number, span: number, limit: TimeView): TimeView {
  const width = Math.min(Math.max(span, shortest), limit.end - limit.start);
  const from = Math.min(Math.max(start, limit.start), limit.end - width);
  return { start: from, end: from + width };
}
/** Zoom a view by `factor` (below 1 in, above 1 out) around a moment, which stays where it is. */
export function zoomView(view: TimeView, factor: number, at: number, limit: TimeView): TimeView {
  const span = view.end - view.start, next = Math.min(Math.max(span * factor, shortest), limit.end - limit.start);
  return within(at - (at - view.start) * next / span, next, limit);
}
/** Move a view along time by `by` ms (later when positive). */
export const panView = (view: TimeView, by: number, limit: TimeView): TimeView => within(view.start + by, view.end - view.start, limit);
