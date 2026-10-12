// Markdown in envUI's style, as the app's reader shows it. Raw HTML is shown as text, never
// rendered, and only files inside the export (or explicit web links) become links or images.
import { createElement, useMemo, type ReactNode } from 'react';
import { slug } from 'github-slugger';
import { Button, Card } from '@envsemble/envui';
import { Markdown as EnvMarkdown } from '@envsemble/envui/content';
import { AccountTree } from '@envsemble/envui/icons/AccountTree';
import { OpenInNew } from '@envsemble/envui/icons/OpenInNew';
import { blobURL, imageType, type ExportFile, type ViewDiagram } from './data.ts';
import { ProvenanceBadge } from './ui.tsx';

// Heading identities mirror the app (app/src/headings.ts), so anchors match between them.
export const headingPrefix = 'planning-heading-';
interface HastNode { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] }
function visit(node: HastNode, action: (node: HastNode) => void) { action(node); for (const child of node.children ?? []) visit(child, action); }
function hastText(node: HastNode): string { return node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(hastText).join(''); }
function rehypeHeadingIds() {
  return (tree: HastNode) => {
    const used = new Set<string>();
    visit(tree, node => {
      if (node.type !== 'element' || !/^h[1-6]$/.test(node.tagName ?? '')) return;
      const base = headingPrefix + (slug(hastText(node)) || 'section');
      let id = base; let suffix = 0;
      while (used.has(id)) id = base + '-' + ++suffix;
      used.add(id);
      node.properties = { ...node.properties, id };
    });
  };
}
const headingPlugins = [rehypeHeadingIds];
export function scrollToHeading(container: HTMLElement | null, anchor: string) {
  const ids = Array.from(container?.querySelectorAll<HTMLElement>('[id]') ?? []);
  const normalized = slug(anchor);
  const target = [anchor, normalized, headingPrefix + normalized].map(id => ids.find(node => node.id === id)).find(Boolean);
  target?.scrollIntoView();
}

/** Strip a leading metadata header, as the app's reader does. */
export function markdownBody(source: string) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  return header ? source.slice(header[0].length) : source;
}

/** Resolve a link from `source` to a file inside the export, keeping its anchor. */
export function resolveExportLink(href: string, source: string, files: Map<string, ExportFile>): { file?: string; anchor?: string; external?: string } {
  try {
    if (href.startsWith('#')) return { anchor: decodeURIComponent(href.slice(1)) };
    const base = 'http://export.local/' + source.split('/').map(encodeURIComponent).join('/');
    const target = new URL(href, base);
    if (target.origin !== 'http://export.local') return ['http:', 'https:'].includes(target.protocol) ? { external: target.href } : {};
    // Refuse references that climb above the work folder rather than letting URL resolution clamp them.
    let depth = source.split('/').length - 1;
    for (const segment of decodeURIComponent(href.split(/[?#]/, 1)[0]).replaceAll('\\', '/').split('/')) {
      if (segment === '..') { if (depth === 0) return {}; depth--; }
      else if (segment && segment !== '.') depth++;
    }
    const relative = decodeURIComponent(target.pathname.slice(1));
    return files.has(relative) ? { file: relative, anchor: target.hash ? decodeURIComponent(target.hash.slice(1)) : undefined } : {};
  } catch { return {}; }
}

interface DiagramCard { handle: string; title: string; diagram: ViewDiagram; elements: { id: string; name: string }[] }
function headingLines(body: string) {
  const lines = new Map<string, number>();
  let fence: string | null = null;
  body.split(/\r?\n/).forEach((line, index) => {
    const marker = /^\s{0,3}(```|~~~)/.exec(line)?.[1];
    if (marker) { fence = fence === marker ? null : fence ?? marker; return; }
    if (fence) return;
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const key = slug(heading[1].replace(/\]\([^)]*\)/g, '').replace(/[*_`[\]]/g, ''));
      if (!lines.has(key)) lines.set(key, index + 1);
    }
  });
  return lines;
}
function DiagramCards({ items, onOpen }: { items: DiagramCard[]; onOpen(handle: string, element?: string): void }) {
  return <div className="diagram-cards">{items.map(card => <Card key={card.handle} className="diagram-card" tone="pane" padding={4}
    heading={<span className="diagram-card-title"><AccountTree className="diagram-card-icon" /><span>{card.title}</span><ProvenanceBadge provenance={card.diagram.provenance} /></span>}
    actions={<Button variant="secondary" onClick={() => onOpen(card.handle)}>Open diagram</Button>}>
    {card.elements.length > 0 && <p className="diagram-card-elements">{card.elements.slice(0, 8).map(element => <button type="button" key={element.id} className="element-chip" title={'Open the diagram at ' + element.name} onClick={() => onOpen(card.handle, element.id)}>{element.name}</button>)}
      {card.elements.length > 8 && <span className="muted">+{card.elements.length - 8}</span>}</p>}
  </Card>)}</div>;
}

