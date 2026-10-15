// The Statistics view: how work went (the implementing model, agent time and tokens from agent
// reports, plan revisions, ledger steps), how that changes as new models arrive, and how
// documents are used.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Counter, EmptyState, IconButton, Notice, Popover, SegmentedControl, Select, Surface, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Tabs, Text } from '@envsemble/envui';
import { Code } from '@envsemble/envui/content';
import { InfoIcon, StatisticsIcon } from './icons';
import type { Snapshot } from './types';
import { documentTarget, workTarget } from './targets';
import { absoluteDate, compactNumber, duration, median, plural, relativeDate, shortDate, workNumber } from './format';
import { workStatus } from './status';
import { StatusIcon } from './ui';
import { aiModel } from './aiModels';
import { ModelName } from './AiModel';
import { ScatterChart, type ChartSeries } from './components/ScatterChart';
import { TargetLink, useWorkbench } from './workbenchContext';
import { Page } from './Pages';
import type { StageUsage } from '@envsemble/atlas-planning/types';
import { colourSlots, completedRows, metricValue, modelShare, modelSummaries, otherModels, otherSeries, seriesModels, seriesOf, stageLabels, stageUsage, subagentShare, tokenRows, tokenText, trendMetrics, workRows, type StageKey, type TrendMetric, type WorkRow } from './workStatistics';

type StatisticsTab = 'work' | 'models' | 'documents';
const tabs: { id: StatisticsTab; label: string }[] = [{ id: 'work', label: 'Work' }, { id: 'models', label: 'Models over time' }, { id: 'documents', label: 'Document use' }];
/** Categorical slots for the three models with the most recent completed work, set per theme in atlas.css. */
const seriesColors = ['var(--atlas-chart-1)', 'var(--atlas-chart-2)', 'var(--atlas-chart-3)'];
const otherColor = 'var(--atlas-chart-other)';
const reportHint = <>The Atlas plugin records them when an agent session that worked on a work item stops, reading the model, agent time and tokens from the session's own log. Run <Code appearance="subtle">atlas setup</Code> to install it; without it, agents report with <Code appearance="subtle">atlas work report</Code>.</>;

const formatMetric = (metric: TrendMetric, value: number | null) => value === null ? '—'
  : metric === 'tokens' ? compactNumber(value) : metric === 'agentMs' ? duration(value) : Number.isInteger(value) ? String(value) : value.toFixed(1);

export function Statistics({ snapshot, repository }: { snapshot: Snapshot; repository: string }) {
  const [tab, setTab] = useState<StatisticsTab>('work');
  const rows = useMemo(() => workRows(snapshot, repository), [snapshot, repository]);
  const usage = repository === 'all' ? snapshot.usage : snapshot.usageByRepository[repository];
  const body = tab === 'work' ? <WorkStatisticsTab rows={rows} /> : tab === 'models' ? <ModelsTab rows={rows} /> : <DocumentUse snapshot={snapshot} repository={repository} />;
  return <Page section title="Statistics" className="statistics-page" heading={<div className="page-heading-row">
    <Text as="h2" variant="section-heading">Statistics</Text>
    <Popover aria-label="About statistics" title="About these numbers" width="wide" trigger={<IconButton variant="text" icon={<InfoIcon />} aria-label="About these numbers" />}>
      <div className="info-body">
        <p>The model, agent time and tokens come from reports the Atlas plugin records when an agent session stops (or, without the plugin, <Code appearance="subtle">atlas work report</Code>). Where a report could read the agent's session log, as in Claude Code and Codex, agent time is measured: the time the agent worked, from each prompt to the end of its turn, with its helpers' work at the same time counted once and the time it waited for a person left out. Tokens are then counted for each model, by kind.</p>
        <p>Older reports, and agents whose log Atlas cannot read, are estimated: agent time adds up the time between a session's reports, leaving out breaks of more than two hours, and tokens are what the agent reported. The implementing model is the one that did most of the work.</p>
        <p>Agent time and tokens are split by the work item's stage when each report was made: planning until its plan is accepted, and while a session amends an accepted plan; implementation after. Reports from before stages were recorded show as "Stage not recorded". Each subagent counts once, with its own working time added up.</p>
        <p>Plan revisions count the commits that changed a plan after it was added, up to its completion, from this project's Git history. Moving a plan to the archive is not a revision.</p>
        <p>The three models whose completed work is most recent each have a colour; other models share "Other". Durations of work items are calendar time between acceptance and completion, not engineering time.</p>
        <p>Agent reports of documents are self-reported consultation; views are documents opened in Atlas. Unreported access is unknown, and zero use does not mean a record has no value.</p>
        {usage && <p className="muted">Collecting agent reports {usage.agentSince ? 'since ' + absoluteDate(usage.agentSince) : '— not yet'} · views since {absoluteDate(usage.dashboardSince) || '—'}</p>}
      </div>
    </Popover>
  </div>}>
    <Tabs className="statistics-nav" aria-label="Statistics sections" value={tab} onValueChange={value => { if (value) setTab(value as StatisticsTab); }}
      items={tabs.map(item => ({ value: item.id, button: <Button variant="secondary">{item.label}</Button>, content: item.id === tab ? <div className="statistics-body">{body}</div> : null }))} />
  </Page>;
}

