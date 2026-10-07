import path from 'node:path';
import { realpath } from 'node:fs/promises';

export async function cacheOutsidePlanning(root: string, destination: string) {
  const planning = await realpath(root).catch(() => path.resolve(root));
  let ancestor = path.resolve(destination);
  const suffix: string[] = [];
  let canonical = '';
  while (!canonical) {
    try { canonical = await realpath(ancestor); }
    catch {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new Error('The statistics location could not be resolved.');
      suffix.unshift(path.basename(ancestor)); ancestor = parent;
    }
  }
  const directory = path.join(canonical, ...suffix);
  const relative = path.relative(planning, directory);
  if (!relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
    throw new Error('Choose a statistics cache outside the planning folder.');
  }
  return directory;
}
