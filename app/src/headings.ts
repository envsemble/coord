import { slug } from 'github-slugger';
import { headingAnchors } from '@envsemble/atlas-planning/headings';

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
export function findHeadingId(anchor: string, available: Iterable<string>) {
  const ids = new Set(available);
  const normalized = headingSlug(anchor);
  return [anchor, normalized, headingPrefix + normalized].find(id => ids.has(id));
}