function WorkStatisticsTab({ rows }: { rows: WorkRow[] }) {
  const reported = rows.filter(row => row.statistics?.reports).map(row => row.statistics!);
  const tokens = reported.reduce((sum, statistics) => sum + (statistics.tokens ?? 0), 0);
  const tokensKnown = reported.some(statistics => statistics.tokens !== null);
  const tokensMeasured = reported.some(statistics => statistics.tokenKinds), tokensSelfReported = reported.some(statistics => tokenRows(statistics).some(row => row.label === 'Self-reported' && row.value > 0));
  const agentMs = reported.reduce((sum, statistics) => sum + statistics.agentMs, 0);
  const measuredMs = reported.reduce((sum, statistics) => sum + statistics.measuredMs, 0);
  const measured = reported.some(statistics => statistics.measuredReports > 0), estimated = reported.some(statistics => statistics.estimatedMs > 0);
  const completed = completedRows(rows).filter(row => row.statistics?.planRevisions !== null && row.statistics?.planRevisions !== undefined);
  const revisions = median(completed.map(row => row.statistics!.planRevisions!));
  const invalid = rows.reduce((sum, row) => sum + (row.statistics?.invalid ?? 0), 0);
  const stages: StageKey[] = rows.some(row => stageUsage(row.statistics, 'unknown')) ? ['planning', 'implementation', 'unknown'] : ['planning', 'implementation'];
  return <>
    <div className="stats-grid">
      <StatsCard label="Work with reports" value={reported.length} note={'of ' + rows.length + ' work items'} />
      <StatsCard label="Agent time" value={reported.length ? duration(agentMs) : '—'} note={!measured ? 'estimated from report times' : !estimated ? 'measured from session logs' : Math.round(measuredMs / Math.max(agentMs, 1) * 100) + '% measured from session logs'} />
      <StatsCard label="Tokens" value={tokensKnown ? compactNumber(tokens) : '—'} note={!tokensKnown ? 'none reported yet' : tokensMeasured && tokensSelfReported ? 'measured and self-reported' : tokensMeasured ? 'measured from session logs' : 'self-reported'} />
      <StatsCard label="Median plan revisions" value={revisions === null ? '—' : formatMetric('planRevisions', revisions)} note={plural(completed.length, 'completed work item')} />
    </div>
    {!reported.length && <Notice tone="info">No agent reports yet. {reportHint}</Notice>}
    {invalid > 0 && <Notice tone="warning">{invalid} {invalid === 1 ? 'line' : 'lines'} of statistics files are not valid reports and are ignored. <Code appearance="subtle">atlas planning check</Code> names the files.</Notice>}
    {rows.length ? <Table className="work-statistics-table" aria-label="Work statistics" stickyHeader>
      <TableHead><TableRow>
        <TableHeaderCell>Work</TableHeaderCell><TableHeaderCell>Model</TableHeaderCell>{stages.map(stage => <TableHeaderCell key={stage} numeric>{stageLabels[stage]}</TableHeaderCell>)}<TableHeaderCell numeric>Subagents</TableHeaderCell><TableHeaderCell numeric>Plan revisions</TableHeaderCell><TableHeaderCell numeric>Steps</TableHeaderCell>
      </TableRow></TableHead>
      <TableBody>{rows.map(row => <WorkStatisticsRow key={row.work.id} row={row} stages={stages} />)}</TableBody>
    </Table> : <EmptyState className="page-empty" title="No work here yet" />}
  </>;
}

