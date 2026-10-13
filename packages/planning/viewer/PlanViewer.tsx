// The read-only plan viewer embedded in every plan export. It reads the inert payload,
// renders Markdown as text-safe React elements and draws diagrams with the shared viewer.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AtlasMark, AtlasPanel, ViewerErrorBoundary } from '@envsemble/atlas-diagrams/react';
import type { PlanningContext, ViewerPayload } from '@envsemble/atlas-diagrams';
import {
  Badge, Breadcrumbs, Button, Counter, EmptyState, Menu, MenuGroup, MenuRadioGroup, MenuRadioItem, Notice, SearchField, Surface, Tabs, Text, ThemeToggle, Tree,
  useThemePreference, type TreeItem,
} from '@envsemble/envui';
import { Code } from '@envsemble/envui/content';
import { AccountTree } from '@envsemble/envui/icons/AccountTree';
import { Checklist } from '@envsemble/envui/icons/Checklist';
import { Description } from '@envsemble/envui/icons/Description';
import { Download } from '@envsemble/envui/icons/Download';
import { Error as ErrorIcon } from '@envsemble/envui/icons/Error';
import { ExpandMore } from '@envsemble/envui/icons/ExpandMore';
import { Folder } from '@envsemble/envui/icons/Folder';
import { FolderOpen } from '@envsemble/envui/icons/FolderOpen';
import { MenuBook } from '@envsemble/envui/icons/MenuBook';
import { blobURL, imageType, textOf, type ExportFile, type PlanData, type ViewDiagram } from './data.ts';
import { Markdown, markdownBody, scrollToHeading } from './Markdown.tsx';
import { LedgerSteps, ProvenanceBadge, StatusBadge, absoluteDate, bytes, workNumber, workStatus } from './ui.tsx';
import { modelSummary, type ProvenanceKind } from '../src/provenance.ts';

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

