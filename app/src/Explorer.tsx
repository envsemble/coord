import { useEffect, useMemo, useState } from 'react';
import { FileDirectoryFillIcon, FileDirectoryOpenFillIcon, FileIcon, FoldIcon, WorkflowIcon } from './icons';
import type { ComputerFolder, ComputerRef, Snapshot, Target, Work } from './types';
import { ComputerMenu, FolderMenu } from './Computers';
import { api } from './api';
import { buildIndex, diagramId, diagramsId, fileId, folderId, revealIds, visibleRows, type DiagramState, type ExplorerRow } from './explorerModel';
import { fileTarget, workTarget } from './targets';
import { workStatus } from './status';
import { workNumber } from './format';
import { Counter, Label, StatusIcon } from './ui';
import { Tree, type TreeOpen } from './components/Tree';
import { ContextMenu, useContextMenu, type MenuEntry } from './components/Menu';
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

export function Explorer({ snapshot, folderName, root, computer, platform, expanded, setExpanded, selected, onExportPlan }: {
  snapshot: Snapshot; folderName: string; root: string; computer: ComputerRef; platform: string; expanded: string[]; setExpanded(next: string[]): void; selected: string | null; onExportPlan(work: Work): void;
}) {
  const { open, revision, notify, remote } = useWorkbench();
  const index = useMemo(() => buildIndex(snapshot), [snapshot]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const [diagrams, setDiagrams] = useState<Map<string, DiagramState & { revision: number }>>(new Map());
  const menu = useContextMenu<ExplorerRow | null>();
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

  const rows = useMemo(() => visibleRows(index, expandedSet, diagrams), [index, expandedSet, diagrams]);
  const setOpen = (id: string, value: boolean) => {
    if (value === expandedSet.has(id)) return;
    setExpanded(value ? [...expanded, id] : expanded.filter(item => item !== id));
  };
  const activate = (row: ExplorerRow, mode: TreeOpen) => {
    const pin = mode === 'pin';
    switch (row.kind) {
      case 'folder': case 'diagrams': setOpen(row.id, !row.expanded); break;
      case 'work': setOpen(row.id, true); open(workTarget(row.work!.id), { pin }); break;
      case 'file': open(fileTarget(row.path!), { pin }); break;
      case 'diagram': open(workTarget(row.workId!, 'diagrams', { diagram: row.model!.handle }), { pin }); break;
    }
  };
  const reveal = (path: string) => { api.reveal(path).catch(error => notify((error as Error).message, 'warning')); };
  const collapse: MenuEntry = { label: 'Collapse All Folders', icon: <FoldIcon size={16} />, disabled: !expanded.length, onSelect: () => setExpanded([]) };
  const rowItems = (row: ExplorerRow): MenuEntry[] => {
    switch (row.kind) {
      case 'work': return [
        { label: 'Open Overview', onSelect: () => open(workTarget(row.work!.id), { pin: true }) },
        { label: 'Open Diagrams', disabled: !row.work!.diagrams, onSelect: () => open(workTarget(row.work!.id, 'diagrams'), { pin: true }) },
        'separator',
        { label: 'Export Plan…', onSelect: () => onExportPlan(row.work!) },
        // A folder on another computer has no files here to reveal.
        ...(remote ? [] : ['separator' as const, { label: 'Reveal in File Explorer', onSelect: () => reveal(row.path!) }]),
      ];
      case 'folder': return remote ? [] : [{ label: 'Reveal in File Explorer', onSelect: () => reveal(row.path!) }];
      case 'file': return [{ label: 'Open', onSelect: () => open(fileTarget(row.path!), { pin: true }) }, ...(remote ? [] : [{ label: 'Reveal in File Explorer', onSelect: () => reveal(row.path!) }])];
      case 'diagram': return [{ label: 'Open Diagram', onSelect: () => open(workTarget(row.workId!, 'diagrams', { diagram: row.model!.handle }), { pin: true }) }];
      default: return [];
    }
  };
  // Every right-click in the explorer, on a row or on empty space, can collapse its folders.
  const menuItems = (row: ExplorerRow | null): MenuEntry[] => {
    const items = row ? rowItems(row) : [];
    return items.length ? [...items, 'separator', collapse] : [collapse];
  };

  return <div className="explorer" onContextMenu={event => {
    if ((event.target as Element).closest('.tree-row, .explorer-header')) return;
    event.preventDefault();
    menu.open(null, { x: event.clientX, y: event.clientY });
  }}>
    <div className="explorer-header">
      <FolderMenu computer={computer} folderName={folderName} folderPath={snapshot.root} isCurrent={isCurrent} onError={warn} />
      <ComputerMenu current={computer} onError={warn} className="explorer-computer" />
    </div>
    <Tree rows={rows} selected={selected} label="Planning folder" onOpen={activate}
      onToggle={(row, value) => setOpen(row.id, value)}
      onContextMenu={(row, position) => menu.open(row, position)}
      renderRow={row => <ExplorerRowContent row={row} />} />
    {menu.menu && <ContextMenu label={menu.menu.subject?.name ?? 'Explorer'} position={menu.menu.position} items={menuItems(menu.menu.subject)} onClose={menu.close} />}
  </div>;
}

function ExplorerRowContent({ row }: { row: ExplorerRow }) {
  switch (row.kind) {
    case 'work': {
      const status = workStatus(row.work!);
      return <span className="tree-label" title={row.work!.title + ' · ' + status.label + ' · ' + row.path}>
        <StatusIcon status={status} />
        <span className="tree-name">{row.name}</span>
        <span className="tree-secondary">{workNumber(row.work!.id)} {row.work!.title}</span>
      </span>;
    }
    case 'folder': return <span className="tree-label" title={row.path}>{row.expanded ? <FileDirectoryOpenFillIcon size={16} className="tree-folder-icon" /> : <FileDirectoryFillIcon size={16} className="tree-folder-icon" />}<span className="tree-name">{row.name}</span></span>;
    case 'file': return <span className="tree-label" title={row.path}><FileIcon size={16} className="tree-file-icon" /><span className="tree-name">{row.name}</span>{row.file && row.file.title !== row.file.name && <span className="tree-secondary">{row.file.title}</span>}</span>;
    case 'diagrams': return <span className="tree-label"><WorkflowIcon size={16} className="tree-diagram-icon" /><span className="tree-name">Diagrams</span><Counter>{row.count}</Counter></span>;
    case 'diagram': return <span className="tree-label" title={row.model!.provenance.detail || row.name}><WorkflowIcon size={16} className="tree-diagram-icon" /><span className="tree-name">{row.name}</span>{row.model!.provenance.label && <Label tone={row.model!.provenance.tone}>{row.model!.provenance.label}</Label>}</span>;
    default: return <span className="tree-label tree-note">{row.name}</span>;
  }
}
