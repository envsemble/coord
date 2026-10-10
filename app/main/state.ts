// Desktop state kept in the Atlas data folder (never in a planning folder): the windows open
// at quit, and per planning folder its window bounds, sidebar and open tabs.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defaultUiState, type UiState } from '../shared/contract.ts';
import { array, boolean, integer, object, optional, string, uiState, type Validator } from '../shared/validate.ts';

export interface Bounds { x: number; y: number; width: number; height: number }
export interface FolderRecord { root: string; bounds?: Bounds; maximized?: boolean; ui?: UiState; used: string }
export interface DesktopState { version: 1; windows: string[]; folders: Record<string, FolderRecord> }

const folderLimit = 40;
const coordinate = integer(-100000, 100000);
const bounds: Validator<Bounds> = object<Bounds>({ x: coordinate, y: coordinate, width: integer(200, 100000), height: integer(150, 100000) });
const record: Validator<FolderRecord> = object<FolderRecord>({ root: string({ min: 1 }), bounds: optional(bounds), maximized: optional(boolean), ui: optional(uiState), used: string({ max: 40 }) });

/** Key planning folders the way the platform compares paths. */
export function folderKey(root: string, platform: NodeJS.Platform = process.platform) {
  return platform === 'win32' || platform === 'darwin' ? root.toLowerCase() : root;
}

export function parseState(value: unknown): DesktopState {
  const empty: DesktopState = { version: 1, windows: [], folders: {} };
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return empty;
  const source = value as { windows?: unknown; folders?: unknown };
  let windows: string[] = [];
  try { windows = array(string({ min: 1 }), 20)(source.windows); } catch { /* Drop an unreadable window list. */ }
  const folders: Record<string, FolderRecord> = {};
  if (source.folders && typeof source.folders === 'object') {
    for (const item of Object.values(source.folders as Record<string, unknown>).slice(0, folderLimit * 2)) {
      try { const checked = record(item); folders[folderKey(checked.root)] = checked; } catch { /* Skip one damaged folder entry. */ }
    }
  }
  return { version: 1, windows, folders };
}

export class StateStore {
  private readonly file: string;
  private state: DesktopState;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onError: (error: unknown) => void;

  constructor(file: string, onError: (error: unknown) => void = () => undefined) {
    this.file = file;
    this.onError = onError;
    let parsed: unknown = null;
    try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch { /* First run or unreadable: start empty. */ }
    this.state = parseState(parsed);
  }

  get windows() { return [...this.state.windows]; }
  folder(root: string): FolderRecord | undefined { return this.state.folders[folderKey(root)]; }
  ui(root: string): UiState { return structuredClone(this.folder(root)?.ui ?? defaultUiState); }

  updateFolder(root: string, change: Partial<Omit<FolderRecord, 'root' | 'used'>>) {
    const key = folderKey(root);
    this.state.folders[key] = { ...this.state.folders[key], ...change, root, used: new Date().toISOString() };
    const keys = Object.keys(this.state.folders);
    if (keys.length > folderLimit) {
      keys.sort((a, b) => this.state.folders[a].used.localeCompare(this.state.folders[b].used));
      for (const old of keys.slice(0, keys.length - folderLimit)) delete this.state.folders[old];
    }
    this.schedule();
  }
  setWindows(roots: string[]) {
    this.state.windows = roots.slice(0, 20);
    this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 250);
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = this.file + '.' + process.pid + '.tmp';
      writeFileSync(temporary, JSON.stringify(this.state, null, 2) + '\n');
      renameSync(temporary, this.file);
    } catch (error) { this.onError(error); }
  }
}