type FileRow = TreeItem & { path: string; folder: boolean };
/** The export's files as a tree; folders open on the way to the chosen file, and all of them while searching. */
function FileTree({ files, selected, onSelect }: { files: ExportFile[]; selected?: string; onSelect(file: string): void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // A search shows every match's folders open, apart from those closed during it; clearing it
  // returns to the folders the reader had open.
  const [closedInSearch, setClosedInSearch] = useState<Set<string>>(() => new Set());
  useEffect(() => { if (!query) setClosedInSearch(new Set()); }, [query]);
  const visible = files.filter(file => file.path.toLowerCase().includes(query.toLowerCase()));
  // Folders open once on the way to the chosen file, before it paints; after that they open and
  // close as the reader chooses.
  useLayoutEffect(() => {
    if (!selected) return;
    setOpen(current => {
      const next = new Set(current);
      for (let at = selected.indexOf('/'); at >= 0; at = selected.indexOf('/', at + 1)) next.add(selected.slice(0, at));
      return next.size === current.size ? current : next;
    });
  }, [selected]);
  const rows = useMemo(() => {
    const result: FileRow[] = [];
    const isOpen = (folder: string) => query ? !closedInSearch.has(folder) : open.has(folder);
    function branch(prefix: string, depth: number) {
      const directories = new Set<string>();
      const leaves: ExportFile[] = [];
      for (const file of visible) {
        if (!file.path.startsWith(prefix)) continue;
        const rest = file.path.slice(prefix.length);
        if (rest.includes('/')) directories.add(rest.split('/')[0]); else leaves.push(file);
      }
      for (const name of [...directories].sort()) {
        const folder = prefix + name;
        const expanded = isOpen(folder);
        result.push({ id: 'folder:' + folder, path: folder, folder: true, depth, expandable: true, expanded, label: name, textValue: name, icon: expanded ? <FolderOpen /> : <Folder /> });
        if (expanded) branch(folder + '/', depth + 1);
      }
      for (const file of leaves) result.push({ id: 'file:' + file.path, path: file.path, folder: false, depth, label: baseName(file.path), textValue: baseName(file.path), title: file.path, icon: <Description /> });
    }
    branch('', 0);
    return result;
  }, [visible, query, open, closedInSearch]);
  const toggle = (folder: string, expanded: boolean) => {
    const change = (current: Set<string>, add: boolean) => { const next = new Set(current); if (add) next.add(folder); else next.delete(folder); return next; };
    if (query) setClosedInSearch(current => change(current, !expanded));
    else setOpen(current => change(current, expanded));
  };
  return <div className="file-tree">
    <SearchField label="Go to file" value={query} onValueChange={setQuery} />
    {visible.length ? <Tree<FileRow> className="file-tree-view" items={rows} aria-label="Files" selectedId={selected ? 'file:' + selected : null} density="compact"
      onOpen={item => { if (item.folder) toggle(item.path, !item.expanded); else onSelect(item.path); }}
      onExpandedChange={(item, expanded) => toggle(item.path, expanded)} />
      : <Text tone="muted" className="tree-empty">No matching files.</Text>}
  </div>;
}

function Reader({ file, data, anchor, toolbar, hideTitle, navigate }: { file: ExportFile; data: PlanData; anchor: string | null; toolbar?: boolean; hideTitle?: string; navigate(route: Partial<Route>): void }) {
  const article = useRef<HTMLElement>(null);
  const format = fileFormat(file.path);
  const text = useMemo(() => format === 'markdown' || format === 'text' ? file.size <= readableLimit ? textOf(file) : null : null, [file, format]);
  useEffect(() => {
    if (anchor) requestAnimationFrame(() => scrollToHeading(article.current, anchor));
    else window.scrollTo(0, 0);
  }, [file.path, anchor]);
  const download = <Button variant="secondary" startIcon={<Download />} href={blobURL(file, 'download')} download={baseName(file.path)}>Download</Button>;
  return <article className={'reader' + (toolbar ? ' reader-boxed' : '')} ref={article}>
    {toolbar && <div className="reader-toolbar"><span className="reader-name"><Description /><strong>{baseName(file.path)}</strong><span className="muted">{bytes(file.size)}</span></span><Button variant="text" iconOnly icon={<Download />} href={blobURL(file, 'download')} download={baseName(file.path)} aria-label={'Download ' + baseName(file.path)} /></div>}
    {(format === 'markdown' || format === 'text') && text === null ? <EmptyState icon={<Description />} title={baseName(file.path)} action={download} description={`This file is too large to show here (${bytes(file.size)}). Download it instead.`} />
      : format === 'markdown' ? <Markdown path={file.path} body={markdownBody(text!)} files={data.files} diagrams={data.view.diagrams} hideTitle={hideTitle}
        onFile={(target, targetAnchor) => navigate({ tab: 'files', file: target, anchor: targetAnchor ?? null })}
        onAnchor={target => scrollToHeading(article.current, target)}
        onDiagram={(handle, element) => navigate({ tab: 'diagrams', diagram: handle, element: element ?? null })} />
      : format === 'text' ? <pre className="source-text">{text}</pre>
      : format === 'image' ? <div className="attachment"><img src={blobURL(file, 'view')} alt={baseName(file.path)} /></div>
      : <div className="attachment"><EmptyState icon={<Description />} title={baseName(file.path)} action={download} description={bytes(file.size)} /></div>}
  </article>;
}

function AboutSection({ title, note, children }: { title: ReactNode; note?: ReactNode; children: ReactNode }) {
  return <section className="about-section">
    <Text as="h2" variant="section-heading" className="about-heading">{title}{note && <span className="about-note"> · {note}</span>}</Text>
    {children}
  </section>;
}
function About({ data }: { data: PlanData }) {
  const { work } = data.view;
  const progress = work.progress;
  const dates = ([['Created', work.created], ['Accepted', work.accepted], ['Completed', work.completed], ['Updated', work.updated]] as const).filter(([, value]) => value);
  return <aside className="about" aria-label="About this work">
    {progress && (progress.steps || progress.current || progress.next.length > 0 || progress.blocked) && <AboutSection title={progress.steps ? 'Progress' : 'Status'} note={progress.updated && absoluteDate(progress.updated)}>
      {progress.blocked && <Notice tone="error" className="about-blocked" title="Blocked">{progress.blocked}</Notice>}
      {progress.steps ? <LedgerSteps steps={progress.steps} /> : <>
        {progress.current && <p className="about-current">{progress.current}</p>}
        {progress.next.length > 0 && <><Text as="h3" variant="caption" className="about-subheading">Next</Text><ul className="about-next">{progress.next.map((step, index) => <li key={index}>{step}</li>)}</ul></>}
      </>}
    </AboutSection>}
    <AboutSection title="About">
      {dates.length > 0 && <dl className="facts">{dates.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{absoluteDate(value)}</dd></div>)}</dl>}
      <p className="about-path" title={work.path}><bdi>{data.payload.source.planningFolder}/{work.path}</bdi></p>
    </AboutSection>
    <AboutSection title="This export">
      <dl className="facts">
        <div><dt>Exported</dt><dd>{absoluteDate(data.payload.exportedAt)}</dd></div>
        <div><dt>Files</dt><dd>{data.payload.files.length} · {bytes(data.payload.files.reduce((sum, file) => sum + file.size, 0))}</dd></div>
        <div><dt>Atlas</dt><dd>{data.payload.atlasVersion}</dd></div>
      </dl>
    </AboutSection>
  </aside>;
}

