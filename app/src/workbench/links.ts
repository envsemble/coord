import type { Document, Work } from '../types';
import { samePath } from '@envsemble/atlas/planning/paths';

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

/**
 * A relative link out of the project's folder into a sibling folder in the Atlas home (projects sit
 * side by side there, so `../../../atlas/active/0013-x/plan.md` from a plan reaches the Atlas
 * project): the sibling's folder name, the path inside it, and the heading. Null for anything else,
 * including a link that climbs above the home's planning folder.
 */
export function siblingReference(href: string, source: string): { folder: string; path: string; anchor: string | null } | null {
  try {
    const hash = href.indexOf('#');
    const raw = (hash < 0 ? href : href.slice(0, hash)).split('?', 1)[0];
    if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('/') || raw.includes('\\')) return null;
    const self = Symbol('project');
    const segments: (string | symbol)[] = [self, ...source.split('/').slice(0, -1)];
    for (const segment of decodeURIComponent(raw).split('/')) {
      if (segment === '..') { if (!segments.length) return null; segments.pop(); }
      else if (segment && segment !== '.') segments.push(segment);
    }
    const [folder, ...rest] = segments;
    if (typeof folder !== 'string' || !rest.length || folder.startsWith('.')) return null;
    return { folder, path: rest.join('/'), anchor: hash < 0 ? null : decodeURIComponent(href.slice(hash + 1)) || null };
  } catch { return null; }
}

/** Split a project's path, from this computer or another, into its parent folder and its name. */
function splitFolder(folder: string) {
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(folder);
  const parts = folder.split(windows ? /[\\/]+/ : /\/+/).filter(Boolean);
  const key = (value: string) => windows ? value.toLowerCase() : value;
  return { parent: key(parts.slice(0, -1).join('/')), name: key(parts.at(-1) ?? ''), key };
}
/** The folder ID of the project listed in a sibling folder `name` of the given project's folder, if there is one. */
export function siblingProject(projects: { folderId: string; path: string }[], project: string, name: string): string | null {
  const own = projects.find(entry => entry.folderId === project);
  if (!own) return null;
  const { parent, key } = splitFolder(own.path);
  return projects.find(entry => entry.folderId !== project && splitFolder(entry.path).parent === parent && splitFolder(entry.path).name === key(name))?.folderId ?? null;
}
