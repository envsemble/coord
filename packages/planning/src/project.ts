// New projects: a planning folder in the home (`<home>/planning/<slug>`) made from the bundled
// templates (plugin/skills/atlas/assets/planning), named in its planning.json, covering its workspace
// folders and registering the repositories it covers (by default the Git checkouts found in those
// folders), as its own Git repository with an initial commit. A project's workspace folders change
// later too, registering what the new ones hold.
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { folderKey, HomeDatabase, projectOf, type ProjectRow } from './database.ts';
import { appendRegistryEntries, setRegistryMember } from './registryText.ts';
import { runProgram } from './run.ts';
import { homePlanningDirectory } from './storage.ts';
import { slugOf, WorkError, writeText } from './work.ts';
import { checkedWorkspaces, newRepositories, scanWorkspaces, type ProjectRepository, type SkippedCheckout } from './workspaces.ts';

export type { ProjectRepository };
/** The template files by their path in a new planning folder. */
export type ProjectTemplates = Record<string, string>;

const repositoryIdentity = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const unprintable = /[\u0000-\u001f\u007f-\u009f]/;

/** The bundled templates in a folder (plugin/skills/atlas/assets/planning). */
export async function readTemplates(folder: string): Promise<ProjectTemplates> {
  const templates: ProjectTemplates = {};
  for (const entry of await readdir(folder, { withFileTypes: true })) if (entry.isFile()) templates[entry.name] = await readFile(path.join(folder, entry.name), 'utf8');
  return templates;
}

/** Check a new project's name and repositories; returns them tidied. */
function checkedProject(name: unknown, repositories: unknown): { name: string; repositories: ProjectRepository[] } {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || unprintable.test(name)) throw new WorkError('Give the project a name of at most 100 characters.');
  if (!Array.isArray(repositories) || repositories.length > 50) throw new WorkError('List at most 50 repositories.');
  const ids = new Set<string>();
  const checked = repositories.map((item, index) => {
    const entry = (item ?? {}) as { id?: unknown; name?: unknown; remote?: unknown };
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!repositoryIdentity.test(id) || id.length > 64) throw new WorkError(`Repository ${index + 1}: its ID must be lowercase letters and digits joined by hyphens, such as coord-web.`);
    if (ids.has(id)) throw new WorkError(`Repository ${index + 1}: ${id} is listed twice.`);
    ids.add(id);
    const label = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
    if (label.length > 100 || unprintable.test(label)) throw new WorkError(`Repository ${index + 1}: its name is too long.`);
    const remote = typeof entry.remote === 'string' && entry.remote.trim() ? entry.remote.trim() : null;
    if (remote && (remote.length > 500 || unprintable.test(remote))) throw new WorkError(`Repository ${index + 1}: its remote is not a Git remote.`);
    // A checkout without a remote is found by its absolute path.
    const hint = (entry as { path?: unknown }).path;
    return { id, name: label, remote, ...!remote && typeof hint === 'string' && path.isAbsolute(hint) && { path: hint } };
  });
  return { name: name.trim(), repositories: checked };
}

/** A repository as planning.json registers it: by its remote, else by its checkout's path. */
const registered = (item: ProjectRepository) => ({ id: item.id, name: item.name, ...item.remote ? { remote: item.remote } : item.path ? { path: item.path } : {} });

const git = (folder: string, args: string[]) => runProgram('git', ['-C', folder, ...args], { windowsHide: true, timeout: 30000 });

/**
 * Create a project in the home: a new folder in its planning folder, named after the project (a
 * number added when the name is taken), with the templates, a planning.json naming it, its workspace
 * folders and its repositories (those given, else the Git checkouts found in the workspace folders),
 * `git init` and an initial commit (as the user's Git identity, else as Atlas). It becomes the last
 * of the home's projects.
 */
