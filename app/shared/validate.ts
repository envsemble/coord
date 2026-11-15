// Validators for the messages the window sends to the main process. The generic validators and the
// planning shapes are the host's (packages/coord/src/host/validate.ts); this module adds what only the
// desktop window sends. Unknown object keys are dropped.
import { agentIds, appCommands, fullPath, limits, settingsSections, themePreferences, updateChannels, type PagePlace, type Place, type Project, type ProjectPlace, type ReferenceInput, type SettingsSection, type Target, type UiState } from './contract.ts';
import { array, diagramPath, integer, nullable, object, oneOf, optional, projectId, relativePath, string, workId, type Validator } from '@envsemble/coord/host/validate';

export {
  ValidationError, argumentsOf, array, boolean, diagramPath, diagramPositions, fileContent, integer, ipAddress, nullable, object, oneOf, optional, pagePath, pairingCode,
  port, projectId, projectName, relativePath, string, toolInput, toolName, workId, type Validator,
} from '@envsemble/coord/host/validate';

export const command = oneOf(appCommands);
/** An agent Coord connects: only these are named, and never a program's path, which main's own dialog chooses. */
export const agentId = oneOf(agentIds);
export const themePreference = oneOf(themePreferences);
export const updateChannel = oneOf(updateChannels);
/** An instant, as an ISO time. */
export const isoTime = string({ min: 10, max: 40, pattern: /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?$/ });
export const statisticsUnit = oneOf(['day', 'week'] as const);
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
/** A section of the Settings page. */
export const settingsSection = oneOf(settingsSections);
/** One of the window's own pages, or something of a project. */
export const place: Validator<Place> = (value, at = 'place') => {
  const page = object<{ page?: PagePlace['page'] | 'projects' }>({ page: optional(oneOf(['hub', 'projects', 'statistics', 'settings'] as const)) })(value, at).page;
  // The Projects page is gone: its projects are managed from the hub.
  if (page === 'projects') return { page: 'hub', projectId: null };
  if (page === 'settings') return { page, section: object<{ section: SettingsSection }>({ section: settingsSection })(value, at).section };
  if (page) return { page, projectId: object<{ projectId: string | null }>({ projectId: nullable(projectId) })(value, at).projectId };
  return object<ProjectPlace>({ projectId, target })(value, at);
};
/** A window's layout as the window saves it. */
export const uiState: Validator<UiState> = object<UiState>({
  place,
});

/**
 * Whether a host's own listing of its projects (with its projects.changed event) reads as one: a list
 * of projects, each with its ID, name, path, place in the order, state and folders.
 * Anything else is not taken; the windows list the projects again instead.
 */
export function isProjectListing(value: unknown): value is Project[] {
  const project = (item: unknown) => {
    const entry = item as Partial<Record<keyof Project, unknown>> | null;
    return Boolean(entry && typeof entry === 'object') && typeof entry!.id === 'string' && /^f-[a-f0-9]{32}$/.test(entry!.id) && typeof entry!.name === 'string'
      && typeof entry!.path === 'string' && typeof entry!.position === 'number' && ['active', 'archived'].includes(entry!.state as string)
      && Array.isArray(entry!.folders) && entry!.folders.every(folder => typeof folder === 'string')
      && (entry!.summary === undefined || entry!.summary === null || typeof entry!.summary === 'object');
  };
  return Array.isArray(value) && value.every(project);
}
