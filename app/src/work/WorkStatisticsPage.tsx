// A plan's statistics, a page of its own (from its page's sidebar, a place in the history): its
// headline figures, tables of agent time and tokens by session and subagent, by model and reasoning
// effort, by stage and by kind of token, and its timeline: one lane per session and subagent with
// its working stretches and its waits for the person, parallel work one lane above another, now
// marked; zoomed to the last day or week, or all of it. The timeline is also a table, for the
// keyboard and screen readers. Tooltips only say what a figure stands for.
import { useMemo, useState, type ReactNode } from 'react';
import { DisclosureNote, SegmentedControl, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Text } from '@envsemble/envui';
import type { AgentUsage, Work, WorkSession, WorkTimeline } from '../types';
import { aiModel, withEffort } from '../ui/aiModels';
import { ModelName } from '../ui/AiModel';
import { absoluteDate, compactNumber, duration, plural, workNumber } from '../ui/format';
import { workTarget } from '../navigation/targets';
import { workStatus } from '../ui/status';
import { StatsCard } from '../statistics/StatisticsPage';
import { useWorkbench } from '../workbench/workbenchContext';
import { Trail } from './WorkPage';
import { activityKey, sessionLabel, useWorkSessions, useWorkTimeline } from './WorkSessions';
import { AgentTime, measuredSection, shortId, useHostNow } from './LiveAgentTime';
import { liveActiveMs, liveAgentMs, type LiveActivity } from './agentTime';
import { harnessNames, roughDuration, timelineLine, timelineSpan, timelineTicks } from './sessions';
import { agentTimeNote, effortRows, stageLabels, stageUsage, tokenRows, type StageKey } from './workStatistics';

/** The subagent that stands for those older reports counted without naming them. */
const unlisted = 'unlisted';

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return <section className="plan-statistics-section" aria-label={title}>
    <div className="section-toolbar"><Text as="h2" variant="section-heading">{title}</Text>{note}</div>
    {children}
  </section>;
}

/** An agent of the plan, as a table names it: a session by its harness, a subagent under its session. */
function agentName(agent: AgentUsage, sessions: WorkSession[]) {
  if (agent.subagent === unlisted) return 'Unnamed subagents';
  if (agent.subagent) return 'Subagent ' + shortId(agent.subagent);
  const session = sessions.find(item => item.session === agent.session);
  return agent.session ? (session ? harnessNames[session.harness] : 'Session') + ' ' + shortId(agent.session) : 'Session not recorded';
}

/** Time by session and subagent: each session, then its subagents under it. */
function ByAgent({ agents, sessions, total }: { agents: AgentUsage[]; sessions: WorkSession[]; total: number }) {
  const ordered = useMemo(() => {
    const own = agents.filter(agent => !agent.subagent);
    const orphans = agents.filter(agent => agent.subagent && !own.some(session => session.session === agent.session));
    return [...own.flatMap(session => [session, ...agents.filter(agent => agent.subagent && agent.session === session.session)]), ...orphans];
  }, [agents]);
  if (!agents.length) return <p className="muted">No session log was measured for this plan yet.</p>;
  return <Table className="plan-statistics-table" aria-label="Agent time by session and subagent">
    <TableHead><TableRow><TableHeaderCell>Session or subagent</TableHeaderCell><TableHeaderCell>Model</TableHeaderCell><TableHeaderCell numeric>Agent time</TableHeaderCell><TableHeaderCell numeric>Share</TableHeaderCell></TableRow></TableHead>
    <TableBody>{ordered.map((agent, index) => <TableRow key={index} data-subagent={agent.subagent ? '' : undefined}>
      <TableCell><span className={agent.subagent ? 'plan-statistics-subagent' : undefined} title={agent.subagent ?? agent.session ?? undefined}>{agentName(agent, sessions)}</span></TableCell>
      <TableCell>{agent.model ? <ModelName model={agent.model} effort={agent.effort} /> : <span className="muted">—</span>}</TableCell>
      <TableCell numeric>{duration(agent.agentMs)}</TableCell>
      <TableCell numeric>{total ? Math.round(agent.agentMs / total * 100) + '%' : '—'}</TableCell>
    </TableRow>)}</TableBody>
  </Table>;
}

/** Time and tokens by model and reasoning effort. */
function ByModel({ work }: { work: Work }) {
  const models = work.statistics?.models.filter(model => model.agentMs > 0 || (model.tokens ?? 0) > 0) ?? [];
  if (!models.length) return <p className="muted">No model was reported for this plan yet.</p>;
  const rows = effortRows(models);
  const recorded = new Set(rows.filter(row => row.effort).map(row => row.model));
  return <Table className="plan-statistics-table" aria-label="Agent time and tokens by model and effort">
    <TableHead><TableRow><TableHeaderCell>Model and effort</TableHeaderCell><TableHeaderCell numeric>Agent time</TableHeaderCell><TableHeaderCell numeric>Tokens</TableHeaderCell></TableRow></TableHead>
    <TableBody>{rows.map(row => <TableRow key={row.model + ':' + row.effort}>
      <TableCell><ModelName model={row.model} effort={row.effort ?? (recorded.has(row.model) ? 'effort not recorded' : null)} /></TableCell>
      <TableCell numeric>{duration(row.agentMs)}</TableCell>
      <TableCell numeric>{row.tokens !== null ? compactNumber(row.tokens) : '—'}</TableCell>
    </TableRow>)}</TableBody>
  </Table>;
}

