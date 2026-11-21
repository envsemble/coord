// The projects a work item is in (its plan header's `projects`): each by its planning folder's name
// in the home, as a handoff names a project (`["envui", "internal"]`). Without the field the work is
// in the project that keeps it (the planning folder its folder is in); with it, in exactly the
// projects listed, which need not include the one that keeps it. A part has projects of its own.
// No imports: the reader, the project list and the check share it.

const projectName = /^[^:\\/\s][^:\\/]{0,99}$/;
const caseless = process.platform === 'win32' || process.platform === 'darwin';
/** A project's name as names compare: without regard to case where the file system has none. */
export const projectKey = (name: string) => caseless ? name.toLowerCase() : name;

/** Whether a header's entry can name a project: a folder's name, as a handoff writes one. */
export const isProjectName = (value: unknown): value is string => typeof value === 'string' && projectName.test(value);

/** A plan header's projects as readers use them: the well-formed names, each once, in their order. */
export function projectsOf(value: unknown): string[] {
  const found = new Map<string, string>();
  for (const item of Array.isArray(value) ? value : []) if (isProjectName(item) && !found.has(projectKey(item))) found.set(projectKey(item), item);
  return [...found.values()];
}

/** Whether work with these projects (its header's, as `projectsOf` reads them), kept in the project `home`, is in the project `name`. */
export function inProject(projects: readonly string[], home: string, name: string): boolean {
  return projects.length ? projects.some(project => projectKey(project) === projectKey(name)) : projectKey(home) === projectKey(name);
}
