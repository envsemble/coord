// The open plan's files, for the Files card under the title bar's button: its work folder (plan,
// ledger, context, diagrams, evidence and the rest) as a tree of real folder and file names; a work
// item's diagram files open as its diagrams. A click, or Enter, opens a file in the window and closes
// the card; folders open and close in place.
import { useMemo } from 'react';
import { MenuItem, MenuSeparator, Tree, type TreeItem } from '@envsemble/envui';
import { DiagramIcon, FileIcon, FolderIcon, FolderOpenIcon } from '../ui/icons';
import type { Document, Snapshot, Target, Work } from '../types';
import { api } from '../api';
import { buildIndex, fileId, folderId, revealIds, visibleRows, type ExplorerRow } from './explorerModel';
import { documentTarget, fileTarget, isDiagramFile } from '../navigation/targets';
import { workNumber } from '../ui/format';
import { useWorkbench } from './workbenchContext';

/** The work item a place is of: a plan, its statistics or diagrams, or a file in its work folder; null for anything else. */
export function placeWork(target: Target | undefined, snapshot: Snapshot): Work | null {
  if (!target) return null;
  if (target.kind === 'file') return snapshot.work.find(work => target.path.startsWith(work.path + '/')) ?? null;
  return snapshot.work.find(work => work.id === target.work) ?? null;
}

/** The node of what the window shows, and the folders to open so it shows. */
export function nodeForTarget(target: Target | undefined, snapshot: Snapshot): { id: string; reveal: string[] } | null {
  if (!target) return null;
  if (target.kind === 'file') return { id: fileId(target.path), reveal: revealIds(target.path) };
  if (target.kind === 'work' || target.kind === 'diagram') {
    const work = snapshot.work.find(item => item.id === target.work);
    if (!work) return null;
    if (target.kind === 'diagram' && target.path) { const path = work.path + '/' + target.path; return { id: fileId(path), reveal: revealIds(path) }; }
    if (work.currentPlan) return { id: fileId(work.currentPlan), reveal: revealIds(work.currentPlan) };
    return { id: folderId(work.path), reveal: revealIds(work.path) };
  }
  return null;
}

type Row = TreeItem & { row: ExplorerRow };

/** How many rows the card shows before it scrolls. */
const shownRows = 14;

export function Explorer({ snapshot, work, expanded, setExpanded, selected, onChosen }: {
  snapshot: Snapshot; work: Work; expanded: string[]; setExpanded(next: string[]): void; selected: string | null;
  /** A file was opened: the card closes. */
  onChosen(): void;
}) {
  const { project, open, notify, remote } = useWorkbench();
  const index = useMemo(() => buildIndex(snapshot), [snapshot]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const rows = useMemo(() => visibleRows(index, expandedSet, work.path).map(treeItem), [index, expandedSet, work.path]);
  // A file opens as a file, a diagram file of the work item as its diagram.
  const fileOpens = (file: Document) => documentTarget(file, isDiagramFile(file.path) ? work : undefined);
  const setOpen = (id: string, value: boolean) => {
    if (value === expandedSet.has(id)) return;
    setExpanded(value ? [...expanded, id] : expanded.filter(item => item !== id));
  };
  const activate = ({ row }: Row) => {
    if (row.kind === 'file') { open(fileOpens(row.file!)); onChosen(); return; }
    setOpen(row.id, !row.expanded);
  };
  const reveal = (path: string) => { api.reveal(project, path).catch(error => notify((error as Error).message, 'warning')); };
  // A folder on another computer has no files here to reveal.
  const revealItem = (path: string) => remote ? null : <MenuItem onClick={() => reveal(path)}>Show in Folder</MenuItem>;
  const menu = (item: Row | null) => {
    const row = item?.row;
    const entries = !row ? null
      : row.kind === 'file' ? <>
        <MenuItem onClick={() => { open(fileOpens(row.file!)); onChosen(); }}>{isDiagramFile(row.path!) ? 'Open Diagram' : 'Open'}</MenuItem>
        {isDiagramFile(row.path!) && <MenuItem onClick={() => { open(fileTarget(row.path!)); onChosen(); }}>Open as Text</MenuItem>}
        {revealItem(row.path!)}
      </>
      : revealItem(row.path!);
    return <>{entries}{entries && <MenuSeparator />}<MenuItem disabled={!expanded.length} onClick={() => setExpanded([])}>Collapse All Folders</MenuItem></>;
  };
  if (!rows.length) return <p className="explorer-empty muted">This work folder has no files.</p>;
  return <div className="explorer" style={{ blockSize: 'calc(' + Math.min(rows.length, shownRows) + ' * var(--explorer-row))' }}>
    <Tree<Row> className="explorer-tree" items={rows} aria-label={'Files of ' + workNumber(work.id) + ' ' + work.title} selectedId={selected} density="compact"
      onOpen={item => activate(item)}
      onExpandedChange={(item, value) => setOpen(item.id, value)}
      contextMenu={menu} />
  </div>;
}

function treeItem(row: ExplorerRow): Row {
  const base = { id: row.id, depth: row.depth, expandable: row.expandable, expanded: row.expanded, row, textValue: row.name };
  if (row.kind !== 'file') return { ...base, label: row.name, icon: row.expanded ? <FolderOpenIcon className="explorer-folder" /> : <FolderIcon className="explorer-folder" />, title: row.path };
  const diagram = isDiagramFile(row.path!) && Boolean(row.file?.workId);
  return { ...base, label: row.name, icon: diagram ? <DiagramIcon className="explorer-diagram" /> : <FileIcon className="explorer-file" />, detail: row.file && row.file.title !== row.file.name ? row.file.title : undefined, title: row.path };
}