const pickerGroups: { kind: ProvenanceKind; title: string }[] = [
  { kind: 'generated', title: 'From code and databases' },
  { kind: 'proposal', title: 'Proposals' },
  { kind: 'authored', title: 'Authored' },
  { kind: 'unknown', title: 'Other' },
];
/** One short line under a diagram's title, as the app's picker has it. */
function diagramSummary(diagram: ViewDiagram) {
  const document = (diagram.payload as { model?: { document?: { profile?: string; state?: string; imported?: boolean } } } | null)?.model?.document;
  return modelSummary({ profile: document?.profile ?? '', state: document?.state ?? '', imported: document?.imported ?? diagram.provenance.detail.endsWith('Imported'), provenance: diagram.provenance });
}
/** The app's model picker: a compact menu of the work item's diagrams, by origin. */
function ModelPicker({ diagrams, handle, onSelect }: { diagrams: ViewDiagram[]; handle: string; onSelect(handle: string): void }) {
  const current = diagrams.find(diagram => diagram.handle === handle);
  return <Menu aria-label="Choose a diagram" align="start" density="compact" className="model-menu"
    trigger={<Button variant="secondary" className="model-picker-button" startIcon={<AccountTree />} endIcon={<ExpandMore />}>
      <span className="model-picker-title">{current?.title ?? 'Choose a diagram'}</span>{current && <ProvenanceBadge provenance={current.provenance} />}
    </Button>}>
    <MenuRadioGroup value={handle} onValueChange={onSelect}>
      {pickerGroups.map(group => {
        const items = diagrams.filter(diagram => diagram.provenance.kind === group.kind);
        if (!items.length) return null;
        return <MenuGroup key={group.kind} label={group.title}>
          {items.map(diagram => <MenuRadioItem key={diagram.handle} value={diagram.handle} description={diagramSummary(diagram) || undefined}>{diagram.title}</MenuRadioItem>)}
        </MenuGroup>;
      })}
    </MenuRadioGroup>
  </Menu>;
}

