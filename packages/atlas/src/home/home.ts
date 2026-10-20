import path from 'node:path';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { atlasHome, guardTestHome } from './homePath.ts';

export { atlasHome, guardTestHome };

/** Where planning folders live in the home: `<home>/planning/<name>`. */
export function homePlanningDirectory(home: string) {
  return path.join(home, 'planning');
}

/**
 * The per-user folder Electron keeps its own caches in for the Atlas app: %APPDATA%\Atlas on
 * Windows, ~/Library/Application Support/Atlas on macOS and ${XDG_CONFIG_HOME:-~/.config}/Atlas
 * elsewhere.
 */
export function electronDataDirectory(environment: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()) {
  if (platform === 'win32') return path.join(environment.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Atlas');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Atlas');
  const configured = environment.XDG_CONFIG_HOME;
  return path.join(configured && path.isAbsolute(configured) ? configured : path.join(home, '.config'), 'Atlas');
}

/**
 * Create the home (owner-only on POSIX: its database holds secrets) and its planning folder. Never
 * throws: an unwritable home shows up where it is used.
 */
export async function prepareHome(options: { override?: string; environment?: NodeJS.ProcessEnv; home?: string } = {}) {
  const home = atlasHome(options.override, options.environment ?? process.env, options.home);
  guardTestHome(home);
  await mkdir(home, { recursive: true, mode: 0o700 }).catch(() => undefined);
  await mkdir(homePlanningDirectory(home), { recursive: true }).catch(() => undefined);
  return { home };
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
