import { slug } from 'github-slugger';

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
// Allocate on the parsed document, so React render retries cannot advance a counter.
export function rehypeHeadingIds() {
  return (tree: HeadingNode) => {
    const used = new Set<string>();
    visit(tree, node => { if (typeof node.properties?.id === 'string') used.add(node.properties.id); });
    visit(tree, node => {
      if (node.type !== 'element' || !/^h[1-6]$/.test(node.tagName ?? '') || node.properties?.id) return;
      const base = headingPrefix + (headingSlug(text(node)) || 'section');
      let id = base; let suffix = 0;
      while (used.has(id)) id = base + '-' + ++suffix;
      used.add(id);
      node.properties = { ...node.properties, id };
    });
  };
}
export function findHeadingId(anchor: string, available: Iterable<string>) {
  const ids = new Set(available);
  const normalized = headingSlug(anchor);
  return [anchor, normalized, headingPrefix + normalized].find(id => ids.has(id));
}
