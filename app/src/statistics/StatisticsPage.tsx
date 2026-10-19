// A project's statistics, to look back on its work over a period (the last 4 weeks by day, the last
// 3 months or all time by week): the period's headline figures against the period before, its work
// over time (agent time stacked by model and effort, the time at least one agent worked as a line,
// the plans completed marked), where the time went (the plans worked on, most time first, each
// opening its own statistics) and its models and effort. From the host's project.statistics.
import { useEffect, useState, type ReactNode } from 'react';
import { DisclosureNote, EmptyState, IconButton, Notice, Popover, SegmentedControl, Spinner, Surface, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Text } from '@envsemble/envui';
import { InfoIcon, StatisticsIcon } from '../ui/icons';
import type { ProjectStatistics, ProjectWork, Snapshot } from '../types';
import { api } from '../api';
import { workStatisticsTarget } from '../navigation/targets';
import { absoluteDate, compactNumber, duration, plural, shortDate } from '../ui/format';
import { hubStatus } from '../hub/hubPlans';
import { StatusIcon } from '../ui/ui';
import { TargetLink, useWorkbench } from '../workbench/workbenchContext';
import { Page } from '../ui/Pages';
import { roughDuration } from '../work/sessions';
import { change, modelColour, modelKey, modelLabel, periods, periodStart, workBars, type PeriodId } from './projectStatistics';

