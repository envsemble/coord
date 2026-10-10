import { useEffect, useState, type ReactNode } from 'react';
import { GitCommitIcon, GraphIcon, InfoIcon } from './icons';
import type { Snapshot } from './types';
import { samePath } from './links';
import { documentTarget, workTarget } from './targets';
import { absoluteDate, relativeDate, workNumber } from './format';
import { Blankslate } from './ui';
import { Popover } from './components/Popover';
import { TargetLink, useWorkbench } from './workbenchContext';

export function Activity({ snapshot, repository, repositoryMenu }: { snapshot: Snapshot; repository: string; repositoryMenu: ReactNode }) {
  const { open } = useWorkbench();
  const same = (a: string, b: string) => samePath(a, b, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths);
  const find = (path: string) => snapshot.documents.find(document => same(document.path, path));
  const owner = (id: string | null) => snapshot.work.find(work => work.id === id);
  const entries = snapshot.history.filter(entry => repository === 'all' || entry.repositories.includes(repository) || entry.files.some(file => { const document = find(file); return document?.workId === null && document.repositories.includes(repository); }));
  const titles = new Map(snapshot.work.map(work => [work.id, work.title]));
  return <div className="page">
    <div className="page-heading-row"><h1 className="page-heading">Activity</h1><span className="spacer" />{repositoryMenu}</div>
    {!snapshot.gitAvailable ? <div className="box"><Blankslate icon={<GitCommitIcon size={24} />} title="No Git history">This planning folder is not its own Git repository.</Blankslate></div>
      : entries.length ? <ul className="box activity-list">{entries.map(entry => <li className="activity-row" key={entry.id}>
        <GitCommitIcon size={16} className="activity-icon" />
        <div className="activity-main">
          <div className="activity-title"><strong>{entry.title}</strong>{entry.workIds.map(id => <TargetLink key={id} className="label label-muted label-link" target={workTarget(id)} title={titles.get(id)}>{workNumber(id)}</TargetLink>)}</div>
          <div className="changed-files">{entry.files.slice(0, 5).map(file => { const document = find(file); return <button type="button" key={file} className="file-chip" disabled={!document} title={file} onClick={event => document && open(documentTarget(document, owner(document.workId)), { pin: event.ctrlKey || event.metaKey })}>{file.split('/').at(-1)}</button>; })}{entry.files.length > 5 && <span className="muted">+{entry.files.length - 5} more</span>}</div>
        </div>
        <div className="activity-meta"><code>{entry.id.slice(0, 7)}</code><span title={absoluteDate(entry.date)}>{relativeDate(entry.date)}</span></div>
      </li>)}</ul> : <div className="box"><Blankslate icon={<GitCommitIcon size={24} />} title="No recent activity" /></div>}
  </div>;
}

function StatsCard({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <div className="stat"><span className="stat-label">{label}</span><strong>{value}</strong>{note != null && <small>{note}</small>}</div>;
}
export function Statistics({ snapshot, repository, repositoryMenu: menu }: { snapshot: Snapshot; repository: string; repositoryMenu: ReactNode }) {
  const [source, setSource] = useState('agent');
  const [order, setOrder] = useState('most');
  const [kind, setKind] = useState('meaningful');
  const [limit, setLimit] = useState(50);
  useEffect(() => setLimit(50), [source, order, kind, repository]);
  const totals = repository === 'all' ? snapshot.usage : snapshot.usageByRepository[repository];
  const owner = (id: string | null) => snapshot.work.find(work => work.id === id);
  const heading = <div className="page-heading-row">
    <h1 className="page-heading">Statistics</h1>
    <Popover label="About statistics" className="info-popover" buttonClassName="btn-octicon" title="About these numbers" button={<InfoIcon size={16} />}>
      {() => <div className="info-body">
        <p>Agent reports are self-reported consultation; views are documents opened in Atlas. Unreported access is unknown, and zero use does not mean a record has no value.</p>
        <p>Durations are calendar time between acceptance and completion, not engineering time.</p>
        {totals && <p className="muted">Collecting agent reports {totals.agentSince ? 'since ' + absoluteDate(totals.agentSince) : '— not yet'} · views since {absoluteDate(totals.dashboardSince) || '—'}</p>}
      </div>}
    </Popover>
    <span className="spacer" />{menu}
  </div>;
  if (snapshot.collectionError) return <div className="page">{heading}<div className="box"><Blankslate icon={<GraphIcon size={24} />} title="Statistics unavailable">{snapshot.collectionError}</Blankslate></div></div>;
  if (!totals) return <div className="page">{heading}<div className="box"><Blankslate title="This repository is no longer registered" /></div></div>;
  const usage = new Map(totals.documents.map(document => [document.key, document]));
  const documents = snapshot.documents.filter(document =>
    (repository === 'all' || document.repositories.includes(repository)) &&
    (kind === 'all' ? true : kind === 'knowledge' ? document.category === 'knowledge' : document.workId || document.category === 'knowledge'));
  const rows = documents.map(document => ({ document, usage: usage.get(document.key), count: source === 'agent' ? usage.get(document.key)?.reports ?? 0 : usage.get(document.key)?.views ?? 0 }));
  rows.sort((a, b) => (order === 'most' ? b.count - a.count : a.count - b.count) || a.document.title.localeCompare(b.document.title));
  const maximum = Math.max(1, ...rows.map(row => row.count));
  const durations = snapshot.work.filter(work => work.durationDays !== null && (repository === 'all' || work.repositories.includes(repository)));
  const meanDuration = durations.length ? (durations.reduce((sum, work) => sum + work.durationDays!, 0) / durations.length).toFixed(1) + ' d' : '—';
  return <div className="page">
    {heading}
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
  </div>;
}
