import { useEffect, useState, type ReactNode } from 'react';
import { AlertIcon, ChevronRightIcon, FileDirectoryFillIcon, FileIcon, GitCommitIcon, SearchIcon, TasklistIcon, WorkflowIcon, BookIcon } from './icons';
import type { Document, Snapshot, Work } from './types';
import { samePath } from './links';
import { defaultDocument, primaryDocuments, relativeDocumentPath } from './work';
import { navigate, routeHref, type Route, type WorkTab } from './routes';
import { absoluteDate, relativeDate, shortDate, workNumber } from './format';
import { designNote, workStatus } from './status';
import { Counter, Label, StateLabel } from './ui';
import { Reader, useReferences } from './Reader';
import { AtlasWorkPanel } from './AtlasWorkPanel';

export function Breadcrumb({ items }: { items: { label: ReactNode; href?: string }[] }) {
  return <nav className="breadcrumb" aria-label="Breadcrumb"><ol>{items.map((item, index) => <li key={index}>{item.href ? <a href={item.href}>{item.label}</a> : <span aria-current="page">{item.label}</span>}</li>)}</ol></nav>;
}

/** The tab a route opens: explicit tab, else the tab owning an explicit file, else plan before implementation and ledger after. */
export function workTab(route: Route, work: Work, file: Document | undefined): WorkTab {
  const { plan, ledger } = primaryDocuments(work);
  if (route.tab === 'diagrams' || route.tab === 'files') return route.tab;
  if (route.tab === 'plan' && plan) return 'plan';
  if (route.tab === 'ledger' && ledger) return 'ledger';
  const target = file ?? defaultDocument(work);
  return target && target.path === plan?.path ? 'plan' : target && target.path === ledger?.path ? 'ledger' : 'files';
}

function FileTree({ files, selected, onSelect }: { files: Document[]; selected?: string; onSelect(file: Document): void }) {
  const [query, setQuery] = useState('');
  const visible = files.filter(file => relativeDocumentPath(file).toLowerCase().includes(query.toLowerCase()));
  function branch(prefix: string, depth: number): ReactNode {
    const directories = new Set<string>();
    const leaves: Document[] = [];
    for (const file of visible) {
      const name = relativeDocumentPath(file);
      if (!name.startsWith(prefix)) continue;
      const rest = name.slice(prefix.length);
      if (rest.includes('/')) directories.add(rest.split('/')[0]); else leaves.push(file);
    }
    return <>
      {[...directories].sort().map(name => <TreeFolder key={prefix + name} name={name} depth={depth} open={Boolean(query) || Boolean(selected && visible.some(file => file.path === selected && relativeDocumentPath(file).startsWith(prefix + name + '/')))}>{branch(prefix + name + '/', depth + 1)}</TreeFolder>)}
      {leaves.map(file => <li key={file.path}><button type="button" className={'tree-item' + (selected === file.path ? ' selected' : '')} style={{ paddingLeft: 8 + depth * 16 }} aria-current={selected === file.path ? 'page' : undefined} title={relativeDocumentPath(file)} onClick={() => onSelect(file)}><FileIcon size={16} /><span>{file.name}</span></button></li>)}
    </>;
  }
  return <div className="file-tree">
    <div className="search-box search-sm"><SearchIcon size={16} /><input aria-label="Go to file" placeholder="Go to file" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <ul className="tree" role="tree">{branch('', 0)}</ul>
    {!visible.length && <p className="muted tree-empty">No matching files.</p>}
  </div>;
}
function TreeFolder({ name, depth, open: forced, children }: { name: string; depth: number; open: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(forced);
  useEffect(() => { if (forced) setOpen(true); }, [forced]);
  return <li role="treeitem" aria-expanded={open}>
    <button type="button" className="tree-item tree-folder" style={{ paddingLeft: 8 + depth * 16 }} onClick={() => setOpen(value => !value)}><ChevronRightIcon size={16} className={'tree-chevron' + (open ? ' open' : '')} /><FileDirectoryFillIcon size={16} className="tree-folder-icon" /><span>{name}</span></button>
    {open && <ul role="group">{children}</ul>}
  </li>;
}

function About({ work, snapshot }: { work: Work; snapshot: Snapshot }) {
  const issues = snapshot.issues.filter(issue => issue.workId === work.id);
  const progress = work.progress;
  const hasStatus = Boolean(progress && (progress.current || progress.next.length || progress.blocked));
  const dates = ([['Created', work.created], ['Accepted', work.accepted], ['Completed', work.completed], ['Updated', work.updated]] as const).filter(([, value]) => value);
  const commits = snapshot.history.filter(entry => entry.workIds.includes(work.id)).slice(0, 5);
  return <aside className="about" aria-label="About this work">
    {issues.length > 0 && <div className={'flash ' + (issues.some(issue => issue.level === 'error') ? 'flash-danger' : 'flash-warning')}><AlertIcon size={16} /><div>{issues.map((issue, index) => <p key={index}>{issue.message}</p>)}</div></div>}
    {hasStatus && progress && <section className="about-section">
      <h2>Status{progress.updated && <span className="muted" title={absoluteDate(progress.updated)}> · {relativeDate(progress.updated)}</span>}</h2>
      {progress.blocked && <p className="about-blocked"><strong>Blocked:</strong> {progress.blocked}</p>}
      {progress.current && <p className="about-current">{progress.current}</p>}
      {progress.next.length > 0 && <><h3>Next</h3><ul className="about-next">{progress.next.map((step, index) => <li key={index}>{step}</li>)}</ul></>}
    </section>}
    <section className="about-section">
      <h2>About</h2>
      {dates.length > 0 && <dl className="about-dates">{dates.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={absoluteDate(value)}>{label === 'Updated' ? relativeDate(value) : shortDate(value)}</dd></div>)}</dl>}
      <p className="about-path muted" title={work.path}>{work.path}</p>
    </section>
    {commits.length > 0 && <section className="about-section">
      <h2>Recent activity</h2>
      <ul className="about-commits">{commits.map(entry => <li key={entry.id}><GitCommitIcon size={16} /><div><span className="commit-title">{entry.title}</span><span className="muted"><code>{entry.id.slice(0, 7)}</code> · <span title={absoluteDate(entry.date)}>{relativeDate(entry.date)}</span></span></div></li>)}</ul>
    </section>}
  </aside>;
}

