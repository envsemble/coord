import { createContext, createElement, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Button, Card, EmptyState, Spinner } from '@envsemble/envui';
import { Markdown } from '@envsemble/envui/content';
import { ChevronRightIcon, DiagramIcon, FileIcon, FolderOpenIcon, NewWindowIcon } from '../ui/icons';
import type { DiagramReference, Document, DocumentContent, Snapshot, Target } from '../types';
import { api, fileUrl } from '../api';
import { resolveLink, siblingReference } from './links';
import { sectionAnchors } from '@envsemble/atlas/planning/headings';
import { findHeadingId, headingPrefix, rehypeFoldRequests, rehypeHeadingIds } from './headings';
import { diagramTarget, documentTarget, workTarget } from '../navigation/targets';
import { bytes, workNumber } from '../ui/format';
import { ProvenanceBadge } from '../ui/badges';
import { useWindow, useWindowActions } from '../window/windowContext';
import { appSchemes, fromUrl, referenceKey, rehypeReferences, type Found } from './references';
import { PullMark, ReferenceLink, ReferencesContext, useCollectedReferences, useResolvedReferences } from './ReferenceLink';

/** The diagrams a document links to, refetched when the folder's files change. */
export function useReferences(file: Document | undefined, workId: string | null | undefined, enabled = true) {
  const { projectId, files } = useWindow();
  const [links, setLinks] = useState<DiagramReference[]>([]);
  useEffect(() => {
    if (!file || !enabled) { setLinks([]); return; }
    let current = true;
    api.references(projectId, workId ?? null, file.path)
      .then(next => { if (current) setLinks(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next); })
      .catch(() => { if (current) setLinks([]); });
    return () => { current = false; };
  }, [projectId, workId, file?.path, file?.modified, file?.category, enabled, files]);
  return links;
}

interface DiagramCard { key: string; path: string; workId: string; title: string; provenance: DiagramReference['provenance']; elements: string[] }
function cards(references: DiagramReference[]): DiagramCard[] {
  const byDiagram = new Map<string, DiagramCard>();
  for (const reference of references) {
    const key = reference.workId + ':' + reference.path;
    let card = byDiagram.get(key);
    if (!card) { card = { key, path: reference.path, workId: reference.workId, title: reference.title, provenance: reference.provenance, elements: [] }; byDiagram.set(key, card); }
    if (reference.element && !card.elements.includes(reference.element)) card.elements.push(reference.element);
  }
  return [...byDiagram.values()];
}
/** The diagrams the passage links to, under its heading, with the elements its links name. */
function DiagramCards({ items, showWork }: { items: DiagramCard[]; showWork: boolean }) {
  const { open } = useWindowActions();
  const show = (card: DiagramCard, element?: string) => open(diagramTarget(card.workId, card.path, element ?? card.elements[0] ?? null));
  return <div className="diagram-cards">{items.map(card => <Card key={card.key} className="diagram-card" tone="pane" padding={4}
    heading={<span className="diagram-card-title"><DiagramIcon className="diagram-card-icon" /><span>{card.title}</span><ProvenanceBadge provenance={card.provenance} /></span>}
    meta={showWork ? workNumber(card.workId) : undefined}
    actions={<Button variant="secondary" onClick={() => show(card)}>Open diagram</Button>}>
    {card.elements.length > 0 && <p className="diagram-card-elements">{card.elements.slice(0, 8).map(element => <button type="button" key={element} className="element-chip" title={'Open the diagram at ' + element} onClick={() => show(card, element)}>{element}</button>)}
      {card.elements.length > 8 && <span className="muted">+{card.elements.length - 8}</span>}</p>}
  </Card>)}</div>;
}

function text(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const value = node as { type?: string; value?: string; children?: unknown[] };
  return value.type === 'text' ? value.value ?? '' : (value.children ?? []).map(text).join('');
}

