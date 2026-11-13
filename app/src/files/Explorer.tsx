// The open plan's files, at the left of its pages: its work folder (plan, ledger,
// context, diagrams and the rest) as a tree of real folder and file names; a work item's diagram
// files open as its diagrams. A click, or Enter, opens a file in the window; folders open and close in
// place. Ctrl+Shift+E brings the keyboard to it.
import { createContext, useContext, useMemo } from 'react';
import { Menu, Text, Tree, type TreeItem } from '@envsemble/envui';
import { DiagramIcon, FileIcon, FolderIcon, FolderOpenIcon } from '../ui/icons';
import type { Document, Snapshot, Target, Work } from '../types';
import { api } from '../api';
import { buildIndex, fileNodeId, folderNodeId, revealIds, visibleRows, type ExplorerRow } from './explorerModel';
import { documentTarget, fileTarget, isDiagramFile } from '../navigation/targets';
import { workNumber } from '../ui/format';
import { useWindow } from '../window/windowContext';

/** The work item a place is of: a plan, its statistics or diagrams, or a file in its work folder; null for anything else. */
export function placeWork(target: Target | undefined, snapshot: Snapshot): Work | null {
  if (!target) return null;
  if (target.kind === 'file') return snapshot.work.find(work => target.path.startsWith(work.path + '/')) ?? null;
  return snapshot.work.find(work => work.id === target.work) ?? null;
}

/** The node of what the window shows, and the folders to open so it shows. */
export function nodeForTarget(target: Target | undefined, snapshot: Snapshot): { id: string; reveal: string[] } | null {
  if (!target) return null;
  if (target.kind === 'file') return { id: fileNodeId(target.path), reveal: revealIds(target.path) };
  if (target.kind === 'work' || target.kind === 'diagram') {
    const work = snapshot.work.find(item => item.id === target.work);
    if (!work) return null;
    if (target.kind === 'diagram' && target.path) { const path = work.path + '/' + target.path; return { id: fileNodeId(path), reveal: revealIds(path) }; }
    if (work.currentPlan) return { id: fileNodeId(work.currentPlan), reveal: revealIds(work.currentPlan) };
    return { id: folderNodeId(work.path), reveal: revealIds(work.path) };
  }
  return null;
}

type Row = TreeItem & { row: ExplorerRow };
/** How the open folders note that the plan's own folder is folded (it shows open otherwise). */
const folded = (id: string) => 'folded:' + id;

/** Which of a project's folders are open in the plan's files, and the row of what the window shows. */
export interface FilesState { expanded: string[]; setExpanded(next: string[]): void; selected: string | null }
export const FilesContext = createContext<FilesState>({ expanded: [], setExpanded: () => undefined, selected: null });

/**
 * The open plan's files, at the left of its pages: the plan's work folder as a tree, the file shown
 * marked. It stays in view as the page scrolls, and scrolls on its own when it is long.
 */
export function PlanFiles({ work }: { work: Work }) {
  const { projectId, open, notify, remote, snapshot } = useWindow();
  const { expanded, setExpanded, selected } = useContext(FilesContext);
  const index = useMemo(() => buildIndex(snapshot), [snapshot]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  // The plan's folder heads its files, open unless folded.
  const rows = useMemo(() => {
    const id = folderNodeId(work.path), open = !expandedSet.has(folded(id));
    const top: ExplorerRow = { id, kind: 'folder', name: work.path.slice(work.path.lastIndexOf('/') + 1), path: work.path, depth: 0, expandable: true, expanded: open };
    return [top, ...open ? visibleRows(index, expandedSet, work.path).map(row => ({ ...row, depth: row.depth + 1 })) : []].map(treeItem);
  }, [index, expandedSet, work.path]);
  // A file opens as a file, a diagram file of the work item as its diagram.
  const fileOpens = (file: Document) => documentTarget(file, isDiagramFile(file.path) ? work : undefined);
  const setOpen = (id: string, value: boolean) => {
    // The plan's folder is open unless folded; the others are folded unless opened.
    if (id === folderNodeId(work.path)) { setExpanded(value ? expanded.filter(item => item !== folded(id)) : [...expanded, folded(id)]); return; }
    if (value === expandedSet.has(id)) return;
    setExpanded(value ? [...expanded, id] : expanded.filter(item => item !== id));
  };
  const activate = ({ row }: Row) => {
    if (row.kind === 'file') open(fileOpens(row.file!));
    else setOpen(row.id, !row.expanded);
  };
  const reveal = (path: string) => { api.reveal(projectId, path).catch(error => notify((error as Error).message, 'warning')); };
  // A folder on another computer has no files here to reveal.
  const revealItem = (path: string) => remote ? null : <Menu.Item onClick={() => reveal(path)}>Show in Folder</Menu.Item>;
  const menu = (item: Row | null) => {
    const row = item?.row;
    const entries = !row ? null
      : row.kind === 'file' ? <>
        <Menu.Item onClick={() => open(fileOpens(row.file!))}>{isDiagramFile(row.path!) ? 'Open Diagram' : 'Open'}</Menu.Item>
        {isDiagramFile(row.path!) && <Menu.Item onClick={() => open(fileTarget(row.path!))}>Open as Text</Menu.Item>}
        {revealItem(row.path!)}
      </>
      : revealItem(row.path!);
    return <>{entries}{entries && <Menu.Separator />}<Menu.Item disabled={!expanded.length} onClick={() => setExpanded([])}>Collapse All Folders</Menu.Item></>;
  };
  return <nav className="plan-files" aria-label={'Files of ' + workNumber(work.id)}>
    <Text render={<h2 />} variant="body" className="plan-files-heading">Files</Text>
    {rows.length ? <Tree<Row> className="plan-files-tree" items={rows} aria-label={'Files of ' + workNumber(work.id) + ' ' + work.title} value={selected} density="sm"
      onAction={item => activate(item)}
      onExpandedChange={(item, value) => setOpen(item.value, value)}
      contextMenu={menu} />
      : <Text render={<p />} variant="body-sm" emphasis="muted" className="plan-files-empty">This work folder has no files.</Text>}
  </nav>;
}

/** Bring the keyboard to the plan's files (which takes focus itself and marks its active row). */
export function focusPlanFiles() {
  document.querySelector<HTMLElement>('.plan-files [role="tree"]')?.focus();
}

function treeItem(row: ExplorerRow): Row {
  const base = { value: row.id, depth: row.depth, expandable: row.expandable, expanded: row.expanded, row, textValue: row.name };
  if (row.kind !== 'file') return { ...base, label: row.name, icon: row.expanded ? <FolderOpenIcon className="explorer-folder" /> : <FolderIcon className="explorer-folder" />, tooltip: row.path };
  const diagram = isDiagramFile(row.path!) && Boolean(row.file?.workId);
  // Its whole name; its title, when it has one of its own, on hover.
  return { ...base, label: row.name, icon: diagram ? <DiagramIcon className="explorer-diagram" /> : <FileIcon className="explorer-file" />, tooltip: row.file && row.file.title !== row.file.name ? row.file.title + ' \u00b7 ' + row.path : row.path };
}
