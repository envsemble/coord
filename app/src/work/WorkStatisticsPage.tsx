// A plan's statistics, a page of its own (from its page's sidebar, a place in the history): its
// headline figures, its timeline (one lane per session and subagent with its working stretches and
// its waits for the person, parallel work one lane above another, now marked, to zoom and move along)
// and agent time and tokens by model and reasoning effort. The timeline is also a table, folded, for
// screen readers.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { DisclosureNote, SegmentedControl, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Text } from '@envsemble/envui';
import type { Work, WorkSession, WorkTimeline } from '../types';
import { aiModel, withEffort } from '../ui/aiModels';
import { ModelName } from '../ui/AiModel';
import { modelPalette, orderModels } from '../ui/modelLook';
import { absoluteDate, compactNumber, duration, plural, workNumber } from '../ui/format';
import { workTarget } from '../navigation/targets';
import { workStatus } from '../ui/status';
import { ModelKey, StatsCard } from '../statistics/StatisticsPage';
import { useWorkbench } from '../workbench/workbenchContext';
import { Trail } from './WorkPage';
import { Page } from '../ui/Pages';
import { activityKey, sessionTitle, useWorkSessions, useWorkTimeline } from './WorkSessions';
import { AgentTime, measuredSection, shortId, useHostNow } from './LiveAgentTime';
import { liveActiveMs, liveAgentMs, type LiveActivity } from './agentTime';
import { harnessNames, panView, roughDuration, timelineLine, timelineSpan, timelineTicks, zoomView, type TimeView } from './sessions';
import { agentTimeNote, effortRows } from './workStatistics';

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return <section className="plan-statistics-section" aria-label={title}>
    <div className="section-toolbar"><Text as="h2" variant="section-heading">{title}</Text>{note}</div>
    {children}
  </section>;
}

function ByModel({ work }: { work: Work }) {
  const models = work.statistics?.models.filter(model => model.agentMs > 0 || (model.tokens ?? 0) > 0) ?? [];
  if (!models.length) return <p className="muted">No model was reported for this plan yet.</p>;
  const rows = orderModels(effortRows(models));
  const colour = modelPalette(rows);
  return <Table className="plan-statistics-table" aria-label="Agent time and tokens by model and effort">
    <TableHead><TableRow><TableHeaderCell>Model and effort</TableHeaderCell><TableHeaderCell numeric>Agent time</TableHeaderCell><TableHeaderCell numeric>Tokens</TableHeaderCell></TableRow></TableHead>
    <TableBody>{rows.map(row => <TableRow key={row.model + ':' + row.effort}>
      <TableCell><ModelKey model={row.model} effort={row.effort} colour={colour(row.model, row.effort)} items={rows} /></TableCell>
      <TableCell numeric>{duration(row.agentMs)}</TableCell>
      <TableCell numeric>{row.tokens !== null ? compactNumber(row.tokens) : '—'}</TableCell>
    </TableRow>)}</TableBody>
  </Table>;
}

type Zoom = 'all' | 'week' | 'day';
type Lane = WorkTimeline['lanes'][number];
/** A lane's name: the model doing its work, with its effort; else its harness, or "Subagent". */
function laneName(lane: Lane, sessions: WorkSession[]) {
  if (lane.model) return withEffort(aiModel(lane.model).name, lane.effort);
  const session = sessions.find(item => item.session === lane.session);
  return lane.subagent ? 'Subagent' : session ? harnessNames[session.harness] : 'Session';
}
/** The time a lane worked, added up. */
const laneWork = (lane: Lane) => lane.working.reduce((total, [from, to]) => total + Math.max(0, Date.parse(to) - Date.parse(from)), 0);
/** What a lane's name does not say: its session's title and harness, the subagent, the time it worked. */
function laneDetail(lane: Lane, sessions: WorkSession[]) {
  const session = sessions.find(item => item.session === lane.session);
  return [
    lane.subagent ? 'Subagent ' + shortId(lane.subagent) + ' of ' + (session ? sessionTitle(session) : 'session ' + shortId(lane.session)) : session ? sessionTitle(session) : 'Session ' + shortId(lane.session),
    session && harnessNames[session.harness], laneName(lane, sessions), duration(laneWork(lane)) + ' of work',
  ].filter(Boolean).join(' · ');
}
const stretchLabels = { working: 'Working', waiting: 'Waiting for you' } as const;
/** A stretch under the pointer, and where the pointer is in the chart. */
interface Tip { lane: Lane; kind: 'working' | 'waiting'; from: string; to: string; x: number; y: number }

