import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileDirectoryIcon, FileIcon, LinkExternalIcon, WorkflowIcon } from './icons';
import type { Document, DocumentContent, ModelReference, Snapshot, Target } from './types';
import { api, fileUrl } from './api';
import { resolveLink } from './links';
import { findHeadingId, headingSlug, rehypeHeadingIds } from './headings';
import { documentTarget, workTarget } from './targets';
import { bytes, workNumber } from './format';
import { Blankslate, ProvenanceLabel, Spinner } from './ui';
import { useWorkbench } from './workbenchContext';

/** Diagrams that reference a document, refetched when the folder changes. */
export function useReferences(file: Document | undefined, workId: string | null | undefined, enabled = true) {
  const { revision } = useWorkbench();
  const [links, setLinks] = useState<ModelReference[]>([]);
  useEffect(() => {
    if (!file || !enabled || (!workId && file.category !== 'knowledge')) { setLinks([]); return; }
    let current = true;
    api.references(workId ?? null, file.path)
      .then(next => { if (current) setLinks(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next); })
      .catch(() => { if (current) setLinks([]); });
    return () => { current = false; };
  }, [workId, file?.path, file?.modified, file?.category, enabled, revision]);
  return links;
}

interface DiagramCard { key: string; handle: string; workId: string; title: string; provenance: ModelReference['provenance']; elements: { id: string; name: string }[] }
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
function DiagramCards({ items, showWork }: { items: DiagramCard[]; showWork: boolean }) {
  const { open } = useWorkbench();
  const show = (card: DiagramCard, element?: string) => open(workTarget(card.workId, 'diagrams', { diagram: card.handle, element: element ?? card.elements[0]?.id ?? null }), { pin: true });
  return <div className="diagram-cards">{items.map(card => <div className="diagram-card" key={card.key}>
    <WorkflowIcon className="diagram-card-icon" size={16} />
    <div className="diagram-card-body">
      <div className="diagram-card-title">
        <button type="button" className="link-button" onClick={() => show(card)}>{card.title}</button>
        {showWork && <span className="muted">{workNumber(card.workId)}</span>}
        <ProvenanceLabel provenance={card.provenance} />
      </div>
      {card.elements.length > 0 && <div className="diagram-card-elements">{card.elements.slice(0, 8).map(element => <button type="button" key={element.id} className="element-chip" title={'Open the diagram at ' + element.name} onClick={() => show(card, element.id)}>{element.name}</button>)}{card.elements.length > 8 && <span className="muted">+{card.elements.length - 8}</span>}</div>}
    </div>
    <button type="button" className="btn btn-sm" onClick={() => show(card)}>Open diagram</button>
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

let viewSession = '';
function sessionId() {
  if (!viewSession) viewSession = crypto.randomUUID();
  return viewSession;
}

export function Reader({ file, snapshot, anchor, toolbar = false, references = [], showWork = false, hideTitle }: {
  file: Document; snapshot: Snapshot; anchor: string | null; toolbar?: boolean; references?: ModelReference[]; showWork?: boolean;
  /** A level-one heading repeating the page title is omitted. */ hideTitle?: string;
}) {
  const { open, notify, remote } = useWorkbench();
  const article = useRef<HTMLElement>(null);
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [error, setError] = useState('');
  function scrollToHeading(target: string) {
    const nodes = Array.from(article.current?.querySelectorAll<HTMLElement>('[id]') ?? []);
    const id = findHeadingId(target, nodes.map(node => node.id));
    nodes.find(node => node.id === id)?.scrollIntoView();
  }
  useEffect(() => {
    let current = true;
    setError('');
    api.document(file.path)
      .then(next => { if (current) setContent(previous => previous && previous.path === next.path && previous.contentHash === next.contentHash ? previous : next); })
      .catch(failure => { if (current) setError(failure.message); });
    return () => { current = false; };
  }, [file.path, file.modified]);
  useEffect(() => { setContent(null); }, [file.path]);
  useEffect(() => {
    if (!content) return;
    // View statistics are optional; a failure never interrupts reading.
    api.recordView({ id: crypto.randomUUID(), path: content.path, session: sessionId(), contentHash: content.contentHash || null }).catch(() => undefined);
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
    return <>{repeated ? <span id={id} /> : createElement('h' + level, { id }, children)}{attached && (line === undefined || line === diagramCards.lines.get(slug)) && <DiagramCards items={attached} showWork={showWork} />}</>;
  };
  const headings = useMemo(() => Object.fromEntries([1, 2, 3, 4, 5, 6].map(level => ['h' + level, heading(level)])), [diagramCards, showWork, hideTitle]);
  const reveal = () => { api.reveal(file.path).catch(failure => notify(failure.message, 'warning')); };
  const revealButton = remote ? null : <button type="button" className="btn btn-sm" onClick={reveal} title="Show this file in your file manager"><FileDirectoryIcon size={16} /> Show in folder</button>;

  return <article className={'reader' + (toolbar ? ' reader-boxed' : '')} ref={article}>
    {toolbar && <div className="reader-toolbar"><span className="reader-name"><FileIcon size={16} /><strong>{file.name}</strong><span className="muted">{bytes(file.size)}</span></span>{revealButton}</div>}
    {error ? <Blankslate title="Unable to open this file" action={revealButton}>{error}</Blankslate>
      : !content ? <div className="reader-loading"><Spinner /> Loading…</div>
      : content.format === 'markdown' ? <div className="prose">
        {diagramCards.top.length > 0 && <DiagramCards items={diagramCards.top} showWork={showWork} />}
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHeadingIds]} components={{
          ...headings,
          a: ({ href = '', children, id }) => {
            const target = destination(href);
            if (target.external) return <a id={id} href={target.external} target="_blank" rel="noreferrer">{children}<LinkExternalIcon className="external-icon" size={12} /></a>;
            const owner = target.file ? snapshot.work.find(work => work.id === target.file!.workId) : undefined;
            const route: Target | null = target.file ? documentTarget(target.file, owner, target.anchor ?? null)
              : target.work ? workTarget(target.work.id, null, { anchor: target.anchor ?? null }) : null;
            if (href.startsWith('#') && target.anchor !== undefined) return <a id={id} href="#" onClick={event => { event.preventDefault(); scrollToHeading(target.anchor!); }}>{children}</a>;
            if (route) return <a id={id} href="#" onClick={event => {
              event.preventDefault();
              if (target.file && target.file.path === file.path && target.anchor) { scrollToHeading(target.anchor); return; }
              open(route, { pin: event.ctrlKey || event.metaKey });
            }}>{children}</a>;
            return <span className="outside-reference" title={'Reference unavailable in this viewer: ' + href}>{children}</span>;
          },
          img: ({ src = '', alt = '' }) => {
            const target = destination(typeof src === 'string' ? src : '');
            return target.file ? <img src={fileUrl(target.file.path)} alt={alt} /> : <span className="outside-reference">Image: {alt || String(src)}</span>;
          },
        }}>{content.body}</ReactMarkdown></div>
      : content.format === 'text' ? <pre className="source-text">{content.body}</pre>
      : <div className="attachment">{/\.(png|jpe?g|gif|webp|svg)$/i.test(file.path) ? <img src={fileUrl(file.path)} alt={file.title} /> : <Blankslate icon={<FileIcon size={24} />} title={file.name} action={revealButton}>{bytes(file.size)}</Blankslate>}</div>}
  </article>;
}
