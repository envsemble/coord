import path from 'node:path';
import { cp, mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { filesystemCaseSensitive, filesystemNormalizesUnicode } from './filesystem.ts';

const expand = (value: string, home: string) => path.resolve(value.replace(/^~(?=$|[\/])/, () => home));

/**
 * The Atlas home: `~/.atlas`, or ATLAS_HOME; an explicit override (such as --home) takes precedence
 * over both. Its `planning/` folder holds the planning folders, and Atlas keeps its own state beside
 * them: usage statistics, the host's identity and folder list, connections, desktop state, session
 * links and logs. Electron's own caches stay in Electron's per-user folder.
 */
export function atlasHome(override?: string, environment: NodeJS.ProcessEnv = process.env, home = homedir()) {
  const chosen = override || environment.ATLAS_HOME;
  return chosen ? expand(chosen, home) : path.join(home, '.atlas');
}

/** Where planning folders live in the home: `<home>/planning/<name>`. */
export function homePlanningDirectory(home: string) {
  return path.join(home, 'planning');
}

/**
 * The per-user folder Atlas used before the home, which Electron still uses for its own caches:
 * %APPDATA%\Atlas on Windows, ~/Library/Application Support/Atlas on macOS and
 * ${XDG_CONFIG_HOME:-~/.config}/Atlas elsewhere.
 */
export function legacyDataDirectory(environment: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()) {
  if (platform === 'win32') return path.join(environment.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Atlas');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Atlas');
  const configured = environment.XDG_CONFIG_HOME;
  return path.join(configured && path.isAbsolute(configured) ? configured : path.join(home, '.config'), 'Atlas');
}

/** What Atlas itself kept in the old data folder; everything else there (Chromium's caches, Electron's files) stays. */
const legacyEntries = ['usage', 'host', 'planning-roots.json', 'connections.json', 'desktop-state.json'];
const legacyLog = /^(?:atlas|host)(?:\.\d+)?\.log$/;

async function moveEntry(from: string, to: string) {
  await mkdir(path.dirname(to), { recursive: true });
  try { await rename(from, to); }
  catch (error) {
    // Another volume: copy, then remove the original.
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await rm(from, { recursive: true, force: true });
  }
}
const exists = (target: string) => stat(target).then(() => true, () => false);

/**
 * Move Atlas's own files from the old data folder into the home, leaving Electron's caches where they
 * are. An entry the home already has is left in the old folder, so nothing is overwritten; once moved,
 * there is nothing left to move, so this runs once in effect. Returns the entries moved.
 */
export async function migrateLegacyData(home: string, legacy: string): Promise<string[]> {
  if (path.resolve(home) === path.resolve(legacy) || !await exists(legacy)) return [];
  const moved: string[] = [];
  const names = [...legacyEntries.map(name => [name]), ...(await readdir(path.join(legacy, 'logs')).catch(() => [] as string[])).filter(name => legacyLog.test(name)).map(name => ['logs', name])];
  for (const parts of names) {
    const from = path.join(legacy, ...parts), to = path.join(home, ...parts);
    if (!await exists(from) || await exists(to)) continue;
    try { await moveEntry(from, to); moved.push(parts.join('/')); } catch { /* Left for the next start. */ }
  }
  return moved;
}

/**
 * Create the home and its planning folder, and, for the default home, move the old data folder's
 * Atlas files into it. A home chosen with ATLAS_HOME or an override (a test, another instance) never
 * takes the user's data. Never throws: Atlas works without the move.
 */
export async function prepareHome(options: { override?: string; environment?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; home?: string } = {}) {
  const environment = options.environment ?? process.env;
  const home = atlasHome(options.override, environment, options.home);
  let moved: string[] = [];
  try {
    await mkdir(homePlanningDirectory(home), { recursive: true });
    if (!options.override && !environment.ATLAS_HOME) moved = await migrateLegacyData(home, legacyDataDirectory(environment, options.platform, options.home));
  } catch { /* An unwritable home shows up where it is used. */ }
  return { home, moved };
}

/** The planning folders in the home: each folder of `<home>/planning` with a planning.json. */
export async function homePlanningFolders(home: string): Promise<string[]> {
  const base = homePlanningDirectory(home);
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  const folders: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folder = path.join(base, entry.name);
    if (await stat(path.join(folder, 'planning.json')).then(info => info.isFile(), () => false)) folders.push(folder);
  }
  return folders;
}

/** Usage statistics for one planning folder: <home>/usage/<canonical-path hash>. */
export async function statisticsDirectory(root: string, base?: string) {
  const canonical = await realpath(root).catch(() => path.resolve(root));
  const unicode = await filesystemNormalizesUnicode(canonical) ? canonical.normalize('NFC') : canonical;
  const normalized = (await filesystemCaseSensitive(canonical) ? unicode : unicode.toLowerCase()).split(path.sep).join('/');
  const identity = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return path.join(atlasHome(base), 'usage', identity);
}

/** Recently opened planning folders. */
export function recentRootsFile(base?: string) {
  return path.join(atlasHome(base), 'planning-roots.json');
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