function Diagrams({ data, route, navigate }: { data: PlanData; route: Route; navigate(route: Partial<Route>): void }) {
  const diagrams = data.view.diagrams;
  const { theme } = useThemePreference();
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
        <AtlasPanel payload={current.payload as ViewerPayload} theme={theme} focus={route.element ? { kind: 'node', id: route.element } : undefined} onReference={onReference}
          leading={picker} fullscreen={fullscreen} onFullscreenChange={setFullscreen} />
      </ViewerErrorBoundary>
      : <>
        {picker && <div className="diagrams-island">{picker}</div>}
        <div className="diagrams-state">{current ? <EmptyState icon={<ErrorIcon />} title="This diagram cannot be shown" description={current.error} />
          : <EmptyState icon={<AccountTree />} title="No diagrams" description="This work item has no diagrams." />}</div>
      </>}
      {notice && <div className="diagrams-notices" role="status"><Notice tone="warning">{notice}</Notice></div>}
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
    { id: 'plan', label: 'Plan', icon: <Checklist />, hidden: !plan },
    { id: 'ledger', label: 'Ledger', icon: <MenuBook />, hidden: !ledger },
    { id: 'diagrams', label: 'Diagrams', icon: <AccountTree />, count: view.diagrams.length },
    { id: 'files', label: 'Files', icon: <Description />, count: listed.length },
  ];
  const [heading, setHeading] = useState<HTMLElement | null>(null);
  const headingVisible = useHeadingVisible(heading);
  const body = tab === 'diagrams' ? <Diagrams data={data} route={route} navigate={navigate} />
    : <div className="work-layout">
      <div className="work-main">
        <header className="work-header" ref={setHeading}>
          <Text as="h1" variant="page-heading">{view.work.title}</Text>
          <div className="work-header-meta">
            <StatusBadge status={workStatus(view.work)} />
            {view.work.location === 'archive' && <Badge tone="warning">Archived</Badge>}
            {view.work.repositories.map(repository => <Badge key={repository.id} variant="outline" title={repository.name}>{repository.id}</Badge>)}
          </div>
        </header>
        {tab === 'files' ? <div className="files-tab">
          <FileTree files={listed} selected={selected?.path} onSelect={file => navigate({ tab: 'files', file })} />
          {selected ? <Surface className="file-surface" padding={0}><Reader key={selected.path} file={selected} data={data} anchor={route.anchor} toolbar navigate={navigate} /></Surface> : <Text tone="muted" className="tree-empty">No files.</Text>}
        </div>
        : reading ? <Reader key={reading.path} file={reading} data={data} anchor={route.anchor} hideTitle={view.work.title} navigate={navigate} /> : null}
      </div>
      <About data={data} />
    </div>;
  // The app's work page without its window: the export's notice, then the same bar with the work
  // item's place and sections (and the theme), then the section.
  return <main className="plan-export">
    <Notice tone="info" className="export-banner" icon={<AtlasMark size={20} label="Atlas" />} role="note" title="Read-only plan export">
      {payload.source.workId} from <Code appearance="subtle">{payload.source.planningFolder}</Code>, exported {absoluteDate(payload.exportedAt)} with Atlas {payload.atlasVersion}. To continue this work, import the file into a planning folder: <Code appearance="subtle">atlas plan import &lt;file&gt;</Code>
    </Notice>
    <div className={'work-page section-' + tab}>
      <Tabs className="work-sections" aria-label="Work sections" value={tab} activation="manual" onValueChange={value => { if (value) navigate({ tab: value as Tab }); }} listClassName="work-sections-list"
        renderList={list => <div className="work-bar">
          <div className="work-bar-place">
            <Breadcrumbs className="breadcrumb" items={[{ label: payload.source.planningFolder }, { label: workNumber(view.work.id) }]} />
            <span className="work-bar-title" hidden={headingVisible}>{view.work.title}</span>
          </div>
          {list}
          <ThemeToggle />
        </div>}
        items={tabs.filter(item => !item.hidden).map(item => ({
          value: item.id,
          button: <Button variant="secondary" startIcon={item.icon}>{item.label}{item.count ? <> <Counter value={item.count} /></> : null}</Button>,
          content: item.id === tab ? body : null,
        }))} />
    </div>
  </main>;
}

/** Whether a section's heading shows below the sticky work bar; false while there is none. */
function useHeadingVisible(node: HTMLElement | null) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!node) { setVisible(false); return; }
    setVisible(true);
    const bar = node.closest('.work-page')?.querySelector('.work-bar');
    const covered = Math.ceil(bar?.getBoundingClientRect().height ?? 0);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: `-${covered}px 0px 0px 0px` });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return visible;
}

export function ExportError({ message }: { message: string }) {
  return <main className="plan-export"><EmptyState icon={<ErrorIcon />} headingLevel={1} title="This plan export cannot be shown" description={message} /></main>;
}
