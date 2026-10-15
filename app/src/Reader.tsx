import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Card, EmptyState, Spinner } from '@envsemble/envui';
import { Markdown } from '@envsemble/envui/content';
import { DiagramIcon, FileIcon, FolderOpenIcon, NewWindowIcon } from './icons';
import type { DiagramReference, Document, DocumentContent, Snapshot, Target } from './types';
import { api, fileUrl } from './api';
import { resolveLink } from './links';
import { sectionAnchors } from '@envsemble/atlas-planning/headings';
import { findHeadingId, headingPrefix, rehypeHeadingIds } from './headings';
import { diagramTarget, documentTarget, workTarget } from './targets';
import { bytes, workNumber } from './format';
import { ProvenanceBadge } from './ui';
import { useWorkbench } from './workbenchContext';

/** The diagrams a document links to, refetched when the folder changes. */
export function useReferences(file: Document | undefined, workId: string | null | undefined, enabled = true) {
  const { project, revision } = useWorkbench();
  const [links, setLinks] = useState<DiagramReference[]>([]);
  useEffect(() => {
    if (!file || !enabled || (!workId && file.category !== 'knowledge')) { setLinks([]); return; }
    let current = true;
    api.references(project, workId ?? null, file.path)
      .then(next => { if (current) setLinks(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next); })
      .catch(() => { if (current) setLinks([]); });
    return () => { current = false; };
  }, [project, workId, file?.path, file?.modified, file?.category, enabled, revision]);
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
  const { open } = useWorkbench();
  const show = (card: DiagramCard, element?: string) => open(diagramTarget(card.workId, card.path, element ?? card.elements[0] ?? null), { pin: true });
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
let viewSession = '';
function sessionId() {
  if (!viewSession) viewSession = crypto.randomUUID();
  return viewSession;
}
const rehypePlugins = [rehypeHeadingIds];

export function Reader({ file, snapshot, anchor, toolbar = false, references = [], showWork = false, hideTitle }: {
  file: Document; snapshot: Snapshot; anchor: string | null; toolbar?: boolean; references?: DiagramReference[]; showWork?: boolean;
  /** A level-one heading repeating the page title is omitted. */ hideTitle?: string;
}) {
  const { project, open, notify, remote } = useWorkbench();
  const article = useRef<HTMLElement>(null);
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [error, setError] = useState('');
  function scrollToHeading(target: string) {
    const nodes = Array.from(article.current?.querySelectorAll<HTMLElement>('[id]') ?? []);
    const id = findHeadingId(target, nodes.map(node => node.id));
    // The window scrolls under the sticky tabs; scroll-margin on headings keeps them in view.
    nodes.find(node => node.id === id)?.scrollIntoView();
  }
  useEffect(() => {
    let current = true;
    setError('');
    api.document(project, file.path)
      .then(next => { if (current) setContent(previous => previous && previous.path === next.path && previous.contentHash === next.contentHash ? previous : next); })
      .catch(failure => { if (current) setError(failure.message); });
    return () => { current = false; };
  }, [project, file.path, file.modified]);
  useEffect(() => { setContent(null); }, [file.path]);
  useEffect(() => {
    if (!content) return;
    // View statistics are optional; a failure never interrupts reading.
    api.recordView(project, { id: crypto.randomUUID(), path: content.path, session: sessionId(), contentHash: content.contentHash || null }).catch(() => undefined);
  }, [content]);
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
  // A card under a heading the page did not draw (its text reads differently there) moves to the top.
  useLayoutEffect(() => {
    if (content?.format !== 'markdown') return;
    const ids = Array.from(article.current?.querySelectorAll<HTMLElement>('[id^="' + headingPrefix + '"]') ?? [], node => node.id.slice(headingPrefix.length));
    const anchors = new Set(ids);
    if (drawn?.body !== content.body || anchors.size !== drawn.anchors.size || ids.some(id => !drawn.anchors.has(id))) setDrawn({ body: content.body, anchors });
  });

  function destination(href: string) {
    return resolveLink(href, file.path, snapshot.documents, snapshot.work, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths);
  }
  const components = useMemo(() => {
    const heading = (level: number) => function Heading({ node, children, id }: { node?: unknown; children?: ReactNode; id?: string }) {
      const attached = id?.startsWith(headingPrefix) ? diagramCards.sections.get(id.slice(headingPrefix.length)) : undefined;
      const repeated = level === 1 && hideTitle !== undefined && text(node).trim() === hideTitle.trim();
      return <>{repeated ? <span id={id} /> : createElement('h' + level, { id }, children)}{attached && <DiagramCards items={attached} showWork={showWork} />}</>;
    };
    return {
      ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(level => ['h' + level, heading(level)])),
      a: ({ href = '', children, id }: { href?: string; children?: ReactNode; id?: string }) => {
        const target = destination(href);
        if (target.external) return <a id={id} href={target.external} target="_blank" rel="noreferrer">{children}<NewWindowIcon className="external-icon" /></a>;
        const owner = target.file ? snapshot.work.find(work => work.id === target.file!.workId) : undefined;
        const route: Target | null = target.file ? documentTarget(target.file, owner, target.anchor ?? null)
          : target.work ? workTarget(target.work.id, target.anchor ?? null) : null;
        if (href.startsWith('#') && target.anchor !== undefined) return <a id={id} href="#" onClick={event => { event.preventDefault(); scrollToHeading(target.anchor!); }}>{children}</a>;
        if (route) return <a id={id} href="#" onClick={event => {
          event.preventDefault();
          if (target.file && target.file.path === file.path && target.anchor) { scrollToHeading(target.anchor); return; }
          open(route, { pin: event.ctrlKey || event.metaKey });
        }}>{children}</a>;
        return <span className="outside-reference" title={'Reference unavailable in this viewer: ' + href}>{children}</span>;
      },
      img: ({ src = '', alt = '' }: { src?: unknown; alt?: string }) => {
        const target = destination(typeof src === 'string' ? src : '');
        return target.file ? <img src={fileUrl(project, target.file.path)} alt={alt} /> : <span className="outside-reference">Image: {alt || String(src)}</span>;
      },
    };
  }, [diagramCards, showWork, hideTitle, snapshot, file.path, open, project]);
  const reveal = () => { api.reveal(project, file.path).catch(failure => notify(failure.message, 'warning')); };
  const revealButton = remote ? null : <Button variant="text" startIcon={<FolderOpenIcon />} onClick={reveal} title="Show this file in your file manager">Show in folder</Button>;

  return <article className={'reader' + (toolbar ? ' reader-boxed' : '')} ref={article}>
    {toolbar && <div className="reader-toolbar"><span className="reader-name"><FileIcon /><strong>{file.name}</strong><span className="muted">{bytes(file.size)}</span></span>{revealButton}</div>}
    {error ? <EmptyState icon={<FileIcon />} title="Unable to open this file" description={error} action={revealButton} />
      : !content ? <div className="reader-loading"><Spinner label="Loading the document" /></div>
      : content.format === 'markdown' ? <div className="prose">
        {diagramCards.top.length > 0 && <DiagramCards items={diagramCards.top} showWork={showWork} />}
        <Markdown inlineCode="subtle" rehypePlugins={rehypePlugins} components={components}>{content.body}</Markdown>
      </div>
      : content.format === 'text' ? <pre className="source-text">{content.body}</pre>
      : <div className="attachment">{/\.(png|jpe?g|gif|webp|svg)$/i.test(file.path) ? <img src={fileUrl(project, file.path)} alt={file.title} /> : <EmptyState icon={<FileIcon />} title={file.name} description={bytes(file.size)} action={revealButton} />}</div>}
  </article>;
}
