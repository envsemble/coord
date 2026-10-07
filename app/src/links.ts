import type { Document, Work } from './types';

export type Destination = { file?: Document; work?: Work; anchor?: string; external?: string };
export function resolveLink(href: string, source: string, documents: Document[], work: Work[] = []): Destination {
  try {
    if (href.startsWith('#')) return { anchor: decodeURIComponent(href.slice(1)) };
    const target = new URL(href, 'http://planning.local/' + source);
    if (target.origin !== 'http://planning.local') return ['http:', 'https:'].includes(target.protocol) ? { external: href } : {};
    const relative = decodeURIComponent(target.pathname.slice(1));
    // URL resolution normalizes dot segments; only registered, retained targets are navigable.
    return { file: documents.find(candidate => candidate.path === relative),
      work: work.find(candidate => candidate.path === relative.replace(/\/$/, '')),
      anchor: decodeURIComponent(target.hash.slice(1)) };
  } catch {
    // Legacy references can contain malformed URLs or percent encodings. Keep their surrounding prose readable.
    return {};
  }
}
