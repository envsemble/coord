// Validators for the messages the window sends to the main process. The generic validators and the
// planning shapes are the host's (packages/host/src/validate.ts); this module adds what only the
// desktop window sends. Unknown object keys are dropped.
import { appCommands, limits, themePreferences, type TabState, type Target, type UiState } from './contract.ts';
import { array, boolean, diagramPath, folderId, integer, nullable, object, oneOf, optional, relativePath, string, workId, type Validator } from '@envsemble/atlas-host/validate';

export {
  ValidationError, absolutePath, argumentsOf, array, boolean, diagramPath, folderId, integer, ipAddress, nullable, object, oneOf, optional, pairingCode,
  port, projectName, relativePath, string, token, viewEvent, workId, type Validator,
} from '@envsemble/atlas-host/validate';

export const command = oneOf(appCommands);
export const themePreference = oneOf(themePreferences);
export const url = string({ min: 1, max: 4096 });

const anchor = optional(nullable(string({ max: 512 })));
export const target: Validator<Target> = (value, at = 'target') => {
  const kind = object({ kind: oneOf(['project', 'work', 'diagram', 'file'] as const) })(value, at).kind;
  if (kind === 'project') return { kind };
  if (kind === 'work') return object<Extract<Target, { kind: 'work' }>>({ kind: oneOf(['work'] as const), work: workId, anchor })(value, at);
  if (kind === 'diagram') return object<Extract<Target, { kind: 'diagram' }>>({ kind: oneOf(['diagram'] as const), work: workId, path: nullable(diagramPath), element: anchor })(value, at);
  return object<Extract<Target, { kind: 'file' }>>({ kind: oneOf(['file'] as const), path: relativePath, anchor })(value, at);
};
const tab: Validator<TabState> = object<TabState>({ id: string({ min: 1, max: limits.path + 128 }), project: folderId, target, preview: boolean });
/** A window's layout as the window saves it. */
export const uiState: Validator<UiState> = object<UiState>({
  sidebar: object<UiState['sidebar']>({ visible: boolean, width: integer(limits.sidebarMin, limits.sidebarMax) }),
  tabs: object<UiState['tabs']>({ items: array(tab, limits.tabs), active: nullable(string({ max: limits.path + 128 })) }),
  inspectorWidth: optional(integer(limits.inspectorMin, limits.inspectorMax)),
});
