import { slug } from 'github-slugger';
import { headingAnchors } from '@envsemble/atlas/planning/headings';

export const headingPrefix = 'planning-heading-';
export function headingSlug(text: string) {
  return slug(text);
}
export interface HeadingNode {
  type: string; tagName?: string; value?: string;
  properties?: Record<string, unknown>; children?: HeadingNode[];
}
function visit(node: HeadingNode, action: (node: HeadingNode) => void) {
  action(node);
  for (const child of node.children ?? []) visit(child, action);
}
function text(node: HeadingNode): string {
  return node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(text).join('');
}
// Allocate on the parsed document, so React render retries cannot advance a counter. Headings are
// numbered as a document's diagram links name them; ids the document already has (footnotes) stay.
export function rehypeHeadingIds() {
  return (tree: HeadingNode) => {
    const anchor = headingAnchors();
    visit(tree, node => {
      if (node.type !== 'element' || !/^h[1-6]$/.test(node.tagName ?? '') || node.properties?.id) return;
      node.properties = { ...node.properties, id: headingPrefix + anchor(text(node)) };
    });
  };
}
const headingLevel = (node: HeadingNode) => node.type === 'element' && /^h[1-6]$/.test(node.tagName ?? '') ? Number(node.tagName![1]) : 0;
/** A heading over the user's own words in a plan: "Request", or "Request (…)" naming who asked and when. */
export const isRequestHeading = (heading: string) => /^request(?:\s*\(.*\))?$/i.test(heading.trim());
/**
 * Fold the sections of a plan that record the request: each heading "Request" (at any level), with
 * everything up to the next heading of its level or above, becomes a section marked `data-fold` with
 * the heading's id, which names it, and its heading is marked `data-fold-toggle`, for the reader to
 * show the section folded with the heading as its toggle.
 */
export function rehypeFoldRequests() {
  return (tree: HeadingNode) => {
    const children = tree.children ?? [];
    const folded: HeadingNode[] = [];
    for (let index = 0; index < children.length; index++) {
      const heading = children[index];
      const level = headingLevel(heading);
      if (!level || !isRequestHeading(text(heading))) { folded.push(heading); continue; }
      heading.properties = { ...heading.properties, dataFoldToggle: true };
      const section = [heading];
      while (index + 1 < children.length && !(headingLevel(children[index + 1]) && headingLevel(children[index + 1]) <= level)) section.push(children[++index]);
      folded.push({ type: 'element', tagName: 'section', properties: { className: ['request-fold'], dataFold: String(heading.properties.id ?? 'request') }, children: section });
    }
    tree.children = folded;
  };
}
export function findHeadingId(anchor: string, available: Iterable<string>) {
  const ids = new Set(available);
  const normalized = headingSlug(anchor);
  return [anchor, normalized, headingPrefix + normalized].find(id => ids.has(id));
}
