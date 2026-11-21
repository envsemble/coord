// Moving a planning folder forward to the registry this Coord writes (schema version 3), once, by
// itself, before anything else reads it. Version 2 gave every part of a work item a number of its
// own and listed the parts in the group's plan (`parts`). Version 3 gives a work item one number:
// the group's own plan is its first part and keeps its ID, and each part takes the work item's
// number with its own (work-0046-2), in the order the group listed them, keeping its old ID as a
// former one (`former_ids`), so everything written about it still leads to it. A folder without
// groups changes its version alone.
//
// The move changes the registry, the renumbered parts' plans and ledgers (their `id` and
// `work_id`), the groups' plans (their `parts` line goes) and the home database's rows about the
// renumbered parts. It keeps a record of what it maps beside a lock in the folder, so two Coords
// meeting the folder at once wait for one move, and one that was cut short is finished by the next
// to come. It commits what it changed in the folder's Git when those files had nothing uncommitted
// before; otherwise the changes are left for whoever commits there.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from '../check/check.ts';
import { databaseName, HomeDatabase } from '../../home/database.ts';
import { coordHome } from '../../home/homePath.ts';
import { runProgram } from '../../platform/run.ts';
import { header } from '../work/headerText.ts';
import { formerIds, parseWorkId, partId } from '../work/ids.ts';
import { setRegistryMember, updateRegistryEntry } from './registryText.ts';

/** The registry version this Coord reads and writes. */
export const registryVersion = 3;
/** The version it moves forward from. */
const earlierVersion = 2;
const lockName = '.coord-move';
const BOM = String.fromCharCode(0xfeff);
const plainId = /^work-[0-9]{4,}$/;

interface Entry { id?: unknown; path?: unknown; current_plan?: unknown }
interface Registry { schema_version?: unknown; work_items?: unknown; former_ids?: unknown }

const parse = (text: string): Registry | null => {
  try { const value = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
  catch { return null; }
};
const inside = (root: string, relative: unknown) =>
  typeof relative === 'string' && relative && !relative.includes('\\') && !relative.split('/').includes('..') ? path.join(root, ...relative.split('/')) : null;

/** Write a file whole or not at all. */
async function write(file: string, text: string) {
  const temporary = file + '.move.tmp';
  await writeFile(temporary, text);
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, file); return; }
    catch (error) {
      if (attempt >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) { await rm(temporary, { force: true }); throw error; }
      await new Promise(resolve => setTimeout(resolve, 50 + attempt * 25));
    }
  }
}

/** A version 2 plan header's parts: the plain work IDs it lists, each once, never the plan's own. */
function listedParts(value: unknown, self: string): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && plainId.test(item)))].filter(id => id !== self) : [];
}

/**
 * What a version 2 registry's parts become: per old ID, the new one. Groups are taken in the
 * registry's order; a part belongs to the first group that lists it, and a part's own list counts
 * for nothing (groups were one level deep).
 */
export async function partRenames(root: string, registry: Registry): Promise<{ renames: Map<string, string>; groups: string[] }> {
  const entries = (Array.isArray(registry.work_items) ? registry.work_items as Entry[] : []).filter(entry => typeof entry?.id === 'string' && plainId.test(entry.id));
  const registered = new Set(entries.map(entry => entry.id as string));
  const lists = new Map<string, string[]>();
  for (const entry of entries) {
    const file = inside(root, entry.current_plan);
    const text = file ? await readFile(file, 'utf8').catch(() => null) : null;
    let metadata = null;
    try { metadata = text === null ? null : parseFrontmatter(text.startsWith(BOM) ? text.slice(1) : text); } catch { /* A plan that cannot be read lists nothing. */ }
    lists.set(entry.id as string, listedParts(metadata?.parts, entry.id as string).filter(id => registered.has(id)));
  }
  const renames = new Map<string, string>(), groups: string[] = [], heads = new Set<string>();
  for (const entry of entries) {
    const group = entry.id as string;
    if (renames.has(group)) continue;
    const parts = (lists.get(group) ?? []).filter(id => !renames.has(id) && !heads.has(id));
    if (!parts.length) continue;
    heads.add(group);
    groups.push(group);
    const number = parseWorkId(group)!.number;
    parts.forEach((part, index) => renames.set(part, partId(number, index + 2)));
  }
  return { renames, groups };
}

/** A header's line `field: old` as `field: now`; the text unchanged when it has no such line. */
export function renamedField(text: string, field: string, old: string, now: string) {
  const found = header(text);
  if (!found) return text;
  const block = found.block.replace(new RegExp(`^(${field}:[ \\t]*)(["']?)${old}\\2([ \\t]*)$`, 'm'), (_, before: string, quote: string, after: string) => before + quote + now + quote + after);
  return text.slice(0, found.start) + block + text.slice(found.end);
}
/** A header without its `parts` field, written on one line or as a block list. */
function withoutParts(text: string) {
  const found = header(text);
  if (!found) return text;
  const lines = found.block.split(/\r?\n/), kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!/^parts:/.test(lines[index])) { kept.push(lines[index]); continue; }
    while (index + 1 < lines.length && /^[ \t]+\S/.test(lines[index + 1])) index++;
  }
  return text.slice(0, found.start) + kept.join(found.eol) + text.slice(found.end);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The folder's lock for the move, taken or waited out; false when another Coord made the move meanwhile. */
