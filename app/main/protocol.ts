// The `atlas:` scheme, registered on each window's own session:
//   atlas://app/…       the built renderer (production), served with a strict CSP
//   atlas://planning/…  a file inside that window's planning folder (images and attachments in documents)
// Nothing else is reachable: other hosts, paths outside the renderer build, hidden files and
// paths outside the planning folder all answer 404/403.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveDocument } from '@envsemble/atlas-planning';

export const scheme = 'atlas';
export const rendererOrigin = 'atlas://app';

/** scheme://host, also for custom schemes (whose WHATWG `origin` is the opaque "null"). */
export function originOf(value: string): string | null {
  try { const url = new URL(value); return url.protocol + '//' + url.host; } catch { return null; }
}

/** The production content security policy. The renderer has no inline script and loads nothing remote. */
export const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' atlas: data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
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
const planningImageTypes = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

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

export function createProtocolHandler(options: { rendererDirectory: string | null; planningRoot: () => string | null }) {
  return async (request: Request): Promise<Response> => {
    let url: URL;
    try { url = new URL(request.url); } catch { return respond(400, 'Bad request'); }
    if (request.method !== 'GET') return respond(405, 'Method not allowed');
    if (url.host === 'app' && options.rendererDirectory) {
      const file = containedFile(options.rendererDirectory, url.pathname);
      if (!file) return respond(404, 'Not found');
      try {
        const body = await readFile(file);
        const headers: Record<string, string> = { 'Content-Type': contentType(file) };
        if (file.endsWith('.html')) headers['Content-Security-Policy'] = contentSecurityPolicy;
        return respond(200, body, headers);
      } catch { return respond(404, 'Not found'); }
    }
    if (url.host === 'planning') {
      const root = options.planningRoot();
      if (!root) return respond(404, 'Not found');
      let relative: string;
      try { relative = decodeURIComponent(url.pathname.replace(/^\/+/, '')); } catch { return respond(400, 'Bad request'); }
      try {
        // Same containment as the reader: inside the folder, no hidden or excluded parts, real files only.
        const file = await resolveDocument(root, relative);
        const extension = path.extname(file).toLowerCase();
        const body = await readFile(file);
        return respond(200, body, {
          'Content-Type': planningImageTypes.has(extension) ? contentType(file) : 'application/octet-stream',
          'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        });
      } catch (error) {
        const status = (error as { status?: number }).status;
        return respond(status === 403 ? 403 : 404, 'Not available');
      }
    }
    return respond(404, 'Not found');
  };
}