/** What the reader's markdown runs on a document's tree. */
export type Plugins = NonNullable<ComponentProps<typeof Markdown>['rehypePlugins']>;
type Components = NonNullable<ComponentProps<typeof Markdown>['components']>;
/**
 * A document's Markdown, parsed and drawn again only when its text, plugins or components change: not
 * each time the page around it draws again (envUI's Markdown parses whenever it is drawn).
 */
const ReaderMarkdown = memo(function ReaderMarkdown({ body, plugins, components }: { body: string; plugins: Plugins; components: Components }) {
  return <Markdown rehypePlugins={plugins} components={components}>{body}</Markdown>;
});
const noReferences: DiagramReference[] = [];
/** An application's link, by its scheme. */
const appLinkPattern = new RegExp('^(?:' + appSchemes.join('|') + '):', 'i');

/** A web link: to the browser, with a PR's state beside it when the host knows it. */
function WebLink({ href, id, children }: { href: string; id?: string; children?: ReactNode }) {
  const { resolved } = useContext(ReferencesContext);
  const input = fromUrl(href);
  const pull = input ? resolved.get(referenceKey(input))?.pull : null;
  return <><a id={id} href={href} target="_blank" rel="noreferrer">{children}<NewWindowIcon className="external-icon" /></a>{pull && <PullMark pull={pull} />}</>;
}

/**
 * The folded sections the reader opened, by their heading's id. The reader keeps them, outside the
 * document's rendering, so they stay open while the document is drawn again as its folder changes.
 */
const FoldsContext = createContext<{ open: ReadonlySet<string>; toggle(id: string): void } | null>(null);
/** A plan's request, folded until its heading is pressed. */
function FoldedSection({ id, children }: { id: string; children?: ReactNode }) {
  const open = useContext(FoldsContext)?.open.has(id) ?? false;
  return <section className="request-fold" data-open={open || undefined}>{children}</section>;
}
/** The heading of a folded section: one press opens or closes it. */
function FoldToggle({ id, children }: { id?: string; children?: ReactNode }) {
  const folds = useContext(FoldsContext);
  if (!folds || !id) return children;
  return <button type="button" className="request-fold-toggle" aria-expanded={folds.open.has(id)} onClick={() => folds.toggle(id)}><ChevronRightIcon className="request-fold-icon" />{children}</button>;
}

