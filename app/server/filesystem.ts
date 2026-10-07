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