export function StatsCard({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <Surface className="stat" padding={4}><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong>{note != null && <small className="stat-note">{note}</small>}</Surface>;
}

/** A model at an effort with its colour. */
export function ModelSwatch({ model, effort }: { model: string | null; effort: string | null }) {
  return <span className="model-swatch" style={{ background: modelColour(model, effort) }} aria-hidden="true" />;
}

type Figures = ProjectStatistics['current'];
/** The headline figures of the period, each with its change against the period before. */
function Headline({ statistics, period }: { statistics: ProjectStatistics; period: (typeof periods)[number] }) {
  const { current, previous } = statistics;
  const card = (label: string, value: (figures: Figures) => number | null, format: (value: number) => string) => {
    const now = value(current), moved = change(now, previous ? value(previous) : null);
    const note = !previous ? (statistics.from ? null : 'since the first report')
      : !moved ? 'none in ' + period.before
      : moved.direction === 'same' ? 'as in ' + period.before
      : (moved.by > 0 ? '+' : '−') + format(Math.abs(moved.by)) + (moved.percent !== null ? ' (' + (moved.percent > 0 ? '+' : '−') + Math.abs(moved.percent) + '%)' : '') + ' against ' + period.before;
    return <StatsCard label={label} value={now === null ? '—' : format(now)} note={note ?? undefined} />;
  };
  return <div className="stats-grid">
    {card('Agent time', figures => figures.agentMs, duration)}
    {card('Plans completed', figures => figures.plansCompleted, String)}
    {card('Median time to complete', figures => figures.medianImplementingMs, roughDuration)}
    {card('Waited on you', figures => figures.waitedMs, roughDuration)}
  </div>;
}

/** A bucket's name: its day, or the week it begins. */
const bucketName = (start: string, unit: 'day' | 'week') => (unit === 'week' ? 'Week of ' : '') + shortDate(start);

/**
 * The work over time: a bar per day or week, agent time stacked by model and effort, the time at least
 * one agent worked as a line over them, and the plans completed marked above. A bar says on hover what
 * it holds; the same figures are in a table, folded.
 */
function WorkOverTime({ statistics }: { statistics: ProjectStatistics }) {
  const { bars, top } = workBars(statistics);
  const [shown, setShown] = useState<number | null>(null);
  const bar = shown === null ? null : bars[shown];
  const line = bars.map((item, index) => `${(index + 0.5) / bars.length * 100},${100 - item.activeMs / top * 100}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(bars.length / 8));
  return <section className="project-statistics-section" aria-label="Work over time">
    <Text as="h2" variant="section-heading">Work over time</Text>
    {bars.some(item => item.total > 0) ? <>
      <div className="work-chart" role="img" aria-label={'Agent time ' + (statistics.unit === 'day' ? 'by day' : 'by week') + ', ' + plural(bars.length, statistics.unit) + '. The table below has every ' + statistics.unit + '.'} onPointerLeave={() => setShown(null)}>
        <div className="work-chart-bars">{bars.map((item, index) => <div key={item.start} className="work-chart-column" data-shown={shown === index ? '' : undefined} onPointerEnter={() => setShown(index)}>
          {item.completed.length > 0 && <span className="work-chart-completed" style={{ bottom: item.total / top * 100 + '%' }}>{item.completed.length}</span>}
          <div className="work-chart-stack" style={{ blockSize: item.total / top * 100 + '%' }}>
            {item.parts.map(part => <span key={modelKey(part.model, part.effort)} style={{ flexGrow: part.agentMs, background: modelColour(part.model, part.effort) }} />)}
          </div>
          {index % labelEvery === 0 && <span className="work-chart-label">{shortDate(item.start)}</span>}
        </div>)}</div>
        <svg className="work-chart-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={line} /></svg>
        {bar && <div className="work-chart-tip" role="tooltip" data-flip={shown! > bars.length / 2 ? '' : undefined} style={{ left: (shown! + 0.5) / bars.length * 100 + '%' }}>
          <strong>{bucketName(bar.start, statistics.unit)}</strong>
          <span>{duration(bar.total)} of agent time · {duration(bar.activeMs)} at least one agent working</span>
          {bar.parts.map(part => <span key={modelKey(part.model, part.effort)} className="work-chart-tip-model"><ModelSwatch model={part.model} effort={part.effort} />{modelLabel(part.model, part.effort)} {duration(part.agentMs)}</span>)}
          {bar.completed.length > 0 && <span>Completed: {bar.completed.map(plan => plan.title).join(', ')}</span>}
        </div>}
      </div>
      <p className="work-chart-legend muted">
        {statistics.models.map(item => <span key={modelKey(item.model, item.effort)}><ModelSwatch model={item.model} effort={item.effort} />{modelLabel(item.model, item.effort)}</span>)}
        <span><span className="work-chart-key-line" aria-hidden="true" />at least one agent working</span>
        <span><span className="work-chart-key-completed" aria-hidden="true" />plans completed</span>
      </p>
      <DisclosureNote title="The work over time as a table">
        <Table className="project-statistics-table" aria-label="Work over time">
          <TableHead><TableRow><TableHeaderCell>{statistics.unit === 'day' ? 'Day' : 'Week'}</TableHeaderCell><TableHeaderCell numeric>Agent time</TableHeaderCell><TableHeaderCell numeric>At least one working</TableHeaderCell><TableHeaderCell>Plans completed</TableHeaderCell></TableRow></TableHead>
          <TableBody>{bars.map(item => <TableRow key={item.start}>
            <TableCell>{bucketName(item.start, statistics.unit)}</TableCell><TableCell numeric>{duration(item.total)}</TableCell><TableCell numeric>{duration(item.activeMs)}</TableCell>
            <TableCell>{item.completed.map(plan => plan.title).join(', ') || '—'}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </DisclosureNote>
    </> : <p className="muted">No agent worked on this project in this period.</p>}
  </section>;
}

/** The plans worked on in the period, most agent time first: each with its status, its share, its time and tokens, and how long it took. */
function WhereTheTimeWent({ statistics }: { statistics: ProjectStatistics }) {
  const total = statistics.plans.reduce((sum, plan) => sum + plan.agentMs, 0);
  const most = Math.max(1, ...statistics.plans.map(plan => plan.agentMs));
  return <section className="project-statistics-section" aria-label="Where the time went">
    <Text as="h2" variant="section-heading">Where the time went</Text>
    {statistics.plans.length ? <ul className="time-plans">{statistics.plans.map(plan => {
      const status = hubStatus({ state: plan.state, outcome: plan.outcome } as ProjectWork);
      const took = [plan.plannedMs !== null && 'planned ' + roughDuration(plan.plannedMs), plan.implementingMs !== null && 'implementing ' + roughDuration(plan.implementingMs), plan.waitedMs > 0 && 'waited on you ' + roughDuration(plan.waitedMs)].filter(Boolean).join(' · ');
      return <li key={plan.id} className="time-plan">
        <StatusIcon status={status} />
        <div className="time-plan-text">
          <TargetLink target={workStatisticsTarget(plan.id)} className="time-plan-title">{plan.title}</TargetLink>
          <span className="time-plan-bar" aria-hidden="true"><span style={{ inlineSize: plan.agentMs / most * 100 + '%' }} /></span>
          {took && <small className="muted">{took}</small>}
        </div>
        <span className="time-plan-figures"><strong>{duration(plan.agentMs)}</strong><small className="muted">{total ? Math.round(plan.agentMs / total * 100) + '%' : ''}{plan.tokens !== null ? ' · ' + compactNumber(plan.tokens) + ' tokens' : ''}</small></span>
      </li>;
    })}</ul> : <p className="muted">No plan was worked on in this period.</p>}
  </section>;
}

/** Agent time and tokens by model and effort in the period, with each one's share. */
function ModelsAndEffort({ statistics }: { statistics: ProjectStatistics }) {
  const total = statistics.models.reduce((sum, item) => sum + item.agentMs, 0);
  return <section className="project-statistics-section" aria-label="Models and effort">
    <Text as="h2" variant="section-heading">Models and effort</Text>
    {statistics.models.length ? <Table className="project-statistics-table" aria-label="Agent time and tokens by model and effort">
      <TableHead><TableRow><TableHeaderCell>Model and effort</TableHeaderCell><TableHeaderCell numeric>Agent time</TableHeaderCell><TableHeaderCell numeric>Share</TableHeaderCell><TableHeaderCell numeric>Tokens</TableHeaderCell></TableRow></TableHead>
      <TableBody>{statistics.models.map(item => <TableRow key={modelKey(item.model, item.effort)}>
        <TableCell><span className="model-cell"><ModelSwatch model={item.model} effort={item.effort} />{modelLabel(item.model, item.effort)}</span></TableCell>
        <TableCell numeric>{duration(item.agentMs)}</TableCell><TableCell numeric>{total ? Math.round(item.agentMs / total * 100) + '%' : '—'}</TableCell>
        <TableCell numeric>{item.tokens !== null ? compactNumber(item.tokens) : '—'}</TableCell>
      </TableRow>)}</TableBody>
    </Table> : <p className="muted">No model was reported in this period.</p>}
  </section>;
}

/**
 * A project's statistics, a page of their own from its row on the Projects page (or the hub filtered
 * to it), under its breadcrumb (`trail`: Projects, the project).
 */
export function Statistics({ trail }: { snapshot: Snapshot; trail: ReactNode }) {
  const { project, revision } = useWorkbench();
  const [periodId, setPeriodId] = useState<PeriodId>('month');
  const period = periods.find(item => item.id === periodId)!;
  const [read, setRead] = useState<{ key: string; statistics: ProjectStatistics | null; error: string } | null>(null);
  const key = project + ':' + periodId;
  useEffect(() => {
    let current = true;
    api.projectStatistics(project, periodStart(periodId), null, period.unit)
      .then(statistics => { if (current) setRead({ key, statistics, error: '' }); }, error => { if (current) setRead({ key, statistics: null, error: (error as Error).message }); });
    return () => { current = false; };
  }, [key, revision]);
  const shown = read?.key === key ? read : null;
  const statistics = shown?.statistics ?? null;
  return <Page title="Statistics" className="statistics-page" heading={<div className="page-heading-stack">{trail}<div className="page-heading-row">
    <Text as="h1" variant="page-heading">Statistics</Text>
    <Popover aria-label="About statistics" title="About these numbers" width="wide" trigger={<IconButton variant="text" icon={<InfoIcon />} aria-label="About these numbers" />}>
      <div className="info-body">
        <p>The figures come from the reports agents record when a session stops, read from their session logs where Atlas can (Claude Code and Codex). Agent time adds up every agent's working time, each session and each subagent in full, also while they work at once; the line shows the time at least one of them was working.</p>
        <p>Time counts where it was worked, by the reports' working intervals; a report without them counts at its time. A plan counts as completed on its completion date, and the time it took runs from its acceptance to its completion. Waiting on you counts the time the project's sessions waited for you, waits at once counted once.</p>
      </div>
    </Popover>
    <span className="spacer" />
    <SegmentedControl aria-label="Period" size="compact" value={periodId} onValueChange={value => setPeriodId(value as PeriodId)} options={periods.map(item => ({ value: item.id, label: item.label }))} />
  </div></div>}>
    {shown?.error && <Notice tone="warning">{shown.error}</Notice>}
    {!shown ? <div className="page-state" aria-busy="true"><Spinner size="large" label="Reading the statistics" /></div>
      : !statistics ? null
      : statistics.current.agentMs === 0 && !statistics.plans.length ? <EmptyState className="page-empty" icon={<StatisticsIcon />} title="No work in this period" description={statistics.from ? 'Agents have not reported on this project since ' + absoluteDate(statistics.from) + '.' : 'Agents have not reported on this project yet.'} />
      : <>
        <Headline statistics={statistics} period={period} />
        <WorkOverTime statistics={statistics} />
        <WhereTheTimeWent statistics={statistics} />
        <ModelsAndEffort statistics={statistics} />
      </>}
  </Page>;
}
