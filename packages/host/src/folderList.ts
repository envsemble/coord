// The computer's folder list: every planning folder opened on this computer, from any device, the
// command line or `atlas serve --folder`, newest first. Every device sees the same list, and a folder
// stays on it until someone removes it. Kept in <Atlas data folder>/host/folders.json. Any host
// process on the data folder may change it (it reads, changes and writes the file), so it is read
// again for every use. The first time, it starts from the app's recent folders and the folders the
// first remote access shared.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HostError, type Logger } from './errors.ts';
import { pathKey } from './folders.ts';
import { array, integer, nullable, object, string, type Validator } from './validate.ts';

export interface FolderListEntry { path: string; openedAt: string | null }
interface FolderListFile { version: 1; folders: FolderListEntry[] }

/** A guard for the file, not a pruning rule: nobody opens this many planning folders. */
export const folderListLimit = 500;
const entry = object<FolderListEntry>({ path: string({ min: 1, max: 2048 }), openedAt: nullable(string({ min: 1, max: 40 })) });
const listFile = object<FolderListFile>({ version: integer(1, 1) as unknown as Validator<1>, folders: array(entry, folderListLimit) });

export class FolderList {
  readonly file: string;
  private readonly log: Logger;
  private readonly seed: () => Promise<string[]>;
  /** Changes run one at a time within this process. */
  private queue: Promise<unknown> = Promise.resolve();

  /** `seed`: the folders the list starts with when it does not exist yet. */
  constructor(directory: string, log: Logger, seed: () => Promise<string[]>) {
    this.file = path.join(directory, 'folders.json');
    this.log = log;
    this.seed = seed;
  }

  /** The list, newest first (empty while the file cannot be read). */
  entries(): Promise<FolderListEntry[]> { return this.run(async () => (await this.read()).folders); }

  /** A folder was opened: it moves to the top of the list. */
  touch(root: string): Promise<FolderListEntry[]> {
    return this.run(async () => {
      const list = await this.changeable();
      const next = [{ path: root, openedAt: new Date().toISOString() }, ...list.filter(item => pathKey(item.path) !== pathKey(root))].slice(0, folderListLimit);
      await this.write(next);
      return next;
    });
  }

  /** Remove a folder from the list (for every device). Returns whether it was listed. */
  remove(root: string): Promise<boolean> {
    return this.run(async () => {
      const list = await this.changeable();
      const next = list.filter(item => pathKey(item.path) !== pathKey(root));
      if (next.length === list.length) return false;
      await this.write(next);
      return true;
    });
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * The list as the file has it. `readable` is false when the file is there but cannot be read now
   * (another program holds it, say): then nothing may replace it.
   */
  private async read(): Promise<{ folders: FolderListEntry[]; readable: boolean }> {
    let text: string;
    try { text = await readFile(this.file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { this.log.warn('Folder list unreadable', error); return { folders: [], readable: false }; }
      return { folders: await this.start(), readable: true };
    }
    try { return { folders: listFile(JSON.parse(text)).folders, readable: true }; }
    catch (error) {
      // A damaged list is only a convenience lost: the next change writes a new one.
      this.log.warn('Folder list damaged; starting a new one', { message: (error as Error).message });
      return { folders: [], readable: true };
    }
  }
  /** The list, to change it; refused while the file cannot be read, so a change cannot erase it. */
  private async changeable(): Promise<FolderListEntry[]> {
    const { folders, readable } = await this.read();
    if (!readable) throw new HostError('unavailable', 'The folder list cannot be read right now, so it was left as it is.');
    return folders;
  }
  /** The first list: the folders it starts with, in their order, without duplicates. */
  private async start(): Promise<FolderListEntry[]> {
    const seen = new Set<string>();
    const first: FolderListEntry[] = [];
    for (const root of await this.seed().catch(() => [])) {
      if (!path.isAbsolute(root) || seen.has(pathKey(root))) continue;
      seen.add(pathKey(root));
      first.push({ path: root, openedAt: null });
    }
    await this.write(first.slice(0, folderListLimit)).catch(error => this.log.warn('Folder list not saved', error));
    return first;
  }
  private async write(folders: FolderListEntry[]) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, folders } satisfies FolderListFile, null, 2) + '\n', { mode: 0o600 });
      await rename(temporary, this.file);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
