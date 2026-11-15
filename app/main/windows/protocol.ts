// The `coord:` scheme, registered on each window's own session:
//   coord://app/…       the built renderer (production), served with a strict CSP
//   coord://page/…      the same files, for the frame a page runs in (page-frame.html), on an origin
//                       of its own and under the page's policy (shared/pagePolicy.ts)
//   coord://planning/<project ID>/…  a file inside the planning folder of a project that window follows (images
//                       and attachments in documents), fetched from its host, which checks containment
// Nothing else is reachable: other hosts, paths outside the renderer build, hidden files and
// paths outside the planning folder all answer 404/403.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pagePolicy } from '../../shared/pagePolicy.ts';

export const scheme = 'coord';
export const rendererOrigin = 'coord://app';
/** The origin pages run on, apart from the window's. */
export const pageOrigin = 'coord://page';
/** The document a page's frame loads. */
export const pageFrame = 'page-frame.html';

/** scheme://host, also for custom schemes (whose WHATWG `origin` is the opaque "null"). */
export function originOf(value: string): string | null {
  try { const url = new URL(value); return url.protocol + '//' + url.host; } catch { return null; }
}

/**
 * Whether an address is the app's own page (`entry`, at any fragment or query): the only place a
 * window may navigate to on its own origin. A relative link resolves to another path there, which
 * would leave the app for a page that does not exist.
 */
export function isEntry(value: string, entry: string): boolean {
  try {
    const url = new URL(value), page = new URL(entry);
    const path = (name: string) => name === '/' ? '/index.html' : name;
    return url.protocol === page.protocol && url.host === page.host && path(url.pathname) === path(page.pathname);
  } catch { return false; }
}

/** Whether an address is a page's frame: coord://page/page-frame.html, or the dev server's in development. */
export function isPageFrameUrl(value: string, devUrl: string | null): boolean {
  try {
    const url = new URL(value);
    if (url.pathname !== '/' + pageFrame) return false;
    return (url.protocol === scheme + ':' && url.host === 'page') || (devUrl !== null && originOf(value) === originOf(devUrl));
  } catch { return false; }
}

/** The production content security policy. The renderer has no inline script and loads nothing remote. */
export const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' coord: data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src coord://page",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.map': 'application/json',
};
function contentType(file: string) { return types[path.extname(file).toLowerCase()] ?? 'application/octet-stream'; }

function respond(status: number, body: string | Buffer, headers: Record<string, string> = {}) {
  return new Response(status === 204 ? null : new Uint8Array(body instanceof Buffer ? body : Buffer.from(body)), { status, headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers } });
}

/** Resolve a request path inside a directory, or null when it would leave it. */
export function containedFile(directory: string, pathname: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const relative = decoded.replace(/^\/+/, '') || 'index.html';
  const resolved = path.resolve(directory, relative);
  const inside = path.relative(directory, resolved);
  return inside && !inside.startsWith('..') && !path.isAbsolute(inside) ? resolved : null;
}

export function createProtocolHandler(options: { rendererDirectory: string | null; planningFile: (projectId: string, relative: string) => Promise<Response> | null }) {
  return async (request: Request): Promise<Response> => {
    let url: URL;
    try { url = new URL(request.url); } catch { return respond(400, 'Bad request'); }
    if (request.method !== 'GET') return respond(405, 'Method not allowed');
    if ((url.host === 'app' || url.host === 'page') && options.rendererDirectory) {
      const file = containedFile(options.rendererDirectory, url.pathname);
      if (!file) return respond(404, 'Not found');
      // The page origin serves only the frame and what it loads; the window's page is the app's.
      const frame = url.host === 'page';
      if (file.endsWith('.html') && (path.basename(file) === pageFrame) !== frame) return respond(404, 'Not found');
      try {
        const body = await readFile(file);
        const headers: Record<string, string> = { 'Content-Type': contentType(file) };
        if (file.endsWith('.html')) headers['Content-Security-Policy'] = frame ? pagePolicy() : contentSecurityPolicy;
        return respond(200, body, headers);
      } catch { return respond(404, 'Not found'); }
    }
    if (url.host === 'planning') {
      let relative: string;
      try { relative = decodeURIComponent(url.pathname.replace(/^\/+/, '')); } catch { return respond(400, 'Bad request'); }
      // A path that steps out of the folder is refused here; the host also resolves every path
      // inside the folder (no hidden or excluded parts, real files only).
      if (relative.split('/').some(segment => segment === '..' || segment === '.') || /[\\\0]/.test(relative)) return respond(403, 'Not available');
      const [projectId, ...rest] = relative.split('/');
      const pending = rest.length ? options.planningFile(projectId, rest.join('/')) : null;
      if (!pending) return respond(404, 'Not found');
      try {
        const answer = await pending;
        if (!answer.ok) return respond(answer.status === 403 ? 403 : 404, 'Not available');
        const type = answer.headers.get('content-type') ?? 'application/octet-stream';
        return respond(200, Buffer.from(await answer.arrayBuffer()), {
          'Content-Type': /^image\/(?:png|jpeg|gif|webp|svg\+xml)$/.test(type) ? type : 'application/octet-stream',
          'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        });
      } catch { return respond(404, 'Not available'); }
    }
    return respond(404, 'Not found');
  };
}
