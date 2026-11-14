// New projects: a planning folder in the home (`<home>/planning/<slug>`) made from the bundled
// templates (packages/coord/templates/planning), with a planning.json naming it and listing the
// folders it covers, as its own Git repository with an initial commit. A project's folders change
// later too.
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { folderKey, HomeDatabase, projectOf, type ProjectRow } from '../../home/database.ts';
import { absoluteFolder } from '../check/check.ts';
import { setRegistryMember } from '../registry/registryText.ts';
import { runProgram } from '../../platform/run.ts';
import { homePlanningDirectory } from '../../home/home.ts';
import { slugOf, WorkError, writeText } from '../work/work.ts';

/** The template files by their path in a new planning folder. */
export type ProjectTemplates = Record<string, string>;

/** The most folders a project lists. */
export const folderLimit = 20;
const unprintable = /[\u0000-\u001f\u007f-\u009f]/;

/** The bundled templates in a folder (packages/coord/templates/planning). */
export async function readTemplates(folder: string): Promise<ProjectTemplates> {
  const templates: ProjectTemplates = {};
  for (const entry of await readdir(folder, { withFileTypes: true })) if (entry.isFile()) templates[entry.name] = await readFile(path.join(folder, entry.name), 'utf8');
  return templates;
}

/** A project's folders as planning.json lists them: absolute, without trailing separators, each once. */
export function checkedFolders(folders: unknown): string[] {
  if (!Array.isArray(folders) || folders.length > folderLimit) throw new WorkError(`List at most ${folderLimit} folders.`);
  const seen = new Set<string>(), checked: string[] = [];
  for (const folder of folders) {
    if (!absoluteFolder(folder)) throw new WorkError(`A project's folder is an absolute path on this computer: ${String(folder)}`);
    const resolved = path.resolve(folder.trim());
    if (seen.has(folderKey(resolved))) continue;
    seen.add(folderKey(resolved));
    checked.push(resolved);
  }
  return checked;
}

/** A project's name, tidied: one line of at most 100 characters. */
function checkedName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || unprintable.test(name)) throw new WorkError('Give the project a name of at most 100 characters.');
  return name.trim();
}

const git = (folder: string, args: string[]) => runProgram('git', ['-C', folder, ...args], { windowsHide: true, timeout: 30000 });

/**
 * Create a project in the home: a new folder in its planning folder, named after the project (a
 * number added when the name is taken), with the templates, a planning.json with its name and
 * folders, `git init` and an initial commit (as the user's Git identity, else as Coord). It becomes
 * the last of the home's projects.
 */
export async function createProject(database: HomeDatabase, request: { name: string; folders?: string[] }, templates: ProjectTemplates): Promise<ProjectRow> {
  const folders = checkedFolders(request.folders ?? []);
  const name = checkedName(request.name);
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
    const registry = { schema_version: 2, name, folders, work_items: [] };
    await writeFile(path.join(folder, 'planning.json'), JSON.stringify(registry, null, 2) + '\n');
    await git(folder, ['init', '-q']);
    await git(folder, ['add', '-A']);
    // Without a Git identity configured, the first commit is Coord's.
    const identity = (await git(folder, ['config', 'user.email']).then(result => result.stdout.trim(), () => '')) ? [] : ['-c', 'user.name=Coord', '-c', 'user.email=coord@localhost'];
    await git(folder, [...identity, 'commit', '-q', '-m', `Create the ${name} project`]);
  } catch (error) {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    throw new WorkError(`The project could not be created: ${(error as Error).message}`);
  }
  return projectOf(database, folder);
}

/**
 * Set a project's folders in its planning.json, keeping the file's formatting; refused when the
 * file changed meanwhile. Folders in another system's form (a planning folder shared with a Mac, on
 * Windows) are kept after them: this computer neither sees nor sets them. Returns this computer's folders.
 */
export async function setProjectFolders(root: string, folders: string[]): Promise<string[]> {
  const checked = checkedFolders(folders);
  const file = path.join(root, 'planning.json');
  let text: string;
  try { text = await readFile(file, 'utf8'); }
  catch (error) { throw new WorkError(`The project's planning.json cannot be read: ${(error as Error).message}`); }
  let others: string[] = [];
  try {
    const listed = (JSON.parse(text.replace(/^﻿/, '')) as { folders?: unknown }).folders;
    others = Array.isArray(listed) ? listed.filter((item): item is string => typeof item === 'string' && !absoluteFolder(item)) : [];
  }
  catch { /* setRegistryMember says what is wrong with the file. */ }
  let next: string;
  try { next = setRegistryMember(text, 'folders', [...checked, ...others], ['name', 'schema_version']); }
  catch (error) { throw new WorkError(`The project's folders could not be set: ${(error as Error).message}`); }
  if (next !== text) {
    if (await readFile(file, 'utf8') !== text) throw new WorkError('planning.json changed meanwhile; the folders were not set. Try again.');
    await writeText(file, next);
  }
  return checked;
}