export async function createProject(database: HomeDatabase, request: { name: string; workspaces?: string[]; repositories?: ProjectRepository[] }, templates: ProjectTemplates): Promise<ProjectRow & { skipped: SkippedCheckout[] }> {
  const workspaces = checkedWorkspaces(request.workspaces ?? []);
  checkedProject(request.name, []);
  if (!templates['planning.json']) throw new WorkError('The planning templates are not available.');
  let given: unknown = request.repositories, skipped: SkippedCheckout[] = [];
  if (given === undefined) ({ repositories: given, skipped } = await scanWorkspaces(workspaces));
  else if (Array.isArray(given) && given.every(item => typeof item?.id === 'string')) {
    let listed = given as ProjectRepository[];
    // A checkout without a remote comes back from the app's preview without its path: this scan has it.
    if (workspaces.length && listed.some(item => !item.remote && !item.path)) {
      const scan = await scanWorkspaces(workspaces);
      skipped = scan.skipped;
      const local = scan.repositories.filter(item => item.remote === null && item.path);
      listed = listed.map(item => {
        if (item.remote || item.path) return item;
        const found = local.find(entry => entry.id === item.id) ?? local.find(entry => entry.name === item.name);
        return found ? { ...item, path: found.path } : item;
      });
    }
    // Previews of several folders may give two repositories one ID: each gets its own.
    given = newRepositories([], listed);
  }
  const { name, repositories } = checkedProject(request.name, given);
  const base = homePlanningDirectory(database.home);
  await mkdir(base, { recursive: true });
  const slug = slugOf(name) === 'work' && !/work/i.test(name) ? 'project' : slugOf(name);
  let folder = path.join(base, slug);
  for (let number = 2; await stat(folder).then(() => true, () => false); number++) folder = path.join(base, slug + '-' + number);
  await mkdir(folder);
  try {
    for (const [file, text] of Object.entries(templates)) {
      if (file.includes('/') || file.includes('\\') || file === 'planning.json') continue;
      await writeFile(path.join(folder, file), text);
    }
    // The name and the workspace folders come first, whatever the template's order.
    const registry = Object.assign({ schema_version: 1, name, workspaces }, JSON.parse(templates['planning.json']) as object, { name, workspaces, repositories: repositories.map(registered) });
    await writeFile(path.join(folder, 'planning.json'), JSON.stringify(registry, null, 2) + '\n');
    await git(folder, ['init', '-q']);
    await git(folder, ['add', '-A']);
    // Without a Git identity configured, the first commit is Atlas's.
    const identity = (await git(folder, ['config', 'user.email']).then(result => result.stdout.trim(), () => '')) ? [] : ['-c', 'user.name=Atlas', '-c', 'user.email=atlas@localhost'];
    await git(folder, [...identity, 'commit', '-q', '-m', `Create the ${name} project`]);
  } catch (error) {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    throw new WorkError(`The project could not be created: ${(error as Error).message}`);
  }
  return { ...await projectOf(database, folder), skipped };
}

/**
 * Set a project's workspace folders in its planning.json, keeping the file's formatting, and register
 * the repositories found in the folders it did not cover before (never removing one). The folders
 * are scanned first; the registry is then read again and replaced whole, and refused when it changed
 * meanwhile, so nothing registered at the same time is lost. Returns the folders, the repositories
 * added and the checkouts skipped.
 */
export async function setProjectWorkspaces(root: string, folders: string[]): Promise<{ workspaces: string[]; added: ProjectRepository[]; skipped: SkippedCheckout[] }> {
  const workspaces = checkedWorkspaces(folders);
  const file = path.join(root, 'planning.json');
  const read = async () => {
    try { const text = await readFile(file, 'utf8'); return { text, registry: JSON.parse(text.replace(/^﻿/, '')) as { workspaces?: unknown; repositories?: unknown } }; }
    catch (error) { throw new WorkError(`The project's planning.json cannot be read: ${(error as Error).message}`); }
  };
  const covered = (registry: { workspaces?: unknown }) => new Set((Array.isArray(registry.workspaces) ? registry.workspaces : []).flatMap(item => typeof item === 'string' ? [folderKey(path.resolve(item))] : []));
  const before = covered((await read()).registry);
  const scan = await scanWorkspaces(workspaces.filter(folder => !before.has(folderKey(folder))));
  const { text, registry } = await read();
  const added = newRepositories(Array.isArray(registry.repositories) ? registry.repositories : [], scan.repositories);
  let next: string;
  try {
    next = setRegistryMember(text, 'workspaces', workspaces, ['name', 'schema_version']);
    if (added.length) next = appendRegistryEntries(next, 'repositories', added.map(registered));
  } catch (error) { throw new WorkError(`The project's workspace folders could not be set: ${(error as Error).message}`); }
  if (next !== text) {
    if (await readFile(file, 'utf8') !== text) throw new WorkError('planning.json changed meanwhile; the workspace folders were not set. Try again.');
    await writeText(file, next);
  }
  return { workspaces, added, skipped: scan.skipped };
}