/** Time and tokens by stage, and tokens by kind. */
function ByStage({ work }: { work: Work }) {
  const statistics = work.statistics;
  const stages = (['planning', 'implementation', 'unknown'] as StageKey[]).filter(stage => stageUsage(statistics ?? null, stage));
  const kinds = statistics ? tokenRows(statistics) : [];
  return <div className="plan-statistics-pair">
    {stages.length ? <Table className="plan-statistics-table" aria-label="Agent time and tokens by stage">
      <TableHead><TableRow><TableHeaderCell>Stage</TableHeaderCell><TableHeaderCell numeric>Reports</TableHeaderCell><TableHeaderCell numeric>Agent time</TableHeaderCell><TableHeaderCell numeric>Tokens</TableHeaderCell></TableRow></TableHead>
      <TableBody>{stages.map(stage => { const usage = stageUsage(statistics!, stage)!; return <TableRow key={stage}>
        <TableCell>{stageLabels[stage]}</TableCell><TableCell numeric>{usage.reports}</TableCell><TableCell numeric>{duration(usage.agentMs)}</TableCell><TableCell numeric>{usage.tokens !== null ? compactNumber(usage.tokens) : '—'}</TableCell>
      </TableRow>; })}</TableBody>
    </Table> : <p className="muted">No report has a stage yet.</p>}
    {kinds.length > 0 && <Table className="plan-statistics-table" aria-label="Tokens by kind">
      <TableHead><TableRow><TableHeaderCell>Tokens</TableHeaderCell><TableHeaderCell numeric>Count</TableHeaderCell></TableRow></TableHead>
      <TableBody>{kinds.map(row => <TableRow key={row.label}><TableCell>{row.label}</TableCell><TableCell numeric>{row.value.toLocaleString()}</TableCell></TableRow>)}</TableBody>
    </Table>}
  </div>;
}

type Zoom = 'all' | 'week' | 'day';
/** A lane's name: its session (harness, model and effort) or a subagent under it. */
function laneName(lane: WorkTimeline['lanes'][number], sessions: WorkSession[]) {
  const session = sessions.find(item => item.session === lane.session);
  const model = lane.model ? withEffort(aiModel(lane.model).name, lane.effort) : null;
  if (lane.subagent) return ['Subagent ' + shortId(lane.subagent), model].filter(Boolean).join(' · ');
  return [(session ? harnessNames[session.harness] : 'Session') + ' ' + shortId(lane.session), model].filter(Boolean).join(' · ');
}

/**
 * The plan's timeline: a lane per session and subagent, each working stretch and wait for the person
 * placed on one scale of time up to now; where lanes overlap, agents worked in parallel.
 */
