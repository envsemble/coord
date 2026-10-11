// The Statistics view: how work went (agent-reported model, tokens and active time, plan
// revisions, ledger steps), how that changes as new models arrive, and how documents are used.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { GraphIcon, InfoIcon } from './icons';
import type { Snapshot } from './types';
import { documentTarget, workTarget } from './targets';
import { absoluteDate, compactNumber, duration, median, relativeDate, shortDate, workNumber } from './format';
import { workStatus } from './status';
import { Blankslate, StatusIcon } from './ui';
import { Popover } from './components/Popover';
import { ScatterChart, type ChartSeries } from './components/ScatterChart';
import { TargetLink, useWorkbench } from './workbenchContext';
import { colourSlots, completedRows, metricValue, modelSummaries, otherSeries, seriesModels, seriesOf, trendMetrics, workRows, type TrendMetric, type WorkRow } from './workStatistics';

type StatisticsTab = 'work' | 'models' | 'documents';
const tabs: { id: StatisticsTab; label: string }[] = [{ id: 'work', label: 'Work' }, { id: 'models', label: 'Models over time' }, { id: 'documents', label: 'Document use' }];
/** Categorical slots for the three models with the most recent completed work; checked for colour-vision separation on the dark surface. */
const seriesColors = ['#3987e5', '#d95926', '#199e70'];
const otherColor = '#768390';
const reportHint = <>Agents record their model, the tokens used so far and the time of each ledger transition with <code>atlas work report</code>, as the <code>atlas-implement</code> skill describes.</>;

const formatMetric = (metric: TrendMetric, value: number | null) => value === null ? '—'
  : metric === 'tokens' ? compactNumber(value) : metric === 'activeMs' ? duration(value) : Number.isInteger(value) ? String(value) : value.toFixed(1);

export function Statistics({ snapshot, repository, repositoryMenu: menu }: { snapshot: Snapshot; repository: string; repositoryMenu: ReactNode }) {
  const [tab, setTab] = useState<StatisticsTab>('work');
  const rows = useMemo(() => workRows(snapshot, repository), [snapshot, repository]);
  const usage = repository === 'all' ? snapshot.usage : snapshot.usageByRepository[repository];
  return <div className="page">
    <div className="page-heading-row">
      <h1 className="page-heading">Statistics</h1>
      <Popover label="About statistics" className="info-popover" buttonClassName="btn-octicon" title="About these numbers" button={<InfoIcon size={16} />}>
        {() => <div className="info-body">
          <p>Model, tokens and active time are what agents reported with <code>atlas work report</code>: self-reported and approximate. Active time adds up the time between reports in each session.</p>
          <p>Plan revisions count the commits that changed a plan after it was added, up to its completion, from this folder's Git history. Moving a plan to the archive is not a revision.</p>
          <p>The three models whose completed work is most recent each have a colour; other models share "Other". Durations of work items are calendar time between acceptance and completion, not engineering time.</p>
          <p>Agent reports of documents are self-reported consultation; views are documents opened in Atlas. Unreported access is unknown, and zero use does not mean a record has no value.</p>
          {usage && <p className="muted">Collecting agent reports {usage.agentSince ? 'since ' + absoluteDate(usage.agentSince) : '— not yet'} · views since {absoluteDate(usage.dashboardSince) || '—'}</p>}
        </div>}
      </Popover>
      <span className="spacer" />{menu}
    </div>
    <nav className="underline-nav statistics-nav" aria-label="Statistics sections">
      {tabs.map(item => <a key={item.id} href="#" className={tab === item.id ? 'selected' : ''} aria-current={tab === item.id ? 'page' : undefined}
        onClick={event => { event.preventDefault(); setTab(item.id); }}>{item.label}</a>)}
    </nav>
    <div className="statistics-body">
      {tab === 'work' ? <WorkStatisticsTab rows={rows} /> : tab === 'models' ? <ModelsTab rows={rows} /> : <DocumentUse snapshot={snapshot} repository={repository} />}
    </div>
  </div>;
}