async function takeLock(root: string): Promise<boolean> {
  const lock = path.join(root, lockName);
  for (let attempt = 0; ; attempt++) {
    try { await mkdir(lock); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (parse(await readFile(path.join(root, 'planning.json'), 'utf8').catch(() => ''))?.schema_version !== earlierVersion) return false;
      // A move cut short leaves its lock: after a minute it is anyone's to finish.
      const age = Date.now() - (await stat(lock).then(info => info.mtimeMs, () => Date.now()));
      if (age > 60_000 || attempt >= 300) return true;
      await sleep(100);
    }
  }
}

/**
 * Move the planning folder forward when its registry is of the earlier version; anything else is
 * left as it is (a current folder, or one this Coord cannot read, which its readers report). True
 * when it moved it. `home` is the Coord home whose database knows the project (the default home
 * unless given).
 */
export async function moveForward(root: string, options: { home?: string } = {}): Promise<boolean> {
  const file = path.join(root, 'planning.json');
  const read = async () => readFile(file, 'utf8').catch(() => null);
  let text = await read();
  if (text === null) return false;
  if (parse(text)?.schema_version !== earlierVersion) return false;
  if (!await takeLock(root)) return false;
  const lock = path.join(root, lockName), record = path.join(lock, 'renames.json');
  let changed: string[] = [];
  let clean = false;
  try {
    text = await read();
    const registry = text === null ? null : parse(text);
    if (text === null || registry?.schema_version !== earlierVersion) return false;
    // What it maps: as recorded by a move that was cut short, else as the folder says now.
    let plan: { renames: [string, string][]; groups: string[] };
    const recorded = await readFile(record, 'utf8').then(value => JSON.parse(value) as typeof plan, () => null);
    if (recorded && Array.isArray(recorded.renames) && Array.isArray(recorded.groups)) plan = recorded;
    else {
      const found = await partRenames(root, registry);
      plan = { renames: [...found.renames], groups: found.groups };
      await writeFile(record, JSON.stringify(plan));
    }
    const renames = new Map(plan.renames);
    const entries = (Array.isArray(registry.work_items) ? registry.work_items as Entry[] : []);
    const entryOf = (id: string) => entries.find(entry => entry?.id === id);
    // The files it will change, and whether Git has them as committed (so its commit carries the move alone).
    const files = new Map<string, (text: string) => string>();
    const add = (relative: unknown, change: (text: string) => string) => { if (typeof relative === 'string' && inside(root, relative)) files.set(relative, change); };
    for (const [old, now] of renames) {
      const entry = entryOf(old);
      add(entry?.current_plan, value => renamedField(value, 'id', old, now));
      if (typeof entry?.path === 'string') add(entry.path.replace(/\/+$/, '') + '/ledger.md', value => renamedField(value, 'work_id', old, now));
    }
    for (const group of plan.groups) add(entryOf(group)?.current_plan, withoutParts);
    const paths = ['planning.json', ...files.keys()];
    clean = await runProgram('git', ['-C', root, 'status', '--porcelain', '--', ...paths], { timeout: 10_000 }).then(({ stdout }) => stdout.trim() === '', () => false);
    for (const [relative, change] of files) {
      const target = inside(root, relative)!;
      const before = await readFile(target, 'utf8').catch(() => null);
      if (before === null) continue;
      const after = change(before);
      if (after !== before) { await write(target, after); changed.push(relative); }
    }
    // The database's rows about the renumbered parts, when the home knows this project.
    const home = options.home ?? coordHome();
    if (renames.size && existsSync(path.join(home, databaseName))) {
      try {
        const database = HomeDatabase.open(home);
        try {
          const project = database.projectByFolder(root);
          if (project) database.renameWork(project.id, renames);
        } finally { database.close(); }
      } catch { /* A database this Coord cannot open keeps its rows: the former IDs still say whose they are. */ }
    }
    // The registry last: until it is written, the folder is still to be moved.
    let next = text;
    for (const [old, now] of renames) if (entryOf(old)) next = updateRegistryEntry(next, 'work_items', old, { id: now });
    if (renames.size) next = setRegistryMember(next, 'former_ids', Object.fromEntries([...formerIds(registry.former_ids), ...renames]), ['work_items']);
    next = setRegistryMember(next, 'schema_version', registryVersion);
    await write(file, next);
    changed = ['planning.json', ...changed];
  } finally {
    await rm(lock, { recursive: true, force: true }).catch(() => undefined);
  }
  if (clean) {
    // Its own commit, of these files alone; a folder that is no repository, or a Git that refuses, leaves them changed.
    await runProgram('git', ['-C', root, 'commit', '-m', 'Coord: work items keep one number, their parts numbered under it (planning.json version 3)', '--', ...changed], { timeout: 20_000 }).catch(() => undefined);
  }
  return true;
}