export function Reader({ file, snapshot, anchor, references = noReferences, showWork = false, hideTitle, plan = false }: {
  file: Document; snapshot: Snapshot; anchor: string | null; references?: DiagramReference[]; showWork?: boolean;
  /** A level-one heading repeating the page title is omitted. */ hideTitle?: string;
  /** A work item's plan: its request shows folded. */ plan?: boolean;
}) {
  const { projectId, open, notify, remote, sibling, openPath } = useWindowActions();
  // The links read the snapshot as they draw; they are drawn again only when what they link to
  // changes (the documents and work items by path), not when the work's statistics do.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const linkKey = useMemo(() => JSON.stringify([snapshot.documents.map(document => [document.path, document.workId]), snapshot.work.map(work => [work.id, work.path])]), [snapshot.documents, snapshot.work]);
  const article = useRef<HTMLElement>(null);
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [openFolds, setOpenFolds] = useState<ReadonlySet<string>>(new Set());
  const folds = useMemo(() => ({ open: openFolds, toggle: (id: string) => setOpenFolds(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; }) }), [openFolds]);
  const [error, setError] = useState('');
  function scrollToHeading(target: string) {
    const nodes = Array.from(article.current?.querySelectorAll<HTMLElement>('[id]') ?? []);
    const id = findHeadingId(target, nodes.map(node => node.id));
    const heading = nodes.find(node => node.id === id);
    // A heading inside a folded request opens it first.
    const fold = heading?.closest('.request-fold:not([data-open])');
    if (heading && fold && fold.firstElementChild !== heading) {
      fold.querySelector<HTMLButtonElement>('.request-fold-toggle')?.click();
      requestAnimationFrame(() => heading.scrollIntoView());
      return;
    }
    // Scroll-margin on headings keeps them clear of the top of the page.
    heading?.scrollIntoView();
  }
  useEffect(() => {
    let current = true;
    setError('');
    api.document(projectId, file.path)
      .then(next => { if (current) setContent(previous => previous && previous.path === next.path && previous.contentHash === next.contentHash ? previous : next); })
      .catch(failure => { if (current) setError(failure.message); });
    return () => { current = false; };
  }, [projectId, file.path, file.modified]);
  useEffect(() => { setContent(null); }, [file.path]);
  // What the document references becomes links, resolved in one batch once it shows: what its
  // rendering can link, as it renders. A plan's request shows folded.
  const { collected, inputs } = useCollectedReferences();
  const plugins = useMemo((): Plugins => [rehypeHeadingIds, [rehypeReferences, { collected }], ...plan ? [rehypeFoldRequests] : []], [collected, plan]);
  const resolved = useResolvedReferences(content?.format === 'markdown' ? inputs : []);
  const referenceScope = useMemo(() => ({ resolved }), [resolved]);
  const cardCount = references.length;
  useEffect(() => {
    if (content && anchor) requestAnimationFrame(() => scrollToHeading(anchor));
  }, [content, anchor, cardCount]);

  // The headings the page actually drew, once it has drawn them; until then the document's own.
  const [drawn, setDrawn] = useState<{ body: string; anchors: Set<string> } | null>(null);
  const diagramCards = useMemo(() => {
    const sections = new Map<string, DiagramCard[]>();
    const anchors = content?.format !== 'markdown' ? new Set<string>() : drawn?.body === content.body ? drawn.anchors : sectionAnchors(content.body);
    const unplaced: DiagramReference[] = [];
    const bySection = new Map<string, DiagramReference[]>();
    for (const reference of references) {
      // A link before any heading, or under one the document no longer has, shows at the top.
      const anchor = reference.section;
      if (!anchor || !anchors.has(anchor)) { unplaced.push(reference); continue; }
      bySection.set(anchor, [...bySection.get(anchor) ?? [], reference]);
    }
    for (const [anchor, items] of bySection) sections.set(anchor, cards(items));
    return { sections, top: cards(unplaced) };
  }, [references, content, drawn]);

  function destination(href: string) {
    const snapshot = snapshotRef.current;
    return resolveLink(href, file.path, snapshot.documents, snapshot.work, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths);
  }
  const components = useMemo(() => {
    const heading = (level: number) => function Heading({ node, children, id }: { node?: unknown; children?: ReactNode; id?: string }) {
      const attached = id?.startsWith(headingPrefix) ? diagramCards.sections.get(id.slice(headingPrefix.length)) : undefined;
      const repeated = level === 1 && hideTitle !== undefined && text(node).trim() === hideTitle.trim();
      const toggles = Boolean((node as { properties?: { dataFoldToggle?: unknown } } | undefined)?.properties?.dataFoldToggle);
      return <>{repeated ? <span id={id} /> : createElement('h' + level, { id }, toggles ? <FoldToggle id={id}>{children}</FoldToggle> : children)}{attached && <DiagramCards items={attached} showWork={showWork} />}</>;
    };
    return {
      ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(level => ['h' + level, heading(level)])),
      section: ({ node: _node, children, ...props }: ComponentProps<'section'> & { node?: unknown }) =>
        typeof (props as Record<string, unknown>)['data-fold'] === 'string' ? <FoldedSection id={(props as Record<string, string>)['data-fold']}>{children}</FoldedSection> : <section {...props}>{children}</section>,
      a: ({ href = '', children, id, ...props }: { href?: string; children?: ReactNode; id?: string; 'data-reference'?: string }) => {
        // A reference the reader found in the text.
        if (props['data-reference']) return <ReferenceLink found={JSON.parse(props['data-reference']) as Found}>{children}</ReferenceLink>;
        if (appLinkPattern.test(href)) return <ReferenceLink found={{ kind: 'app', url: href }}>{children}</ReferenceLink>;
        const target = destination(href);
        if (target.external) return <WebLink id={id} href={target.external}>{children}</WebLink>;
        const owner = target.file ? snapshotRef.current.work.find(work => work.id === target.file!.workId) : undefined;
        const route: Target | null = target.file ? documentTarget(target.file, owner, target.anchor ?? null)
          : target.work ? workTarget(target.work.id, target.anchor ?? null) : null;
        if (href.startsWith('#') && target.anchor !== undefined) return <a id={id} href="#" onClick={event => { event.preventDefault(); scrollToHeading(target.anchor!); }}>{children}</a>;
        if (route) return <a id={id} href="#" onClick={event => {
          event.preventDefault();
          if (target.file && target.file.path === file.path && target.anchor) { scrollToHeading(target.anchor); return; }
          open(route);
        }}>{children}</a>;
        // A link into a sibling project of the same computer opens there.
        const across = siblingReference(href, file.path);
        const other = across && sibling(across.folder);
        if (across && other) return <a id={id} href="#" onClick={event => { event.preventDefault(); openPath(other, across.path, across.anchor); }}>{children}</a>;
        return <span className="outside-reference" title={'Reference unavailable in this viewer: ' + href}>{children}</span>;
      },
      img: ({ src = '', alt = '' }: { src?: unknown; alt?: string }) => {
        const target = destination(typeof src === 'string' ? src : '');
        return target.file ? <img src={fileUrl(projectId, target.file.path)} alt={alt} /> : <span className="outside-reference">Image: {alt || String(src)}</span>;
      },
    };
  }, [diagramCards, showWork, hideTitle, linkKey, file.path, open, projectId, sibling, openPath]);
  // A card under a heading the page did not draw (its text reads differently there) moves to the top,
  // once the document is drawn (again).
  useLayoutEffect(() => {
    if (content?.format !== 'markdown') return;
    const ids = Array.from(article.current?.querySelectorAll<HTMLElement>('[id^="' + headingPrefix + '"]') ?? [], node => node.id.slice(headingPrefix.length));
    const anchors = new Set(ids);
    if (drawn?.body !== content.body || anchors.size !== drawn.anchors.size || ids.some(id => !drawn.anchors.has(id))) setDrawn({ body: content.body, anchors });
  }, [content, components, plugins]);
  const reveal = () => { api.reveal(projectId, file.path).catch(failure => notify(failure.message, 'warning')); };
  const revealButton = remote ? null : <Button variant="text" startIcon={<FolderOpenIcon />} onClick={reveal} title="Show this file in your file manager">Show in folder</Button>;

  return <article className="reader" ref={article}>
    {error ? <EmptyState icon={<FileIcon />} title="Unable to open this file" description={error} action={revealButton} />
      : !content ? <div className="reader-loading"><Spinner label="Loading the document" /></div>
      : content.format === 'markdown' ? <div className="prose">
        {diagramCards.top.length > 0 && <DiagramCards items={diagramCards.top} showWork={showWork} />}
        <ReferencesContext.Provider value={referenceScope}><FoldsContext.Provider value={folds}><ReaderMarkdown body={content.body} plugins={plugins} components={components} /></FoldsContext.Provider></ReferencesContext.Provider>
      </div>
      : content.format === 'text' ? <pre className="source-text">{content.body}</pre>
      : <div className="attachment">{/\.(png|jpe?g|gif|webp|svg)$/i.test(file.path) ? <img src={fileUrl(projectId, file.path)} alt={file.title} /> : <EmptyState icon={<FileIcon />} title={file.name} description={bytes(file.size)} action={revealButton} />}</div>}
  </article>;
}