function WorkStatisticsTab({ rows }: { rows: WorkRow[] }) {
  const reported = rows.filter(row => row.statistics?.reports);
  const tokens = reported.reduce((sum, row) => sum + (row.statistics!.tokens ?? 0), 0);
  const tokensReported = reported.some(row => row.statistics!.tokens !== null);
  const active = reported.reduce((sum, row) => sum + row.statistics!.activeMs, 0);
  const completed = completedRows(rows).filter(row => row.statistics?.planRevisions !== null && row.statistics?.planRevisions !== undefined);
  const revisions = median(completed.map(row => row.statistics!.planRevisions!));
  const invalid = rows.reduce((sum, row) => sum + (row.statistics?.invalid ?? 0), 0);
  return <>
    <div className="stats-grid">
      <StatsCard label="Work with reports" value={reported.length} note={'of ' + rows.length + ' work items'} />
      <StatsCard label="Tokens reported" value={tokensReported ? compactNumber(tokens) : '—'} note="self-reported" />
      <StatsCard label="Active time" value={reported.length ? duration(active) : '—'} note="between reports" />
      <StatsCard label="Median plan revisions" value={revisions === null ? '—' : formatMetric('planRevisions', revisions)} note={completed.length + ' completed work items'} />
    </div>
    {!reported.length && <div className="flash"><InfoIcon size={16} /><p>No agent reports yet. {reportHint}</p></div>}
    {invalid > 0 && <div className="flash flash-warning"><p>{invalid} {invalid === 1 ? 'line' : 'lines'} of statistics files are not valid reports and are ignored. <code>atlas planning check</code> names the files.</p></div>}
    {rows.length ? <div className="box table-wrap"><table className="usage-table work-statistics-table"><thead><tr>
      <th>Work</th><th>Model</th><th className="numeric">Tokens</th><th className="numeric">Active time</th><th className="numeric">Plan revisions</th><th className="numeric">Steps</th>
    </tr></thead><tbody>{rows.map(row => <WorkStatisticsRow key={row.work.id} row={row} />)}</tbody></table></div>
      : <div className="box"><Blankslate title="No work here yet" /></div>}
  </>;
}

function WorkStatisticsRow({ row }: { row: WorkRow }) {
  const { work, statistics } = row;
  const status = workStatus(work);
  const others = statistics?.models.slice(1) ?? [];
  return <tr>
    <td><span className="work-cell"><StatusIcon status={status} /><TargetLink target={workTarget(work.id)}>{work.title}</TargetLink></span><small>{workNumber(work.id)} · {status.label}{statistics?.lastReport ? ' · reported ' + relativeDate(statistics.lastReport) : ''}</small></td>
    <td>{statistics?.primaryModel ? <span className="model-cell"><code>{statistics.primaryModel}</code>{others.length > 0 && <span className="counter-label" title={others.map(model => model.model).join(', ')}>+{others.length}</span>}</span> : <span className="muted">—</span>}</td>
    <td className="numeric">{statistics?.tokens != null ? compactNumber(statistics.tokens) : '—'}</td>
    <td className="numeric">{statistics?.reports ? duration(statistics.activeMs) : '—'}</td>
    <td className="numeric" title={statistics?.planRevisions == null ? 'Not in this folder\'s Git history' : work.completed ? 'Before completion' : 'So far'}>{statistics?.planRevisions ?? '—'}</td>
    <td className="numeric">{row.steps ? `${row.stepsDone}/${row.steps}` : '—'}</td>
  </tr>;
}

function ModelsTab({ rows }: { rows: WorkRow[] }) {
  const { open } = useWorkbench();
  const [metric, setMetric] = useState<TrendMetric>('tokens');
  const completed = completedRows(rows);
  const models = seriesModels(completed);
  const slots = colourSlots(models);
  const series: ChartSeries[] = [...models.map(model => ({ key: model, label: model, color: seriesColors[slots.get(model)!] })), { key: otherSeries, label: models.length ? 'Other or unreported model' : 'Model not reported', color: otherColor }];
  const definition = trendMetrics.find(item => item.id === metric)!;
  const points = completed.flatMap(row => {
    const value = metricValue(row, metric);
    return value === null ? [] : [{ id: row.work.id, x: new Date(row.work.completed + 'T12:00:00').getTime(), y: value, series: seriesOf(row, models), title: row.work.title, detail: workNumber(row.work.id) + ' · completed ' + shortDate(row.work.completed) }];
  });
  const summaries = modelSummaries(completed);
  return <>
    <div className="toolbar">
      <h2 className="section-heading">Completed work by implementing model</h2>
      <div className="segmented" role="group" aria-label="Measure">{trendMetrics.map(item => <button key={item.id} type="button" className={metric === item.id ? 'active' : ''} aria-pressed={metric === item.id} onClick={() => setMetric(item.id)}>{item.label}</button>)}</div>
    </div>
    {points.length ? <div className="box chart-box">
      <ScatterChart label={definition.label + ': ' + definition.unit + ', by completion date and implementing model'} points={points} series={series} formatValue={value => formatMetric(metric, value)}
        valueKind={metric === 'activeMs' ? 'duration' : 'count'} onOpen={id => open(workTarget(id), { pin: true })} />
      <p className="chart-note muted">Each dot is a completed work item: its {definition.unit}, at its completion date, coloured by the model with the most active time.{completed.length > points.length ? ` ${completed.length - points.length} completed ${completed.length - points.length === 1 ? 'item has' : 'items have'} no value and ${completed.length - points.length === 1 ? 'is' : 'are'} not shown.` : ''}</p>
    </div> : <div className="box"><Blankslate icon={<GraphIcon size={24} />} title={completed.length ? 'No completed work has this value yet' : 'No completed work yet'}>{metric === 'tokens' || metric === 'activeMs' ? reportHint : 'Trends compare work items once they are complete.'}</Blankslate></div>}
    {summaries.length > 0 && <div className="box table-wrap"><table className="usage-table"><thead><tr>
      <th>Implementing model</th><th className="numeric">Completed</th><th className="numeric">Median tokens</th><th className="numeric">Median active time</th><th className="numeric">Median plan revisions</th><th className="numeric">Median steps</th><th>Completed between</th>
    </tr></thead><tbody>{summaries.map(summary => <tr key={summary.model ?? ''}>
      <td>{summary.model ? <span className="model-cell"><span className="chart-swatch" style={{ background: series.find(entry => entry.key === summary.model)?.color ?? otherColor }} /><code>{summary.model}</code></span> : <span className="muted">Not reported</span>}</td>
      <td className="numeric">{summary.completed}</td>
      <td className="numeric">{formatMetric('tokens', summary.tokens)}</td>
      <td className="numeric">{formatMetric('activeMs', summary.activeMs)}</td>
      <td className="numeric">{formatMetric('planRevisions', summary.planRevisions)}</td>
      <td className="numeric">{formatMetric('steps', summary.steps)}</td>
      <td>{summary.first === summary.last ? shortDate(summary.first) : shortDate(summary.first) + ' – ' + shortDate(summary.last)}</td>
    </tr>)}</tbody></table></div>}
  </>;
}

