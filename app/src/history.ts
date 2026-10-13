// Back and forward, as in a browser: what a window showed, in order, and where it is now. An entry is
// a page (Work, Activity, Statistics) or what a tab showed: a work item at its section, diagram,
// element or heading, or a file at its heading. The history lives in memory while the window shows
// its folder.
import { openTab } from './tabs';
import { viewTarget } from './targets';
import type { Target, UiState } from './types';

export interface History { entries: Target[]; index: number }

/** How many entries a window keeps; the oldest go first. */
export const historyLimit = 50;

export const startHistory = (target: Target): History => ({ entries: [target], index: 0 });

const parts = (target: Target) => target.kind === 'view' ? [target.view]
  : target.kind === 'work' ? [target.work, target.section ?? null, target.diagram ?? null, target.element ?? null, target.anchor ?? null]
  : [target.path, target.anchor ?? null];
/** Whether two targets show the same thing; a part left out is the same as one set to null. */
export const sameTarget = (a: Target, b: Target) => a.kind === b.kind && JSON.stringify(parts(a)) === JSON.stringify(parts(b));

/** The window shows something else: it follows the current entry, and what was ahead goes. Showing the same again adds nothing. */
export function record(history: History, target: Target): History {
  if (sameTarget(history.entries[history.index], target)) return history;
  const entries = [...history.entries.slice(0, history.index + 1), target].slice(-historyLimit);
  return { entries, index: entries.length - 1 };
}

export const canGoBack = (history: History) => history.index > 0;
export const canGoForward = (history: History) => history.index < history.entries.length - 1;

/** One step back (-1) or forward (1): the history there and what to show, or null at that end. */
export function step(history: History, by: -1 | 1): { history: History; target: Target } | null {
  const index = history.index + by;
  const target = history.entries[index];
  return target ? { history: { ...history, index }, target } : null;
}

/** What a window shows: its active tab's target, or else its page. */
export function shownTarget(ui: UiState): Target {
  return ui.tabs.items.find(tab => tab.id === ui.tabs.active)?.target ?? viewTarget(ui.page);
}

/**
 * Show an entry again: a page shows over the tabs; a document's tab becomes active, at the entry's
 * place and without being kept (a preview stays one), or opens again as a preview if it was closed.
 */
export function showTarget(ui: UiState, target: Target): UiState {
  if (target.kind === 'view') return { ...ui, page: target.view, tabs: { ...ui.tabs, active: null } };
  return { ...ui, tabs: openTab(ui.tabs, target, false) };
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
