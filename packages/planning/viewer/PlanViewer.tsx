// The read-only plan viewer embedded in every plan export. It reads the inert payload,
// renders Markdown as text-safe React elements and draws diagrams with the shared viewer.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AtlasMark, AtlasPanel, ViewerErrorBoundary } from '@envsemble/atlas-diagrams/react';
import type { PlanningContext, ViewerPayload } from '@envsemble/atlas-diagrams';
import {
  AlertIcon, BookIcon, CheckIcon, ChevronRightIcon, DownloadIcon, FileDirectoryFillIcon, FileIcon, InfoIcon, SearchIcon, TasklistIcon,
  TriangleDownIcon, WorkflowIcon,
} from '@primer/octicons-react';
import { blobURL, imageType, textOf, type ExportFile, type PlanData, type ViewDiagram } from './data.ts';
import { Markdown, markdownBody, scrollToHeading } from './Markdown.tsx';
import { Blankslate, Counter, Dropdown, Label, LedgerSteps, ProvenanceLabel, StateLabel, absoluteDate, bytes, workNumber, workStatus } from './ui.tsx';

type Tab = 'plan' | 'ledger' | 'diagrams' | 'files';
interface Route { tab: Tab | null; file: string | null; anchor: string | null; diagram: string | null; element: string | null }

function readRoute(): Route {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const tab = parameters.get('tab');
  return {
    tab: tab === 'plan' || tab === 'ledger' || tab === 'diagrams' || tab === 'files' ? tab : null,
    file: parameters.get('file'), anchor: parameters.get('anchor'), diagram: parameters.get('diagram'), element: parameters.get('element'),
  };
}
function routeHash(route: Partial<Route>) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(route)) if (value) parameters.set(key, value);
  return '#' + parameters.toString();
}
function useRoute(): [Route, (next: Partial<Route>) => void] {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const changed = () => setRoute(readRoute());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const navigate = useCallback((next: Partial<Route>) => { window.location.hash = routeHash(next); }, []);
  return [route, navigate];
}

