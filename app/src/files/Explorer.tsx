// The open plan's files, at the left of its pages: its work folder (plan, ledger,
// context, diagrams and the rest) as a tree of real folder and file names; a work item's diagram
// files open as its diagrams. A diagram's first file opens like a folder onto its other layers (its
// later captures and the proposals over it), listed only there. A click, or Enter, opens a file in the
// window; folders open and close in place. Ctrl+Shift+E brings the keyboard to it. Its end edge
// resizes it (envUI's resizable drawer, on the page's background), and the width is kept.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Badge, Menu, NavigationDrawer, Text, Tree, type NavigationDrawerDestination, type TreeItem } from '@envsemble/envui';
import { DiagramIcon, GlossaryIcon, LedgerIcon, PageIcon, PlanIcon } from '../ui/icons';
import { AttentionDot } from '../ui/AttentionDot';
import type { Document, Snapshot, Target, Work } from '../types';
import { api } from '../api';
import { buildIndex, fileNodeId, folderNodeId, revealIds, visibleRows, type ExplorerRow } from './explorerModel';
import { documentTarget, fileTarget, isDiagramFile, pageAt, pageTarget } from '../navigation/targets';
import { workNumber } from '../ui/format';
import { familyLayers } from '../diagrams/layers';
import type { DiagramEntry } from '../types';
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
  // A page is its folder's row.
  if (target.kind === 'file' && pageAt(target.path, snapshot)) return { id: folderNodeId(target.path), reveal: revealIds(target.path) };
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
  const { projectId, open, notify, remote, snapshot, files } = useWindow();
  const { expanded, setExpanded, selected } = useContext(FilesContext);
  const { width, keepWidth } = useFilesWidth();
  const index = useMemo(() => buildIndex(snapshot), [snapshot]);
  // A diagram's layers: its later captures and the proposals over it, under its first file.
  const [diagrams, setDiagrams] = useState<DiagramEntry[]>([]);
  useEffect(() => {
    let current = true;
    api.diagrams(projectId, work.id).then(next => { if (current) setDiagrams(next); }).catch(() => { if (current) setDiagrams([]); });
    return () => { current = false; };
  }, [projectId, work.id, files]);
  // Each layer's small tag: when the first capture and a later one were taken, or that it is a proposal.
  const { layers, tags } = useMemo(() => {
    const map = new Map<string, string[]>(), tags = new Map<string, string>();
    const full = (path: string) => work.path + '/' + path;
    for (const root of new Set(diagrams.flatMap(entry => entry.family ? [entry.family] : []))) {
      const family = familyLayers(diagrams, root);
      const members = family.map(layer => layer.path).filter(path => path !== root);
      if (members.length) map.set(full(root), members.map(full));
      for (const layer of family) tags.set(full(layer.path), layer.kind === 'proposal' ? 'Proposal' : layer.label);
    }
    return { layers: map, tags };
  }, [diagrams, work.path]);
  // A diagram shown, or one of its layers, opens its layers in the tree, with the folders they are in.
  const expandedSet = useMemo(() => {
    const set = new Set(expanded);
    for (const [root, members] of layers)
      if (selected && [root, ...members].some(path => fileNodeId(path) === selected)) {
        set.add(fileNodeId(root));
        for (const id of revealIds(root)) set.add(id);
      }
    return set;
  }, [expanded, layers, selected]);
  // The plan's folder heads its files, open unless folded.
  const rows = useMemo(() => {
    const id = folderNodeId(work.path), open = !expandedSet.has(folded(id));
    const top: ExplorerRow = { id, kind: 'folder', name: work.path.slice(work.path.lastIndexOf('/') + 1), path: work.path, depth: 0, expandable: true, expanded: open };
    const attention = snapshot.attention ?? {};
    return [top, ...open ? visibleRows(index, expandedSet, work.path, layers).map(row => ({ ...row, depth: row.depth + 1 })) : []].map(row => treeItem(row, work.path, tags.get(row.path ?? ''), attention));
  }, [index, expandedSet, work.path, layers, tags, snapshot.attention]);
  // A file opens as a file, a diagram file of the work item as its diagram.
  // A plan's plan.md opens as the plan, a diagram as a diagram, any other file on its page.
  const fileOpens = (file: Document) => documentTarget(file, work);
  const setOpen = (id: string, value: boolean) => {
    // The plan's folder is open unless folded; the others are folded unless opened.
    if (id === folderNodeId(work.path)) { setExpanded(value ? expanded.filter(item => item !== folded(id)) : [...expanded, folded(id)]); return; }
    if (value === expandedSet.has(id)) return;
    setExpanded(value ? [...expanded, id] : expanded.filter(item => item !== id));
  };
  const activate = ({ row }: Row) => {
    if (row.kind === 'file') open(fileOpens(row.file!));
    // A page opens as itself; its chevron shows its files.
    else if (row.kind === 'page') open(pageTarget(row.path!));
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
      : row.kind === 'page' ? <><Menu.Item onClick={() => open(pageTarget(row.path!))}>Open Page</Menu.Item>{revealItem(row.path!)}</>
      : revealItem(row.path!);
    return <>{entries}{entries && <Menu.Separator />}<Menu.Item disabled={!expanded.length} onClick={() => setExpanded([])}>Collapse All Folders</Menu.Item></>;
  };
  // The tree is the drawer's content, in its header: it has no destinations of its own.
  return <NavigationDrawer className="plan-files" aria-label={'Files of ' + workNumber(work.id)} destinations={NO_DESTINATIONS} background="page"
    resizable resizeLabel="Resize files" width={width} defaultWidth={DEFAULT_WIDTH} minWidth={12} maxWidth={32} onWidthChange={keepWidth}
    header={<>
      <Text render={<h2 />} variant="body" className="plan-files-heading">Files</Text>
      {rows.length ? <Tree<Row> className="plan-files-tree" items={rows} aria-label={'Files of ' + workNumber(work.id) + ' ' + work.title} value={selected} density="sm"
        onAction={item => activate(item)}
        onExpandedChange={(item, value) => setOpen(item.value, value)}
        contextMenu={menu} />
        : <Text render={<p />} variant="body-sm" emphasis="muted" className="plan-files-empty">This work folder has no files.</Text>}
    </>} />;
}