/** A stage's agent time, with its tokens below. */
function StageCell({ usage }: { usage: StageUsage | null }) {
  return <TableCell numeric title={usage?.tokens != null ? tokenText(usage) : undefined}>{usage ? <>{duration(usage.agentMs)}{usage.tokens !== null && <small className="cell-note">{compactNumber(usage.tokens)} tokens</small>}</> : '—'}</TableCell>;
}

function WorkStatisticsRow({ row, stages }: { row: WorkRow; stages: StageKey[] }) {
  const { work, statistics } = row;
  const status = workStatus(work);
  const primary = statistics?.models.find(model => model.model === statistics.primaryModel);
  const others = statistics ? otherModels(statistics) : [];
  return <TableRow interactive>
    <TableCell><span className="work-cell"><StatusIcon status={status} /><TargetLink target={workTarget(work.id)}>{work.title}</TargetLink></span><small className="cell-note">{workNumber(work.id)} · {status.label}{statistics?.lastReport ? ' · reported ' + relativeDate(statistics.lastReport) : ''}</small></TableCell>
    <TableCell>{primary ? <span className="model-cell"><ModelName model={primary.model} detail={modelShare(primary)} />{others.length > 0 && <span title={'Also ' + others.map(model => aiModel(model.model).name + (modelShare(model) ? ' (' + modelShare(model) + ')' : '')).join(', ')}><Counter value={'+' + others.length} /></span>}</span> : <span className="muted">—</span>}</TableCell>
    {stages.map(stage => <StageCell key={stage} usage={stageUsage(statistics, stage)} />)}
    <TableCell numeric title={subagentShare(statistics) ?? undefined}>{statistics?.subagents?.count ? <>{statistics.subagents.count}<small className="cell-note">{duration(statistics.subagents.agentMs)}</small></> : '—'}</TableCell>
    <TableCell numeric title={statistics?.planRevisions == null ? 'Not in this folder\'s Git history' : work.completed ? 'Before completion' : 'So far'}>{statistics?.planRevisions ?? '—'}</TableCell>
    <TableCell numeric>{row.steps ? `${row.stepsDone}/${row.steps}` : '—'}</TableCell>
  </TableRow>;
}

