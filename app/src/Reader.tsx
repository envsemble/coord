import { apiFetch, rootQuery } from './api';
import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DownloadIcon, FileIcon, LinkExternalIcon, WorkflowIcon } from './icons';
import type { Document, DocumentContent, Snapshot } from './types';
import { resolveLink } from './links';
import { findHeadingId, headingSlug, rehypeHeadingIds } from './headings';
import { documentRoute, navigate, routeHref } from './routes';
import { bytes, workNumber } from './format';
import { pollWhileVisible } from './visiblePoll';
import { Blankslate, ProvenanceLabel, Spinner } from './ui';
import type { Provenance } from './provenance';

export interface ModelReference { handle: string; workId: string; title: string; elementId: string | null; elementName: string | null; label: string; section: string | null; provenance: Provenance }
export const fileUrl = (path: string, download = false) => '/api/file?' + new URLSearchParams({ path, ...(download ? { download: '1' } : {}), ...rootQuery() });
export async function request<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await apiFetch(url, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'The local viewer could not load this record.');
  return body as T;
}

/** Diagrams that reference a document, refreshed while visible. */
export function useReferences(file: Document | undefined, workId: string | null | undefined, enabled = true) {
  const [links, setLinks] = useState<ModelReference[]>([]);
  useEffect(() => {
    setLinks([]);
    if (!file || !enabled || (!workId && file.category !== 'knowledge')) return;
    return pollWhileVisible(async signal => {
      try { const next = await request<ModelReference[]>('/api/atlas/references?' + new URLSearchParams({ ...(workId ? { work: workId } : {}), path: file.path }), signal); if (!signal.aborted) setLinks(current => JSON.stringify(current) === JSON.stringify(next) ? current : next); }
      catch { if (!signal.aborted) setLinks([]); }
      return 2000;
    });
  }, [workId, file?.path, file?.modified, enabled]);
  return links;
}

interface DiagramCard { key: string; handle: string; workId: string; title: string; provenance: Provenance; elements: { id: string; name: string }[] }
function cards(references: ModelReference[]): DiagramCard[] {
  const byModel = new Map<string, DiagramCard>();
  for (const reference of references) {
    const key = reference.workId + ':' + reference.handle;
    let card = byModel.get(key);
    if (!card) { card = { key, handle: reference.handle, workId: reference.workId, title: reference.title, provenance: reference.provenance, elements: [] }; byModel.set(key, card); }
    if (reference.elementId && !card.elements.some(element => element.id === reference.elementId)) card.elements.push({ id: reference.elementId, name: reference.elementName ?? reference.label });
  }
  return [...byModel.values()];
}
function openDiagram(card: DiagramCard, element?: string) {
  navigate({ view: 'work', work: card.workId, tab: 'diagrams', diagram: card.handle, element: element ?? card.elements[0]?.id ?? null });
}
function DiagramCards({ items, showWork }: { items: DiagramCard[]; showWork: boolean }) {
  return <div className="diagram-cards">{items.map(card => <div className="diagram-card" key={card.key}>
    <WorkflowIcon className="diagram-card-icon" size={16} />
    <div className="diagram-card-body">
      <div className="diagram-card-title">
        <button type="button" className="link-button" onClick={() => openDiagram(card)}>{card.title}</button>
        {showWork && <span className="muted">{workNumber(card.workId)}</span>}
        <ProvenanceLabel provenance={card.provenance} />
      </div>
      {card.elements.length > 0 && <div className="diagram-card-elements">{card.elements.slice(0, 8).map(element => <button type="button" key={element.id} className="element-chip" title={'Open the diagram at ' + element.name} onClick={() => openDiagram(card, element.id)}>{element.name}</button>)}{card.elements.length > 8 && <span className="muted">+{card.elements.length - 8}</span>}</div>}
    </div>
    <button type="button" className="btn btn-sm" onClick={() => openDiagram(card)}>Open diagram</button>
  </div>)}</div>;
}

function text(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const value = node as { type?: string; value?: string; children?: unknown[] };
  return value.type === 'text' ? value.value ?? '' : (value.children ?? []).map(text).join('');
}
/** First line of each heading slug in the Markdown source, skipping fenced code. */
function headingLines(body: string) {
  const lines = new Map<string, number>();
  let fence: string | null = null;
  body.split(/\r?\n/).forEach((line, index) => {
    const marker = /^\s{0,3}(```|~~~)/.exec(line)?.[1];
    if (marker) { fence = fence === marker ? null : fence ?? marker; return; }
    if (fence) return;
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const slug = headingSlug(heading[1].replace(/\]\([^)]*\)/g, '').replace(/[*_`[\]]/g, ''));
      if (!lines.has(slug)) lines.set(slug, index + 1);
    }
  });
  return lines;
}

