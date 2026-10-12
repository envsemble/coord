// Validators for the messages the window sends to the main process and for persisted window
// state. The generic validators and the planning shapes are the host's (packages/host/src/validate.ts);
// this module adds what only the desktop window sends. Unknown object keys are dropped.
import { appCommands, limits, themePreferences, type TabState, type Target, type UiState } from './contract.ts';
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
  if (kind === 'view') return object<Extract<Target, { kind: 'view' }>>({ kind: oneOf(['view'] as const), view: oneOf(['work', 'activity', 'statistics'] as const) })(value, at);
  if (kind === 'work') return object<Extract<Target, { kind: 'work' }>>({
    kind: oneOf(['work'] as const), work: workId, section: optional(nullable(oneOf(['plan', 'ledger', 'diagrams'] as const))),
    diagram: optional(nullable(modelHandle)), element: optional(nullable(string({ max: 512 }))), anchor,
  })(value, at);
  return object<Extract<Target, { kind: 'file' }>>({ kind: oneOf(['file'] as const), path: relativePath, anchor })(value, at);
};
const tab: Validator<TabState> = object<TabState>({ id: string({ min: 1, max: limits.path + 64 }), target, preview: boolean });
export const uiState: Validator<UiState> = (value, at = 'state') => {
  const state = object<UiState>({
    sidebar: object<UiState['sidebar']>({ visible: boolean, width: integer(limits.sidebarMin, limits.sidebarMax), expanded: array(string({ max: limits.path + 64 }), limits.expanded) }),
    tabs: object<UiState['tabs']>({ items: array(tab, limits.tabs), active: nullable(string({ max: limits.path + 64 })) }),
  })(value, at);
  if (state.tabs.active !== null && !state.tabs.items.some(item => item.id === state.tabs.active)) state.tabs.active = state.tabs.items[0]?.id ?? null;
  return state;
};