function ModelsTab({ rows }: { rows: WorkRow[] }) {
  const { open } = useWorkbench();
  const [metric, setMetric] = useState<TrendMetric>('agentMs');
  const completed = completedRows(rows);
  const models = seriesModels(completed);
  const slots = colourSlots(models);
  // The series colour says which model: the marks stay in the text colour.
  const series: ChartSeries[] = [...models.map(model => ({ key: model, label: <ModelName model={model} plain />, color: seriesColors[slots.get(model)!] })), { key: otherSeries, label: models.length ? 'Other or unreported model' : 'Model not reported', color: otherColor }];
  const definition = trendMetrics.find(item => item.id === metric)!;
  const points = completed.flatMap(row => {
    const value = metricValue(row, metric);
    return value === null ? [] : [{ id: row.work.id, x: new Date(row.work.completed + 'T12:00:00').getTime(), y: value, series: seriesOf(row, models), title: row.work.title, detail: workNumber(row.work.id) + ' · completed ' + shortDate(row.work.completed) }];
  });
  const summaries = modelSummaries(completed);
  return <>
    <div className="section-toolbar">
      <Text as="h2" variant="section-heading">Completed work by implementing model</Text>
      <SegmentedControl aria-label="Measure" size="compact" value={metric} onValueChange={value => setMetric(value as TrendMetric)} options={trendMetrics.map(item => ({ value: item.id, label: item.label }))} />
    </div>
    {points.length ? <Surface className="chart-box" padding={5}>
      <ScatterChart label={definition.label + ': ' + definition.unit + ', by completion date and implementing model'} points={points} series={series} formatValue={value => formatMetric(metric, value)}
        valueKind={metric === 'agentMs' ? 'duration' : 'count'} onOpen={id => open(workTarget(id), { pin: true })} />
      <Text variant="caption" tone="muted" className="chart-note">Each dot is a completed work item: its {definition.unit}, at its completion date, coloured by the model that did most of the work.{completed.length > points.length ? ` ${completed.length - points.length} completed ${completed.length - points.length === 1 ? 'item has' : 'items have'} no value and ${completed.length - points.length === 1 ? 'is' : 'are'} not shown.` : ''}</Text>
    </Surface> : <EmptyState className="page-empty" icon={<StatisticsIcon />} title={completed.length ? 'No completed work has this value yet' : 'No completed work yet'} description={metric === 'tokens' || metric === 'agentMs' ? reportHint : 'Trends compare work items once they are complete.'} />}
    {summaries.length > 0 && <Table className="model-table" aria-label="Implementing models">
      <TableHead><TableRow>
        <TableHeaderCell>Implementing model</TableHeaderCell><TableHeaderCell numeric>Completed</TableHeaderCell><TableHeaderCell numeric>Median agent time</TableHeaderCell><TableHeaderCell numeric>Median tokens</TableHeaderCell><TableHeaderCell numeric>Median plan revisions</TableHeaderCell><TableHeaderCell numeric>Median steps</TableHeaderCell><TableHeaderCell>Completed between</TableHeaderCell>
      </TableRow></TableHead>
      <TableBody>{summaries.map(summary => <TableRow key={summary.model ?? ''}>
        <TableCell>{summary.model ? <span className="model-cell"><span className="chart-swatch" style={{ background: series.find(entry => entry.key === summary.model)?.color ?? otherColor }} /><ModelName model={summary.model} plain /></span> : <span className="muted">Not reported</span>}</TableCell>
        <TableCell numeric>{summary.completed}</TableCell>
        <TableCell numeric>{formatMetric('agentMs', summary.agentMs)}</TableCell>
        <TableCell numeric>{formatMetric('tokens', summary.tokens)}</TableCell>
        <TableCell numeric>{formatMetric('planRevisions', summary.planRevisions)}</TableCell>
        <TableCell numeric>{formatMetric('steps', summary.steps)}</TableCell>
        <TableCell nowrap>{summary.first === summary.last ? shortDate(summary.first) : shortDate(summary.first) + ' – ' + shortDate(summary.last)}</TableCell>
      </TableRow>)}</TableBody>
    </Table>}
  </>;
}

