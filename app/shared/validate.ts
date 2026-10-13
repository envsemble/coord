// Validators for the messages the window sends to the main process and for persisted window
// state. The generic validators and the planning shapes are the host's (packages/host/src/validate.ts);
// this module adds what only the desktop window sends. Unknown object keys are dropped.
import { appCommands, limits, themePreferences, viewNames, type TabState, type Target, type UiState, type ViewName } from './contract.ts';
import { array, boolean, integer, modelHandle, nullable, object, oneOf, optional, relativePath, string, workId, type Validator } from '@envsemble/atlas-host/validate';

export {
  ValidationError, absolutePath, argumentsOf, array, boolean, folderId, integer, ipAddress, modelHandle, nullable, object, oneOf, optional, pairingCode,
  port, relativePath, string, token, viewEvent, workId, type Validator,
} from '@envsemble/atlas-host/validate';

export const command = oneOf(appCommands);
export const themePreference = oneOf(themePreferences);
export const url = string({ min: 1, max: 4096 });

const anchor = optional(nullable(string({ max: 512 })));
export const target: Validator<Target> = (value, at = 'target') => {
  const kind = object({ kind: oneOf(['view', 'work', 'file'] as const) })(value, at).kind;
  if (kind === 'view') return object<Extract<Target, { kind: 'view' }>>({ kind: oneOf(['view'] as const), view: oneOf(viewNames) })(value, at);
  if (kind === 'work') return object<Extract<Target, { kind: 'work' }>>({
    kind: oneOf(['work'] as const), work: workId, section: optional(nullable(oneOf(['plan', 'ledger', 'diagrams'] as const))),
    diagram: optional(nullable(modelHandle)), element: optional(nullable(string({ max: 512 }))), anchor,
  })(value, at);
  return object<Extract<Target, { kind: 'file' }>>({ kind: oneOf(['file'] as const), path: relativePath, anchor })(value, at);
};
const tab: Validator<TabState> = object<TabState>({ id: string({ min: 1, max: limits.path + 64 }), target, preview: boolean });
/**
 * A window's saved layout. Layouts saved before the views became pages keep them as tabs: those tabs
 * go, and an active one becomes the page.
 */
export const uiState: Validator<UiState> = (value, at = 'state') => {
  const saved = object<Omit<UiState, 'page'> & { page?: ViewName }>({
    sidebar: object<UiState['sidebar']>({ visible: boolean, width: integer(limits.sidebarMin, limits.sidebarMax), expanded: array(string({ max: limits.path + 64 }), limits.expanded) }),
    tabs: object<UiState['tabs']>({ items: array(tab, limits.tabs), active: nullable(string({ max: limits.path + 64 })) }),
    page: optional(oneOf(viewNames)),
  })(value, at);
  const activeTab = saved.tabs.items.find(item => item.id === saved.tabs.active);
  const items = saved.tabs.items.filter(item => item.target.kind !== 'view');
  const page = activeTab?.target.kind === 'view' ? activeTab.target.view : saved.page ?? 'work';
  // No active tab shows the page; a dangling one falls back to the first document.
  const active = saved.tabs.active === null || activeTab?.target.kind === 'view' ? null : activeTab?.id ?? items[0]?.id ?? null;
  return { sidebar: saved.sidebar, tabs: { items, active }, page };
};
