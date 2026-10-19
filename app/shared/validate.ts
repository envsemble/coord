// Validators for the messages the window sends to the main process. The generic validators and the
// planning shapes are the host's (packages/atlas/src/host/validate.ts); this module adds what only the
// desktop window sends. Unknown object keys are dropped.
import { appCommands, editors, fullPath, limits, themePreferences, type PagePlace, type Place, type Project, type ProjectPlace, type ReferenceInput, type Target, type UiState } from './contract.ts';
import { array, diagramPath, folderId, integer, nullable, object, oneOf, optional, relativePath, string, workId, type Validator } from '@envsemble/atlas/host/validate';

export {
  ValidationError, argumentsOf, array, boolean, diagramPath, folderId, integer, ipAddress, nullable, object, oneOf, optional, pairingCode,
  port, projectName, relativePath, string, token, viewEvent, workId, type Validator,
} from '@envsemble/atlas/host/validate';

export const command = oneOf(appCommands);
export const themePreference = oneOf(themePreferences);
export const editor = oneOf(editors);
/** What a planning file references, as the host resolves it (within the host's own limits). */
export const referenceInput: Validator<ReferenceInput> = object<ReferenceInput>({ kind: oneOf(['pull', 'commit', 'path'] as const), repository: nullable(string({ min: 1, max: 200 })), value: string({ min: 1, max: 1000 }), line: nullable(integer(1, 10_000_000)) });
export const referenceInputs = array(referenceInput, 500);
export const url = string({ min: 1, max: 4096 });
/** A folder of the window's computer by its full path. */
export const folderPath = string({ min: 1, max: limits.path, pattern: fullPath });

const anchor = optional(nullable(string({ max: 512 })));
/** A plan's statistics; any other view (the ledger's, which is gone) is dropped: the plan shows. */
const workView: Validator<'statistics' | undefined> = value => value === 'statistics' ? 'statistics' : undefined;
export const target: Validator<Target> = (value, at = 'target') => {
  const kind = object({ kind: oneOf(['work', 'diagram', 'file'] as const) })(value, at).kind;
  if (kind === 'work') return object<Extract<Target, { kind: 'work' }>>({ kind: oneOf(['work'] as const), work: workId, anchor, step: anchor, view: workView })(value, at);
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

/**
 * Whether a host's own listing of its projects (with its projects.changed event) reads as one: a list
 * of projects, each with its folder ID, name, path, place in the order, state and workspace folders.
 * Anything else is not taken; the windows list the projects again instead.
 */
export function isProjectListing(value: unknown): value is Project[] {
  const project = (item: unknown) => {
    const entry = item as Partial<Record<keyof Project, unknown>> | null;
    return Boolean(entry && typeof entry === 'object') && typeof entry!.folderId === 'string' && /^f-[a-f0-9]{32}$/.test(entry!.folderId) && typeof entry!.name === 'string'
      && typeof entry!.path === 'string' && typeof entry!.position === 'number' && ['active', 'archived', 'hidden'].includes(entry!.state as string)
      && typeof entry!.outsideHome === 'boolean' && Array.isArray(entry!.workspaces) && entry!.workspaces.every(folder => typeof folder === 'string')
      && (entry!.summary === undefined || entry!.summary === null || typeof entry!.summary === 'object');
  };
  return Array.isArray(value) && value.every(project);
}
