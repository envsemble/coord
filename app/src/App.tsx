import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Activity, ArrowLeft, ArrowUpRight, BookOpen, ChevronRight, CircleIcon, Clock3, Download, FileText, Folder, FolderOpen, GitCommitHorizontal, Layers3, LayoutDashboard, ListChecks, RefreshCw, Search, ShieldCheck, Sparkles, Workflow, X } from './icons';
import type { Document, DocumentContent, Snapshot, Work } from './types';
import { resolveLink, samePath } from './links';
import { findHeadingId, rehypeHeadingIds } from './headings';
import { defaultDocument, primaryDocuments, relativeDocumentPath } from './work';
import { documentRoute, routeHref, type Route } from './routes';
import { AtlasWorkPanel, PlanDiagrams } from './AtlasWorkPanel';

function currentRoute(): Route {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  return { view: parameters.get('view') ?? 'work', work: parameters.get('work'), file: parameters.get('file'), anchor: parameters.get('anchor'), tab: parameters.get('tab'), diagram: parameters.get('diagram'), element: parameters.get('element') };
}
function navigate(route: Partial<Route>) {
  window.location.hash = routeHref(route);
}
function pretty(value: string) { return value.replaceAll('_', ' ').replace(/^\w/, character => character.toUpperCase()); }
function day(value: string | null) {
  if (!value) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value.length === 10 ? value + 'T12:00:00' : value));
}
function shortDay(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value.length === 10 ? value + 'T12:00:00' : value)) : 'Unknown';
}
function bytes(value: number) { return value < 1024 ? value + ' B' : value < 1048576 ? Math.round(value / 1024) + ' KB' : (value / 1048576).toFixed(1) + ' MB'; }
const fileUrl = (path: string, download = false) => '/api/file?' + new URLSearchParams({ path, ...(download ? { download: '1' } : {}) });
async function request<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'The local viewer could not load this record.');
  return body as T;
}
function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={'badge ' + tone}>{children}</span>; }
function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty"><FolderOpen size={30} /><h3>{title}</h3>{children != null && <p>{children}</p>}</div>; }
function StatsCard({ label, value, note, icon }: { label: string; value: ReactNode; note?: ReactNode; icon: ReactNode }) {
  return <div className="stat"><div className="stat-top"><span>{label}</span>{icon}</div><strong>{value}</strong>{note != null && <small>{note}</small>}</div>;
}
function documentOpen(file: Document) { navigate(documentRoute(file)); }
function WorkCard({ work }: { work: Work }) {
  const updated = work.progress?.updated ?? work.updated;
  return <button className="work-card" onClick={() => navigate({ work: work.id })}>
    <CircleIcon className={'work-status-icon ' + (work.implementation === 'complete' ? 'complete' : '')} size={18} />
    <div className="work-row-main"><h3>{work.title}</h3>
    <div className="card-foot"><span>{work.id.replace('work-', '#')} · {pretty(work.design)} plan</span><span>{work.repositories.join(', ')}</span></div>
    {work.progress?.current && <div className="row-focus">{work.progress.current}</div>}</div>
    <div className="work-row-status"><Badge tone={work.implementation === 'complete' ? 'green' : work.implementation === 'in_progress' ? 'blue' : 'neutral'}>{pretty(work.implementation)}</Badge></div>
    <span className="work-row-date">{shortDay(updated)}</span>
  </button>;
}
function FileList({ files, selected }: { files: Document[]; selected?: string | null }) {
  const [query, setQuery] = useState('');
  const relative = relativeDocumentPath;
  const visible = files.filter(file => relative(file).toLowerCase().includes(query.toLowerCase()));
  function branch(prefix: string): ReactNode {
    const directories = new Set<string>();
    const leaves: Document[] = [];
    for (const file of visible) {
      const name = relative(file);
      if (!name.startsWith(prefix)) continue;
      const rest = name.slice(prefix.length);
      if (rest.includes('/')) directories.add(rest.split('/')[0]); else leaves.push(file);
    }
    return <>{[...directories].sort().map(name => <FileFolder key={prefix + name} name={name} selected={Boolean(selected && visible.some(file => file.path === selected && relative(file).startsWith(prefix + name + '/')))} searching={Boolean(query)}>{branch(prefix + name + '/')}</FileFolder>)}{leaves.map(file => <button key={file.path} className={'file-item ' + (selected === file.path ? 'selected' : '')} aria-current={selected === file.path ? 'page' : undefined} title={file.path} onClick={() => documentOpen(file)}><FileText size={16} /><span><strong>{file.name}</strong></span></button>)}</>;
  }
  return <><div className="file-search"><Search size={14} /><input aria-label="Find a file" placeholder="Find a file" value={query} onChange={event => setQuery(event.target.value)} /></div><div className="file-list">{branch('')}{!visible.length && <p className="muted">No matching files.</p>}</div></>;
}
function FileFolder({ name, selected, searching, children }: { name: string; selected: boolean; searching: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(selected || searching);
  useEffect(() => { if (selected || searching) setOpen(true); }, [selected, searching]);
  return <details className="file-folder" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary><ChevronRight size={12} /><Folder size={16} />{name}</summary><div>{children}</div></details>;
}
function WorkFocus({ work }: { work: Work }) {
  if (!work.progress) return <p className="muted progress-missing">No progress reported.</p>;
  return <section className="work-focus" aria-label="Reported work status"><div className="focus-columns"><div><h3>Current</h3><p>{work.progress.current ?? 'Not reported.'}</p></div><div><h3>Next</h3>{work.progress.next.length ? <ul>{work.progress.next.map((step, index) => <li key={index}>{step}</li>)}</ul> : <p>Not recorded.</p>}</div></div>{work.progress.blocked && <p className="focus-blocked"><strong>Blocked:</strong> {work.progress.blocked}</p>}{work.progress.updated && <small className="focus-updated">Updated {day(work.progress.updated)}</small>}</section>;
}

function DocumentRow({ file, scoped = false, category = true }: { file: Document; scoped?: boolean; category?: boolean }) {
  return <button className="document-card" onClick={() => documentOpen(file)}>
    <FileText className="document-icon" size={18} />
    <span className="document-label"><strong>{file.title}</strong><small>{scoped ? relativeDocumentPath(file) : file.path}</small></span>
    {category && <Badge>{pretty(file.category)}</Badge>}<ChevronRight className="document-chevron" size={16} />
  </button>;
}
function RecordGroup({ title, files, work, searching, expansion }: { title: string; files: Document[]; work?: Work; searching: string; expansion: { open: boolean; revision: number } }) {
  const [open, setOpen] = useState(Boolean(searching) || expansion.open);
  useEffect(() => { if (expansion.revision) setOpen(expansion.open); }, [expansion]);
  useEffect(() => { if (searching) setOpen(true); }, [searching]);
  return <details className="record-group" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ChevronRight size={16} /><Folder size={18} /><strong>{title}</strong>{work && <Badge>{pretty(work.location)}</Badge>}<span className="group-count">{files.length}</span></summary>
    <div>{files.map(file => <DocumentRow key={file.path} file={file} scoped={Boolean(work)} />)}</div>
  </details>;
}
function Records({ snapshot, repository, search, knowledge }: { snapshot: Snapshot; repository: string; search: string; knowledge: boolean }) {
  const [expansion, setExpansion] = useState({ open: false, revision: 0 });
  const term = search.toLowerCase();
  const owners = new Map(snapshot.work.map(work => [work.id, work]));
  const files = snapshot.documents.filter(file => {
    const owner = file.workId === null ? undefined : owners.get(file.workId);
    const searchable = [file.title, file.path, owner?.title, owner?.id, owner?.id.replace('work-', '#')].join(' ').toLowerCase();
    return (!knowledge || file.category === 'knowledge') && (repository === 'all' || file.repositories.includes(repository)) && searchable.includes(term);
  });
  const groups = new Map<string | null, Document[]>();
  for (const file of files) {
    const key = file.workId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(file);
  }
  return !files.length ? <Empty title="No matching records" /> : knowledge ? <div className="document-grid">{files.map(file => <DocumentRow key={file.path} file={file} category={false} />)}</div> : <><div className="records-toolbar"><span>{files.length} {files.length === 1 ? 'file' : 'files'}</span><div><button className="text-link" onClick={() => setExpansion(current => ({ open: true, revision: current.revision + 1 }))}>Expand all</button><button className="text-link" onClick={() => setExpansion(current => ({ open: false, revision: current.revision + 1 }))}>Collapse all</button></div></div><div className="record-groups">{[...groups].sort(([a], [b]) => {
    if (a === b) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    const first = snapshot.work.find(work => work.id === a), second = snapshot.work.find(work => work.id === b);
    return (first?.location === 'active' ? 0 : 1) - (second?.location === 'active' ? 0 : 1) || b.localeCompare(a);
  }).map(([id, files]) => {
    const work = snapshot.work.find(work => work.id === id);
    return <RecordGroup key={id === null ? 'workspace' : 'work:' + id} title={work ? work.id.replace('work-', '#') + ' · ' + work.title : id === null ? 'Workspace' : id} work={work} files={files} searching={search} expansion={expansion} />;
  })}</div></>;
}
function Reader({ file, snapshot, anchor, scrollToDocument }: { file: Document; snapshot: Snapshot; anchor: string | null; scrollToDocument: boolean }) {
  const article = useRef<HTMLElement>(null);
  const openedDocument = useRef<string | null>(null);
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [error, setError] = useState('');
  const [collectionError, setCollectionError] = useState('');
  function scrollToHeading(anchor: string) {
    const nodes = Array.from(article.current?.querySelectorAll<HTMLElement>('[id]') ?? []);
    const id = findHeadingId(anchor, nodes.map(node => node.id));
    nodes.find(node => node.id === id)?.scrollIntoView();
  }
  useEffect(() => {
    const controller = new AbortController();
    setContent(null); setError(''); setCollectionError('');
    request<DocumentContent>('/api/document?' + new URLSearchParams({ path: file.path }), controller.signal).then(setContent).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [file.path, file.modified]);
  useEffect(() => {
    if (!content) return;
    try {
      let session = sessionStorage.getItem('planning-dashboard-session');
      if (!session) { session = crypto.randomUUID(); sessionStorage.setItem('planning-dashboard-session', session); }
      fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), path: content.path, session, contentHash: content.contentHash }) })
        .then(response => { if (!response.ok) setCollectionError('View not recorded.'); })
        .catch(() => setCollectionError('View tracking unavailable.'));
    } catch { setCollectionError('View tracking unavailable.'); }
  }, [content]);
  useEffect(() => {
    if (!content) return;
    const opening = scrollToDocument && openedDocument.current !== file.path;
    openedDocument.current = scrollToDocument ? file.path : null;
    if (anchor) requestAnimationFrame(() => scrollToHeading(anchor));
    else if (opening) requestAnimationFrame(() => article.current?.closest('.document-pane')?.scrollIntoView({ block: 'start' }));
  }, [content, anchor, scrollToDocument, file.path]);
  function destination(href: string) {
    return resolveLink(href, file.path, snapshot.documents, snapshot.work, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths);
  }
  return <article className="reader" ref={article}>
    <div className="reader-toolbar"><div><FileText size={16} /><strong>{file.name}</strong></div><a className="icon-button" href={fileUrl(file.path, true)} aria-label={'Download ' + file.name}><Download size={17} /></a></div>
    {collectionError && <div className="notice warning">{collectionError}</div>}
    {error ? <Empty title="Unable to open file">{error}<br /><a href={fileUrl(file.path, true)}>Download</a></Empty> : !content ? <div className="reader-loading">Loading…</div> : content.format === 'markdown' ?
      <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHeadingIds]} components={{
        a: ({ href = '', children, id }) => {
          const target = destination(href);
          if (target.external) return <a id={id} href={target.external} target="_blank" rel="noreferrer">{children}<ArrowUpRight className="external-icon" size={12} /></a>;
          const route = target.file ? documentRoute(target.file, target.anchor) : target.work ? { view: 'work', work: target.work.id, anchor: target.anchor } : href.startsWith('#') && target.anchor !== undefined ? documentRoute(file, target.anchor) : null;
          if (route) return <a id={id} href={routeHref(route)} onClick={event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); navigate(route);
            if (target.anchor && !target.work && (!target.file || target.file.path === file.path)) scrollToHeading(target.anchor);
          }}>{children}</a>;
          return <span className="outside-reference" title={'Reference unavailable in this viewer: ' + href}>{children}</span>;
        },
        img: ({ src = '', alt = '' }) => {
          const target = destination(typeof src === 'string' ? src : '');
          return target.file ? <img src={fileUrl(target.file.path)} alt={alt} /> : <span className="outside-reference">Image reference: {alt || String(src)}</span>;
        },
      }}>{content.body}</ReactMarkdown></div> : content.format === 'text' ? <pre className="source-text">{content.body}</pre> :
      <div className="attachment">{/\.(png|jpe?g|gif|webp|svg)$/i.test(file.path) ? <img src={fileUrl(file.path)} alt={file.title} /> : <><FileText size={40} /><h3>{file.name}</h3><p>{bytes(file.size)}</p><a className="primary-link" href={fileUrl(file.path, true)}>Download <Download size={15} /></a></>}</div>}
  </article>;
}