function StatsCard({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <div className="stat"><span className="stat-label">{label}</span><strong>{value}</strong>{note != null && <small>{note}</small>}</div>;
}
function DocumentUse({ snapshot, repository }: { snapshot: Snapshot; repository: string }) {
  const [source, setSource] = useState('agent');
  const [order, setOrder] = useState('most');
  const [kind, setKind] = useState('meaningful');
  const [limit, setLimit] = useState(50);
  useEffect(() => setLimit(50), [source, order, kind, repository]);
  const totals = repository === 'all' ? snapshot.usage : snapshot.usageByRepository[repository];
  const owner = (id: string | null) => snapshot.work.find(work => work.id === id);
  if (snapshot.collectionError) return <><div className="box"><Blankslate icon={<GraphIcon size={24} />} title="Statistics unavailable">{snapshot.collectionError}</Blankslate></div></>;
  if (!totals) return <div className="box"><Blankslate title="This repository is no longer registered" /></div>;
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
    {snapshot.usage.failures > 0 && <div className="flash flash-warning">{snapshot.usage.failures} collection failures; counts are incomplete.</div>}
    <div className="toolbar">
      <h2 className="section-heading">Document use</h2>
      <div className="segmented" role="group" aria-label="Usage source"><button type="button" className={source === 'agent' ? 'active' : ''} aria-pressed={source === 'agent'} onClick={() => setSource('agent')}>Agent reports</button><button type="button" className={source === 'views' ? 'active' : ''} aria-pressed={source === 'views'} onClick={() => setSource('views')}>Views in Atlas</button></div>
      <select className="select" value={kind} onChange={event => setKind(event.target.value)} aria-label="Document category"><option value="meaningful">Work & knowledge</option><option value="knowledge">Knowledge only</option><option value="all">All documents</option></select>
      <select className="select" value={order} onChange={event => setOrder(event.target.value)} aria-label="Usage order"><option value="most">Most used</option><option value="least">Least used</option></select>
    </div>
    {rows.length ? <div className="box table-wrap"><table className="usage-table"><thead><tr><th>Document</th><th>{source === 'agent' ? 'Reports' : 'Views'}</th><th>{source === 'agent' ? 'Tasks' : 'Sessions'}</th><th>Last</th></tr></thead><tbody>{rows.slice(0, limit).map(({ document, usage: item, count }) => {
      const last = source === 'agent' ? item?.lastConsulted ?? null : item?.lastViewed ?? null;
      return <tr key={document.path}><td><TargetLink target={documentTarget(document, owner(document.workId))}>{document.title}</TargetLink><small>{document.path}</small></td><td><span className="count-cell"><span className="mini-bar"><span style={{ width: count / maximum * 100 + '%' }} /></span><strong>{count}</strong></span></td><td>{source === 'agent' ? item?.tasks ?? 0 : item?.sessions ?? 0}</td><td title={absoluteDate(last)}>{last ? relativeDate(last) : '—'}</td></tr>;
    })}</tbody></table>
      {rows.length > limit && <button type="button" className="table-more" onClick={() => setLimit(value => value + 100)}>Show more ({rows.length - limit} remaining)</button>}
    </div> : <div className="box"><Blankslate title="No matching documents" /></div>}
  </>;
}
