import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

// Probe an existing name without creating or changing planning records. The host
// OS does not determine whether this particular volume/directory folds case.
export async function filesystemCaseSensitive(root: string): Promise<boolean> {
  async function probe(directory: string, names: string[]): Promise<boolean | undefined> {
    for (const name of names) {
      const alternate = name.replace(/[a-zA-Z]/, letter => letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase());
      if (alternate === name) continue;
      if (names.includes(alternate)) return true;
      try {
        const original = await lstat(path.join(directory, name));
        const other = await lstat(path.join(directory, alternate));
        return original.dev !== other.dev || original.ino !== other.ino;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      }
    }
  }
  try {
    const result = await probe(root, await readdir(root));
    if (result !== undefined) return result;
    // An empty root can still be identified through its own directory entry.
    const parent = path.dirname(root);
    const names = await readdir(parent);
    const name = path.basename(root);
    if (names.includes(name)) return (await probe(parent, [name, ...names.filter(entry => entry !== name)])) ?? true;
  } catch { /* Missing/unreadable roots cannot establish case folding. */ }
  return true;
}

export async function filesystemNormalizesUnicode(root: string, retained: string[] = []): Promise<boolean> {
  for (const filename of [root, ...retained.map(relative => path.resolve(root, relative))]) {
    const alternate = filename.normalize('NFC') === filename ? filename.normalize('NFD') : filename.normalize('NFC');
    if (alternate === filename) continue;
    try {
      const original = await lstat(filename);
      try {
        const other = await lstat(alternate);
        const parts = filename.split(path.sep); const aliases = alternate.split(path.sep);
        for (let index = 0; index < parts.length; index++) {
          if (parts[index] === aliases[index]) continue;
          const directory = parts.slice(0, index).join(path.sep) || path.parse(filename).root;
          const names = await readdir(directory);
          if (names.includes(parts[index]) && names.includes(aliases[index])) return false;
        }
        return original.dev === other.dev && original.ino === other.ino;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      }
    } catch { /* A missing registry target cannot establish normalization behavior. */ }
  }
  return false;
}
