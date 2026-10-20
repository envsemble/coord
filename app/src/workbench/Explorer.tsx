// The open plan's files, in a card always beside its pages: its work folder (plan, ledger, context,
// diagrams and the rest) as a tree of real folder and file names; a work item's diagram
// files open as its diagrams. A click, or Enter, opens a file in the window; folders open and close in
// place.
import { createContext, useContext, useMemo } from 'react';
import { MenuItem, MenuSeparator, Surface, Text, Tree, type TreeItem } from '@envsemble/envui';
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
/** How the open folders note that the plan's own folder is folded (it shows open otherwise). */
const folded = (id: string) => 'folded:' + id;

/** Which of a project's folders are open in the Files card, and the row of what the window shows. */
export interface FilesState { expanded: string[]; setExpanded(next: string[]): void; selected: string | null }
export const FilesContext = createContext<FilesState>({ expanded: [], setExpanded: () => undefined, selected: null });

/**
 * The open plan's files, always on its pages: a card with the plan's work folder as a tree, the file
 * shown marked. It keeps beside the page as it scrolls, and scrolls on its own when it is long.
 */
export function PlanFiles({ work }: { work: Work }) {
  const { project, open, notify, remote, snapshot } = useWorkbench();
  const { expanded, setExpanded, selected } = useContext(FilesContext);
  const index = useMemo(() => buildIndex(snapshot), [snapshot]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  // The plan's folder heads its files, open unless folded.
  const rows = useMemo(() => {
    const id = folderId(work.path), open = !expandedSet.has(folded(id));
    const top: ExplorerRow = { id, kind: 'folder', name: work.path.slice(work.path.lastIndexOf('/') + 1), path: work.path, depth: 0, expandable: true, expanded: open };
    return [top, ...open ? visibleRows(index, expandedSet, work.path).map(row => ({ ...row, depth: row.depth + 1 })) : []].map(treeItem);
  }, [index, expandedSet, work.path]);
  // A file opens as a file, a diagram file of the work item as its diagram.
  const fileOpens = (file: Document) => documentTarget(file, isDiagramFile(file.path) ? work : undefined);
  const setOpen = (id: string, value: boolean) => {
    // The plan's folder is open unless folded; the others are folded unless opened.
    if (id === folderId(work.path)) { setExpanded(value ? expanded.filter(item => item !== folded(id)) : [...expanded, folded(id)]); return; }
    if (value === expandedSet.has(id)) return;
    setExpanded(value ? [...expanded, id] : expanded.filter(item => item !== id));
  };
  const activate = ({ row }: Row) => {
    if (row.kind === 'file') open(fileOpens(row.file!));
    else setOpen(row.id, !row.expanded);
  };
  const reveal = (path: string) => { api.reveal(project, path).catch(error => notify((error as Error).message, 'warning')); };
  // A folder on another computer has no files here to reveal.
  const revealItem = (path: string) => remote ? null : <MenuItem onClick={() => reveal(path)}>Show in Folder</MenuItem>;
  const menu = (item: Row | null) => {
    const row = item?.row;
    const entries = !row ? null
      : row.kind === 'file' ? <>
        <MenuItem onClick={() => open(fileOpens(row.file!))}>{isDiagramFile(row.path!) ? 'Open Diagram' : 'Open'}</MenuItem>
        {isDiagramFile(row.path!) && <MenuItem onClick={() => open(fileTarget(row.path!))}>Open as Text</MenuItem>}
        {revealItem(row.path!)}
      </>
      : revealItem(row.path!);
    return <>{entries}{entries && <MenuSeparator />}<MenuItem disabled={!expanded.length} onClick={() => setExpanded([])}>Collapse All Folders</MenuItem></>;
  };
  return <Surface as="section" className="plan-files" padding={2} aria-label={'Files of ' + workNumber(work.id)}>
    <Text as="h2" variant="section-heading" className="plan-files-heading">Files</Text>
    {rows.length ? <div className="plan-files-tree" style={{ blockSize: 'calc(' + rows.length + ' * var(--plan-files-row))' }}>
      <Tree<Row> items={rows} aria-label={'Files of ' + workNumber(work.id) + ' ' + work.title} selectedId={selected} density="compact"
        onOpen={item => activate(item)}
        onExpandedChange={(item, value) => setOpen(item.id, value)}
        contextMenu={menu} />
    </div> : <p className="plan-files-empty muted">This work folder has no files.</p>}
  </Surface>;
}

/** Bring the keyboard to the Files card's tree (which takes focus itself and marks its active row). */
export function focusPlanFiles() {
  document.querySelector<HTMLElement>('.plan-files [role="tree"]')?.focus();
}

function treeItem(row: ExplorerRow): Row {
  const base = { id: row.id, depth: row.depth, expandable: row.expandable, expanded: row.expanded, row, textValue: row.name };
  if (row.kind !== 'file') return { ...base, label: row.name, icon: row.expanded ? <FolderOpenIcon className="explorer-folder" /> : <FolderIcon className="explorer-folder" />, title: row.path };
  const diagram = isDiagramFile(row.path!) && Boolean(row.file?.workId);
  // Its whole name; its title, when it has one of its own, on hover.
  return { ...base, label: row.name, icon: diagram ? <DiagramIcon className="explorer-diagram" /> : <FileIcon className="explorer-file" />, title: row.file && row.file.title !== row.file.name ? row.file.title + ' \u00b7 ' + row.path : row.path };
}
