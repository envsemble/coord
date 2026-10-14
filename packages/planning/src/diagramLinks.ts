// Links from planning documents to diagram files. A Markdown link to a `.puml` file attaches that
// diagram to the passage it sits in: under the nearest heading before it, or at the top of the
// document before any heading. A fragment names an element: `diagrams/order.puml#Order`.
import path from 'node:path';
import type { Nodes } from 'mdast';
import { headingAnchors, headingText, parseMarkdown } from './headings.ts';

export interface DiagramLink {
  /** The diagram file, as a path in the planning folder. */
  target: string;
  /** The element the link's fragment names, or null. */
  element: string | null;
  /**
   * The heading the link sits under, by the anchor the readers give it (see headings.ts), or null
   * before any heading.
   */
  section: string | null;
}

function decode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/**
 * The diagram links in a Markdown body at `documentPath` (a path in the planning folder), in order,
 * each once per section. A reference link counts where it is used. Links leaving the planning
 * folder, URLs and anything in code or raw HTML are not links to diagrams.
 */
export function diagramLinks(markdown: string, documentPath: string): DiagramLink[] {
  const links: DiagramLink[] = [];
  const seen = new Set<string>();
  const directory = path.posix.dirname(documentPath.replaceAll('\\', '/'));
  const tree = parseMarkdown(markdown);
  const definitions = new Map<string, string>();
  const anchor = headingAnchors();
  let section: string | null = null;
  const add = (href: string) => {
    if (!href || href.startsWith('#') || href.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    const hash = href.indexOf('#');
    const file = decode((hash < 0 ? href : href.slice(0, hash)).split('?', 1)[0]).replaceAll('\\', '/');
    if (!/\.puml$/i.test(file)) return;
    const target = path.posix.normalize(directory === '.' ? file : directory + '/' + file);
    if (target === '..' || target.startsWith('../') || path.posix.isAbsolute(target)) return;
    const element = hash < 0 ? null : decode(href.slice(hash + 1)) || null;
    const key = [target, element, section].join('\0');
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ target, element, section });
  };
  const walk = (node: Nodes, visit: (node: Nodes) => void) => {
    visit(node);
    if ('children' in node) for (const child of node.children) walk(child, visit);
  };
  // The first definition of a label wins, wherever it is.
  walk(tree, node => { if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url); });
  walk(tree, node => {
    if (node.type === 'heading') section = anchor(headingText(node));
    else if (node.type === 'link' || node.type === 'image') add(node.url);
    else if (node.type === 'linkReference' || node.type === 'imageReference') add(definitions.get(node.identifier) ?? '');
  });
  return links;
}
