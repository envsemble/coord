// Editor tabs, VS Code style: a single click opens a preview tab that the next preview replaces;
// a double click, or working in the tab, pins it.
import { limits } from '../shared/contract';
import { tabId } from './targets';
import type { TabState, Target, UiState } from './types';

export type TabsState = UiState['tabs'];

export function openTab(state: TabsState, target: Target, pin: boolean): TabsState {
  const id = tabId(target);
  const existing = state.items.find(item => item.id === id);
  if (existing) {
    return { items: state.items.map(item => item.id === id ? { ...item, target, preview: item.preview && !pin } : item), active: id };
  }
  const tab: TabState = { id, target, preview: !pin };
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

export function pinTab(state: TabsState, id: string): TabsState {
  return state.items.some(item => item.id === id && item.preview) ? { ...state, items: state.items.map(item => item.id === id ? { ...item, preview: false } : item) } : state;
}

/** Change what a tab shows within the same item (a section, a diagram, a heading); doing so pins it. */
export function retarget(state: TabsState, id: string, target: Target, pin = true): TabsState {
  if (tabId(target) !== id) return openTab(state, target, pin);
  return { ...state, items: state.items.map(item => item.id === id ? { ...item, target, preview: item.preview && !pin } : item) };
}

export function activateTab(state: TabsState, id: string): TabsState {
  return state.items.some(item => item.id === id) ? { ...state, active: id } : state;
}

export function moveTab(state: TabsState, id: string, offset: number): TabsState {
  const index = state.items.findIndex(item => item.id === id);
  const next = index + offset;
  if (index < 0 || next < 0 || next >= state.items.length) return state;
  const items = [...state.items];
  const [tab] = items.splice(index, 1);
  items.splice(next, 0, tab);
  return { ...state, items };
}
