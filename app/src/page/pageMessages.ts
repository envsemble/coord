// What a page's frame and the window that shows it say to each other. The window opens the frame
// (coord://page/page-frame.html, an origin of its own), hands it a MessagePort with `init`, and
// answers its requests there: the frame reaches Coord only through the window, which asks the
// page's host. Only types and small helpers live here, for both sides.

/** The page as the frame knows it. Paths are relative to the planning folder. */
export interface PageInfo {
  /** The page's name: its folder's. */
  name: string;
  /** Its folder. */
  folder: string;
  work: { id: string; title: string; path: string };
  project: { id: string; name: string };
}

export type ColorScheme = 'light' | 'dark';

/** From the window to the frame. */
export type ToFrame =
  | { type: 'build'; code: string; css: string; imports: string[]; build: number }
  | { type: 'theme'; theme: ColorScheme }
  /** Files of the planning folder changed (their paths): a page re-reads what it reads. */
  | { type: 'changed'; paths: string[] }
  | { type: 'answer'; id: number; ok: true; value: unknown }
  | { type: 'answer'; id: number; ok: false; error: string };

/** From the frame to the window. */
export type FromFrame =
  | { type: 'request'; id: number; method: 'read'; params: { path: string } }
  | { type: 'request'; id: number; method: 'write'; params: { path: string; content: string } }
  | { type: 'request'; id: number; method: 'tool'; params: { name: string; input: Record<string, unknown> } }
  | { type: 'request'; id: number; method: 'diagram'; params: { path: string } }
  | { type: 'request'; id: number; method: 'open'; params: { path: string } }
  /** The page failed while running; the frame shows it, and the window notes it. */
  | { type: 'failed'; message: string };

export type Request = Extract<FromFrame, { type: 'request' }>;

/** The first message, posted to the frame's window with the port. */
export interface FrameInit { type: 'coord-page:init'; page: PageInfo; theme: ColorScheme }

/**
 * A path a page gives, as a path in the planning folder: relative to the page's folder, or to the
 * planning folder when it starts with `/`. Null when it leaves the planning folder.
 */
export function planningPath(folder: string, given: string): string | null {
  const parts = (given.startsWith('/') ? given.slice(1) : folder + '/' + given).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!out.length) return null; out.pop(); } else out.push(part);
  }
  return out.length ? out.join('/') : null;
}
