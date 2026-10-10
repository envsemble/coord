import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { filesystemCaseSensitive, filesystemNormalizesUnicode } from './filesystem.ts';

/**
 * The per-user Atlas data folder shared by the command and the app, following Electron's
 * userData convention: %APPDATA%\Atlas on Windows, ~/Library/Application Support/Atlas on
 * macOS, and ${XDG_CONFIG_HOME:-~/.config}/Atlas elsewhere. ATLAS_DATA_DIR overrides it;
 * an explicit override (such as --data-dir) takes precedence over both. It never lives in a planning folder.
 */
export function atlasDataDirectory(override?: string, environment: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()) {
  const expand = (value: string) => path.resolve(value.replace(/^~(?=$|[\\/])/, () => home));
  const chosen = override || environment.ATLAS_DATA_DIR;
  if (chosen) return expand(chosen);
  if (platform === 'win32') return path.join(environment.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Atlas');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Atlas');
  const configured = environment.XDG_CONFIG_HOME;
  return path.join(configured && path.isAbsolute(configured) ? configured : path.join(home, '.config'), 'Atlas');
}

/** Usage statistics for one planning folder: <data folder>/usage/<canonical-path hash>. */
export async function statisticsDirectory(root: string, base?: string) {
  const canonical = await realpath(root).catch(() => path.resolve(root));
  const unicode = await filesystemNormalizesUnicode(canonical) ? canonical.normalize('NFC') : canonical;
  const normalized = (await filesystemCaseSensitive(canonical) ? unicode : unicode.toLowerCase()).split(path.sep).join('/');
  const identity = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return path.join(atlasDataDirectory(base), 'usage', identity);
}

/** Recently opened planning folders. */
export function recentRootsFile(base?: string) {
  return path.join(atlasDataDirectory(base), 'planning-roots.json');
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
  const sensitive = await filesystemCaseSensitive(planning);
  const unicode = await filesystemNormalizesUnicode(planning);
  const normalize = (value: string) => { const spelling = unicode ? value.normalize('NFC') : value; return sensitive ? spelling : spelling.toLowerCase(); };
  const relative = path.relative(normalize(planning), normalize(directory));
  if (!relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
    throw new Error('Choose a statistics cache outside the planning folder.');
  }
  return directory;
}
