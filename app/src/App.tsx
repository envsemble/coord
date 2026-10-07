import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PulseIcon as Activity, ArchiveIcon as Archive, ArrowLeftIcon as ArrowLeft, ArrowUpRightIcon as ArrowUpRight, BookIcon as BookOpen, ChevronRightIcon as ChevronRight, IssueOpenedIcon, ClockIcon as Clock3, DownloadIcon as Download, FileIcon as FileText, FileDirectoryIcon as Folder, FileDirectoryOpenFillIcon as FolderOpen, GitCommitIcon as GitCommitHorizontal, StackIcon as Layers3, ProjectIcon as LayoutDashboard, ChecklistIcon as ListChecks, SyncIcon as RefreshCw, SearchIcon as Search, ShieldCheckIcon as ShieldCheck, SparkleIcon as Sparkles, RepoIcon as Workflow, XIcon as X } from '@primer/octicons-react';
import type { Document, DocumentContent, Snapshot, Work } from './types';
import { resolveLink, samePath } from './links';
import { findHeadingId, rehypeHeadingIds } from './headings';
import { defaultDocument, primaryDocuments, relativeDocumentPath } from './work';
import { documentRoute, routeHref, type Route } from './routes';

function currentRoute(): Route {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  return { view: parameters.get('view') ?? 'work', work: parameters.get('work'), file: parameters.get('file'), anchor: parameters.get('anchor') };
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
function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty"><FolderOpen size={30} /><h3>{title}</h3><p>{children}</p></div>; }
function StatsCard({ label, value, note, icon }: { label: string; value: ReactNode; note: ReactNode; icon: ReactNode }) {
  return <div className="stat"><div className="stat-top"><span>{label}</span>{icon}</div><strong>{value}</strong><small>{note}</small></div>;
}
function documentOpen(file: Document) { navigate(documentRoute(file)); }
function WorkCard({ work }: { work: Work }) {
  const ledgers = work.documents.filter(file => file.category === 'ledger').length;
  const decisions = work.documents.filter(file => file.category === 'decision').length;
  return <button className="work-card" onClick={() => navigate({ work: work.id })}>
    <IssueOpenedIcon className={'work-status-icon ' + (work.implementation === 'complete' ? 'complete' : '')} size={18} />
    <div className="work-row-main"><div className="work-row-title"><h3>{work.title}</h3><Badge tone={work.implementation === 'complete' ? 'green' : work.implementation === 'in_progress' ? 'blue' : 'neutral'}>{pretty(work.implementation)}</Badge>{work.repositories.map(repository => <Badge key={repository}>{repository}</Badge>)}</div>
    <div className="card-foot"><span>{work.id.replace('work-', '#')} · {pretty(work.design)} design · {work.documents.length} files{ledgers ? ' · ledger' : ''}{decisions ? ' · ' + decisions + ' decisions' : ''}</span><span>Updated {shortDay(work.progress?.updated ?? work.updated)}</span></div>
    {work.progress?.current && <div className="row-focus">Current: {work.progress.current}</div>}</div>
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
    return <>{[...directories].sort().map(name => <FileFolder key={prefix + name} name={name} selected={Boolean(selected && visible.some(file => file.path === selected && relative(file).startsWith(prefix + name + '/')))} searching={Boolean(query)}>{branch(prefix + name + '/')}</FileFolder>)}{leaves.map(file => <button key={file.path} className={'file-item ' + (selected === file.path ? 'selected' : '')} aria-current={selected === file.path ? 'page' : undefined} title={file.path} onClick={() => documentOpen(file)}><FileText size={16} /><span><strong>{file.name}</strong>{file.category === 'plan' || file.path.endsWith('/ledger.md') ? <small>{file.category === 'plan' ? 'Main plan' : 'Implementation ledger'}</small> : null}</span></button>)}</>;
  }
  return <><div className="file-search"><Search size={14} /><input aria-label="Find a file" placeholder="Find a file…" value={query} onChange={event => setQuery(event.target.value)} /></div><div className="file-list">{branch('')}{!visible.length && <p className="muted">No matching files.</p>}</div></>;
}
function FileFolder({ name, selected, searching, children }: { name: string; selected: boolean; searching: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(selected || searching);
  useEffect(() => { if (selected || searching) setOpen(true); }, [selected, searching]);
  return <details className="file-folder" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary><ChevronRight size={12} /><Folder size={16} />{name}</summary><div>{children}</div></details>;
}
function WorkFocus({ work }: { work: Work }) {
  return <section className="work-focus" aria-label="Reported work status"><div className="focus-header"><strong>Work status</strong><small>{work.progress ? 'Reported · updated ' + day(work.progress.updated) : 'No current status reported'}</small></div><div className="focus-columns"><div><h3>Current</h3><p>{work.progress?.current ?? 'Not reported.'}</p></div><div><h3>Next</h3>{work.progress?.next.length ? <ul>{work.progress.next.map((step, index) => <li key={index}>{step}</li>)}</ul> : <p>Not recorded.</p>}</div></div>{work.progress?.blocked && <p className="focus-blocked"><strong>Blocked:</strong> {work.progress.blocked}</p>}</section>;
}
function Reader({ file, snapshot, anchor }: { file: Document; snapshot: Snapshot; anchor: string | null }) {
  const article = useRef<HTMLElement>(null);
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
        .then(response => { if (!response.ok) setCollectionError('This document opened, but its view statistic could not be recorded.'); })
        .catch(() => setCollectionError('This document opened, but view collection is unavailable.'));
    } catch { setCollectionError('This document opened, but browser session storage is unavailable for view collection.'); }
  }, [content]);
  useEffect(() => {
    if (content && anchor) requestAnimationFrame(() => scrollToHeading(anchor));
  }, [content, anchor]);
  function destination(href: string) {
    return resolveLink(href, file.path, snapshot.documents, snapshot.work, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths);
  }
  return <article className="reader" ref={article}>
    <div className="reader-toolbar"><div><FileText size={16} /><strong>{file.name}</strong><span className="file-size">{bytes(file.size)}</span></div><a className="icon-button" href={fileUrl(file.path, true)} aria-label={'Download ' + file.name}><Download size={17} /></a></div>
    {content?.metadata?.kind === 'plan' && <div className="intent-note"><ListChecks size={15} /> Plan · intended work. Actual progress is recorded in the ledger.</div>}
    {collectionError && <div className="notice warning">{collectionError}</div>}
    {error ? <Empty title="This record could not be displayed">{error}<br /><a href={fileUrl(file.path, true)}>Download the original</a></Empty> : !content ? <div className="reader-loading">Opening the original record…</div> : content.format === 'markdown' ?
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
      <div className="attachment">{/\.(png|jpe?g|gif|webp|svg)$/i.test(file.path) ? <img src={fileUrl(file.path)} alt={file.title} /> : <><FileText size={40} /><h3>{file.name}</h3><p>{bytes(file.size)} · Original attachment</p><a className="primary-link" href={fileUrl(file.path, true)}>Download original <Download size={15} /></a></>}</div>}
  </article>;
}

