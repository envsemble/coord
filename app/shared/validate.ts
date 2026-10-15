// Validators for the messages the window sends to the main process. The generic validators and the
// planning shapes are the host's (packages/host/src/validate.ts); this module adds what only the
// desktop window sends. Unknown object keys are dropped.
import { appCommands, fullPath, limits, themePreferences, type PagePlace, type Place, type ProjectPlace, type Target, type UiState } from './contract.ts';
import { diagramPath, folderId, integer, nullable, object, oneOf, optional, relativePath, string, workId, type Validator } from '@envsemble/atlas-host/validate';

export {
  ValidationError, argumentsOf, array, boolean, diagramPath, folderId, integer, ipAddress, nullable, object, oneOf, optional, pairingCode,
  port, projectName, relativePath, string, token, viewEvent, workId, type Validator,
} from '@envsemble/atlas-host/validate';

export const command = oneOf(appCommands);
export const themePreference = oneOf(themePreferences);
export const url = string({ min: 1, max: 4096 });
/** A folder of the window's computer by its full path. */
export const folderPath = string({ min: 1, max: limits.path, pattern: fullPath });

const anchor = optional(nullable(string({ max: 512 })));
export const target: Validator<Target> = (value, at = 'target') => {
  const kind = object({ kind: oneOf(['work', 'diagram', 'file'] as const) })(value, at).kind;
  if (kind === 'work') return object<Extract<Target, { kind: 'work' }>>({ kind: oneOf(['work'] as const), work: workId, anchor, view: optional(nullable(oneOf(['ledger'] as const))) })(value, at);
  if (kind === 'diagram') return object<Extract<Target, { kind: 'diagram' }>>({ kind: oneOf(['diagram'] as const), work: workId, path: nullable(diagramPath), element: anchor })(value, at);
  return object<Extract<Target, { kind: 'file' }>>({ kind: oneOf(['file'] as const), path: relativePath, anchor })(value, at);
};
/** One of the window's own pages, or something of a project. */
export const place: Validator<Place> = (value, at = 'place') => {
  const page = object<{ page?: PagePlace['page'] }>({ page: optional(oneOf(['hub', 'projects', 'statistics'] as const)) })(value, at).page;
  if (page === 'projects') return { page };
  if (page) return { page, project: object<{ project: string | null }>({ project: nullable(folderId) })(value, at).project };
  return object<ProjectPlace>({ project: folderId, target })(value, at);
};
/** A window's layout as the window saves it. */
export const uiState: Validator<UiState> = object<UiState>({
  place,
  inspectorWidth: optional(integer(limits.inspectorMin, limits.inspectorMax)),
});
