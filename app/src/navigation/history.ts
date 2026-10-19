// Back and forward, as in a browser: what a window showed, in order, and where it is now. An entry is
// a place: the hub (with its project filter), the Projects page, a project's statistics, a work
// item's plan at its heading, a diagram at its element, or a file at its heading. The history lives
// in memory while the window is open.
import { isPage, placeProject, type Place } from './targets';
import type { Target, UiState } from '../types';

/** The entries, which is current, and an id for each (so each can keep where it was left). */
export interface History { entries: Place[]; ids: number[]; index: number; next: number }

/** How many entries a window keeps; the oldest go first. */
export const historyLimit = 50;

export const startHistory = (place: Place): History => ({ entries: [place], ids: [0], index: 0, next: 1 });

/** The current entry's id. */
export const currentEntry = (history: History) => history.ids[history.index];

const parts = (target: Target) => target.kind === 'work' ? [target.work, target.anchor ?? null, target.step ?? null, target.view ?? null]
  : target.kind === 'diagram' ? [target.work, target.path ?? null, target.element ?? null]
  : [target.path, target.anchor ?? null];
/** Whether two places show the same thing; a part left out is the same as one set to null. */
export function samePlace(a: Place, b: Place) {
  if (isPage(a) || isPage(b)) return isPage(a) && isPage(b) && a.page === b.page && placeProject(a) === placeProject(b);
  return a.project === b.project && a.target.kind === b.target.kind && JSON.stringify(parts(a.target)) === JSON.stringify(parts(b.target));
}

/** The window shows something else: it follows the current entry, and what was ahead goes. Showing the same again adds nothing. */
export function record(history: History, place: Place): History {
  if (samePlace(history.entries[history.index], place)) return history;
  const entries = [...history.entries.slice(0, history.index + 1), place].slice(-historyLimit);
  const ids = [...history.ids.slice(0, history.index + 1), history.next].slice(-historyLimit);
  return { entries, ids, index: entries.length - 1, next: history.next + 1 };
}

export const canGoBack = (history: History) => history.index > 0;
export const canGoForward = (history: History) => history.index < history.entries.length - 1;

/** One step back (-1) or forward (1): the history there and what to show, or null at that end. */
export function step(history: History, by: -1 | 1): { history: History; place: Place } | null {
  const index = history.index + by;
  if (index < 0 || index >= history.entries.length) return null;
  return { history: { ...history, index }, place: history.entries[index] };
}

type Keys = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;
/** The keys that go back (-1) or forward (1): Alt+← and Alt+→ (⌘[ and ⌘] on macOS), and a keyboard's Back and Forward keys. */
export function keyStep(event: Keys, platform: string): -1 | 1 | null {
  if (event.key === 'BrowserBack') return -1;
  if (event.key === 'BrowserForward') return 1;
  const mac = platform === 'darwin';
  const held = mac ? event.metaKey && !event.altKey : event.altKey && !event.metaKey;
  if (!held || event.ctrlKey || event.shiftKey) return null;
  const keys: Record<string, -1 | 1> = mac ? { '[': -1, ']': 1 } : { ArrowLeft: -1, ArrowRight: 1 };
  return keys[event.key] ?? null;
}