export function Reader({ file, snapshot, anchor, toolbar = false, references = [], showWork = false, hideTitle }: {
  file: Document; snapshot: Snapshot; anchor: string | null; toolbar?: boolean; references?: ModelReference[]; showWork?: boolean;
  /** A level-one heading repeating the page title is omitted. */ hideTitle?: string;
}) {
  const article = useRef<HTMLElement>(null);
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [error, setError] = useState('');
  const [collectionError, setCollectionError] = useState('');
  function scrollToHeading(target: string) {
    const nodes = Array.from(article.current?.querySelectorAll<HTMLElement>('[id]') ?? []);
    const id = findHeadingId(target, nodes.map(node => node.id));
    nodes.find(node => node.id === id)?.scrollIntoView();
  }
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setCollectionError('');
    request<DocumentContent>('/api/document?' + new URLSearchParams({ path: file.path }), controller.signal)
      .then(next => setContent(current => current && current.path === next.path && current.contentHash === next.contentHash ? current : next))
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [file.path, file.modified]);
  useEffect(() => { setContent(null); }, [file.path]);
  useEffect(() => {
    if (!content) return;
    try {
      let session = sessionStorage.getItem('planning-dashboard-session');
      if (!session) { session = crypto.randomUUID(); sessionStorage.setItem('planning-dashboard-session', session); }
      apiFetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), path: content.path, session, contentHash: content.contentHash }) })
        .then(response => { if (!response.ok && response.status !== 503) setCollectionError('This view was not recorded.'); })
        .catch(() => undefined);
    } catch { /* View tracking is optional. */ }
  }, [content]);
  const cardCount = references.length;
  useEffect(() => {
    if (content && anchor) requestAnimationFrame(() => scrollToHeading(anchor));
  }, [content, anchor, cardCount]);

  const diagramCards = useMemo(() => {
    const sections = new Map<string, DiagramCard[]>();
    const lines = content?.format === 'markdown' ? headingLines(content.body) : new Map<string, number>();
    const unplaced: ModelReference[] = [];
    const bySection = new Map<string, ModelReference[]>();
    for (const reference of references) {
      const slug = reference.section ? headingSlug(reference.section) : '';
      if (!slug || !lines.has(slug)) { unplaced.push(reference); continue; }
      bySection.set(slug, [...bySection.get(slug) ?? [], reference]);
    }
    for (const [slug, items] of bySection) sections.set(slug, cards(items));
    return { lines, sections, top: cards(unplaced) };
  }, [references, content]);

  function destination(href: string) {
    return resolveLink(href, file.path, snapshot.documents, snapshot.work, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths);
  }
  const heading = (level: number) => function Heading({ node, children, id }: { node?: unknown; children?: ReactNode; id?: string }) {
    const slug = headingSlug(text(node));
    const line = (node as { position?: { start?: { line?: number } } } | undefined)?.position?.start?.line;
    const attached = diagramCards.sections.get(slug);
    const repeated = level === 1 && hideTitle !== undefined && text(node).trim() === hideTitle.trim();
    return <>{repeated ? <span id={id} /> : createElement('h' + level, { id }, children)}{attached && (line === undefined || line === diagramCards.lines.get(slug)) &&<DiagramCards items={attached} showWork={showWork} />}</>;
  };
  const headings = useMemo(() => Object.fromEntries([1, 2, 3, 4, 5, 6].map(level => ['h' + level, heading(level)])), [diagramCards, showWork, hideTitle]);

  return <article className={'reader' + (toolbar ? ' reader-boxed' : '')} ref={article}>
    {toolbar && <div className="reader-toolbar"><span className="reader-name"><FileIcon size={16} /><strong>{file.name}</strong><span className="muted">{bytes(file.size)}</span></span><a className="btn btn-sm btn-icon" href={fileUrl(file.path, true)} aria-label={'Download ' + file.name} title="Download"><DownloadIcon size={16} /></a></div>}
    {collectionError && <div className="flash flash-warning flash-inline">{collectionError}</div>}
    {error ? <Blankslate title="Unable to open this file" action={<a className="btn btn-sm" href={fileUrl(file.path, true)}>Download</a>}>{error}</Blankslate>
      : !content ? <div className="reader-loading"><Spinner /> Loading…</div>
      : content.format === 'markdown' ? <div className="prose">
        {diagramCards.top.length > 0 && <DiagramCards items={diagramCards.top} showWork={showWork} />}
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHeadingIds]} components={{
          ...headings,
          a: ({ href = '', children, id }) => {
            const target = destination(href);
            if (target.external) return <a id={id} href={target.external} target="_blank" rel="noreferrer">{children}<LinkExternalIcon className="external-icon" size={12} /></a>;
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
            return target.file ? <img src={fileUrl(target.file.path)} alt={alt} /> : <span className="outside-reference">Image: {alt || String(src)}</span>;
          },
        }}>{content.body}</ReactMarkdown></div>
      : content.format === 'text' ? <pre className="source-text">{content.body}</pre>
      : <div className="attachment">{/\.(png|jpe?g|gif|webp|svg)$/i.test(file.path) ? <img src={fileUrl(file.path)} alt={file.title} /> : <Blankslate icon={<FileIcon size={24} />} title={file.name} action={<a className="btn btn-sm" href={fileUrl(file.path, true)}><DownloadIcon size={16} /> Download</a>}>{bytes(file.size)}</Blankslate>}</div>}
  </article>;
}
