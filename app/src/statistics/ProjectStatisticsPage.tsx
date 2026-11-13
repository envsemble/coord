// A project's statistics, to look back on its work over a period (the last 4 weeks by day, the last
// 3 months or all time by week): the period's headline figures against the period before, its work
// over time (agent time stacked by model and effort, the time at least one agent worked as a line,
// the plans completed marked) and its models and effort. From the host's project.statistics; all
// plans' statistics (every active project together) are the same page, from its projects.statistics.
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Disclosure, IconButton, Popover, SegmentedControl, Spinner, Table, Text } from '@envsemble/envui';
import { EmptyState } from '../ui/EmptyState';
import { InfoIcon, StatisticsIcon } from '../ui/icons';
import type { ProjectStatistics } from '../types';
import { api } from '../api';
import { absoluteDate, compactNumber, duration, plural, shortDate } from '../ui/format';
import { useWindow } from '../window/windowContext';
import { Page } from '../ui/Page';
import { roughDuration } from '../plan/sessions';
import { change, modelKey, periods, periodStart, workBars, type PeriodId } from './statisticsPeriods';
import { modelPalette, orderModels } from '../ui/modelColours';
import { ModelKey, StatsCard } from '../ui/statistics';

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
    <Text render={<h2 />} variant="title">Work over time</Text>
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
        {/* eslint-disable-next-line envui/no-html-elements -- the tip follows the bar the pointer is over; Tooltip anchors to one element */}
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
      <Disclosure title="The work over time as a table">
        <Table.Root className="project-statistics-table" aria-label="Work over time">
          <Table.Head><Table.Row><Table.HeaderCell>{statistics.unit === 'day' ? 'Day' : 'Week'}</Table.HeaderCell><Table.HeaderCell numeric>Agent time</Table.HeaderCell><Table.HeaderCell numeric>At least one working</Table.HeaderCell><Table.HeaderCell>Plans completed</Table.HeaderCell></Table.Row></Table.Head>
          <Table.Body>{bars.map(item => <Table.Row key={item.start}>
            <Table.Cell>{bucketName(item.start, statistics.unit)}</Table.Cell><Table.Cell numeric>{duration(item.total)}</Table.Cell><Table.Cell numeric>{duration(item.activeMs)}</Table.Cell>
            <Table.Cell>{item.completed.map(plan => plan.title).join(', ') || '—'}</Table.Cell>
          </Table.Row>)}</Table.Body>
        </Table.Root>
      </Disclosure>
    </> : <p className="muted">No agent worked on {scope} in this period.</p>}
  </section>;
}

/** Agent time and tokens by model and effort in the period, with each one's share. */
function ModelsAndEffort({ statistics }: { statistics: ProjectStatistics }) {
  const total = statistics.models.reduce((sum, item) => sum + item.agentMs, 0);
  const models = orderModels(statistics.models);
  const colour = modelPalette(models);
  return <section className="project-statistics-section" aria-label="Models and effort">
    <Text render={<h2 />} variant="title">Models and effort</Text>
    {statistics.models.length ? <Table.Root className="project-statistics-table" aria-label="Agent time and tokens by model and effort">
      <Table.Head><Table.Row><Table.HeaderCell>Model and effort</Table.HeaderCell><Table.HeaderCell numeric>Agent time</Table.HeaderCell><Table.HeaderCell numeric>Share</Table.HeaderCell><Table.HeaderCell numeric>Tokens</Table.HeaderCell></Table.Row></Table.Head>
      <Table.Body>{models.map(item => <Table.Row key={modelKey(item.model, item.effort)}>
        <Table.Cell><ModelKey model={item.model} effort={item.effort} colour={colour(item.model, item.effort)} items={models} /></Table.Cell>
        <Table.Cell numeric>{duration(item.agentMs)}</Table.Cell><Table.Cell numeric>{total ? Math.round(item.agentMs / total * 100) + '%' : '—'}</Table.Cell>
        <Table.Cell numeric>{item.tokens !== null ? compactNumber(item.tokens) : '—'}</Table.Cell>
      </Table.Row>)}</Table.Body>
    </Table.Root> : <p className="muted">No model was reported in this period.</p>}
  </section>;
}

/** The page's breadcrumb, heading and period, and the figures for the period the host gives (`read`). */
function StatisticsView({ read, revision, trail, scope, all }: {
  read(from: string | null, unit: 'day' | 'week'): Promise<ProjectStatistics>; revision: unknown; trail: ReactNode; scope: string;
  all: boolean;
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
    <Text render={<h1 />} variant="title">Statistics</Text>
    <Popover aria-label="About statistics" title="About these numbers" width="lg" trigger={<IconButton variant="text" icon={<InfoIcon />} aria-label="About these numbers" />}>
      <div className="info-body">
        <p>The figures come from the reports agents record when a session stops, read from their session logs where Atlas can (Claude Code and Codex). Agent time adds up every agent's working time, each session and each subagent in full, also while they work at once; the line shows the time at least one of them was working.</p>
        <p>Time counts where it was worked, by the reports' working intervals; a report without them counts at its time. A plan counts as completed on its completion date, and the time it took runs from its acceptance to its completion. Waiting on you counts the time {all ? 'the sessions' : 'the project’s sessions'} waited for you, waits at once counted once.{all ? ' All plans are every active project’s together.' : ''}</p>
      </div>
    </Popover>
  </div></div>
    <SegmentedControl aria-label="Period" value={periodId} onValueChange={value => setPeriodId(value as PeriodId)} items={periods.map(item => ({ value: item.id, label: item.label }))} />
  </div>}>
    {shown?.error && <Alert tone="warning">{shown.error}</Alert>}
    {!shown ? <div className="page-state" aria-busy="true"><Spinner size="lg" label="Reading the statistics" /></div>
      : !statistics ? null
      : statistics.current.agentMs === 0 && statistics.current.plansCompleted === 0 ? <EmptyState className="page-empty" icon={<StatisticsIcon />} title="No work in this period" description={statistics.from ? 'Agents have not reported on ' + scope + ' since ' + absoluteDate(statistics.from) + '.' : 'Agents have not reported on ' + scope + ' yet.'} />
      : <>
        <Headline statistics={statistics} period={period} />
        <WorkOverTime statistics={statistics} scope={scope} />
        <ModelsAndEffort statistics={statistics} />
      </>}
  </Page>;
}

/**
 * A project's statistics, a page of their own from its row on the Projects page (or the hub filtered
 * to it), under its breadcrumb (`trail`: Projects, the project).
 */
export function ProjectStatisticsPage({ trail }: { trail: ReactNode }) {
  const { projectId, revision } = useWindow();
  return <StatisticsView read={(from, unit) => api.projectStatistics(projectId, from, null, unit)} revision={revision} trail={trail} scope="this project" all={false} />;
}

/**
 * All plans' statistics: every active project together, on the same page as a project's, from the
 * hub's Statistics. `revision` changes with the project list, to read them again.
 */
export function AllStatisticsPage({ trail, revision }: { trail: ReactNode; revision: unknown }) {
  return <StatisticsView read={(from, unit) => api.allStatistics(from, null, unit)} revision={revision} trail={trail} scope="any project" all />;
}
