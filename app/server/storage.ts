import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

export async function statisticsDirectory(root: string, base?: string) {
  const canonical = await realpath(root).catch(() => path.resolve(root));
  const normalized = (process.platform === 'win32' ? canonical.toLowerCase() : canonical).replaceAll('\\', '/');
  const identity = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  const directory = base ? path.resolve(base.replace(/^~(?=$|[\\/])/, () => homedir())) : path.join(homedir(), '.cache', 'planning-dashboard');
  return path.join(directory, identity);
}

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