function Insights({ snapshot, repository }: { snapshot: Snapshot; repository: string }) {
  const [source, setSource] = useState('agent');
  const [order, setOrder] = useState('most');
  const [kind, setKind] = useState('meaningful');
  if (snapshot.collectionError) return <Empty title="Usage statistics unavailable">{snapshot.collectionError} Work records remain available from the sidebar.</Empty>;
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
    <div className="page-title"><h1>Statistics</h1><p>Reported consultation and browser views, with their sources kept separate.</p></div>
    <div className="stats-grid">
      <StatsCard label="Agent reports" value={totals.reports} note={totals.agentSince ? 'Since ' + day(totals.agentSince) : 'No agent reports collected yet'} icon={<Sparkles size={18} />} />
      <StatsCard label="Known tasks" value={totals.tasks} note={totals.unassigned + ' reports without a task ID'} icon={<Layers3 size={18} />} />
      <StatsCard label="Dashboard views" value={totals.views} note={totals.documentsViewed + ' distinct documents opened'} icon={<BookOpen size={18} />} />
      <StatsCard label="Recorded duration" value={meanDuration === '—' ? meanDuration : meanDuration + 'd'} note={knownDurations.length + ' work items with both dates'} icon={<Clock3 size={18} />} />
    </div>
    <div className="notice"><ShieldCheck size={17} /><div><strong>Usage is a signal, not a quality score.</strong><span>Agent reports are self-reported, not independently observed reads. Unreported access is unknown. Calendar durations do not measure engineering time.</span></div></div>
    {snapshot.usage.failures > 0 && <div className="notice warning">{snapshot.usage.failures} usage collection failures were recorded across this workspace. Collection is incomplete.</div>}
    <div className="section-heading"><div><h2>Document use</h2><p>Only activity collected since instrumentation is included.</p></div><div className="segmented"><button className={source === 'agent' ? 'active' : ''} onClick={() => setSource('agent')}>Agent reports</button><button className={source === 'views' ? 'active' : ''} onClick={() => setSource('views')}>Dashboard views</button></div></div>
    <div className="table-controls"><select value={kind} onChange={event => setKind(event.target.value)} aria-label="Document category"><option value="meaningful">Work & knowledge</option><option value="knowledge">Knowledge only</option><option value="all">All documents</option></select><select value={order} onChange={event => setOrder(event.target.value)} aria-label="Usage order"><option value="most">Most recorded use</option><option value="least">Least recorded use</option></select></div>
    <div className="table-wrap"><table className="usage-table"><thead><tr><th>Document</th><th>{source === 'agent' ? 'Reports' : 'Views'}</th><th>{source === 'agent' ? 'Known tasks' : 'Browser sessions'}</th><th>Last recorded</th></tr></thead><tbody>{rows.slice(0, 60).map(({ document, usage, count }) => <tr key={document.path}><td><button className="text-link" onClick={() => documentOpen(document)}>{document.title}</button><small>{document.path}</small></td><td><strong>{count}</strong><div className="mini-bar"><span style={{ width: Math.max(0, count / Math.max(1, ...rows.map(row => row.count)) * 100) + '%' }} /></div></td><td>{source === 'agent' ? usage?.tasks ?? 0 : usage?.sessions ?? 0}</td><td>{day(source === 'agent' ? usage?.lastConsulted ?? null : usage?.lastViewed ?? null)}</td></tr>)}</tbody></table>{!rows.length && <Empty title="No matching records">Choose another repository or document category.</Empty>}</div>
    <div className="coverage-note">A zero means no recorded activity during collection. It does not establish that a record was never read or has no value. Showing {Math.min(rows.length, 60)} of {rows.length} matching records.</div>
  </>;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [route, setRoute] = useState(currentRoute);
  const [repository, setRepository] = useState('all');
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('active');
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { setSnapshot(await request<Snapshot>('/api/snapshot')); setError(''); } catch (error) { setError(error instanceof Error ? error.message : 'The planning folder could not be read.'); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 20000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { const change = () => { setRoute(currentRoute()); window.scrollTo(0, 0); }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const work = snapshot?.work.filter(item => repository === 'all' || item.repositories.includes(repository)) ?? [];
  const selectedFile = snapshot?.documents.find(file => route.file !== null && samePath(file.path, route.file, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths));
  const selectedWork = snapshot?.work.find(item => item.id === (selectedFile ? selectedFile.workId : route.work));
  const selectedDefault = selectedWork ? defaultDocument(selectedWork) : null;
  const reading = selectedFile ?? selectedDefault;
  const searchTerm = search.toLowerCase();
  const matches = (item: Work) => [item.title, item.id, ...item.repositories, ...item.documents.map(file => file.name)].join(' ').toLowerCase().includes(searchTerm);
  const navigation = [{ id: 'work', label: 'Work', icon: <LayoutDashboard size={18} /> }, { id: 'knowledge', label: 'Knowledge', icon: <BookOpen size={18} /> }, { id: 'history', label: 'Activity', icon: <Activity size={18} /> }, { id: 'insights', label: 'Statistics', icon: <Layers3 size={18} /> }, { id: 'records', label: 'All records', icon: <FolderOpen size={18} /> }];
  return <div className="app">
    <header className="site-header"><a className="brand" href="#view=work"><Workflow size={24} /><span>Workspace <span className="muted">/</span> <strong>planning</strong></span><Badge>Local</Badge></a><span className="header-note"><ShieldCheck size={14} />View records · discuss changes in chat</span><button className="icon-button" aria-label="Refresh records" title="Refresh records" onClick={() => void refresh()}><RefreshCw size={16} className={refreshing ? 'spinning' : ''} /></button></header>
    <nav className="workspace-nav" aria-label="Workspace">{navigation.map(item => <button key={item.id} className={route.view === item.id ? 'active' : ''} aria-current={route.view === item.id ? 'page' : undefined} onClick={() => { setSearch(''); navigate({ view: item.id }); }}>{item.icon}{item.label}{item.id === 'work' && <span className="nav-count">{snapshot?.work.filter(work => work.location === 'active').length ?? '—'}</span>}</button>)}</nav>
    <div className="workspace-layout">
    <aside className="sidebar">
      <div className="sidebar-heading">Repositories</div>
      <div className="repository-list"><button className={repository === 'all' ? 'active' : ''} onClick={() => setRepository('all')}><Layers3 size={15} /> All repositories</button>{snapshot?.repositories.map(item => <button key={item.id} className={repository === item.id ? 'active' : ''} onClick={() => setRepository(item.id)}><span className="repo-dot" />{item.id}<span>{snapshot.work.filter(work => work.repositories.includes(item.id)).length}</span></button>)}</div>
      <div className="sidebar-bottom"><div><ShieldCheck size={16} /><strong>Read-only, by design</strong></div><p>Discuss and change work with your agent in chat.</p><span className="connected"><span style={{ background: !snapshot || error ? '#9aa5b1' : undefined }} />{!snapshot || error ? 'Waiting for planning records' : 'Connected to local files'}</span></div>
    </aside>
    <div className="main">
      <main className="content">
        {snapshot?.collectionError && <div className="notice warning">{snapshot.collectionError}</div>}
        {error && <div className="notice warning">{error}</div>}
        {!snapshot ? error ? <Empty title="Connect a planning folder">Start the viewer with a valid --planning-dir containing planning.json, then refresh.<br /><button className="text-link" onClick={() => void refresh()}>Try again</button></Empty> : <div className="initial-loading"><Workflow size={30} /><h2>Opening your planning workspace…</h2></div> :
        selectedWork || selectedFile ? <>
          <button className="back-link" onClick={() => navigate({ view: route.view })}><ArrowLeft size={15} />Back to {navigation.find(item => item.id === route.view)?.label.toLowerCase() ?? 'work'}</button>
          <div className="page-title detail-title"><div className="eyebrow">{selectedWork ? selectedWork.id.replace('work-', 'WORK ') + ' · ' + selectedWork.location.toUpperCase() : selectedFile?.category.toUpperCase()}</div><h1>{selectedWork?.title ?? selectedFile?.title}</h1>
          {selectedWork && <div className="detail-badges"><Badge tone="neutral">{pretty(selectedWork.design)} design</Badge><Badge tone={selectedWork.implementation === 'complete' ? 'green' : 'blue'}>{pretty(selectedWork.implementation)} implementation</Badge>{selectedWork.repositories.map(id => <Badge key={id}>{id}</Badge>)}</div>}</div>
          {selectedWork?.location === 'archived' && <div className="notice"><Archive size={17} /><div><strong>Historical work</strong><span>This record describes past intent and outcomes. Current code and current instructions establish today's behavior.</span></div></div>}
          {selectedWork && <div className="milestones"><div><small>Created</small><strong>{day(selectedWork.created)}</strong></div><div><small>Accepted</small><strong>{day(selectedWork.accepted)}</strong></div><div><small>Implementation completed</small><strong>{day(selectedWork.completed)}</strong></div><div><small>Plan updated</small><strong>{day(selectedWork.updated)}</strong></div></div>}
          {selectedWork && snapshot.issues.some(issue => issue.workId === selectedWork.id) && <div className={'notice ' + (snapshot.issues.some(issue => issue.workId === selectedWork.id && issue.level === 'error') ? 'error' : 'warning')}><ShieldCheck size={17} /><div><strong>Record health</strong>{snapshot.issues.filter(issue => issue.workId === selectedWork.id).map((issue, index) => <span key={index}>{issue.level === 'error' ? 'Error: ' : 'Note: '}{issue.message}</span>)}</div></div>}
          {selectedWork && <WorkFocus work={selectedWork} />}
          <div className="reading-layout"><aside className="record-panel"><div className="record-panel-heading"><Folder size={16} /><strong>All files</strong><span>{selectedWork?.documents.length ?? 1}</span></div><FileList files={selectedWork?.documents ?? (selectedFile ? [selectedFile] : [])} selected={reading?.path} /></aside><div className="document-pane">{selectedWork && <nav className="document-tabs" aria-label="Main work records">{(['plan', 'ledger'] as const).map(kind => { const file = primaryDocuments(selectedWork)[kind]; return <button key={kind} disabled={!file} className={file?.path === reading?.path ? 'active' : ''} aria-current={file?.path === reading?.path ? 'page' : undefined} onClick={() => file && documentOpen(file)}>{kind === 'plan' ? <ListChecks size={16} /> : <GitCommitHorizontal size={16} />}{kind === 'plan' ? 'Plan' : 'Ledger'}</button>; })}</nav>}{reading ? <Reader key={reading.path} file={reading} snapshot={snapshot} anchor={route.anchor} /> : <Empty title="No retained documents">This work item has no readable records yet.</Empty>}</div></div>
          {selectedWork && <div className="work-history"><h2>Recent recorded activity</h2>{snapshot.history.filter(entry => entry.workIds.includes(selectedWork.id)).slice(0, 6).map(entry => <div className="history-row compact" key={entry.id}><GitCommitHorizontal size={17} /><div><strong>{entry.title}</strong><small>{day(entry.date)} · {entry.id.slice(0, 7)}</small></div></div>)}</div>}
        </> : route.view === 'work' ? <>
          <div className="page-title"><h1>Work</h1><p>Plans, implementation progress, and retained decisions.</p></div>
          <div className="stats-grid"><StatsCard label="Active work" value={work.filter(item => item.location === 'active').length} note="Planned or awaiting closure" icon={<FolderOpen size={19} />} /><StatsCard label="In progress" value={work.filter(item => item.implementation === 'in_progress' || item.implementation === 'partial').length} note="Based on recorded implementation" icon={<Activity size={19} />} /><StatsCard label="Archived work" value={work.filter(item => item.location === 'archived').length} note="Completed or deliberately closed" icon={<Archive size={19} />} /><StatsCard label="Retained records" value={snapshot.documents.filter(file => repository === 'all' || file.repositories.includes(repository)).length} note="Plans, decisions, and evidence" icon={<FileText size={19} />} /></div>
          <div className="section-heading"><div><h2>Work overview <span className="heading-count">{work.length}</span></h2><p>Implementation status and closure are separate facts.</p></div><div className="segmented">{['active', 'archived', 'all'].map(value => <button key={value} className={location === value ? 'active' : ''} onClick={() => setLocation(value)}>{value === 'all' ? 'All work' : pretty(value)}</button>)}</div></div>
          <div className="search"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search work, repositories, or filenames…" aria-label="Search work" />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}</div>
          <div className="work-grid">{work.filter(item => (location === 'all' || item.location === location) && matches(item)).sort((a, b) => b.id.localeCompare(a.id)).map(item => <WorkCard key={item.id} work={item} />)}</div>
          {!work.some(item => (location === 'all' || item.location === location) && matches(item)) && <Empty title="No matching work">Try another repository, lifecycle filter, or search.</Empty>}
          <div className="workspace-footer"><Folder size={15} /><span>{snapshot.root}</span><small>Refreshed {new Date(snapshot.loadedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</small></div>
        </> : route.view === 'insights' ? <Insights snapshot={snapshot} repository={repository} /> :
        route.view === 'history' ? <>
          <div className="page-title"><h1>Activity</h1><p>Recorded planning commits and changed files.</p></div>
          <div className="history-list">{snapshot.history.filter(entry => repository === 'all' || entry.repositories.includes(repository) || entry.files.some(file => snapshot.documents.some(document => samePath(document.path, file, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths) && document.workId === null && document.repositories.includes(repository)))).map(entry => <div className="history-row" key={entry.id}><span className="history-icon"><GitCommitHorizontal size={19} /></span><div><strong>{entry.title}</strong><small>{day(entry.date)} · {entry.id.slice(0, 7)} · {entry.files.length} changed records</small><div className="changed-files">{entry.files.slice(0, 4).map(file => <button key={file} disabled={!snapshot.documents.some(document => samePath(document.path, file, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths))} onClick={() => { const document = snapshot.documents.find(document => samePath(document.path, file, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths)); if (document) documentOpen(document); }}>{file.split('/').at(-1)}</button>)}{entry.files.length > 4 && <span>+{entry.files.length - 4} more</span>}</div></div></div>)}</div>
          {!snapshot.gitAvailable && <Empty title="History unavailable">The connected folder needs its own readable local Git history.</Empty>}
        </> : <>
          <div className="page-title"><h1>{route.view === 'knowledge' ? 'Knowledge' : 'All records'}</h1><p>{route.view === 'knowledge' ? 'Scoped preferences, decisions, and lessons with their original sources.' : 'Original documents and attachments.'}</p></div>
          <div className="search"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search document titles and paths…" aria-label="Search documents" /></div>
          <div className="document-grid">{snapshot.documents.filter(file => (route.view !== 'knowledge' || file.category === 'knowledge') && (repository === 'all' || file.repositories.includes(repository)) && (file.title + ' ' + file.path).toLowerCase().includes(searchTerm)).map(file => <button className="document-card" key={file.path} onClick={() => documentOpen(file)}><span className="document-icon"><FileText size={20} /></span><strong>{file.title}</strong><small>{file.path}</small><div><Badge>{pretty(file.category)}</Badge><span>{bytes(file.size)}</span></div></button>)}</div>
        </>}
        {snapshot && snapshot.issues.length > 0 && !selectedWork && !selectedFile && <details className="health"><summary><ShieldCheck size={16} />Record health <Badge tone={snapshot.issues.some(issue => issue.level === 'error') ? 'amber' : 'neutral'}>{snapshot.issues.length} notes</Badge></summary><ul>{snapshot.issues.map((issue, index) => <li key={index}>{issue.workId && <button className="text-link" onClick={() => navigate({ work: issue.workId })}>{issue.workId}</button>} {issue.message}</li>)}</ul></details>}
      </main>
    </div>
    </div>
  </div>;
}
