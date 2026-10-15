// Editor tabs, VS Code style: a single click opens a preview tab that the next preview replaces;
// a double click, or working in the tab, pins it. Tabs of different projects sit side by side.
import { limits } from '../shared/contract';
import { tabId } from './targets';
import type { TabState, Target, UiState } from './types';

export type TabsState = UiState['tabs'];

export function openTab(state: TabsState, project: string, target: Target, pin: boolean): TabsState {
  const id = tabId(project, target);
  const existing = state.items.find(item => item.id === id);
  if (existing) {
    return { items: state.items.map(item => item.id === id ? { ...item, target, preview: item.preview && !pin } : item), active: id };
  }
  const tab: TabState = { id, project, target, preview: !pin };
  const previewIndex = state.items.findIndex(item => item.preview);
  let items: TabState[];
  if (previewIndex >= 0) {
    items = state.items.map((item, index) => index === previewIndex ? tab : item);
  } else {
    const activeIndex = state.items.findIndex(item => item.id === state.active);
    items = [...state.items];
    items.splice(activeIndex >= 0 ? activeIndex + 1 : items.length, 0, tab);
  }
  while (items.length > limits.tabs) {
    const drop = items.findIndex(item => item.id !== id);
    items.splice(drop, 1);
  }
  return { items, active: id };
}

export function closeTab(state: TabsState, id: string): TabsState {
  const index = state.items.findIndex(item => item.id === id);
  if (index < 0) return state;
  const items = state.items.filter(item => item.id !== id);
  const active = state.active === id ? (items[index] ?? items[index - 1])?.id ?? null : state.active;
  return { items, active };
}

/** Close every tab of the window (the tab rail's Close All Tabs). */
export const closeAllTabs = (): TabsState => ({ items: [], active: null });

export function pinTab(state: TabsState, id: string): TabsState {
  return state.items.some(item => item.id === id && item.preview) ? { ...state, items: state.items.map(item => item.id === id ? { ...item, preview: false } : item) } : state;
}

/** Change what a tab shows within the same item (a heading, a diagram's element); doing so pins it. */
export function retarget(state: TabsState, id: string, project: string, target: Target, pin = true): TabsState {
  if (tabId(project, target) !== id) return openTab(state, project, target, pin);
  return { ...state, items: state.items.map(item => item.id === id ? { ...item, target, preview: item.preview && !pin } : item) };
}

export function activateTab(state: TabsState, id: string): TabsState {
  return state.items.some(item => item.id === id) ? { ...state, active: id } : state;
}

/** Saved tabs with their ids as this version gives them, the active one kept. */
export function keyTabs(state: TabsState): TabsState {
  const active = state.items.find(item => item.id === state.active);
  const items = state.items.map(item => ({ ...item, id: tabId(item.project, item.target) }))
    .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
  return { items, active: active ? tabId(active.project, active.target) : null };
}