function Timeline({ timeline, sessions, live }: { timeline: WorkTimeline; sessions: WorkSession[]; live: LiveActivity | null }) {
  const [zoom, setZoom] = useState<Zoom>('all');
  // Now moves along while agents work.
  const now = useHostNow(live);
  const { start, end } = timelineSpan(timeline, now, zoom);
  const span = end - start;
  const place = (from: string, to: string) => {
    const a = Math.max(start, Date.parse(from)), b = Math.min(end, Date.parse(to));
    return b > a ? { left: (a - start) / span * 100 + '%', width: (b - a) / span * 100 + '%' } : null;
  };
  const ticks = timelineTicks(start, end);
  const working = timeline.lanes.reduce((sum, lane) => sum + lane.working.reduce((total, [from, to]) => total + Math.max(0, Date.parse(to) - Date.parse(from)), 0), 0);
  const summary = plural(timeline.lanes.length, 'lane') + ' from ' + absoluteDate(new Date(start).toISOString()) + ' to now: ' + duration(working) + ' of work' + (timeline.waitedMs ? ', ' + duration(timeline.waitedMs) + ' waiting for you' : '') + '. The table below lists every stretch.';
  const stretches = timeline.lanes.flatMap(lane => [...lane.working.map(([from, to]) => ({ lane, kind: 'Working', from, to })), ...lane.waiting.map(([from, to]) => ({ lane, kind: 'Waiting for you', from, to }))]).sort((a, b) => a.from.localeCompare(b.from));
  return <Section title="Timeline" note={<SegmentedControl aria-label="Timeline span" size="compact" value={zoom} onValueChange={value => setZoom(value as Zoom)}
    options={[{ value: 'all', label: 'All' }, { value: 'week', label: 'Last week' }, { value: 'day', label: 'Last day' }]} />}>
    {timeline.lanes.length ? <>
      <div className="timeline" role="img" aria-label={summary}>
        <div className="timeline-axis">{ticks.map(tick => <span key={tick.at} className="timeline-tick" style={{ left: (tick.at - start) / span * 100 + '%' }}>{tick.label}</span>)}</div>
        {timeline.lanes.map((lane, index) => <div key={index} className="timeline-lane" data-subagent={lane.subagent ? '' : undefined}>
          <span className="timeline-lane-name">{laneName(lane, sessions)}</span>
          <div className="timeline-track">
            {lane.waiting.map(([from, to], at) => { const style = place(from, to); return style && <span key={'w' + at} className="timeline-bar" data-kind="waiting" style={style} />; })}
            {lane.working.map(([from, to], at) => { const style = place(from, to); return style && <span key={'b' + at} className="timeline-bar" data-kind="working" style={style} />; })}
          </div>
        </div>)}
        {end >= now - 1000 && <span className="timeline-now" aria-hidden="true" />}
      </div>
      <p className="timeline-legend muted"><span className="timeline-key" data-kind="working" /> working <span className="timeline-key" data-kind="waiting" /> waiting for you <span className="timeline-key" data-kind="now" /> now</p>
      <DisclosureNote title="The timeline as a table">
        <Table className="plan-statistics-table" aria-label="Timeline">
          <TableHead><TableRow><TableHeaderCell>Session or subagent</TableHeaderCell><TableHeaderCell>What</TableHeaderCell><TableHeaderCell>From</TableHeaderCell><TableHeaderCell>To</TableHeaderCell><TableHeaderCell numeric>Length</TableHeaderCell></TableRow></TableHead>
          <TableBody>{stretches.map((stretch, index) => <TableRow key={index}>
            <TableCell>{laneName(stretch.lane, sessions)}</TableCell><TableCell>{stretch.kind}</TableCell>
            <TableCell>{absoluteDate(stretch.from)}</TableCell><TableCell>{absoluteDate(stretch.to)}</TableCell>
            <TableCell numeric>{duration(Math.max(0, Date.parse(stretch.to) - Date.parse(stretch.from)))}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </DisclosureNote>
    </> : <p className="muted">No session has worked on this plan since Atlas began recording when agents work.</p>}
  </Section>;
}

/** The headline figures: agent time (counting up while agents work), the time at least one worked, tokens and sessions. */
function Headline({ work, live, sessions, timeline }: { work: Work; live: LiveActivity | null; sessions: WorkSession[]; timeline: WorkTimeline | null }) {
  const { listed } = useWorkbench();
  const statistics = work.statistics;
  const totals = listed(work.id)?.statistics ?? statistics ?? null;
  const now = useHostNow(live);
  const line = timelineLine(timeline, work);
  return <div className="stats-grid">
    <StatsCard label="Agent time" value={totals ? <AgentTime totals={totals} activity={live} description={statistics ? agentTimeNote(statistics) : 'Every agent’s working time, added up'} after={statistics ? [measuredSection(statistics)] : []} /> : '—'} note="every agent's time added up" />
    <StatsCard label="At least one agent working" value={totals ? duration(liveActiveMs(totals.activeMs, live, now, totals.lastReport, liveAgentMs(totals.agentMs, live, now))) : '—'} note={totals?.unmergedMs ? roughDuration(totals.unmergedMs) + ' from older reports added as is' : 'agents working at once count once'} />
    <StatsCard label="Tokens" value={statistics?.tokens != null ? compactNumber(statistics.tokens) : '—'} note={statistics?.tokenKinds ? 'measured from session logs' : statistics?.tokens != null ? 'self-reported' : 'none reported yet'} />
    <StatsCard label="Sessions" value={sessions.length || '—'} note={line ?? undefined} />
  </div>;
}

/** A plan's statistics page. */
export function WorkStatisticsPage({ work }: { work: Work }) {
  const { activity } = useWorkbench();
  const agents = activity(work.id);
  // Closed work keeps how it ended: what a session still does on it does not count here either.
  const status = workStatus(work, agents?.state ?? null);
  const live = status.key === 'working' || status.key === 'waiting' ? agents : null;
  const key = activityKey(agents);
  const sessions = useWorkSessions(work.id, key)?.sessions ?? [];
  const timeline = useWorkTimeline(work.id, key);
  const statistics = work.statistics;
  return <div className="page plan-statistics-page">
    <Trail items={[{ label: workNumber(work.id), target: workTarget(work.id) }, { label: 'Statistics' }]} />
    <header className="page-header plan-statistics-header">
      <Text as="h1" variant="page-heading">Statistics</Text>
      <Text tone="muted">{work.title}</Text>
    </header>
    <Headline work={work} live={live} sessions={sessions} timeline={timeline} />
    {timeline && <Timeline timeline={timeline} sessions={sessions} live={live} />}
    <Section title="By session and subagent"><ByAgent agents={statistics?.agents ?? []} sessions={sessions} total={statistics?.agentMs ?? 0} /></Section>
    <Section title="By model and effort"><ByModel work={work} /></Section>
    <Section title="By stage"><ByStage work={work} /></Section>
    {statistics && statistics.reports > 0 && <Text variant="caption" tone="muted">{agentTimeNote(statistics)}</Text>}
  </div>;
}
