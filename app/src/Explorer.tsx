// The planning folder's files in the sidebar: work folders with their status and plan title, files,
// and each work item's diagrams. A click previews an item in a tab; a double click or Enter keeps it.
import { useEffect, useMemo, useState } from 'react';
import { Badge, Counter, IconButton, MenuItem, MenuSeparator, Tooltip, Tree, type TreeItem } from '@envsemble/envui';
import { CollapseAllIcon, DiagramIcon, FileIcon, FolderIcon, FolderOpenIcon } from './icons';
import type { ComputerFolder, ComputerRef, Snapshot, Target, Work } from './types';
import { FolderMenu } from './Computers';
import { api } from './api';
import { buildIndex, diagramId, diagramsId, fileId, folderId, revealIds, visibleRows, type DiagramState, type ExplorerRow } from './explorerModel';
import { fileTarget, workTarget } from './targets';
import { workStatus } from './status';
import { workNumber } from './format';
import { StatusIcon } from './ui';
import { useWorkbench } from './workbenchContext';

/** The explorer node that shows what a tab shows. */
export function nodeForTarget(target: Target | undefined, snapshot: Snapshot): { id: string; reveal: string[] } | null {
  if (!target) return null;
  if (target.kind === 'file') return { id: fileId(target.path), reveal: revealIds(target.path) };
  if (target.kind === 'work') {
    const work = snapshot.work.find(item => item.id === target.work);
    if (!work) return null;
    if (target.section === 'diagrams' && target.diagram) return { id: diagramId(work.id, target.diagram), reveal: revealIds(work.path, work.id, true) };
    return { id: folderId(work.path), reveal: revealIds(work.path) };
  }
  return null;
}

type Row = TreeItem & { row: ExplorerRow };

export function Explorer({ snapshot, folderName, root, computer, platform, expanded, setExpanded, selected, onExportPlan }: {
  snapshot: Snapshot; folderName: string; root: string; computer: ComputerRef; platform: string; expanded: string[]; setExpanded(next: string[]): void; selected: string | null; onExportPlan(work: Work): void;
}) {
  const { open, revision, notify, remote } = useWorkbench();
  const index = useMemo(() => buildIndex(snapshot), [snapshot]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const [diagrams, setDiagrams] = useState<Map<string, DiagramState & { revision: number }>>(new Map());
  // The folder this window shows, in its computer's folder list: by path here, by its key on another computer.
  const isCurrent = (folder: ComputerFolder) => computer.hostId === null
    ? (platform === 'win32' || platform === 'darwin' ? folder.path.toLowerCase() === root.toLowerCase() : folder.path === root)
    : root === `atlas-remote:${computer.hostId}/${folder.folderId}`;
  const warn = (message: string) => notify(message, 'warning');

  // Load the models of each expanded Diagrams entry, and again after the folder changes.
  useEffect(() => {
    for (const work of snapshot.work) {
      if (!work.diagrams || !expandedSet.has(diagramsId(work.id)) || !expandedSet.has(folderId(work.path))) continue;
      const known = diagrams.get(work.id);
      if (known && known.revision === revision) continue;
      setDiagrams(previous => new Map(previous).set(work.id, { ...(known && 'models' in known ? known : { loading: true as const }), revision }));
      api.models(work.id)
        .then(catalog => setDiagrams(previous => new Map(previous).set(work.id, { models: catalog.models, revision })))
        .catch(error => setDiagrams(previous => new Map(previous).set(work.id, { error: (error as Error).message, revision })));
    }
  }, [snapshot, expandedSet, revision]);

  const rows = useMemo(() => visibleRows(index, expandedSet, diagrams).map(row => treeItem(row)), [index, expandedSet, diagrams]);
  const setOpen = (id: string, value: boolean) => {
    if (value === expandedSet.has(id)) return;
    setExpanded(value ? [...expanded, id] : expanded.filter(item => item !== id));
  };
  const activate = ({ row }: Row, preview: boolean) => {
    const pin = !preview;
    switch (row.kind) {
      case 'folder': case 'diagrams': setOpen(row.id, !row.expanded); break;
      case 'work': setOpen(row.id, true); open(workTarget(row.work!.id), { pin }); break;
      case 'file': open(fileTarget(row.path!), { pin }); break;
      case 'diagram': open(workTarget(row.workId!, 'diagrams', { diagram: row.model!.handle }), { pin }); break;
    }
  };
  const reveal = (path: string) => { api.reveal(path).catch(error => notify((error as Error).message, 'warning')); };
  // A folder on another computer has no files here to reveal.
  const revealItem = (path: string) => remote ? null : <MenuItem onClick={() => reveal(path)}>Reveal in File Explorer</MenuItem>;
  const collapseAll = <MenuItem icon={<CollapseAllIcon />} disabled={!expanded.length} onClick={() => setExpanded([])}>Collapse All Folders</MenuItem>;
  const menu = (item: Row | null) => {
    const row = item?.row;
    const entries = !row ? null
      : row.kind === 'work' ? <>
        <MenuItem onClick={() => open(workTarget(row.work!.id), { pin: true })}>Open Overview</MenuItem>
        <MenuItem disabled={!row.work!.diagrams} onClick={() => open(workTarget(row.work!.id, 'diagrams'), { pin: true })}>Open Diagrams</MenuItem>
        <MenuSeparator />
        <MenuItem onClick={() => onExportPlan(row.work!)}>Export Plan…</MenuItem>
        {!remote && <><MenuSeparator />{revealItem(row.path!)}</>}
      </>
      : row.kind === 'folder' ? revealItem(row.path!)
      : row.kind === 'file' ? <><MenuItem onClick={() => open(fileTarget(row.path!), { pin: true })}>Open</MenuItem>{revealItem(row.path!)}</>
      : row.kind === 'diagram' ? <MenuItem onClick={() => open(workTarget(row.workId!, 'diagrams', { diagram: row.model!.handle }), { pin: true })}>Open Diagram</MenuItem>
      : null;
    // Every right-click in the explorer, on a row or on empty space, can collapse its folders.
    return <>{entries}{entries && <MenuSeparator />}{collapseAll}</>;
  };

  return <div className="explorer">
    <div className="explorer-header">
      <FolderMenu computer={computer} folderName={folderName} folderPath={snapshot.root} isCurrent={isCurrent} onError={warn} />
      <Tooltip content="Collapse all folders">
        <IconButton variant="text" icon={<CollapseAllIcon />} aria-label="Collapse all folders" disabled={!expanded.length} onClick={() => setExpanded([])} />
      </Tooltip>
    </div>
    <Tree<Row> className="explorer-tree" items={rows} aria-label="Planning folder" selectedId={selected} density="compact"
      onOpen={(item, { preview }) => activate(item, preview)}
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
    case 'file': return { ...base, label: row.name, icon: <FileIcon className="explorer-file" />, detail: row.file && row.file.title !== row.file.name ? row.file.title : undefined, title: row.path };
    case 'diagrams': return { ...base, label: 'Diagrams', icon: <DiagramIcon className="explorer-diagram" />, trailing: <Counter value={row.count ?? 0} /> };
    case 'diagram': return { ...base, label: row.name, icon: <DiagramIcon className="explorer-diagram" />, title: row.model!.provenance.detail || row.name,
      trailing: row.model!.provenance.label ? <Badge tone={row.model!.provenance.tone}>{row.model!.provenance.label}</Badge> : undefined };
    default: return { ...base, label: <span className="explorer-note">{row.name}</span>, disabled: true };
  }
}
