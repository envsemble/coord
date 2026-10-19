// The explorer mirrors the planning folder on disk, or one folder of it (a plan's work folder): real
// folder and file names, dot folders hidden. Diagram files (.puml) open as diagrams. Only
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
    addFolder(parent(document.path));
    const siblings = files.get(parent(document.path)) ?? [];
    siblings.push(document);
    files.set(parent(document.path), siblings);
  }
  for (const list of folders.values()) list.sort((a, b) => compare(base(a), base(b)));
  for (const list of files.values()) list.sort((a, b) => compare(a.name, b.name));
  return { folders, files, works: new Map(snapshot.work.map(work => [work.path, work])) };
}

export const folderId = (path: string) => 'd:' + path;
export const fileId = (path: string) => 'f:' + path;

/** The rows of a folder (`root`: the planning folder's own by default) and of its folders that are open. */
export function visibleRows(index: ExplorerIndex, expanded: ReadonlySet<string>, root = ''): ExplorerRow[] {
  const rows: ExplorerRow[] = [];
  const visit = (directory: string, depth: number) => {
    for (const path of index.folders.get(directory) ?? []) {
      const id = folderId(path);
      const work = index.works.get(path);
      const open = expanded.has(id);
      rows.push({ id, kind: work ? 'work' : 'folder', name: base(path), path, depth, expandable: true, expanded: open, work });
      if (!open) continue;
      visit(path, depth + 1);
    }
    for (const file of index.files.get(directory) ?? []) rows.push({ id: fileId(file.path), kind: 'file', name: file.name, path: file.path, depth, expandable: false, expanded: false, file });
  };
  visit(root, 0);
  return rows;
}

/** The ids to expand so that a path becomes visible. */
export function revealIds(path: string): string[] {
  const ids: string[] = [];
  let current = parent(path);
  while (current) { ids.push(folderId(current)); current = parent(current); }
  return ids;
}