/**
 * The plan's timeline: a lane per session and subagent (subagents under their session), each working
 * stretch and wait for the person on one scale of time up to now; where lanes overlap, agents worked
 * in parallel. Shift and the mouse wheel zoom around the pointer and dragging moves along time, as
 * the arrow keys do on the focused chart; the presets show all of it or its last week or day. Each
 * stretch says on hover what it was, when, how long and which model.
 */
function Timeline({ timeline, sessions, live }: { timeline: WorkTimeline; sessions: WorkSession[]; live: LiveActivity | null }) {
  const [preset, setPreset] = useState<Zoom | null>('all');
  const [view, setView] = useState<TimeView | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const chart = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; view: TimeView } | null>(null);
  // Now moves along while agents work.
  const now = useHostNow(live);
  const whole = timelineSpan(timeline, now, 'all', live !== null);
  const { start, end } = preset ? timelineSpan(timeline, now, preset, live !== null) : view ?? whole;
  const span = end - start;
  const show = (next: TimeView) => { setPreset(null); setView(next); };
  /** The tracks' left edge and width on screen, where time is drawn. */
  const track = () => chart.current?.querySelector('.timeline-track')?.getBoundingClientRect() ?? null;
  // Shift and the wheel zoom around the pointer (Chromium turns a shifted wheel sideways).
  useEffect(() => {
    const element = chart.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.shiftKey) return;
      const box = track(), delta = event.deltaY || event.deltaX;
      if (!box || !delta) return;
      event.preventDefault();
      const at = start + Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1) * span;
      show(zoomView({ start, end }, delta > 0 ? 1.25 : 0.8, at, whole));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  });
  const keys = (event: KeyboardEvent) => {
    const step = span / 10, middle = start + span / 2;
    const moves: Record<string, () => TimeView> = {
      ArrowLeft: () => panView({ start, end }, -step, whole), ArrowRight: () => panView({ start, end }, step, whole),
      ArrowUp: () => zoomView({ start, end }, 0.8, middle, whole), '+': () => zoomView({ start, end }, 0.8, middle, whole), '=': () => zoomView({ start, end }, 0.8, middle, whole),
      ArrowDown: () => zoomView({ start, end }, 1.25, middle, whole), '-': () => zoomView({ start, end }, 1.25, middle, whole),
    };
    if (event.key === 'Home') { event.preventDefault(); setPreset('all'); return; }
    const move = moves[event.key];
    if (move) { event.preventDefault(); show(move()); }
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, view: { start, end } };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    const box = track();
    if (drag.current && box) {
      setTip(null);
      const from = drag.current.view;
      show(panView(from, -(event.clientX - drag.current.x) / box.width * (from.end - from.start), whole));
      return;
    }
    const bar = (event.target as HTMLElement).closest<HTMLElement>('.timeline-bar');
    const own = chart.current?.getBoundingClientRect();
    if (!bar || !own) { setTip(null); return; }
    const lane = timeline.lanes[Number(bar.dataset.lane)], kind = bar.dataset.kind as Tip['kind'];
    const [from, to] = lane[kind][Number(bar.dataset.index)];
    setTip({ lane, kind, from, to, x: event.clientX - own.left, y: event.clientY - own.top });
  };
  const up = () => { drag.current = null; };
  const place = (from: string, to: string) => {
    const a = Math.max(start, Date.parse(from)), b = Math.min(end, Date.parse(to));
    return b > a ? { left: (a - start) / span * 100 + '%', width: (b - a) / span * 100 + '%' } : null;
  };
  const ticks = timelineTicks(start, end);
  const working = timeline.lanes.reduce((sum, lane) => sum + laneWork(lane), 0);
  const summary = plural(timeline.lanes.length, 'lane') + ', ' + duration(working) + ' of work' + (timeline.waitedMs ? ', ' + duration(timeline.waitedMs) + ' waiting for you' : '') + ', shown from ' + absoluteDate(new Date(start).toISOString()) + ' to ' + absoluteDate(new Date(end).toISOString()) + '.';
  const stretches = timeline.lanes.flatMap(lane => [...lane.working.map(([from, to]) => ({ lane, kind: 'Working', from, to })), ...lane.waiting.map(([from, to]) => ({ lane, kind: 'Waiting for you', from, to }))]).sort((a, b) => a.from.localeCompare(b.from));
  return <Section title="Timeline" note={<SegmentedControl aria-label="Timeline span" size="compact" value={preset ?? ''} onValueChange={value => setPreset(value as Zoom)}
    options={[{ value: 'all', label: 'All' }, { value: 'week', label: 'Last week' }, { value: 'day', label: 'Last day' }]} />}>
    {timeline.lanes.length ? <>
      <div ref={chart} className="timeline" role="group" aria-roledescription="timeline" aria-label={summary} aria-describedby="timeline-help" tabIndex={0}
        onKeyDown={keys} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => { if (!drag.current) setTip(null); }}>
        <div className="timeline-axis" aria-hidden="true">{ticks.map(tick => <span key={tick.at} className="timeline-tick" style={{ left: (tick.at - start) / span * 100 + '%' }}>{tick.label}</span>)}</div>
        {timeline.lanes.map((lane, index) => <div key={index} className="timeline-lane" data-subagent={lane.subagent ? '' : undefined} aria-hidden="true">
          <span className="timeline-lane-name" title={laneDetail(lane, sessions)}>{lane.model ? <ModelName model={lane.model} effort={lane.effort} detail={laneDetail(lane, sessions)} /> : laneName(lane, sessions)}</span>
          <div className="timeline-track">
            {(['waiting', 'working'] as const).map(kind => lane[kind].map(([from, to], at) => { const style = place(from, to); return style && <span key={kind + at} className="timeline-bar" data-kind={kind} data-lane={index} data-index={at} style={style} />; }))}
          </div>
        </div>)}
        {end >= now - 1000 && <span className="timeline-now" aria-hidden="true" />}
        {tip && <div className="timeline-tip" role="tooltip" data-flip={tip.x > (chart.current?.clientWidth ?? 0) - 320 ? '' : undefined} style={{ left: tip.x, top: tip.y }}>
          <strong>{stretchLabels[tip.kind]}</strong>
          <span>{absoluteDate(tip.from)} – {absoluteDate(tip.to)} · {duration(Math.max(0, Date.parse(tip.to) - Date.parse(tip.from)))}</span>
          <span className="muted">{laneDetail(tip.lane, sessions)}</span>
        </div>}
      </div>
      <p id="timeline-help" className="timeline-legend muted"><span className="timeline-key" data-kind="working" /> working <span className="timeline-key" data-kind="waiting" /> waiting for you <span className="timeline-key" data-kind="now" /> now · Shift and the wheel zoom, dragging moves; on the focused chart the arrow keys move and zoom, Home shows all</p>
      <DisclosureNote title="The timeline as a table">
        <Table className="plan-statistics-table" aria-label="Timeline">
          <TableHead><TableRow><TableHeaderCell>Model</TableHeaderCell><TableHeaderCell>Session or subagent</TableHeaderCell><TableHeaderCell>What</TableHeaderCell><TableHeaderCell>From</TableHeaderCell><TableHeaderCell>To</TableHeaderCell><TableHeaderCell numeric>Length</TableHeaderCell></TableRow></TableHead>
          <TableBody>{stretches.map((stretch, index) => <TableRow key={index}>
            <TableCell>{stretch.lane.model ? <ModelName model={stretch.lane.model} effort={stretch.lane.effort} /> : laneName(stretch.lane, sessions)}</TableCell><TableCell>{laneDetail(stretch.lane, sessions).split(' · ')[0]}</TableCell><TableCell>{stretch.kind}</TableCell>
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
    <StatsCard label="At least one agent working" value={totals ? duration(liveActiveMs(totals.activeMs, live, now, totals.lastReport, liveAgentMs(totals.agentMs, live, now))) : '—'} note={totals?.unmergedMs ? roughDuration(totals.unmergedMs) + ' estimated and added as is' : 'agents working at once count once'} />
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
  // Headed like a project's statistics: the breadcrumb, then the heading, here with the plan's title.
  return <Page className="plan-statistics-page" heading={<div className="page-heading-stack">
    <Trail items={[{ label: workNumber(work.id), target: workTarget(work.id) }, { label: 'Statistics' }]} />
    <div className="plan-statistics-header"><Text as="h1" variant="page-heading">Statistics</Text><Text tone="muted">{work.title}</Text></div>
  </div>}>
    <Headline work={work} live={live} sessions={sessions} timeline={timeline} />
    {timeline && <Timeline timeline={timeline} sessions={sessions} live={live} />}
    <Section title="By model and effort"><ByModel work={work} /></Section>
    {statistics && statistics.reports > 0 && <Text variant="caption" tone="muted">{agentTimeNote(statistics)}</Text>}
  </Page>;
}
