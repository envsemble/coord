// The folder browser's view of the computer: folders only, never files, with planning folders (a
// folder with a planning.json) marked. Browsing starts at the home folder and the drives (the root
// on Linux and macOS). Hidden folders (a name starting with a dot) are left out.
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { BrowseEntry, BrowseResult } from './contract.ts';
import { HostError } from './errors.ts';

/** Folders listed at most; a larger folder says the list is cut short. */
export const browseLimit = 1000;

const isDirectory = (folder: string) => stat(folder).then(info => info.isDirectory(), () => false);
const isPlanning = (folder: string) => stat(path.join(folder, 'planning.json')).then(info => info.isFile(), () => false);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

async function entry(name: string, folder: string): Promise<BrowseEntry> {
  return { name, path: folder, planning: await isPlanning(folder) };
}

/** Where browsing starts: the home folder, then each drive (Windows) or the root. */
async function places(platform: NodeJS.Platform): Promise<BrowseResult> {
  const home = homedir();
  const candidates: { name: string; path: string }[] = [{ name: 'Home', path: home }];
  if (platform === 'win32') {
    const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(letter => ({ name: letter + ':', path: letter + ':\\' }));
    const present = await Promise.all(letters.map(async drive => (await isDirectory(drive.path)) ? drive : null));
    candidates.push(...present.filter(drive => drive !== null));
  } else candidates.push({ name: '/', path: '/' });
  const folders = await Promise.all(candidates.map(place => entry(place.name, place.path)));
  return { path: null, parent: null, planning: false, folders, truncated: false };
}

/** The subfolders of a folder on this computer, or where browsing starts (null). */
export async function browse(input: string | null, platform: NodeJS.Platform = process.platform): Promise<BrowseResult> {
  if (input === null) return places(platform);
  const folder = path.resolve(input);
  let names: { name: string; directory: boolean; link: boolean }[];
  try {
    const listed = await readdir(folder, { withFileTypes: true });
    names = listed.map(item => ({ name: item.name, directory: item.isDirectory(), link: item.isSymbolicLink() }));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new HostError('not-found', 'This folder does not exist: ' + folder);
    if (code === 'ENOTDIR') throw new HostError('invalid-argument', 'This is a file, not a folder: ' + folder);
    if (code === 'EACCES' || code === 'EPERM') throw new HostError('forbidden', 'Atlas may not read this folder: ' + folder);
    throw new HostError('unavailable', 'This folder cannot be read: ' + (error as Error).message);
  }
  const candidates = names.filter(item => !item.name.startsWith('.') && (item.directory || item.link)).sort((a, b) => collator.compare(a.name, b.name));
  // A link (or a Windows junction) counts when it leads to a folder.
  const kept = (await Promise.all(candidates.map(async item => item.directory || await isDirectory(path.join(folder, item.name)) ? item : null))).filter(item => item !== null);
  const folders = await Promise.all(kept.slice(0, browseLimit).map(item => entry(item.name, path.join(folder, item.name))));
  const parent = path.dirname(folder);
  return { path: folder, parent: parent === folder ? null : parent, planning: await isPlanning(folder), folders, truncated: kept.length > browseLimit };
}
