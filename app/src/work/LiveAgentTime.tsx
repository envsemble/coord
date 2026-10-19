// Agent time where it shows (the hub's Agents column, a plan's statistics): every agent's time added
// up, counting up once a second while agents work on the plan, and on hover and focus its report:
// the time at least one agent worked, older reports added as is, and as far as the place knows, by
// agent, by model and by stage, who works now, and how it was measured. Only these values tick, so a
// working plan renders little each second. The reported time they count on is the project listing's,
// which comes with the activity in one reading, so a report replaces the live count it covers at once.
import { useEffect, useState } from 'react';
import type { SessionActivity, WorkStatistics } from '../types';
import { aiModel } from '../ui/aiModels';
import { absoluteDate, duration } from '../ui/format';
import { Detailed } from '../ui/ui';
import { hostNow, liveActiveMs, liveAgentMs, since, type LiveActivity } from './agentTime';
import { agentTimeNote, timeSource } from './workStatistics';

/**
 * The host's time now, in ms, rendering again once a second while agents work on the plan and once
 * a minute while one waits for the person (for how long it has waited); never otherwise.
 */
export function useHostNow(activity: LiveActivity | null): number {
  const period = activity?.state === 'working' ? 1000 : activity ? 60_000 : null;
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

const harnessNames: Record<SessionActivity['harness'], string> = { 'claude-code': 'Claude Code', codex: 'Codex', unknown: 'Agent' };
/** A session's or subagent's identifier, short enough to tell them apart. */
export const shortId = (id: string) => id.replace(/^agent-/, '').slice(0, 8);

/** The sessions working now and how long each has been in its turn. */
function workingNow(activity: LiveActivity | null, now: number): ReportSection | null {
  const sessions = activity?.sessions.filter(session => session.state === 'working') ?? [];
  return sessions.length ? { heading: 'Working now', rows: sessions.map(session => ({ label: harnessNames[session.harness] + ' session ' + shortId(session.session), value: duration(since(session.since, now), true) + ' this turn' })) } : null;
}

/**
 * Agent time and its report on hover and focus: the totals (the project listing's, which the live
 * count goes with), what the place knows beyond them (`sections`), who works now, then how it was
 * counted (`after`).
 */
export function AgentTime({ totals, activity, sections = [], after = [], description, strong = false }: {
  totals: AgentTotals; activity: LiveActivity | null; sections?: ReportSection[]; after?: ReportSection[]; description: string; strong?: boolean;
}) {
  const now = useHostNow(activity);
  const agentMs = liveAgentMs(totals.agentMs, activity, now), activeMs = liveActiveMs(totals.activeMs, activity, now, totals.lastReport, agentMs);
  // Seconds while it counts up.
  const working = activity?.state === 'working';
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
