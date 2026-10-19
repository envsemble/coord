// Agent time where it shows (the hub's Agents column, a plan's statistics): every agent's time added
// up, counting up once a second while agents work on the plan, and on hover and focus its report:
// the time at least one agent worked, older reports added as is, and as far as the place knows, by
// agent, by model and by stage, who works now, and how it was measured. Only these values tick, so a
// working plan renders little each second; they hold steady while a report arrives.
import { useEffect, useRef, useState } from 'react';
import type { SessionActivity, WorkStatistics } from '../types';
import { aiModel } from '../ui/aiModels';
import { absoluteDate, duration } from '../ui/format';
import { Detailed } from '../ui/ui';
import { held, hostNow, liveActiveMs, liveAgentMs, since, workingSessions, type LiveActivity, type Shown } from './agentTime';
import { agentTimeNote, timeSource } from './workStatistics';

/**
 * The host's time now, in ms, rendering again once a second while agents work on the plan (or the
 * value shown still settles, `settling`) and once a minute while one waits for the person (for how
 * long it has waited); never otherwise.
 */
export function useHostNow(activity: LiveActivity | null, settling = false): number {
  const period = activity?.state === 'working' || settling ? 1000 : activity ? 60_000 : null;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (period === null) return;
    // On the period's boundaries, so every value shown ticks together.
    let timer = 0;
    const tick = () => { setTick(count => count + 1); timer = window.setTimeout(tick, period - Date.now() % period); };
    timer = window.setTimeout(tick, period - Date.now() % period);
    return () => window.clearTimeout(timer);
  }, [period]);
  return hostNow(activity);
}

/** How long an agent has waited for the person, counting on, with since when on hover. */
export function Waited({ activity }: { activity: LiveActivity }) {
  const now = useHostNow(activity);
  return <span title={'Waiting since ' + absoluteDate(activity.since)}>{duration(since(activity.since, now))}</span>;
}

/** A report's rows: a label and a value, under an optional heading. */
export interface ReportSection { heading?: string; rows: { label: string; value: string }[]; note?: string }

/**
 * The agent time a place knows: every agent's added up, the time at least one worked, of that the
 * older reports' added as is, and when the latest report was made.
 */
export interface AgentTotals { agentMs: number; activeMs: number; unmergedMs: number; lastReport: string | null }

/** How long a live value holds steady after what it counts from changes: the host looks for changes every 3 s. */
const settle = 6000;
/**
 * What a work item's agent time counts from, when that last changed and whether agents worked then
 * (`live`), and what it showed last.
 */
interface Steady { work: string; inputs: string; changed: number; live: boolean; agent: Shown | null; active: Shown | null }

const harnessNames: Record<SessionActivity['harness'], string> = { 'claude-code': 'Claude Code', codex: 'Codex', unknown: 'Agent' };
/** A session's or subagent's identifier, short enough to tell them apart. */
export const shortId = (id: string) => id.replace(/^agent-/, '').slice(0, 8);

/** The sessions working now and how long each has been in its turn. */
function workingNow(activity: LiveActivity | null, now: number): ReportSection | null {
  const sessions = workingSessions(activity);
  return sessions.length ? { heading: 'Working now', rows: sessions.map(session => ({ label: harnessNames[session.harness] + ' session ' + shortId(session.session), value: duration(since(session.since, now), true) + ' this turn' })) } : null;
}

/**
 * A work item's agent time (`work`) and its report on hover and focus: the totals, what the place
 * knows beyond them (`sections`), who works now, then how it was counted (`after`). For a few seconds
 * after what it counts from changes, while agents work or just did, it holds steady (`held`): the
 * listing and the statistics of a new report arrive apart.
 */
export function AgentTime({ work, totals, activity, sections = [], after = [], description, strong = false }: {
  work: string; totals: AgentTotals; activity: LiveActivity | null; sections?: ReportSection[]; after?: ReportSection[]; description: string; strong?: boolean;
}) {
  const sessions = workingSessions(activity);
  // What was shown last is kept across renders, and changes only as the values shown do.
  const steady = useRef<Steady | null>(null);
  const local = Date.now();
  const inputs = [totals.agentMs, totals.activeMs, totals.lastReport, ...sessions.map(session => session.session + '@' + session.countsFrom)].join('|');
  if (steady.current?.work !== work) steady.current = { work, inputs, changed: -Infinity, live: false, agent: null, active: null };
  else if (steady.current.inputs !== inputs) Object.assign(steady.current, { inputs, changed: local, live: Boolean(steady.current.agent?.rate) || sessions.length > 0 });
  const shown = steady.current;
  const settling = shown.live && local - shown.changed < settle && Boolean(shown.agent && shown.active);
  const now = useHostNow(activity, settling);
  let agentMs = liveAgentMs(totals.agentMs, activity, now);
  let activeMs = liveActiveMs(totals.activeMs, activity, now, totals.lastReport, agentMs);
  if (settling) {
    agentMs = held(agentMs, shown.agent!, local);
    activeMs = Math.min(held(activeMs, shown.active!, local), agentMs);
  }
  shown.agent = { value: agentMs, at: local, rate: sessions.length };
  shown.active = { value: activeMs, at: local, rate: sessions.length ? 1 : 0 };
  const working = sessions.length > 0;
  const value = duration(agentMs, working), current = workingNow(activity, now);
  const report: ReportSection[] = [
    { rows: [
      { label: 'Agent time', value },
      { label: 'At least one agent working', value: duration(activeMs, working) },
      ...totals.unmergedMs > 0 ? [{ label: 'Of that, from older reports added as is', value: duration(totals.unmergedMs) }] : [],
    ] },
    ...sections,
    ...current ? [current] : [],
    ...after,
  ];
  return <Detailed detail={<AgentTimeReport sections={report} />} description={description}>{strong ? <strong>{value}</strong> : value}</Detailed>;
}

/** The report's sections that have something to say, each under its heading. */
function AgentTimeReport({ sections }: { sections: ReportSection[] }) {
  return <div className="agent-time-report">{sections.filter(section => section.rows.length || section.note).map((section, index) => <div key={index}>
    {section.heading && <p className="agent-time-report-heading">{section.heading}</p>}
    {section.rows.length > 0 && <dl className="breakdown">{section.rows.map((row, at) => <div key={at}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
    {section.note && <p>{section.note}</p>}
  </div>)}</div>;
}

/** How agent time was counted: measured from logs, estimated from reports, or both since the first report. */
export function measuredSection(statistics: WorkStatistics): ReportSection {
  if (timeSource(statistics) !== 'mixed') return { rows: [], note: agentTimeNote(statistics) };
  return {
    rows: [{ label: 'Measured from logs', value: duration(statistics.measuredMs) }, { label: 'Estimated from reports', value: duration(statistics.estimatedMs) }],
    note: statistics.firstReport ? 'Since ' + absoluteDate(statistics.firstReport) : undefined,
  };
}

/** A model's name for a report row. */
export const modelName = (model: string | null) => model ? aiModel(model).name : 'Model not reported';
