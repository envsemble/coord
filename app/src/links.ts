import type { Document, Work } from './types';
import { samePath } from '@atlas/planning/paths';

export { samePath };
export type Destination = { file?: Document; work?: Work; anchor?: string; external?: string };
function containedReference(href: string, source: string) {
  // Check before URL resolution can clamp excessive parent traversal to the root.
  const rawPath = href.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '').replace(/[\t\r\n]/g, '').replaceAll('\\', '/').split(/[?#]/, 1)[0].replace(/^http:/i, '').replace(/^\/{2,}[^/]*/, '');
  let depth = rawPath.startsWith('/') ? 0 : source.split('/').length - 1;
  for (const segment of decodeURIComponent(rawPath).split('/')) {
    if (segment === '..') { if (depth === 0) return false; depth--; }
    else if (segment && segment !== '.') depth++;
  }
  return true;
}
export function resolveLink(href: string, source: string, documents: Document[], work: Work[] = [], caseSensitive = true, normalizesUnicode = false): Destination {
  try {
    if (href.startsWith('#')) return { anchor: decodeURIComponent(href.slice(1)) };
    const target = new URL(href, 'http://planning.local/' + source.split('/').map(encodeURIComponent).join('/'));
    if (target.origin !== 'http://planning.local') return ['http:', 'https:'].includes(target.protocol) ? { external: href } : {};
    if (!containedReference(href, source)) return {};
    const relative = decodeURIComponent(target.pathname.slice(1));
    // URL resolution normalizes dot segments; only registered, retained targets are navigable.
    return { file: documents.find(candidate => samePath(candidate.path, relative, caseSensitive, normalizesUnicode)),
      work: work.find(candidate => samePath(candidate.path, relative.replace(/\/$/, ''), caseSensitive, normalizesUnicode)),
      anchor: decodeURIComponent(target.hash.slice(1)) };
  } catch {
    // Hand-written references can contain malformed URLs or percent encodings. Keep their surrounding prose readable.
    return {};
  }
}