function StatsCard({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <Surface className="stat" padding={4}><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong>{note != null && <small className="stat-note">{note}</small>}</Surface>;
}

function DocumentUse({ snapshot, repository }: { snapshot: Snapshot; repository: string }) {
  const [source, setSource] = useState('agent');
  const [order, setOrder] = useState('most');
  const [kind, setKind] = useState('meaningful');
  const [limit, setLimit] = useState(50);
  useEffect(() => setLimit(50), [source, order, kind, repository]);
  const totals = repository === 'all' ? snapshot.usage : snapshot.usageByRepository[repository];
  const owner = (id: string | null) => snapshot.work.find(work => work.id === id);
  if (snapshot.collectionError) return <EmptyState className="page-empty" icon={<StatisticsIcon />} title="Statistics unavailable" description={snapshot.collectionError} />;
  if (!totals) return <EmptyState className="page-empty" title="This repository is no longer registered" />;
  const usage = new Map(totals.documents.map(document => [document.key, document]));
  const documents = snapshot.documents.filter(document =>
    (repository === 'all' || document.repositories.includes(repository)) &&
    (kind === 'all' ? true : kind === 'knowledge' ? document.category === 'knowledge' : document.workId || document.category === 'knowledge'));
  const rows = documents.map(document => ({ document, usage: usage.get(document.key), count: source === 'agent' ? usage.get(document.key)?.reports ?? 0 : usage.get(document.key)?.views ?? 0 }));
  rows.sort((a, b) => (order === 'most' ? b.count - a.count : a.count - b.count) || a.document.title.localeCompare(b.document.title));
  const maximum = Math.max(1, ...rows.map(row => row.count));
  const durations = snapshot.work.filter(work => work.durationDays !== null && (repository === 'all' || work.repositories.includes(repository)));
  const meanDuration = durations.length ? (durations.reduce((sum, work) => sum + work.durationDays!, 0) / durations.length).toFixed(1) + ' d' : '—';
  return <>
    <div className="stats-grid">
      <StatsCard label="Agent reports" value={totals.reports} note={totals.agentSince ? 'since ' + absoluteDate(totals.agentSince) : 'not collected yet'} />
      <StatsCard label="Known tasks" value={totals.tasks} note={totals.unassigned ? totals.unassigned + ' without a task' : undefined} />
      <StatsCard label="Views in Atlas" value={totals.views} note={totals.documentsViewed + ' documents'} />
      <StatsCard label="Avg. calendar duration" value={meanDuration} note={durations.length + ' completed work items'} />
    </div>
    {snapshot.usage.failures > 0 && <Notice tone="warning">{snapshot.usage.failures} collection failures; counts are incomplete.</Notice>}
    <div className="section-toolbar">
      <Text as="h2" variant="section-heading">Document use</Text>
      <SegmentedControl aria-label="Usage source" size="compact" value={source} onValueChange={setSource} options={[{ value: 'agent', label: 'Agent reports' }, { value: 'views', label: 'Views in Atlas' }]} />
      <Select density="compact" aria-label="Document category" value={kind} onValueChange={value => setKind(value ?? 'meaningful')} options={[{ value: 'meaningful', label: 'Work & knowledge' }, { value: 'knowledge', label: 'Knowledge only' }, { value: 'all', label: 'All documents' }]} />
      <Select density="compact" aria-label="Usage order" value={order} onValueChange={value => setOrder(value ?? 'most')} options={[{ value: 'most', label: 'Most used' }, { value: 'least', label: 'Least used' }]} />
    </div>
    {rows.length ? <>
      <Table className="usage-table" aria-label="Document use">
        <TableHead><TableRow><TableHeaderCell>Document</TableHeaderCell><TableHeaderCell>{source === 'agent' ? 'Reports' : 'Views'}</TableHeaderCell><TableHeaderCell numeric>{source === 'agent' ? 'Tasks' : 'Sessions'}</TableHeaderCell><TableHeaderCell>Last</TableHeaderCell></TableRow></TableHead>
        <TableBody>{rows.slice(0, limit).map(({ document, usage: item, count }) => {
          const last = source === 'agent' ? item?.lastConsulted ?? null : item?.lastViewed ?? null;
          return <TableRow key={document.path} interactive>
            <TableCell><TargetLink target={documentTarget(document, owner(document.workId))}>{document.title}</TargetLink><small className="cell-note">{document.path}</small></TableCell>
            <TableCell><span className="count-cell"><span className="mini-bar"><span style={{ width: count / maximum * 100 + '%' }} /></span><strong>{count}</strong></span></TableCell>
            <TableCell numeric>{source === 'agent' ? item?.tasks ?? 0 : item?.sessions ?? 0}</TableCell>
            <TableCell nowrap title={absoluteDate(last)}>{last ? relativeDate(last) : '—'}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
      {rows.length > limit && <div className="table-more"><Button variant="secondary" onClick={() => setLimit(value => value + 100)}>Show more ({rows.length - limit} remaining)</Button></div>}
    </> : <EmptyState className="page-empty" title="No matching documents" />}
  </>;
}
