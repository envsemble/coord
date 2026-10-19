// A project's statistics, to look back on its work over a period (the last 4 weeks by day, the last
// 3 months or all time by week): the period's headline figures against the period before, its work
// over time (agent time stacked by model and effort, the time at least one agent worked as a line,
// the plans completed marked), where the time went (the plans worked on, most time first, each
// opening its own statistics) and its models and effort. From the host's project.statistics; all
// plans' statistics (every active project together) are the same page, from its projects.statistics.
import { useEffect, useState, type ReactNode } from 'react';
import { DisclosureNote, EmptyState, IconButton, Link, Notice, Popover, SegmentedControl, Spinner, Surface, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Text } from '@envsemble/envui';
import { InfoIcon, StatisticsIcon } from '../ui/icons';
import type { ProjectStatistics, ProjectWork } from '../types';
import { api } from '../api';
import { workStatisticsTarget, type Place } from '../navigation/targets';
import { absoluteDate, compactNumber, duration, plural, shortDate } from '../ui/format';
import { hubStatus } from '../hub/hubPlans';
import { StatusIcon } from '../ui/ui';
import { useWorkbench } from '../workbench/workbenchContext';
import { Page } from '../ui/Pages';
import { roughDuration } from '../work/sessions';
import { change, modelKey, periods, periodStart, workBars, type PeriodId } from './projectStatistics';
import { modelPalette, orderModels, shownEffort } from '../ui/modelLook';
import { ModelName } from '../ui/AiModel';

export function StatsCard({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <Surface className="stat" padding={4}><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong>{note != null && <small className="stat-note">{note}</small>}</Surface>;
}

/** A model at an effort's colour, from the palette of the models shown with it (`modelPalette`). */
export function ModelSwatch({ colour }: { colour: string }) {
  return <span className="model-swatch" style={{ background: colour }} aria-hidden="true" />;
}

/** A model at an effort as charts, legends and tables show it: its colour, then its name with its provider's mark and effort. */
export function ModelKey({ model, effort, colour, items }: { model: string | null; effort: string | null; colour: string; items: { model: string | null; effort: string | null }[] }) {
  return <span className="model-cell"><ModelSwatch colour={colour} /><ModelName model={model} effort={shownEffort(items, model, effort)} /></span>;
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
function WorkOverTime({ statistics, scope }: { statistics: ProjectStatistics; scope: string }) {
  const { bars, models, top } = workBars(statistics);
  const colour = modelPalette(models);
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
            {item.parts.map(part => <span key={modelKey(part.model, part.effort)} style={{ flexGrow: part.agentMs, background: colour(part.model, part.effort) }} />)}
          </div>
          {index % labelEvery === 0 && <span className="work-chart-label">{shortDate(item.start)}</span>}
        </div>)}</div>
        <svg className="work-chart-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={line} /></svg>
        {bar && <div className="work-chart-tip" role="tooltip" data-flip={shown! > bars.length / 2 ? '' : undefined} style={{ left: (shown! + 0.5) / bars.length * 100 + '%' }}>
          <strong>{bucketName(bar.start, statistics.unit)}</strong>
          <span>{duration(bar.total)} of agent time · {duration(bar.activeMs)} at least one agent working</span>
          {[...bar.parts].reverse().map(part => <span key={modelKey(part.model, part.effort)} className="work-chart-tip-model"><ModelKey model={part.model} effort={part.effort} colour={colour(part.model, part.effort)} items={models} /><span className="work-chart-tip-figure">{duration(part.agentMs)}</span></span>)}
          {bar.completed.length > 0 && <span>Completed: {bar.completed.map(plan => plan.title).join(', ')}</span>}
        </div>}
      </div>
      <p className="work-chart-legend muted">
        {models.map(item => <ModelKey key={modelKey(item.model, item.effort)} model={item.model} effort={item.effort} colour={colour(item.model, item.effort)} items={models} />)}
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
    </> : <p className="muted">No agent worked on {scope} in this period.</p>}
  </section>;
}

/**
 * The plans worked on in the period, most agent time first: each with its status, its share, its time
 * and tokens, and how long it took; with its project's name when the page covers all plans.
 */
function WhereTheTimeWent({ statistics, open, all }: { statistics: ProjectStatistics; open(plan: ProjectStatistics['plans'][number]): void; all: boolean }) {
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
          <span className="time-plan-name">
            <Link href="#" underline={false} className="time-plan-title" onClick={event => { event.preventDefault(); open(plan); }}>{plan.title}</Link>
            {all && plan.project && <small className="muted">{plan.project}</small>}
          </span>
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
  const models = orderModels(statistics.models);
  const colour = modelPalette(models);
  return <section className="project-statistics-section" aria-label="Models and effort">
    <Text as="h2" variant="section-heading">Models and effort</Text>
    {statistics.models.length ? <Table className="project-statistics-table" aria-label="Agent time and tokens by model and effort">
      <TableHead><TableRow><TableHeaderCell>Model and effort</TableHeaderCell><TableHeaderCell numeric>Agent time</TableHeaderCell><TableHeaderCell numeric>Share</TableHeaderCell><TableHeaderCell numeric>Tokens</TableHeaderCell></TableRow></TableHead>
      <TableBody>{models.map(item => <TableRow key={modelKey(item.model, item.effort)}>
        <TableCell><ModelKey model={item.model} effort={item.effort} colour={colour(item.model, item.effort)} items={models} /></TableCell>
        <TableCell numeric>{duration(item.agentMs)}</TableCell><TableCell numeric>{total ? Math.round(item.agentMs / total * 100) + '%' : '—'}</TableCell>
        <TableCell numeric>{item.tokens !== null ? compactNumber(item.tokens) : '—'}</TableCell>
      </TableRow>)}</TableBody>
    </Table> : <p className="muted">No model was reported in this period.</p>}
  </section>;
}