const NO_DESTINATIONS: NavigationDrawerDestination[] = [];
const DEFAULT_WIDTH = 16;
const WIDTH_KEY = 'coord-files-width';
/** The width the reader gave the files in this window's browser storage, if any (storage can be blocked). */
function storedWidth() {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY) ?? Number.NaN);
    return Number.isFinite(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}
/** The files' width, kept as the reader leaves it. */
function useFilesWidth() {
  const [width, setWidth] = useState(() => storedWidth() ?? DEFAULT_WIDTH);
  const keepWidth = useCallback((next: number, details: { committed: boolean }) => {
    setWidth(next);
    if (details.committed) try { localStorage.setItem(WIDTH_KEY, String(next)); } catch { /* the width lasts this session */ }
  }, []);
  return { width, keepWidth };
}

/** Bring the keyboard to the plan's files (which takes focus itself and marks its active row). */
export function focusPlanFiles() {
  document.querySelector<HTMLElement>('.plan-files [role="tree"]')?.focus();
}

/**
 * A row of the tree. Only the files Coord reads for what they are have an icon: the plan, its ledger,
 * its glossary and its diagrams; every other row keeps the icon's room empty, so the names line up.
 */
function treeItem(row: ExplorerRow, workPath: string, tag: string | undefined, attention: Record<string, string>): Row {
  const base = { value: row.id, depth: row.depth, expandable: row.expandable, expanded: row.expanded, row, textValue: row.name };
  if (row.kind === 'page') {
    const asks = attention[row.path!];
    return { ...base, label: row.name, icon: <PageIcon className="explorer-special" data-file="page" />, ...asks ? { end: <AttentionDot text={asks} /> } : {}, tooltip: 'Page · ' + row.path + (asks ? '\nNeeds you: ' + asks : '') };
  }
  // A folded folder with a page in it that needs its user shows that it has one.
  const inside = row.kind !== 'file' && !row.expanded ? Object.keys(attention).filter(page => page.startsWith(row.path + '/')) : [];
  if (row.kind !== 'file') return { ...base, label: row.name, icon: <></>, ...inside.length ? { end: <AttentionDot text={inside.length === 1 ? 'A page in it needs you' : inside.length + ' pages in it need you'} /> } : {}, tooltip: row.path };
  const own = (name: string) => row.path === workPath + '/' + name;
  const icon = own('plan.md') ? <PlanIcon className="explorer-special" data-file="plan" />
    : own('ledger.md') ? <LedgerIcon className="explorer-special" data-file="ledger" />
    : own('CONTEXT.md') ? <GlossaryIcon className="explorer-special" data-file="glossary" />
    : isDiagramFile(row.path!) && row.file?.workId ? <DiagramIcon className="explorer-special" data-file="diagram" />
    : <></>;
  // Its whole name; its title, when it has one of its own, on hover.
  // A diagram's layer (Captured, Proposal) as a badge at the row's end, which keeps its width while the name ellipsizes.
  return { ...base, label: row.name, icon, ...tag ? { end: <Badge tone="neutral" className="explorer-tag">{tag}</Badge> } : {}, tooltip: row.file && row.file.title !== row.file.name ? row.file.title + ' \u00b7 ' + row.path : row.path };
}