export function WorkPage({ work, snapshot, route }: { work: Work; snapshot: Snapshot; route: Route }) {
  const same = (a: string, b: string) => samePath(a, b, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths);
  const routeFile = route.file ? work.documents.find(file => same(file.path, route.file!)) : undefined;
  const tab = workTab(route, work, routeFile);
  const { plan, ledger } = primaryDocuments(work);
  const status = workStatus(work);
  const note = designNote(work);
  const filesSelection = tab === 'files' ? routeFile ?? work.documents.find(file => file !== plan && file !== ledger) ?? work.documents[0] : undefined;
  const reading = tab === 'plan' ? plan : tab === 'ledger' ? ledger : filesSelection;
  const references = useReferences(reading, work.id, tab !== 'diagrams' && reading?.format === 'markdown');
  const tabs: { id: WorkTab; label: string; icon: ReactNode; count?: number; hidden?: boolean }[] = [
    { id: 'plan', label: 'Plan', icon: <TasklistIcon size={16} />, hidden: !plan },
    { id: 'ledger', label: 'Ledger', icon: <BookIcon size={16} />, hidden: !ledger },
    { id: 'diagrams', label: 'Diagrams', icon: <WorkflowIcon size={16} />, count: work.diagrams ?? 0 },
    { id: 'files', label: 'Files', icon: <FileIcon size={16} />, count: work.documents.length },
  ];
  return <div className={'work-page tab-' + tab}>
    <Breadcrumb items={[{ label: 'Work', href: routeHref({ view: 'work' }) }, { label: workNumber(work.id) }]} />
    <header className="work-header">
      <h1>{work.title}</h1>
      <div className="work-header-meta">
        <StateLabel status={status} />
        {work.location === 'archived' && <Label tone="attention">Archived</Label>}
        {note && <Label>{note}</Label>}
        {work.repositories.map(id => <Label key={id} tone="muted">{id}</Label>)}
      </div>
    </header>
    <nav className="underline-nav" aria-label="Work sections">
      {tabs.filter(item => !item.hidden).map(item => <a key={item.id} href={routeHref({ view: 'work', work: work.id, tab: item.id })} className={tab === item.id ? 'selected' : ''} aria-current={tab === item.id ? 'page' : undefined}>
        {item.icon}<span>{item.label}</span>{item.count !== undefined && item.count > 0 && <Counter>{item.count}</Counter>}
      </a>)}
    </nav>
    {tab === 'diagrams' ? <AtlasWorkPanel key={work.id} work={work} snapshot={snapshot} route={route} navigate={navigate} />
      : <div className="work-layout">
        <div className="work-main">
          {tab === 'files' ? <div className="files-tab">
            <FileTree files={work.documents} selected={filesSelection?.path} onSelect={file => navigate({ view: 'work', work: work.id, tab: 'files', file: file.path })} />
            {filesSelection ? <Reader key={filesSelection.path} file={filesSelection} snapshot={snapshot} anchor={route.anchor} toolbar references={references} /> : <div className="box"><p className="muted tree-empty">No retained files.</p></div>}
          </div>
          : reading ? <Reader key={reading.path} file={reading} snapshot={snapshot} anchor={route.anchor} references={references} hideTitle={work.title} />
          : null}
        </div>
        <About work={work} snapshot={snapshot} />
      </div>}
  </div>;
}

export function FilePage({ file, snapshot, route, viewLabel }: { file: Document; snapshot: Snapshot; route: Route; viewLabel: string }) {
  const references = useReferences(file, null, file.category === 'knowledge' && file.format === 'markdown');
  return <div className="file-page">
    <Breadcrumb items={[{ label: viewLabel, href: routeHref({ view: route.view }) }, { label: file.path }]} />
    <Reader key={file.path} file={file} snapshot={snapshot} anchor={route.anchor} toolbar references={references} showWork />
  </div>;
}