function nodeText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const value = node as { type?: string; value?: string; children?: unknown[] };
  return value.type === 'text' ? value.value ?? '' : (value.children ?? []).map(nodeText).join('');
}

export function Markdown({ path, body, files, diagrams, hideTitle, onFile, onAnchor, onDiagram }: {
  path: string; body: string; files: Map<string, ExportFile>; diagrams: ViewDiagram[]; hideTitle?: string;
  onFile(file: string, anchor?: string): void; onAnchor(anchor: string): void; onDiagram(handle: string, element?: string): void;
}) {
  const cards = useMemo(() => {
    const lines = headingLines(body);
    const bySection = new Map<string, Map<string, DiagramCard>>();
    const top = new Map<string, DiagramCard>();
    for (const diagram of diagrams) {
      for (const reference of diagram.references) {
        if (reference.path !== path) continue;
        const key = reference.section ? slug(reference.section) : '';
        const group = key && lines.has(key) ? bySection.get(key) ?? bySection.set(key, new Map()).get(key)! : top;
        const card = group.get(diagram.handle) ?? group.set(diagram.handle, { handle: diagram.handle, title: diagram.title, diagram, elements: [] }).get(diagram.handle)!;
        if (reference.elementId && !card.elements.some(element => element.id === reference.elementId)) card.elements.push({ id: reference.elementId, name: reference.elementName ?? reference.elementId });
      }
    }
    return { lines, sections: new Map([...bySection].map(([key, group]) => [key, [...group.values()]])), top: [...top.values()] };
  }, [body, path, diagrams]);
  const heading = (level: number) => function Heading({ node, children, id }: { node?: unknown; children?: ReactNode; id?: string }) {
    const key = slug(nodeText(node));
    const line = (node as { position?: { start?: { line?: number } } } | undefined)?.position?.start?.line;
    const attached = cards.sections.get(key);
    const repeated = level === 1 && hideTitle !== undefined && nodeText(node).trim() === hideTitle.trim();
    return <>{repeated ? <span id={id} /> : createElement('h' + level, { id }, children)}{attached && (line === undefined || line === cards.lines.get(key)) && <DiagramCards items={attached} onOpen={onDiagram} />}</>;
  };
  const headings = useMemo(() => Object.fromEntries([1, 2, 3, 4, 5, 6].map(level => ['h' + level, heading(level)])), [cards, hideTitle]);
  return <div className="prose">
    {cards.top.length > 0 && <DiagramCards items={cards.top} onOpen={onDiagram} />}
    <EnvMarkdown inlineCode="subtle" rehypePlugins={headingPlugins} components={{
      ...headings,
      a: ({ href = '', children, id }: { href?: string; children?: ReactNode; id?: string }) => {
        const target = resolveExportLink(href, path, files);
        if (target.external) return <a id={id} href={target.external} target="_blank" rel="noreferrer noopener">{children}<OpenInNew className="external-icon" /></a>;
        if (target.file) return <a id={id} href={'#' + new URLSearchParams({ tab: 'files', file: target.file, ...(target.anchor ? { anchor: target.anchor } : {}) })} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); onFile(target.file!, target.anchor);
        }}>{children}</a>;
        if (target.anchor !== undefined) return <a id={id} href={'#'} onClick={event => { event.preventDefault(); onAnchor(target.anchor!); }}>{children}</a>;
        return <span className="outside-reference" title={'Not included in this export: ' + href}>{children}</span>;
      },
      img: ({ src = '', alt = '' }: { src?: unknown; alt?: string }) => {
        const target = resolveExportLink(typeof src === 'string' ? src : '', path, files);
        const file = target.file ? files.get(target.file) : undefined;
        return file && imageType(file.path) ? <img src={blobURL(file, 'view')} alt={alt} /> : <span className="outside-reference">Image: {alt || String(src)}</span>;
      },
    }}>{body}</EnvMarkdown>
  </div>;
}