const textExtensions = new Set(['txt', 'json', 'yaml', 'yml', 'csv', 'puml', 'mmd', 'mermaid', 'dot', 'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'ps1', 'sh', 'sql', 'log', 'xml', 'toml', 'ini', 'java', 'svg']);
const readableLimit = 4 * 1024 * 1024;
function fileFormat(name: string) {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return extension === 'md' ? 'markdown' : imageType(name) ? 'image' : textExtensions.has(extension) ? 'text' : 'attachment';
}
const baseName = (name: string) => name.split('/').pop() ?? name;

function FileTree({ files, selected, onSelect }: { files: ExportFile[]; selected?: string; onSelect(file: string): void }) {
  const [query, setQuery] = useState('');
  const visible = files.filter(file => file.path.toLowerCase().includes(query.toLowerCase()));
  function branch(prefix: string, depth: number): ReactNode {
    const directories = new Set<string>();
    const leaves: ExportFile[] = [];
    for (const file of visible) {
      if (!file.path.startsWith(prefix)) continue;
      const rest = file.path.slice(prefix.length);
      if (rest.includes('/')) directories.add(rest.split('/')[0]); else leaves.push(file);
    }
    return <>
      {[...directories].sort().map(name => <TreeFolder key={prefix + name} name={name} depth={depth} open={Boolean(query) || Boolean(selected?.startsWith(prefix + name + '/'))}>{branch(prefix + name + '/', depth + 1)}</TreeFolder>)}
      {leaves.map(file => <li key={file.path}><button type="button" className={'tree-item' + (selected === file.path ? ' selected' : '')} style={{ paddingLeft: 8 + depth * 16 }} aria-current={selected === file.path ? 'page' : undefined} title={file.path} onClick={() => onSelect(file.path)}><FileIcon size={16} /><span>{baseName(file.path)}</span></button></li>)}
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

function Reader({ file, data, anchor, toolbar, hideTitle, navigate }: { file: ExportFile; data: PlanData; anchor: string | null; toolbar?: boolean; hideTitle?: string; navigate(route: Partial<Route>): void }) {
  const article = useRef<HTMLElement>(null);
  const format = fileFormat(file.path);
  const text = useMemo(() => format === 'markdown' || format === 'text' ? file.size <= readableLimit ? textOf(file) : null : null, [file, format]);
  useEffect(() => {
    if (anchor) requestAnimationFrame(() => scrollToHeading(article.current, anchor));
    else window.scrollTo(0, 0);
  }, [file.path, anchor]);
  const download = <a className="btn btn-sm" href={blobURL(file, 'download')} download={baseName(file.path)}><DownloadIcon size={16} /> Download</a>;
  return <article className={'reader' + (toolbar ? ' reader-boxed' : '')} ref={article}>
    {toolbar && <div className="reader-toolbar"><span className="reader-name"><FileIcon size={16} /><strong>{baseName(file.path)}</strong><span className="muted">{bytes(file.size)}</span></span><a className="btn btn-sm btn-icon" href={blobURL(file, 'download')} download={baseName(file.path)} aria-label={'Download ' + baseName(file.path)} title="Download"><DownloadIcon size={16} /></a></div>}
    {(format === 'markdown' || format === 'text') && text === null ? <Blankslate icon={<FileIcon size={24} />} title={baseName(file.path)} action={download}>This file is too large to show here ({bytes(file.size)}). Download it instead.</Blankslate>
      : format === 'markdown' ? <Markdown path={file.path} body={markdownBody(text!)} files={data.files} diagrams={data.view.diagrams} hideTitle={hideTitle}
        onFile={(target, targetAnchor) => navigate({ tab: 'files', file: target, anchor: targetAnchor ?? null })}
        onAnchor={target => scrollToHeading(article.current, target)}
        onDiagram={(handle, element) => navigate({ tab: 'diagrams', diagram: handle, element: element ?? null })} />
      : format === 'text' ? <pre className="source-text">{text}</pre>
      : format === 'image' ? <div className="attachment"><img src={blobURL(file, 'view')} alt={baseName(file.path)} /></div>
      : <div className="attachment"><Blankslate icon={<FileIcon size={24} />} title={baseName(file.path)} action={download}>{bytes(file.size)}</Blankslate></div>}
  </article>;
}

function About({ data }: { data: PlanData }) {
  const { work } = data.view;
  const progress = work.progress;
  const dates = ([['Created', work.created], ['Accepted', work.accepted], ['Completed', work.completed], ['Updated', work.updated]] as const).filter(([, value]) => value);
  return <aside className="about" aria-label="About this work">
    {progress && (progress.steps || progress.current || progress.next.length > 0 || progress.blocked) && <section className="about-section">
      <h2>{progress.steps ? 'Progress' : 'Status'}{progress.updated && <span className="muted"> · {absoluteDate(progress.updated)}</span>}</h2>
      {progress.blocked && <p className="about-blocked"><strong>Blocked:</strong> {progress.blocked}</p>}
      {progress.steps ? <LedgerSteps steps={progress.steps} /> : <>
        {progress.current && <p className="about-current">{progress.current}</p>}
        {progress.next.length > 0 && <><h3>Next</h3><ul className="about-next">{progress.next.map((step, index) => <li key={index}>{step}</li>)}</ul></>}
      </>}
    </section>}
    <section className="about-section">
      <h2>About</h2>
      {dates.length > 0 && <dl className="about-dates">{dates.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{absoluteDate(value)}</dd></div>)}</dl>}
      <p className="about-path muted" title={work.path}>{data.payload.source.planningFolder}/{work.path}</p>
    </section>
    <section className="about-section">
      <h2>This export</h2>
      <dl className="about-dates">
        <div><dt>Exported</dt><dd>{absoluteDate(data.payload.exportedAt)}</dd></div>
        <div><dt>Files</dt><dd>{data.payload.files.length} · {bytes(data.payload.files.reduce((sum, file) => sum + file.size, 0))}</dd></div>
        <div><dt>Atlas</dt><dd>{data.payload.atlasVersion}</dd></div>
      </dl>
    </section>
  </aside>;
}

function ModelPicker({ diagrams, handle, onSelect }: { diagrams: ViewDiagram[]; handle: string; onSelect(handle: string): void }) {
  const current = diagrams.find(diagram => diagram.handle === handle);
  return <Dropdown label="Choose a diagram" className="model-picker" buttonClassName="btn model-picker-button" button={<>
    <WorkflowIcon size={16} /><span className="model-picker-title">{current?.title ?? 'Choose a diagram'}</span>{current && <ProvenanceLabel provenance={current.provenance} />}<TriangleDownIcon size={16} />
  </>}>
    {close => <div className="action-menu model-menu" role="menu">
      <div className="menu-title">Diagrams</div>
      {diagrams.map(diagram => <button key={diagram.handle} type="button" role="menuitemradio" aria-checked={diagram.handle === handle} className="menu-item menu-item-rich" onClick={() => { onSelect(diagram.handle); close(); }}>
        <span className="menu-check">{diagram.handle === handle && <CheckIcon size={16} />}</span>
        <span className="menu-text">
          <span className="menu-item-heading"><strong>{diagram.title}</strong></span>
          {diagram.provenance.detail && <span className="menu-description">{diagram.provenance.detail}</span>}
          {diagram.explains.slice(0, 3).map((item, index) => <span key={index} className="menu-description">Explains {item.section ? item.path + ' › ' + item.section : item.path}</span>)}
        </span>
      </button>)}
    </div>}
  </Dropdown>;
}

function Diagrams({ data, route, navigate }: { data: PlanData; route: Route; navigate(route: Partial<Route>): void }) {
  const diagrams = data.view.diagrams;
  const section = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState('');
  const handle = diagrams.some(diagram => diagram.handle === route.diagram) ? route.diagram! : diagrams.find(diagram => diagram.payload)?.handle ?? diagrams[0]?.handle ?? '';
  const current = diagrams.find(diagram => diagram.handle === handle);
  useLayoutEffect(() => {
    const element = section.current;
    if (!element) return;
    const measure = () => { if (!element.classList.contains('fullscreen')) element.style.setProperty('--diagram-top', Math.max(0, element.getBoundingClientRect().top + window.scrollY) + 'px'); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) setFullscreen(false); };
    window.addEventListener('keydown', key);
    document.body.classList.add('has-fullscreen');
    return () => { window.removeEventListener('keydown', key); document.body.classList.remove('has-fullscreen'); };
  }, [fullscreen]);
  const onReference = useCallback((record: PlanningContext['records'][number]) => {
    const target = typeof record.path === 'string' ? record.path.replaceAll('\\', '/').split('#', 1)[0].split('/').reduce<string[] | null>((parts, segment) => {
      if (!parts || !segment || segment === '.') return parts;
      if (segment === '..') return parts.length ? parts.slice(0, -1) : null;
      return [...parts, segment];
    }, [])?.join('/') : undefined;
    if (!target || !data.files.has(target)) { setNotice('This passage is not included in this export.'); return; }
    setFullscreen(false);
    navigate({ tab: 'files', file: target, anchor: typeof record.section === 'string' ? record.section : null });
  }, [data.files, navigate]);
  const picker = diagrams.length ? <ModelPicker diagrams={diagrams} handle={handle} onSelect={next => navigate({ tab: 'diagrams', diagram: next })} /> : null;
  return <section ref={section} className={'diagrams' + (fullscreen ? ' fullscreen' : '')} aria-label="Work diagrams">
    <div className="diagrams-canvas">
      {current?.payload ? <ViewerErrorBoundary key={handle} resetKey={handle}>
        <AtlasPanel payload={current.payload as ViewerPayload} theme="dark" focus={route.element ? { kind: 'node', id: route.element } : undefined} onReference={onReference}
          leading={picker} fullscreen={fullscreen} onFullscreenChange={setFullscreen} />
      </ViewerErrorBoundary>
      : <>
        {picker && <div className="diagrams-island">{picker}</div>}
        <div className="diagrams-state">{current ? <Blankslate icon={<AlertIcon size={24} />} title="This diagram cannot be shown">{current.error}</Blankslate>
          : <Blankslate icon={<WorkflowIcon size={24} />} title="No diagrams">This work item has no diagrams.</Blankslate>}</div>
      </>}
      {notice && <div className="diagrams-notices" role="status"><div className="flash flash-warning">{notice}</div></div>}
    </div>
  </section>;
}

export function PlanViewer({ data }: { data: PlanData }) {
  const [route, navigate] = useRoute();
  const { view, payload } = data;
  const plan = view.plan ? data.files.get(view.plan) : undefined;
  const ledger = view.ledger ? data.files.get(view.ledger) : undefined;
  const listed = payload.files.filter(file => !file.path.startsWith('.atlas/'));
  const tab: Tab = route.tab === 'plan' && plan ? 'plan' : route.tab === 'ledger' && ledger ? 'ledger' : route.tab === 'diagrams' || route.tab === 'files' ? route.tab : route.file ? 'files' : plan ? 'plan' : ledger ? 'ledger' : 'files';
  const selected = tab === 'files' ? (route.file ? data.files.get(route.file) : undefined) ?? listed.find(file => file !== plan && file !== ledger) ?? listed[0] : undefined;
  const reading = tab === 'plan' ? plan : tab === 'ledger' ? ledger : selected;
  useEffect(() => { document.title = view.work.title + ' | Atlas plan'; }, [view.work.title]);
  const tabs: { id: Tab; label: string; icon: ReactNode; count?: number; hidden?: boolean }[] = [
    { id: 'plan', label: 'Plan', icon: <TasklistIcon size={16} />, hidden: !plan },
    { id: 'ledger', label: 'Ledger', icon: <BookIcon size={16} />, hidden: !ledger },
    { id: 'diagrams', label: 'Diagrams', icon: <WorkflowIcon size={16} />, count: view.diagrams.length },
    { id: 'files', label: 'Files', icon: <FileIcon size={16} />, count: listed.length },
  ];
  return <main className="content plan-export">
    <div className={'work-page tab-' + tab}>
      <div className="flash export-banner" role="note"><InfoIcon size={16} /><div>
        <p><strong>Read-only plan export</strong> of {payload.source.workId} from <code>{payload.source.planningFolder}</code>, exported {absoluteDate(payload.exportedAt)} with Atlas {payload.atlasVersion}.</p>
        <p>To continue this work, import the file into a planning folder: <code>atlas plan import &lt;file&gt;</code></p>
      </div><span className="export-mark"><AtlasMark size={20} label="Atlas" /></span></div>
      <nav className="breadcrumb" aria-label="Breadcrumb"><ol><li><span>{payload.source.planningFolder}</span></li><li><span aria-current="page">{workNumber(view.work.id)}</span></li></ol></nav>
      <header className="work-header">
        <h1>{view.work.title}</h1>
        <div className="work-header-meta">
          <StateLabel status={workStatus(view.work)} />
          {view.work.location === 'archive' && <Label tone="attention">Archived</Label>}
          {view.work.repositories.map(repository => <Label key={repository.id} tone="muted" title={repository.name}>{repository.id}</Label>)}
        </div>
      </header>
      <nav className="underline-nav" aria-label="Work sections">
        {tabs.filter(item => !item.hidden).map(item => <a key={item.id} href={routeHash({ tab: item.id })} className={tab === item.id ? 'selected' : ''} aria-current={tab === item.id ? 'page' : undefined}>
          {item.icon}<span>{item.label}</span>{item.count !== undefined && item.count > 0 && <Counter>{item.count}</Counter>}
        </a>)}
      </nav>
      {tab === 'diagrams' ? <Diagrams data={data} route={route} navigate={navigate} />
        : <div className="work-layout">
          <div className="work-main">
            {tab === 'files' ? <div className="files-tab">
              <FileTree files={listed} selected={selected?.path} onSelect={file => navigate({ tab: 'files', file })} />
              {selected ? <Reader key={selected.path} file={selected} data={data} anchor={route.anchor} toolbar navigate={navigate} /> : <div className="box"><p className="muted tree-empty">No files.</p></div>}
            </div>
            : reading ? <Reader key={reading.path} file={reading} data={data} anchor={route.anchor} hideTitle={view.work.title} navigate={navigate} /> : null}
          </div>
          <About data={data} />
        </div>}
    </div>
  </main>;
}

export function ExportError({ message }: { message: string }) {
  return <main className="content plan-export"><Blankslate icon={<AlertIcon size={24} />} title="This plan export cannot be shown">{message}</Blankslate></main>;
}
