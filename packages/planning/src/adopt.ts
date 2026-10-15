// `atlas home adopt`: move an existing planning folder (a Git repository) into the Atlas home, so
// checkouts find it by their remotes and the app lists it as a project. Repository path hints
// relative to the old location become absolute; hints into the folder itself stay relative, as they
// move with it. Its project (statistics and sessions are kept by project) follows it to the new
// path, its document use from before the home database is imported, and its work statistics files
// are imported into the database and deleted from the folder (not committed).
import { cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HomeDatabase, planningName } from './database.ts';
import { importLegacyUsage } from './homeMigration.ts';
import { updateRegistryEntry } from './registryText.ts';
import { importStatisticsFiles, type StatisticsImport } from './statistics.ts';
import { atlasHome, homePlanningDirectory, statisticsDirectory } from './storage.ts';
import { WorkError } from './work.ts';

export interface Adopted {
  from: string; to: string; project: string; rewritten: { id: string; from: string; to: string }[]; statistics: StatisticsImport;
  /** The name of the project last at the new path, whose row and statistics the folder took over, or null. */
  reused: string | null;
}

const within = (parent: string, child: string) => { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); };
const exists = (target: string) => stat(target).then(() => true, () => false);

export async function adoptPlanningFolder(folder: string, options: { name?: string | null; home?: string } = {}): Promise<Adopted> {
  const from = await realpath(folder).catch(() => { throw new WorkError('The folder does not exist: ' + folder); });
  const name = options.name ?? path.basename(from);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.length > 100) throw new WorkError('The name must be letters, digits, dots, hyphens and underscores.');
  const registryFile = path.join(from, 'planning.json');
  let source: string;
  try { source = await readFile(registryFile, 'utf8'); } catch { throw new WorkError(from + ' has no planning.json; it is not a planning folder.'); }
  if (!await exists(path.join(from, '.git'))) throw new WorkError(from + ' is not the top of a Git repository; a planning folder in the home keeps its own history.');
  const home = options.home ?? atlasHome();
  const base = homePlanningDirectory(home);
  const to = path.join(base, name);
  if (within(from, base)) throw new WorkError('The Atlas home is inside ' + from + '; a planning folder cannot move into itself.');
  if (await exists(to)) throw new WorkError(to + ' already exists; choose another --name.');
  const registry = JSON.parse(source.replace(/^﻿/, '')) as { repositories?: { id?: unknown; path?: unknown }[] };
  let text = source;
  const rewritten: Adopted['rewritten'] = [];
  for (const repository of Array.isArray(registry.repositories) ? registry.repositories : []) {
    if (typeof repository?.id !== 'string' || typeof repository.path !== 'string' || !repository.path.trim() || path.isAbsolute(repository.path)) continue;
    const target = path.resolve(from, repository.path);
    if (within(from, target)) continue;
    text = updateRegistryEntry(text, 'repositories', repository.id, { path: target });
    rewritten.push({ id: repository.id, from: repository.path, to: target });
  }
  // Document use from before the database was kept by the folder's path.
  const usage = await statisticsDirectory(from, home);
  await mkdir(base, { recursive: true });
  const target = path.join(await realpath(base), name);
  const database = HomeDatabase.open(home);
  try {
    // Before anything moves, the folder's project (or a new one) takes the new path. A row left for
    // the target path (its folder is gone) is most likely this folder renamed or moved by hand: one
    // without a project of its own takes it over, with its statistics. A folder with a project of
    // its own is another one, and the row's statistics are not thrown away for it.
    const projectName = await planningName(from);
    let reused: string | null = null;
    const project = database.transaction(() => {
      const known = database.projectByFolder(from), stale = database.projectByFolder(target);
      if (known && stale && stale.id !== known.id) throw new WorkError(`The project ${stale.name}, whose folder is gone, was last at ${target} and keeps its statistics there; choose another --name.`);
      if (!known && stale) reused = stale.name;
      const row = known ?? stale;
      if (!row) return database.addProject(target, projectName);
      database.updateProject(row.id, { folder: target, name: projectName, ...row === stale && { state: 'active' as const } });
      return database.project(row.id)!;
    });
    if (await exists(usage)) await importLegacyUsage(database, project.id, usage);
    try { await renameSoon(from, to); }
    catch (error) {
      // Nothing moved: the project keeps the folder where it is.
      database.updateProject(project.id, { folder: from });
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EBUSY') throw new WorkError(`${from} could not be moved (${code}): close programs that have it open, such as an editor, a terminal or Atlas, and try again.`);
      if (code !== 'EXDEV') throw error;
      await cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
      database.updateProject(project.id, { folder: target });
      await rm(from, { recursive: true, force: true });
    }
    await rm(usage, { recursive: true, force: true });
    if (text !== source) await writeFile(path.join(to, 'planning.json'), text);
    const moved = await realpath(to);
    if (moved !== target) database.updateProject(project.id, { folder: moved });
    let statistics: StatisticsImport;
    try { statistics = await importStatisticsFiles(database, moved); }
    catch (error) { throw new WorkError(`${from} moved to ${moved}, but its statistics files could not be imported (${(error as Error).message}). Run atlas setup to import them.`); }
    return { from, to: moved, project: projectName, rewritten, statistics, reused };
  } finally { database.close(); }
}

/**
 * Rename a folder, trying again for a couple of seconds while Windows refuses because something has
 * it open for a moment (Atlas listing its projects reads the folder and runs Git in it, for one).
 */
async function renameSoon(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try { return await rename(from, to); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') || attempt >= 10) throw error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
}