function Insights({ snapshot, repository }: { snapshot: Snapshot; repository: string }) {
  const [source, setSource] = useState('agent');
  const [order, setOrder] = useState('most');
  const [kind, setKind] = useState('meaningful');
  if (snapshot.collectionError) return <Empty title="Statistics unavailable">{snapshot.collectionError}</Empty>;
  const totals = repository === 'all' ? snapshot.usage : snapshot.usageByRepository[repository];
  if (!totals) return <Empty title="This repository is no longer registered">Choose a repository from the current sidebar.</Empty>;
  const usage = new Map(totals.documents.map(document => [document.key, document]));
  const documents = snapshot.documents.filter(document =>
    (repository === 'all' || document.repositories.includes(repository)) &&
    (kind === 'all' || kind === 'knowledge' ? kind === 'all' || document.category === 'knowledge' : document.workId || document.category === 'knowledge'));
  const rows = documents.map(document => ({ document, usage: usage.get(document.key), count: source === 'agent' ? usage.get(document.key)?.reports ?? 0 : usage.get(document.key)?.views ?? 0 }));
  rows.sort((a, b) => (order === 'most' ? b.count - a.count : a.count - b.count) || a.document.title.localeCompare(b.document.title));
  const knownDurations = snapshot.work.filter(work => work.durationDays !== null && (repository === 'all' || work.repositories.includes(repository)));
  const meanDuration = knownDurations.length ? (knownDurations.reduce((sum, work) => sum + work.durationDays!, 0) / knownDurations.length).toFixed(1) : '—';
  return <>
    <div className="page-title insights-title"><h1>Statistics</h1><details className="statistics-about"><summary>About statistics</summary><p>Agent reports are self-reported consultation. Counts cover the collection period; unreported access is unknown. Zero activity does not mean no value. Durations are calendar time, not engineering time.</p><p>Agent collection: {day(totals.agentSince)} · View collection: {day(totals.dashboardSince)}</p></details></div>
    <div className="stats-grid">
      <StatsCard label="Agent reports" value={totals.reports} note={totals.agentSince ? 'Since ' + day(totals.agentSince) : 'Not collected'} icon={<Sparkles size={18} />} />
      <StatsCard label="Known tasks" value={totals.tasks} note={totals.unassigned ? totals.unassigned + ' unassigned reports' : undefined} icon={<Layers3 size={18} />} />
      <StatsCard label="Dashboard views" value={totals.views} note={totals.documentsViewed + ' files'} icon={<BookOpen size={18} />} />
      <StatsCard label="Avg. calendar duration" value={meanDuration === '—' ? meanDuration : meanDuration + 'd'} note={knownDurations.length + ' dated work items'} icon={<Clock3 size={18} />} />
    </div>
    {snapshot.usage.failures > 0 && <div className="notice warning">{snapshot.usage.failures} collection failures. Counts are incomplete.</div>}
    <div className="section-heading"><h2>Document use</h2></div>
    <div className="usage-toolbar"><div className="segmented" role="group" aria-label="Usage source"><button className={source === 'agent' ? 'active' : ''} aria-pressed={source === 'agent'} onClick={() => setSource('agent')}>Agent reports</button><button className={source === 'views' ? 'active' : ''} aria-pressed={source === 'views'} onClick={() => setSource('views')}>Dashboard views</button></div><div className="table-controls"><select value={kind} onChange={event => setKind(event.target.value)} aria-label="Document category"><option value="meaningful">Work & knowledge</option><option value="knowledge">Knowledge only</option><option value="all">All documents</option></select><select value={order} onChange={event => setOrder(event.target.value)} aria-label="Usage order"><option value="most">Most recorded use</option><option value="least">Least recorded use</option></select></div></div>
    <div className="table-wrap"><table className="usage-table"><thead><tr><th>Document</th><th>{source === 'agent' ? 'Reports' : 'Views'}</th><th>{source === 'agent' ? 'Known tasks' : 'Browser sessions'}</th><th>Last recorded</th></tr></thead><tbody>{rows.slice(0, 60).map(({ document, usage, count }) => <tr key={document.path}><td><button className="text-link" onClick={() => documentOpen(document)}>{document.title}</button><small>{document.path}</small></td><td><strong>{count}</strong><div className="mini-bar"><span style={{ width: Math.max(0, count / Math.max(1, ...rows.map(row => row.count)) * 100) + '%' }} /></div></td><td>{source === 'agent' ? usage?.tasks ?? 0 : usage?.sessions ?? 0}</td><td>{day(source === 'agent' ? usage?.lastConsulted ?? null : usage?.lastViewed ?? null)}</td></tr>)}</tbody></table>{!rows.length && <Empty title="No matching records" />}</div>
    {rows.length > 60 && <div className="coverage-note">Showing 60 of {rows.length} records.</div>}
  </>;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [route, setRoute] = useState(currentRoute);
  const [repository, setRepository] = useState('all');
  const [workSearch, setWorkSearch] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [location, setLocation] = useState('active');
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { setSnapshot(await request<Snapshot>('/api/snapshot')); setError(''); } catch (error) { setError(error instanceof Error ? error.message : 'The planning folder could not be read.'); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 20000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => {
    const change = () => {
      const next = currentRoute();
      setRoute(next);
      if (next.view !== route.view || next.work !== route.work || (!next.work && !next.file)) window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, [route.view, route.work, route.file]);
  const work = snapshot?.work.filter(item => repository === 'all' || item.repositories.includes(repository)) ?? [];
  const selectedFile = snapshot?.documents.find(file => route.file !== null && samePath(file.path, route.file, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths));
  const selectedWork = snapshot?.work.find(item => item.id === (selectedFile ? selectedFile.workId : route.work));
  const selectedDefault = selectedWork ? defaultDocument(selectedWork) : null;
  const reading = selectedFile ?? selectedDefault;
  const search = route.view === 'work' ? workSearch : recordSearch;
  const setSearch = route.view === 'work' ? setWorkSearch : setRecordSearch;
  const searchTerm = search.toLowerCase();
  const matches = (item: Work) => [item.title, item.id, ...item.repositories, ...item.documents.map(file => file.name)].join(' ').toLowerCase().includes(searchTerm);
  const navigation = [
    { id: 'work', label: 'Work', icon: <LayoutDashboard size={18} /> },
    { id: 'knowledge', label: 'Knowledge', icon: <BookOpen size={18} /> },
    { id: 'records', label: 'All records', icon: <FolderOpen size={18} /> },
    { id: 'history', label: 'Activity', icon: <Activity size={18} /> },
    { id: 'insights', label: 'Statistics', icon: <Layers3 size={18} /> },
  ];
  const viewName = navigation.find(item => item.id === route.view)?.label ?? 'Work';
  const visibleWork = work.filter(item => (location === 'all' || item.location === location) && matches(item)).sort((a, b) => b.id.localeCompare(a.id));
  const activeCount = work.filter(item => item.location === 'active').length;
  const archivedCount = work.filter(item => item.location === 'archived').length;
  return <div className="app">
    <aside className="app-sidebar">
      <a className="brand" href="#view=work" title={snapshot?.root}><Workflow size={24} /><strong>Planning</strong></a>
      <nav className="workspace-nav" aria-label="Workspace">
        {navigation.map(item => <button key={item.id} className={(route.view === item.id ? 'active ' : '') + (item.id === 'history' ? 'secondary-start' : '')} aria-label={item.label} aria-current={route.view === item.id ? 'page' : undefined} title={item.label} onClick={() => { setWorkSearch(''); setRecordSearch(''); navigate({ view: item.id }); }}>
          {item.icon}<span className="nav-label">{item.label}</span>{item.id === 'work' && <span className="nav-count">{snapshot?.work.filter(work => work.location === 'active').length ?? '—'}</span>}
        </button>)}
      </nav>
    </aside>
    <div className="main">
      <header className="site-header">
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          {selectedWork || selectedFile ? <><button className="back-link" onClick={() => navigate({ view: route.view })}><ArrowLeft size={15} />{viewName}</button><span>/</span><span>{selectedWork?.id.replace('work-', '#') ?? selectedFile?.name}</span></> : <span>{viewName}</span>}
        </nav>
        <div className="workspace-controls"><label className="repository-filter"><Workflow size={16} /><select aria-label="Repository" value={repository} onChange={event => { setRepository(event.target.value); if (selectedWork || selectedFile) { setSearch(''); navigate({ view: route.view }); } }}>
          <option value="all">All repositories</option>{snapshot?.repositories.map(item => <option key={item.id} value={item.id}>{item.id} ({snapshot.work.filter(work => work.repositories.includes(item.id)).length})</option>)}
        </select></label><button className="icon-button" aria-label="Refresh records" title="Refresh records" onClick={() => void refresh()}><RefreshCw size={16} className={refreshing ? 'spinning' : ''} /></button></div>
      </header>
      <main className="content">
        {snapshot?.collectionError && <div className="notice warning">{snapshot.collectionError}</div>}
        {error && <div className="notice warning">{error}</div>}
        {!snapshot ? error ? <Empty title="Connect a planning folder">Start the viewer with a valid --planning-dir containing planning.json, then refresh.<br /><button className="text-link" onClick={() => void refresh()}>Try again</button></Empty> : <div className="initial-loading"><Workflow size={30} /><h2>Loading…</h2></div> :
        selectedWork || selectedFile ? <>
          <div className="page-title detail-title">
            <div className="eyebrow">{selectedWork ? selectedWork.id.replace('work-', 'WORK ') + ' · ' + selectedWork.location.toUpperCase() : selectedFile?.category.toUpperCase()}</div>
            <h1>{selectedWork?.title ?? selectedFile?.title}</h1>
            {selectedWork && <div className="detail-badges"><Badge tone="neutral">{pretty(selectedWork.design)} plan</Badge><Badge tone={selectedWork.implementation === 'complete' ? 'green' : 'blue'}>{pretty(selectedWork.implementation)} implementation</Badge>{selectedWork.repositories.map(id => <Badge key={id}>{id}</Badge>)}</div>}
          </div>
          <div className="reading-layout">
            <aside className="work-context" aria-label="Work context">
              {selectedWork && <WorkFocus work={selectedWork} />}
              <details className="record-panel" open>
                <summary className="record-panel-heading"><Folder size={16} /><strong>All files</strong><span>{selectedWork?.documents.length ?? 1}</span></summary>
                <FileList files={selectedWork?.documents ?? (selectedFile ? [selectedFile] : [])} selected={reading?.path} />
              </details>
              {selectedWork && <div className="work-metadata">
                <details className="work-dates"><summary>Dates</summary><div className="milestones"><div><small>Created</small><strong>{day(selectedWork.created)}</strong></div><div><small>Accepted</small><strong>{day(selectedWork.accepted)}</strong></div><div><small>Completed</small><strong>{day(selectedWork.completed)}</strong></div><div><small>Plan updated</small><strong>{day(selectedWork.updated)}</strong></div></div></details>
                <details className="work-history"><summary>Activity</summary>{snapshot.history.filter(entry => entry.workIds.includes(selectedWork.id)).slice(0, 6).map(entry => <div className="history-row compact" key={entry.id}><GitCommitHorizontal size={15} /><div><strong>{entry.title}</strong><small>{day(entry.date)} · {entry.id.slice(0, 7)}</small></div></div>)}</details>
              </div>}
              {selectedWork && snapshot.issues.some(issue => issue.workId === selectedWork.id) && <div className={'notice ' + (snapshot.issues.some(issue => issue.workId === selectedWork.id && issue.level === 'error') ? 'error' : 'warning')}><ShieldCheck size={17} /><div><strong>Record health</strong>{snapshot.issues.filter(issue => issue.workId === selectedWork.id).map((issue, index) => <span key={index}>{issue.level === 'error' ? 'Error: ' : 'Note: '}{issue.message}</span>)}</div></div>}
            </aside>
            <div className="document-pane">
              {selectedWork && <nav className="document-tabs" aria-label="Main work records">{(['plan', 'ledger'] as const).map(kind => { const file = primaryDocuments(selectedWork)[kind]; const active = route.tab !== 'diagrams' && file?.path === reading?.path; return <button key={kind} disabled={!file} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => file && documentOpen(file)}>{kind === 'plan' ? <ListChecks size={16} /> : <GitCommitHorizontal size={16} />}{kind === 'plan' ? 'Plan' : 'Ledger'}</button>; })}<button className={route.tab === 'diagrams' ? 'active' : ''} aria-current={route.tab === 'diagrams' ? 'page' : undefined} onClick={() => navigate({ view: 'work', work: selectedWork.id, tab: 'diagrams' })}><Layers3 size={16} />Diagrams</button></nav>}
              {route.tab === 'diagrams' && selectedWork ? <AtlasWorkPanel key={selectedWork.id} work={selectedWork} snapshot={snapshot} route={route} navigate={navigate} /> : reading ? <>{selectedWork && <PlanDiagrams file={reading} work={selectedWork} navigate={navigate} />}<Reader key={reading.path} file={reading} snapshot={snapshot} anchor={route.anchor} scrollToDocument={Boolean(selectedFile)} /></> : <Empty title="No retained documents" />}
            </div>
          </div>
        </> : route.view === 'work' ? <>
          <div className="page-title overview-title"><h1>Work</h1><div className="overview-metrics"><span><strong>{activeCount}</strong> active</span><span><strong>{work.filter(item => item.implementation === 'in_progress' || item.implementation === 'partial').length}</strong> in progress</span><span><strong>{archivedCount}</strong> archived</span><span><strong>{snapshot.documents.filter(file => repository === 'all' || file.repositories.includes(repository)).length}</strong> files</span></div></div>
          <div className="work-toolbar">
            <div className="segmented" role="group" aria-label="Work location">{['active', 'archived', 'all'].map(value => <button key={value} className={location === value ? 'active' : ''} aria-pressed={location === value} onClick={() => setLocation(value)}>{pretty(value)}</button>)}</div>
            <div className="search"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search work" aria-label="Search work" />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}</div>
          </div>
          {visibleWork.length ? <div className="work-grid"><div className="work-columns" aria-hidden="true"><span>Work</span><span>Implementation</span><span>Updated</span></div>{visibleWork.map(item => <WorkCard key={item.id} work={item} />)}</div> : <Empty title="No matching work" />}
        </> : route.view === 'insights' ? <Insights snapshot={snapshot} repository={repository} /> :
        route.view === 'history' ? <>
          <div className="page-title"><h1>Activity</h1></div>
          <div className="history-list">{snapshot.history.filter(entry => repository === 'all' || entry.repositories.includes(repository) || entry.files.some(file => snapshot.documents.some(document => samePath(document.path, file, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths) && document.workId === null && document.repositories.includes(repository)))).map(entry => <div className="history-row" key={entry.id}>
            <span className="history-icon"><GitCommitHorizontal size={19} /></span><div className="history-content"><div className="history-heading"><strong>{entry.title}</strong><small>{day(entry.date)} · {entry.id.slice(0, 7)}</small></div>
            <div className="changed-files">{entry.files.slice(0, 4).map(file => <button key={file} disabled={!snapshot.documents.some(document => samePath(document.path, file, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths))} onClick={() => { const document = snapshot.documents.find(document => samePath(document.path, file, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths)); if (document) documentOpen(document); }}>{file.split('/').at(-1)}</button>)}{entry.files.length > 4 && <span>+{entry.files.length - 4} more</span>}<small className="history-file-count">{entry.files.length} files</small></div></div>
          </div>)}</div>
          {!snapshot.gitAvailable && <Empty title="History unavailable">The connected folder needs its own readable local Git history.</Empty>}
        </> : <>
          <div className="page-title"><h1>{route.view === 'knowledge' ? 'Knowledge' : 'All records'}</h1></div>
          <div className="search"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search files" aria-label="Search documents" />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}</div>
          <Records snapshot={snapshot} repository={repository} search={search} knowledge={route.view === 'knowledge'} />
        </>}
        {snapshot && snapshot.issues.length > 0 && !selectedWork && !selectedFile && <details className="health"><summary><ShieldCheck size={16} />Record health <Badge tone={snapshot.issues.some(issue => issue.level === 'error') ? 'amber' : 'neutral'}>{snapshot.issues.length} notes</Badge></summary><ul>{snapshot.issues.map((issue, index) => <li key={index}>{issue.workId && <button className="text-link" onClick={() => navigate({ work: issue.workId })}>{issue.workId}</button>} {issue.message}</li>)}</ul></details>}
      </main>
    </div>
  </div>;
}
