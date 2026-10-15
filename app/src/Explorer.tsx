// A project's files in the file panel: work folders with their status and plan title, and files; a
// work item's diagram files open as its diagrams. A click, or Enter, opens an item in the window.
import { useMemo } from 'react';
import { IconButton, MenuItem, MenuSeparator, Tooltip, Tree, type TreeItem } from '@envsemble/envui';
import { CollapseAllIcon, DiagramIcon, FileIcon, FolderIcon, FolderOpenIcon } from './icons';
import type { Document, Snapshot, Target } from './types';
import { api } from './api';
import { buildIndex, fileId, folderId, revealIds, visibleRows, type ExplorerRow } from './explorerModel';
import { diagramTarget, documentTarget, fileTarget, isDiagramFile, workTarget } from './targets';
import { workStatus } from './status';
import { workNumber } from './format';
import { StatusIcon } from './ui';
import { useWorkbench } from './workbenchContext';

/** The explorer node of what the window shows. */
export function nodeForTarget(target: Target | undefined, snapshot: Snapshot): { id: string; reveal: string[] } | null {
  if (!target) return null;
  if (target.kind === 'file') return { id: fileId(target.path), reveal: revealIds(target.path) };
  if (target.kind === 'work' || target.kind === 'diagram') {
    const work = snapshot.work.find(item => item.id === target.work);
    if (!work) return null;
    if (target.kind === 'diagram' && target.path) { const path = work.path + '/' + target.path; return { id: fileId(path), reveal: revealIds(path) }; }
    return { id: folderId(work.path), reveal: revealIds(work.path) };
  }
  return null;
}

type Row = TreeItem & { row: ExplorerRow };

export function Explorer({ snapshot, expanded, setExpanded, selected }: {
  snapshot: Snapshot; expanded: string[]; setExpanded(next: string[]): void; selected: string | null;
}) {
  const { project, projectName, open, notify, remote, exportPlan } = useWorkbench();
  const index = useMemo(() => buildIndex(snapshot), [snapshot]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const rows = useMemo(() => visibleRows(index, expandedSet).map(row => treeItem(row)), [index, expandedSet]);
  // A file opens as a file, a diagram file of a work item as its diagram.
  const fileOpens = (file: Document) => documentTarget(file, isDiagramFile(file.path) ? snapshot.work.find(work => work.id === file.workId) : undefined);
  const setOpen = (id: string, value: boolean) => {
    if (value === expandedSet.has(id)) return;
    setExpanded(value ? [...expanded, id] : expanded.filter(item => item !== id));
  };
  const activate = ({ row }: Row) => {
    switch (row.kind) {
      case 'folder': setOpen(row.id, !row.expanded); break;
      case 'work': setOpen(row.id, true); open(workTarget(row.work!.id)); break;
      case 'file': open(fileOpens(row.file!)); break;
    }
  };
  const reveal = (path: string) => { api.reveal(project, path).catch(error => notify((error as Error).message, 'warning')); };
  // A folder on another computer has no files here to reveal.
  const revealItem = (path: string) => remote ? null : <MenuItem onClick={() => reveal(path)}>Reveal in File Explorer</MenuItem>;
  const collapseAll = <MenuItem disabled={!expanded.length} onClick={() => setExpanded([])}>Collapse All Folders</MenuItem>;
  const menu = (item: Row | null) => {
    const row = item?.row;
    const entries = !row ? null
      : row.kind === 'work' ? <>
        <MenuItem onClick={() => open(workTarget(row.work!.id))}>Open Plan</MenuItem>
        <MenuItem disabled={!row.work!.diagrams} onClick={() => open(diagramTarget(row.work!.id))}>Open Diagrams</MenuItem>
        <MenuSeparator />
        <MenuItem onClick={() => exportPlan(row.work!.id)}>Export Plan…</MenuItem>
        {!remote && <><MenuSeparator />{revealItem(row.path!)}</>}
      </>
      : row.kind === 'folder' ? revealItem(row.path!)
      : row.kind === 'file' ? <>
        <MenuItem onClick={() => open(fileOpens(row.file!))}>{isDiagramFile(row.path!) && row.file!.workId ? 'Open Diagram' : 'Open'}</MenuItem>
        {isDiagramFile(row.path!) && <MenuItem onClick={() => open(fileTarget(row.path!))}>Open as Text</MenuItem>}
        {revealItem(row.path!)}
      </>
      : null;
    // Every right-click in the explorer, on a row or on empty space, can collapse its folders.
    return <>{entries}{entries && <MenuSeparator />}{collapseAll}</>;
  };

  // The project's name heads its files.
  return <div className="explorer">
    <div className="explorer-header">
      <h3 className="explorer-title" title={remote ? `${projectName} on ${remote.hostName}` : snapshot.root}>{projectName}</h3>
      <Tooltip content="Collapse all folders">
        <IconButton variant="text" icon={<CollapseAllIcon />} aria-label="Collapse all folders" disabled={!expanded.length} onClick={() => setExpanded([])} />
      </Tooltip>
    </div>
    <Tree<Row> className="explorer-tree" items={rows} aria-label={'Files of ' + projectName} selectedId={selected} density="compact"
      onOpen={item => activate(item)}
      onExpandedChange={(item, value) => setOpen(item.id, value)}
      contextMenu={menu} />
  </div>;
}

function treeItem(row: ExplorerRow): Row {
  const base = { id: row.id, depth: row.depth, expandable: row.expandable, expanded: row.expanded, row, textValue: row.name };
  switch (row.kind) {
    case 'work': {
      const status = workStatus(row.work!);
      return { ...base, label: row.name, icon: <StatusIcon status={status} />, detail: row.work!.title, title: `${workNumber(row.work!.id)} ${row.work!.title} · ${status.label} · ${row.path}` };
    }
    case 'folder': return { ...base, label: row.name, icon: row.expanded ? <FolderOpenIcon className="explorer-folder" /> : <FolderIcon className="explorer-folder" />, title: row.path };
    default: {
      const diagram = isDiagramFile(row.path!) && Boolean(row.file?.workId);
      return { ...base, label: row.name, icon: diagram ? <DiagramIcon className="explorer-diagram" /> : <FileIcon className="explorer-file" />, detail: row.file && row.file.title !== row.file.name ? row.file.title : undefined, title: row.path };
    }
  }
}
