// The explorer mirrors the planning folder on disk, or one folder of it (a plan's work folder): real
// folder and file names, dot folders hidden. Diagram files (.puml) open as diagrams; the arrangement
// a reader gave a diagram (name.layout.json beside it) is the diagram’s, and not listed. Only
// expanded branches are flattened into rows, so very large folders stay cheap: the tree renders
// just the rows in view.
import type { Document, Snapshot, Work } from '../types';

export type NodeKind = 'folder' | 'work' | 'file';
export interface ExplorerRow {
  id: string;
  kind: NodeKind;
  name: string;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  path?: string;
  work?: Work;
  file?: Document;
}

export interface ExplorerIndex {
  folders: Map<string, string[]>;
  files: Map<string, Document[]>;
  works: Map<string, Work>;
}

const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const parent = (path: string) => { const index = path.lastIndexOf('/'); return index < 0 ? '' : path.slice(0, index); };
const base = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export function buildIndex(snapshot: Pick<Snapshot, 'folders' | 'documents' | 'work'>): ExplorerIndex {
  const folders = new Map<string, string[]>();
  const files = new Map<string, Document[]>();
  const known = new Set<string>();
  const addFolder = (path: string) => {
    if (!path || known.has(path)) return;
    known.add(path);
    addFolder(parent(path));
    const siblings = folders.get(parent(path)) ?? [];
    siblings.push(path);
    folders.set(parent(path), siblings);
  };
  for (const folder of snapshot.folders) addFolder(folder);
  for (const document of snapshot.documents) {
    if (/\.layout\.json$/i.test(document.path)) continue;
    addFolder(parent(document.path));
    const siblings = files.get(parent(document.path)) ?? [];
    siblings.push(document);
    files.set(parent(document.path), siblings);
  }
  for (const list of folders.values()) list.sort((a, b) => compare(base(a), base(b)));
  for (const list of files.values()) list.sort((a, b) => compare(a.name, b.name));
  return { folders, files, works: new Map(snapshot.work.map(work => [work.path, work])) };
}

export const folderNodeId = (path: string) => 'd:' + path;
export const fileNodeId = (path: string) => 'f:' + path;

/**
 * The rows of a folder (`root`: the planning folder's own by default) and of its folders that are open.
 * `layers` maps a diagram's first file to its other layers (later captures and proposals, in order,
 * by their paths): the first file opens like a folder onto them, and they are listed only there.
 */
export function visibleRows(index: ExplorerIndex, expanded: ReadonlySet<string>, root = '', layers: ReadonlyMap<string, readonly string[]> = new Map()): ExplorerRow[] {
  const rows: ExplorerRow[] = [];
  const nested = new Set([...layers.values()].flat());
  const byPath = new Map([...index.files.values()].flat().map(file => [file.path, file]));
  const visit = (directory: string, depth: number) => {
    for (const path of index.folders.get(directory) ?? []) {
      const id = folderNodeId(path);
      const work = index.works.get(path);
      const open = expanded.has(id);
      rows.push({ id, kind: work ? 'work' : 'folder', name: base(path), path, depth, expandable: true, expanded: open, work });
      if (!open) continue;
      visit(path, depth + 1);
    }
    for (const file of index.files.get(directory) ?? []) {
      if (nested.has(file.path)) continue;
      const own = (layers.get(file.path) ?? []).filter(path => byPath.has(path));
      const open = own.length > 0 && expanded.has(fileNodeId(file.path));
      rows.push({ id: fileNodeId(file.path), kind: 'file', name: file.name, path: file.path, depth, expandable: own.length > 0, expanded: open, file });
      if (open) for (const path of own) rows.push({ id: fileNodeId(path), kind: 'file', name: byPath.get(path)!.name, path, depth: depth + 1, expandable: false, expanded: false, file: byPath.get(path) });
    }
  };
  visit(root, 0);
  return rows;
}

/** The ids to expand so that a path becomes visible. */
export function revealIds(path: string): string[] {
  const ids: string[] = [];
  let current = parent(path);
  while (current) { ids.push(folderNodeId(current)); current = parent(current); }
  return ids;
}
