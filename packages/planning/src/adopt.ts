// `atlas home adopt`: move an existing planning folder (a Git repository) into the Atlas home, so
// checkouts find it by their remotes. Repository path hints relative to the old location become
// absolute; hints into the folder itself stay relative, as they move with it. Its document-use
// statistics in the home, kept per folder path, move to the new path.
import { cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { updateRegistryEntry } from './registryText.ts';
import { atlasHome, homePlanningDirectory, mergeUsage, statisticsDirectory } from './storage.ts';
import { WorkError } from './work.ts';

export interface Adopted { from: string; to: string; rewritten: { id: string; from: string; to: string }[] }

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
  const base = homePlanningDirectory(options.home ?? atlasHome());
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
  // Document use is kept per folder path: it follows the folder to its new path.
  const usage = await statisticsDirectory(from, options.home);
  await mkdir(base, { recursive: true });
  try { await rename(from, to); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EBUSY') throw new WorkError(`${from} could not be moved (${code}): close programs that have it open, such as an editor, a terminal or Atlas, and try again.`);
    if (code !== 'EXDEV') throw error;
    await cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    await rm(from, { recursive: true, force: true });
  }
  if (text !== source) await writeFile(path.join(to, 'planning.json'), text);
  const moved = await statisticsDirectory(to, options.home);
  if (await exists(usage)) {
    if (await exists(moved)) { await mergeUsage(usage, moved); await rm(usage, { recursive: true, force: true }); }
    else { await mkdir(path.dirname(moved), { recursive: true }); await rename(usage, moved); }
  }
  return { from, to, rewritten };
}
