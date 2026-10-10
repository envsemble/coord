import { useEffect, useMemo, useState } from 'react';
import { FileDirectoryFillIcon, FileDirectoryOpenFillIcon, FileIcon, FoldIcon, WorkflowIcon } from './icons';
import type { Snapshot, Target, Work } from './types';
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

export function Explorer({ snapshot, folderName, expanded, setExpanded, selected, onExportPlan }: {
  snapshot: Snapshot; folderName: string; expanded: string[]; setExpanded(next: string[]): void; selected: string | null; onExportPlan(work: Work): void;
}) {
  const { open, revision, notify } = useWorkbench();
  const index = useMemo(() => buildIndex(snapshot), [snapshot]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const [diagrams, setDiagrams] = useState<Map<string, DiagramState & { revision: number }>>(new Map());
  const menu = useContextMenu<ExplorerRow>();

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
  const menuItems = (row: ExplorerRow): MenuEntry[] => {
    switch (row.kind) {
      case 'work': return [
        { label: 'Open Overview', onSelect: () => open(workTarget(row.work!.id), { pin: true }) },
        { label: 'Open Diagrams', disabled: !row.work!.diagrams, onSelect: () => open(workTarget(row.work!.id, 'diagrams'), { pin: true }) },
        'separator',
        { label: 'Export Plan…', onSelect: () => onExportPlan(row.work!) },
        'separator',
        { label: 'Reveal in File Explorer', onSelect: () => reveal(row.path!) },
      ];
      case 'folder': return [{ label: 'Reveal in File Explorer', onSelect: () => reveal(row.path!) }];
      case 'file': return [{ label: 'Open', onSelect: () => open(fileTarget(row.path!), { pin: true }) }, { label: 'Reveal in File Explorer', onSelect: () => reveal(row.path!) }];
      case 'diagram': return [{ label: 'Open Diagram', onSelect: () => open(workTarget(row.workId!, 'diagrams', { diagram: row.model!.handle }), { pin: true }) }];
      default: return [];
    }
  };

  return <div className="explorer">
    <div className="explorer-header">
      <span className="explorer-title" title={snapshot.root}>{folderName}</span>
      <button type="button" className="btn-octicon" aria-label="Collapse folders" title="Collapse folders" onClick={() => setExpanded([])}><FoldIcon size={16} /></button>
    </div>
    <Tree rows={rows} selected={selected} label="Planning folder" onOpen={activate}
      onToggle={(row, value) => setOpen(row.id, value)}
      onContextMenu={(row, position) => { if (menuItems(row).length) menu.open(row, position); }}
      renderRow={row => <ExplorerRowContent row={row} />} />
    {menu.menu && <ContextMenu label={menu.menu.subject.name} position={menu.menu.position} items={menuItems(menu.menu.subject)} onClose={menu.close} />}
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
