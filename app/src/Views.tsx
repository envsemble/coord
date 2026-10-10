import { useEffect, useState, type ReactNode } from 'react';
import { BookIcon, ChevronRightIcon, FileDirectoryFillIcon, FileIcon, FoldIcon, GitCommitIcon, GraphIcon, InfoIcon, UnfoldIcon } from './icons';
import type { Document, Snapshot } from './types';
import { samePath } from './links';
import { documentRoute, navigate, routeHref } from './routes';
import { relativeDocumentPath } from './work';
import { absoluteDate, relativeDate, workNumber } from './format';
import { Blankslate, Counter, Dropdown, Label } from './ui';
import { SearchInput } from './WorkList';

const categoryLabels: Record<string, string> = { plan: 'Plan', ledger: 'Ledger', decision: 'Decision', glossary: 'Glossary', evidence: 'Evidence' };
function DocumentRow({ file, scoped = false }: { file: Document; scoped?: boolean }) {
  const label = categoryLabels[file.category];
  return <li><a className="document-row" href={routeHref(documentRoute(file))} onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); navigate(documentRoute(file)); } }}>
    <FileIcon size={16} className="document-icon" />
    <span className="document-title">{file.title}</span>
    <span className="document-path">{scoped ? relativeDocumentPath(file) : file.path}</span>
    {label && <Label tone="muted">{label}</Label>}
  </a></li>;
}

export function Knowledge({ snapshot, search, setSearch }: { snapshot: Snapshot; search: string; setSearch(value: string): void }) {
  const term = search.toLowerCase();
  const files = snapshot.documents.filter(file => file.category === 'knowledge' && [file.title, file.path].join(' ').toLowerCase().includes(term));
  return <>
    <h1 className="page-heading">Knowledge</h1>
    <div className="toolbar"><SearchInput value={search} onChange={setSearch} label="Search knowledge" /></div>
    {files.length ? <ul className="box document-list">{files.map(file => <DocumentRow key={file.path} file={file} />)}</ul>
      : <div className="box"><Blankslate icon={<BookIcon size={24} />} title={search ? 'No matching knowledge' : 'No shared knowledge yet'}>{!search && 'Records under knowledge/ appear here.'}</Blankslate></div>}
  </>;
}

function FileGroup({ title, meta, files, scoped, open, onToggle }: { title: ReactNode; meta?: ReactNode; files: Document[]; scoped: boolean; open: boolean; onToggle(): void }) {
  return <li className="file-group">
    <button type="button" className="file-group-header" aria-expanded={open} onClick={onToggle}>
      <ChevronRightIcon size={16} className={'tree-chevron' + (open ? ' open' : '')} /><FileDirectoryFillIcon size={16} className="tree-folder-icon" />
      <span className="file-group-title">{title}</span>{meta}<Counter>{files.length}</Counter>
    </button>
    {open && <ul className="file-group-items">{files.map(file => <DocumentRow key={file.path} file={file} scoped={scoped} />)}</ul>}
  </li>;
}

