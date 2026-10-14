// Links from planning documents to diagram files. A Markdown link to a `.puml` file attaches that
// diagram to the passage it sits in: under the nearest heading before it, or at the top of the
// document before any heading. A fragment names an element: `diagrams/order.puml#Order`.
import path from 'node:path';

export interface DiagramLink {
  /** The diagram file, as a path in the planning folder. */
  target: string;
  /** The element the link's fragment names, or null. */
  element: string | null;
  /** The text of the heading the link sits under, or null before any heading. */
  section: string | null;
}

/** A heading's text as it reads: links keep their text, emphasis and code marks go. */
export function headingText(source: string) {
  return source.replace(/\]\([^)]*\)/g, '').replace(/[*_`[\]]/g, '').trim();
}

const inline = /!?\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const definition = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]*)>|(\S+))/;

function decode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/**
 * The diagram links in a Markdown document at `documentPath` (a path in the planning folder), in
 * order, each once per section. Links leaving the planning folder, URLs and links inside code are
 * not links to diagrams.
 */
export function diagramLinks(markdown: string, documentPath: string): DiagramLink[] {
  const links: DiagramLink[] = [];
  const seen = new Set<string>();
  const directory = path.posix.dirname(documentPath.replaceAll('\\', '/'));
  let section: string | null = null;
  let fence: string | null = null;
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
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^\s{0,3}(```|~~~)/.exec(line)?.[1];
    if (marker) { fence = fence === marker ? null : fence ?? marker; continue; }
    if (fence) continue;
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) section = headingText(heading[1]) || null;
    const text = line.replace(/`+[^`]*`+/g, '');
    const defined = definition.exec(text);
    if (defined) { add(defined[1] ?? defined[2]); continue; }
    for (const match of text.matchAll(inline)) add(match[1] ?? match[2]);
  }
  return links;
}
