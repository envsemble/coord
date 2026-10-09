import { mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PlanningError } from './planning.ts';

export interface PlanningRootInfo { path: string; name: string; parent: string; workItems: number }

const registryLimit = 2 * 1024 * 1024;
const skipped = new Set(['node_modules', '__pycache__', 'dist', 'build', 'vendor', 'target', 'out', 'coverage']);
const recentLimit = 8;

function absolute(value: string) {
  if (process.platform === 'win32') return /^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
  return path.isAbsolute(value);
}

/** Validate a user-supplied planning folder: absolute, existing, readable, with a schema-1 registry. */
export async function inspectPlanningRoot(input: unknown): Promise<PlanningRootInfo> {
  if (typeof input !== 'string' || !input.trim() || input.length > 1024 || input.includes('\0')) throw new PlanningError('Enter the full path of a planning folder.');
  const trimmed = input.trim().replace(/^"(.*)"$/, '$1');
  if (!absolute(trimmed)) throw new PlanningError('Use an absolute path, for example C:\\work\\planning or /home/me/planning.');
  let canonical: string;
  try { canonical = await realpath(path.resolve(trimmed)); } catch { throw new PlanningError('This folder does not exist.', 404); }
  let folder;
  try { folder = await stat(canonical); } catch { throw new PlanningError('This folder cannot be read.', 403); }
  if (!folder.isDirectory()) throw new PlanningError('Choose a folder, not a file.');
  const registryPath = path.join(canonical, 'planning.json');
  let registry: { schema_version?: unknown; work_items?: unknown; repositories?: unknown };
  try {
    const information = await stat(registryPath);
    if (!information.isFile() || information.size > registryLimit) throw new Error('Unreadable registry');
    registry = JSON.parse((await readFile(registryPath, 'utf8')).replace(/^\uFEFF/, ''));
  } catch { throw new PlanningError('This folder has no readable planning.json.', 422); }
  if (!registry || registry.schema_version !== 1 || !Array.isArray(registry.work_items) || !Array.isArray(registry.repositories)) {
    throw new PlanningError('This planning.json does not use schema version 1.', 422);
  }
  return { path: canonical, name: path.basename(canonical), parent: path.dirname(canonical), workItems: registry.work_items.length };
}

/**
 * Find planning folders near the current one: its parent, the parent's children and grandchildren.
 * The walk is bounded, skips hidden/dependency folders and symlinks, and never descends into a planning folder.
 */
export async function discoverPlanningRoots(current: string, { depth = 2, limit = 600 } = {}): Promise<PlanningRootInfo[]> {
  const base = path.dirname(current);
  const found: PlanningRootInfo[] = [];
  const queue: { directory: string; level: number }[] = [{ directory: base, level: 0 }];
  let visited = 0;
  while (queue.length && visited < limit) {
    const { directory, level } = queue.shift()!;
    visited++;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { continue; }
    if (entries.some(entry => entry.name === 'planning.json' && entry.isFile())) {
      try { found.push(await inspectPlanningRoot(directory)); continue; } catch { /* Not a usable planning folder. */ }
    }
    if (level >= depth) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name.startsWith('$') || skipped.has(entry.name)) continue;
      queue.push({ directory: path.join(directory, entry.name), level: level + 1 });
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/** Recently opened planning folders, kept in the dashboard's data directory (never in planning). */
export class RecentPlanningRoots {
  constructor(private readonly filename: string) {}
  async list(): Promise<string[]> {
    try {
      const value = JSON.parse(await readFile(this.filename, 'utf8'));
      return Array.isArray(value?.recent) ? value.recent.filter((item: unknown): item is string => typeof item === 'string' && absolute(item)).slice(0, recentLimit) : [];
    } catch { return []; }
  }
  async remember(root: string) {
    const recent = [root, ...(await this.list()).filter(item => !samePlatformPath(item, root))].slice(0, recentLimit);
    try {
      await mkdir(path.dirname(this.filename), { recursive: true });
      const temporary = this.filename + '.' + process.pid + '.tmp';
      await writeFile(temporary, JSON.stringify({ recent }, null, 2) + '\n');
      await rename(temporary, this.filename);
    } catch { /* Recents are a convenience; switching still works without them. */ }
    return recent;
  }
}
export function samePlatformPath(first: string, second: string) {
  return process.platform === 'win32' || process.platform === 'darwin' ? first.toLowerCase() === second.toLowerCase() : first === second;
}