/** The page's breadcrumb, heading and period, and the figures for the period the host gives (`read`). */
function StatisticsView({ read, revision, trail, scope, open, all }: {
  read(from: string | null, unit: 'day' | 'week'): Promise<ProjectStatistics>; revision: unknown; trail: ReactNode; scope: string;
  open(plan: ProjectStatistics['plans'][number]): void; all: boolean;
}) {
  const [periodId, setPeriodId] = useState<PeriodId>('month');
  const period = periods.find(item => item.id === periodId)!;
  const [result, setResult] = useState<{ key: string; statistics: ProjectStatistics | null; error: string } | null>(null);
  const key = scope + ':' + periodId;
  useEffect(() => {
    let current = true;
    read(periodStart(periodId), period.unit)
      .then(statistics => { if (current) setResult({ key, statistics, error: '' }); }, error => { if (current) setResult({ key, statistics: null, error: (error as Error).message }); });
    return () => { current = false; };
  }, [key, revision]);
  const shown = result?.key === key ? result : null;
  const statistics = shown?.statistics ?? null;
  // The breadcrumb over the title and its explanation at the left, the period at the right across both.
  return <Page title="Statistics" className="statistics-page" heading={<div className="statistics-heading"><div className="page-heading-stack">{trail}<div className="statistics-title">
    <Text as="h1" variant="page-heading">Statistics</Text>
    <Popover aria-label="About statistics" title="About these numbers" width="wide" trigger={<IconButton variant="text" icon={<InfoIcon />} aria-label="About these numbers" />}>
      <div className="info-body">
        <p>The figures come from the reports agents record when a session stops, read from their session logs where Atlas can (Claude Code and Codex). Agent time adds up every agent's working time, each session and each subagent in full, also while they work at once; the line shows the time at least one of them was working.</p>
        <p>Time counts where it was worked, by the reports' working intervals; a report without them counts at its time. A plan counts as completed on its completion date, and the time it took runs from its acceptance to its completion. Waiting on you counts the time {all ? 'the sessions' : 'the project’s sessions'} waited for you, waits at once counted once.{all ? ' All plans are every active project’s together.' : ''}</p>
      </div>
    </Popover>
  </div></div>
    <SegmentedControl aria-label="Period" value={periodId} onValueChange={value => setPeriodId(value as PeriodId)} options={periods.map(item => ({ value: item.id, label: item.label }))} />
  </div>}>
    {shown?.error && <Notice tone="warning">{shown.error}</Notice>}
    {!shown ? <div className="page-state" aria-busy="true"><Spinner size="large" label="Reading the statistics" /></div>
      : !statistics ? null
      : statistics.current.agentMs === 0 && !statistics.plans.length ? <EmptyState className="page-empty" icon={<StatisticsIcon />} title="No work in this period" description={statistics.from ? 'Agents have not reported on ' + scope + ' since ' + absoluteDate(statistics.from) + '.' : 'Agents have not reported on ' + scope + ' yet.'} />
      : <>
        <Headline statistics={statistics} period={period} />
        <WorkOverTime statistics={statistics} scope={scope} />
        <WhereTheTimeWent statistics={statistics} open={open} all={all} />
        <ModelsAndEffort statistics={statistics} />
      </>}
  </Page>;
}

/**
 * A project's statistics, a page of their own from its row on the Projects page (or the hub filtered
 * to it), under its breadcrumb (`trail`: Projects, the project).
 */
export function Statistics({ trail }: { trail: ReactNode }) {
  const { project, revision, open } = useWorkbench();
  return <StatisticsView read={(from, unit) => api.projectStatistics(project, from, null, unit)} revision={revision} trail={trail} scope="this project" all={false}
    open={plan => open(workStatisticsTarget(plan.id))} />;
}

/**
 * All plans' statistics: every active project together, on the same page as a project's, from the
 * hub's Statistics; each plan opens its own statistics in its project. `revision` changes with the
 * project list, to read them again.
 */
export function AllStatistics({ trail, revision, go }: { trail: ReactNode; revision: unknown; go(place: Place): void }) {
  return <StatisticsView read={(from, unit) => api.allStatistics(from, null, unit)} revision={revision} trail={trail} scope="any project" all
    open={plan => { if (plan.folderId) go({ project: plan.folderId, target: workStatisticsTarget(plan.id) }); }} />;
}