export function Files({ snapshot, repository, search, setSearch, repositoryMenu }: { snapshot: Snapshot; repository: string; search: string; setSearch(value: string): void; repositoryMenu: ReactNode }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const term = search.toLowerCase();
  const owners = new Map(snapshot.work.map(work => [work.id, work]));
  const files = snapshot.documents.filter(file => {
    const owner = file.workId === null ? undefined : owners.get(file.workId);
    const searchable = [file.title, file.path, owner?.title, owner?.id, owner && workNumber(owner.id)].join(' ').toLowerCase();
    return (repository === 'all' || file.repositories.includes(repository)) && searchable.includes(term);
  });
  const groups = new Map<string, Document[]>();
  for (const file of files) {
    const key = file.workId ?? 'workspace';
    groups.set(key, [...groups.get(key) ?? [], file]);
  }
  const ordered = [...groups].sort(([a], [b]) => {
    if (a === b) return 0;
    if (a === 'workspace') return -1;
    if (b === 'workspace') return 1;
    return (owners.get(a)?.location === 'active' ? 0 : 1) - (owners.get(b)?.location === 'active' ? 0 : 1) || b.localeCompare(a);
  });
  const toggle = (key: string) => setOpen(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  return <>
    <h1 className="page-heading">Files</h1>
    <div className="toolbar">
      <SearchInput value={search} onChange={setSearch} label="Search files" />
      {repositoryMenu}
      <div className="button-group">
        <button type="button" className="btn btn-icon" aria-label="Expand all" title="Expand all" onClick={() => setOpen(new Set(groups.keys()))}><UnfoldIcon size={16} /></button>
        <button type="button" className="btn btn-icon" aria-label="Collapse all" title="Collapse all" onClick={() => setOpen(new Set())}><FoldIcon size={16} /></button>
      </div>
    </div>
    {files.length ? <ul className="box file-groups">{ordered.map(([key, items]) => {
      const work = owners.get(key);
      return <FileGroup key={key} files={items} scoped={Boolean(work)} open={Boolean(search) || open.has(key)} onToggle={() => toggle(key)}
        title={work ? <><span className="muted">{workNumber(work.id)}</span> {work.title}</> : key === 'workspace' ? 'Workspace' : key}
        meta={work?.location === 'archived' ? <Label tone="muted">Archived</Label> : undefined} />;
    })}</ul> : <div className="box"><Blankslate icon={<FileIcon size={24} />} title="No matching files" /></div>}
  </>;
}

export function Activity({ snapshot, repository, repositoryMenu }: { snapshot: Snapshot; repository: string; repositoryMenu: ReactNode }) {
  const same = (a: string, b: string) => samePath(a, b, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths);
  const find = (path: string) => snapshot.documents.find(document => same(document.path, path));
  const entries = snapshot.history.filter(entry => repository === 'all' || entry.repositories.includes(repository) || entry.files.some(file => { const document = find(file); return document?.workId === null && document.repositories.includes(repository); }));
  const titles = new Map(snapshot.work.map(work => [work.id, work.title]));
  return <>
    <div className="page-heading-row"><h1 className="page-heading">Activity</h1><span className="spacer" />{repositoryMenu}</div>
    {!snapshot.gitAvailable ? <div className="box"><Blankslate icon={<GitCommitIcon size={24} />} title="No Git history">This planning folder is not its own Git repository.</Blankslate></div>
      : entries.length ? <ul className="box activity-list">{entries.map(entry => <li className="activity-row" key={entry.id}>
        <GitCommitIcon size={16} className="activity-icon" />
        <div className="activity-main">
          <div className="activity-title"><strong>{entry.title}</strong>{entry.workIds.map(id => <a key={id} className="label label-muted label-link" href={routeHref({ view: 'work', work: id })} title={titles.get(id)}>{workNumber(id)}</a>)}</div>
          <div className="changed-files">{entry.files.slice(0, 5).map(file => { const document = find(file); return <button type="button" key={file} className="file-chip" disabled={!document} title={file} onClick={() => document && navigate(documentRoute(document))}>{file.split('/').at(-1)}</button>; })}{entry.files.length > 5 && <span className="muted">+{entry.files.length - 5} more</span>}</div>
        </div>
        <div className="activity-meta"><code>{entry.id.slice(0, 7)}</code><span title={absoluteDate(entry.date)}>{relativeDate(entry.date)}</span></div>
      </li>)}</ul> : <div className="box"><Blankslate icon={<GitCommitIcon size={24} />} title="No recent activity" /></div>}
  </>;
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
  const heading = <div className="page-heading-row">
    <h1 className="page-heading">Statistics</h1>
    <Dropdown label="About statistics" className="info-popover" buttonClassName="btn-octicon" title="About these numbers" button={<InfoIcon size={16} />}>
      {() => <div className="info-body">
        <p>Agent reports are self-reported consultation; dashboard views are documents opened here. Unreported access is unknown, and zero use does not mean a record has no value.</p>
        <p>Durations are calendar time between acceptance and completion, not engineering time.</p>
        {totals && <p className="muted">Collecting agent reports {totals.agentSince ? 'since ' + absoluteDate(totals.agentSince) : '— not yet'} · views since {absoluteDate(totals.dashboardSince) || '—'}</p>}
      </div>}
    </Dropdown>
    <span className="spacer" />{menu}
  </div>;
  if (snapshot.collectionError) return <>{heading}<div className="box"><Blankslate icon={<GraphIcon size={24} />} title="Statistics unavailable">{snapshot.collectionError}</Blankslate></div></>;
  if (!totals) return <>{heading}<div className="box"><Blankslate title="This repository is no longer registered" /></div></>;
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
    {heading}
    <div className="stats-grid">
      <StatsCard label="Agent reports" value={totals.reports} note={totals.agentSince ? 'since ' + absoluteDate(totals.agentSince) : 'not collected yet'} />
      <StatsCard label="Known tasks" value={totals.tasks} note={totals.unassigned ? totals.unassigned + ' without a task' : undefined} />
      <StatsCard label="Dashboard views" value={totals.views} note={totals.documentsViewed + ' documents'} />
      <StatsCard label="Avg. calendar duration" value={meanDuration} note={durations.length + ' completed work items'} />
    </div>
    {snapshot.usage.failures > 0 && <div className="flash flash-warning">{snapshot.usage.failures} collection failures; counts are incomplete.</div>}
    <div className="toolbar">
      <h2 className="section-heading">Document use</h2>
      <div className="segmented" role="group" aria-label="Usage source"><button type="button" className={source === 'agent' ? 'active' : ''} aria-pressed={source === 'agent'} onClick={() => setSource('agent')}>Agent reports</button><button type="button" className={source === 'views' ? 'active' : ''} aria-pressed={source === 'views'} onClick={() => setSource('views')}>Dashboard views</button></div>
      <select className="select" value={kind} onChange={event => setKind(event.target.value)} aria-label="Document category"><option value="meaningful">Work & knowledge</option><option value="knowledge">Knowledge only</option><option value="all">All documents</option></select>
      <select className="select" value={order} onChange={event => setOrder(event.target.value)} aria-label="Usage order"><option value="most">Most used</option><option value="least">Least used</option></select>
    </div>
    {rows.length ? <div className="box table-wrap"><table className="usage-table"><thead><tr><th>Document</th><th>{source === 'agent' ? 'Reports' : 'Views'}</th><th>{source === 'agent' ? 'Tasks' : 'Sessions'}</th><th>Last</th></tr></thead><tbody>{rows.slice(0, limit).map(({ document, usage: item, count }) => {
      const last = source === 'agent' ? item?.lastConsulted ?? null : item?.lastViewed ?? null;
      return <tr key={document.path}><td><a href={routeHref(documentRoute(document))}>{document.title}</a><small>{document.path}</small></td><td><span className="count-cell"><span className="mini-bar"><span style={{ width: count / maximum * 100 + '%' }} /></span><strong>{count}</strong></span></td><td>{source === 'agent' ? item?.tasks ?? 0 : item?.sessions ?? 0}</td><td title={absoluteDate(last)}>{last ? relativeDate(last) : '—'}</td></tr>;
    })}</tbody></table>
      {rows.length > limit && <button type="button" className="table-more" onClick={() => setLimit(value => value + 100)}>Show more ({rows.length - limit} remaining)</button>}
    </div> : <div className="box"><Blankslate title="No matching documents" /></div>}
  </>;
}
