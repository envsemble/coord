import { createContext, createElement, memo, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Button, Link, Spinner } from '@envsemble/envui';
import { EmptyState } from '../ui/EmptyState';
import { Markdown } from '@envsemble/envui/markdown';
import { ChevronRightIcon, DiagramIcon, FileIcon, FolderOpenIcon, NewWindowIcon } from '../ui/icons';
import type { DiagramReference, Document, DocumentContent, Snapshot, Target } from '../types';
import { api, fileUrl } from '../api';
import { resolveLink, siblingReference } from './links';
import { findHeadingId, rehypeFoldRequests, rehypeHeadingIds } from './headings';
import { documentTarget, workTarget } from '../navigation/targets';
import { bytes } from '../ui/format';
import { useWindow, useWindowActions } from '../window/windowContext';
import { appSchemes, fromUrl, referenceKey, rehypeReferences, type Found } from './references';
import { PullMark, ReferenceLink, ReferencesContext, useCollectedReferences, useResolvedReferences } from './ReferenceLink';
import { DocumentHeader } from './DocumentHeader';

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

/** The diagrams a document links to, by work item and path: their titles and where they came from, for their links' tooltips. */
function diagramNames(references: DiagramReference[]) {
  const names = new Map<string, { title: string; provenance: string }>();
  for (const reference of references) names.set(reference.workId + ':' + reference.path, { title: reference.title, provenance: reference.provenance.label });
  return names;
}

/**
 * A link to a diagram, inline in the text as the author wrote it: a purple diagram icon before its
 * words, in the accent colour, so it reads as a diagram; its tooltip names the diagram and where it
 * came from.
 */
function DiagramLink({ id, title, onOpen, children }: { id?: string; title: string; onOpen(): void; children?: ReactNode }) {
  return <Link id={id} href="#" underline={false} className="diagram-link" title={title} onClick={event => { event.preventDefault(); onOpen(); }}>
    <DiagramIcon className="diagram-link-icon" />{children}
  </Link>;
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
  return <><Link id={id} href={href} target="_blank" rel="noreferrer">{children}<NewWindowIcon className="external-icon" /></Link>{pull && <PullMark pull={pull} />}</>;
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
  return <Button variant="text" className="request-fold-toggle" aria-expanded={folds.open.has(id)} startIcon={<ChevronRightIcon className="request-fold-icon" />} onClick={() => folds.toggle(id)}>{children}</Button>;
}

export function Reader({ file, snapshot, anchor, references = noReferences, hideTitle, plan = false, showHeader = false }: {
  file: Document; snapshot: Snapshot; anchor: string | null; references?: DiagramReference[];
  /** The file as it is: its metadata header shown as a table above its text. */ showHeader?: boolean;
  /** A level-one heading repeating the page title is omitted. */ hideTitle?: string;
  /** A work item's plan: its request shows folded. */ plan?: boolean;
}) {
  const { projectId, open, notify, remote, sibling, openPath } = useWindowActions();
  // The links read the snapshot as they draw; they are drawn again only when what they link to
  // changes (the documents and work items by path, and the work's plans), not when the work's statistics do.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const linkKey = useMemo(() => JSON.stringify([snapshot.documents.map(document => [document.path, document.workId]), snapshot.work.map(work => [work.id, work.path, work.currentPlan])]), [snapshot.documents, snapshot.work]);
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
  useEffect(() => {
    if (content && anchor) requestAnimationFrame(() => scrollToHeading(anchor));
  }, [content, anchor]);

  const names = useMemo(() => diagramNames(references), [references]);

  function destination(href: string) {
    const snapshot = snapshotRef.current;
    return resolveLink(href, file.path, snapshot.documents, snapshot.work, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths);
  }
  const components = useMemo(() => {
    const heading = (level: number) => function Heading({ node, children, id }: { node?: unknown; children?: ReactNode; id?: string }) {
      const repeated = level === 1 && hideTitle !== undefined && text(node).trim() === hideTitle.trim();
      const toggles = Boolean((node as { properties?: { dataFoldToggle?: unknown } } | undefined)?.properties?.dataFoldToggle);
      return repeated ? <span id={id} /> : createElement('h' + level, { id }, toggles ? <FoldToggle id={id}>{children}</FoldToggle> : children);
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
        if (href.startsWith('#') && target.anchor !== undefined) return <Link id={id} href="#" onClick={event => { event.preventDefault(); scrollToHeading(target.anchor!); }}>{children}</Link>;
        if (route?.kind === 'diagram') {
          const named = names.get(route.work + ':' + route.path);
          const title = (named ? named.title + (named.provenance ? ' · ' + named.provenance : '') : 'Diagram') + (route.element ? ' · ' + route.element : '');
          return <DiagramLink id={id} title={title} onOpen={() => open(route)}>{children}</DiagramLink>;
        }
        if (route) return <Link id={id} href="#" onClick={event => {
          event.preventDefault();
          if (target.file && target.file.path === file.path && target.anchor) { scrollToHeading(target.anchor); return; }
          open(route);
        }}>{children}</Link>;
        // A link into a sibling project of the same computer opens there.
        const across = siblingReference(href, file.path);
        const other = across && sibling(across.folder);
        if (across && other) return <Link id={id} href="#" onClick={event => { event.preventDefault(); openPath(other, across.path, across.anchor); }}>{children}</Link>;
        return <span className="outside-reference" title={'Reference unavailable in this viewer: ' + href}>{children}</span>;
      },
      img: ({ src = '', alt = '' }: { src?: unknown; alt?: string }) => {
        const target = destination(typeof src === 'string' ? src : '');
        // eslint-disable-next-line envui/no-raw-graphics -- a document's own image keeps the size its author gave it, up to the column's width
        return target.file ? <img src={fileUrl(projectId, target.file.path)} alt={alt} /> : <span className="outside-reference">Image: {alt || String(src)}</span>;
      },
    };
  }, [names, hideTitle, linkKey, file.path, open, projectId, sibling, openPath]);
  const reveal = () => { api.reveal(projectId, file.path).catch(failure => notify(failure.message, 'warning')); };
  const revealButton = remote ? null : <Button variant="text" startIcon={<FolderOpenIcon />} onClick={reveal} title="Show this file in your file manager">Show in folder</Button>;

  return <article className="reader" ref={article}>
    {error ? <EmptyState icon={<FileIcon />} title="Unable to open this file" description={error} action={revealButton} />
      : !content ? <div className="reader-loading"><Spinner label="Loading the document" /></div>
      : content.format === 'markdown' ? <div className="prose">
        {showHeader && content.metadata && <DocumentHeader metadata={content.metadata} />}
        <ReferencesContext.Provider value={referenceScope}><FoldsContext.Provider value={folds}><ReaderMarkdown body={content.body} plugins={plugins} components={components} /></FoldsContext.Provider></ReferencesContext.Provider>
      </div>
      : content.format === 'text' ? <pre className="source-text">{content.body}</pre>
      : <div className="attachment">{/\.(png|jpe?g|gif|webp|svg)$/i.test(file.path)
        // eslint-disable-next-line envui/no-raw-graphics -- an image file of the plan shows at its own size, up to the page's width
        ? <img src={fileUrl(projectId, file.path)} alt={file.title} /> : <EmptyState icon={<FileIcon />} title={file.name} description={bytes(file.size)} action={revealButton} />}</div>}
  </article>;
}
