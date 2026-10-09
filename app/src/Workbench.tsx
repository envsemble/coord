// The window for one planning folder: activity bar, explorer sidebar and tabbed editor area.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertIcon, FileIcon, GraphIcon, IssueOpenedIcon, PulseIcon, RepoIcon } from './icons';
import { limits, type ImportPreview, type MenuCommand } from '../shared/contract';
import type { Snapshot, Target, UiState, ViewName, WindowInfo, Work } from './types';
import { api, AtlasError } from './api';
import { activateTab, closeTab, openTab, pinTab, retarget as retargetTab } from './tabs';
import { viewLabels, viewTarget, workTarget } from './targets';
import { workStatus } from './status';
import { workNumber } from './format';
import { Blankslate, StatusIcon } from './ui';
import { ActivityBar } from './ActivityBar';
import { Explorer, nodeForTarget } from './Explorer';
import { QuickOpen } from './QuickOpen';
import { ImportDialog } from './ImportDialog';
import { WorkList } from './WorkList';
import { FileView, WorkPage } from './WorkPage';
import { Activity, Statistics } from './Views';
import { SelectMenu } from './components/Menu';
import { SplitPane } from './components/SplitPane';
import { TabStrip, type TabItem } from './components/Tabs';
import { Toasts, useToasts } from './components/Toast';
import { WorkbenchContext, type OpenOptions, type WorkbenchApi } from './workbenchContext';

const viewIcons: Record<ViewName, ReactNode> = { work: <IssueOpenedIcon size={16} />, activity: <PulseIcon size={16} />, statistics: <GraphIcon size={16} /> };

/** Keys handled in the window; the same shortcuts in the application menu are the fallback. */
const shortcuts: Record<string, MenuCommand> = { 'ctrl+p': 'quickOpen', 'ctrl+b': 'toggleSidebar', 'ctrl+w': 'closeTab', 'ctrl+shift+e': 'showExplorer' };

export function Workbench({ info, snapshot, initialUi }: { info: WindowInfo; snapshot: Snapshot; initialUi: UiState }) {
  const [ui, setUi] = useState<UiState>(() => initialUi.tabs.items.length ? initialUi : { ...initialUi, tabs: openTab(initialUi.tabs, viewTarget('work'), true) });
  const [quickOpen, setQuickOpen] = useState<null | { mode: 'all' | 'work'; placeholder?: string; onPick(target: Target, pin: boolean): void }>(null);
  const [importing, setImporting] = useState<ImportPreview | null>(null);
  const [repository, setRepository] = useState('all');
  const [workSearch, setWorkSearch] = useState('');
  const [location, setLocation] = useState('active');
  const { toasts, notify, dismiss } = useToasts();
  const editor = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const lastShortcut = useRef<{ command: MenuCommand; time: number } | null>(null);

  // Persist the sidebar and tabs for this folder (and for crash recovery), debounced.
  useEffect(() => {
    const timer = window.setTimeout(() => { api.saveUi(ui).catch(() => undefined); }, 250);
    return () => window.clearTimeout(timer);
  }, [ui]);

  const active = ui.tabs.items.find(tab => tab.id === ui.tabs.active);
  const setTabs = useCallback((change: (tabs: UiState['tabs']) => UiState['tabs']) => setUi(current => ({ ...current, tabs: change(current.tabs) })), []);
  const open = useCallback((target: Target, options: OpenOptions = {}) => setTabs(tabs => openTab(tabs, target, options.pin ?? false)), [setTabs]);
  const retarget = useCallback((target: Target) => setTabs(tabs => tabs.active ? retargetTab(tabs, tabs.active, target) : openTab(tabs, target, true)), [setTabs]);
  const setSidebar = useCallback((change: Partial<UiState['sidebar']>) => setUi(current => ({ ...current, sidebar: { ...current.sidebar, ...change } })), []);

  // Reveal the active tab's item in the explorer.
  const node = nodeForTarget(active?.target, snapshot);
  useEffect(() => {
    if (!node?.reveal.length) return;
    setUi(current => {
      const missing = node.reveal.filter(id => !current.sidebar.expanded.includes(id));
      return missing.length ? { ...current, sidebar: { ...current.sidebar, expanded: [...current.sidebar.expanded, ...missing].slice(-limits.expanded) } } : current;
    });
  }, [node?.id]);

  // Keep each tab's scroll position while switching between tabs.
  useEffect(() => {
    const element = editor.current;
    if (!element || !active) return;
    element.scrollTop = scrollPositions.current.get(active.id) ?? 0;
    const remember = () => scrollPositions.current.set(active.id, element.scrollTop);
    element.addEventListener('scroll', remember, { passive: true });
    return () => element.removeEventListener('scroll', remember);
  }, [active?.id]);

  const exportWork = useCallback(async (work: Work) => {
    try {
      const result = await api.exportPlan(work.id);
      if (result) notify(`Exported ${workNumber(work.id)} to ${result.path}` + (result.warnings.length ? ' — ' + result.warnings.join(' ') : ''), result.warnings.length ? 'warning' : 'info');
    } catch (error) { notify((error as Error).message, (error as AtlasError).code === 'unavailable' ? 'warning' : 'danger'); }
  }, [notify]);
  const startImport = useCallback(async () => {
    try {
      const preview = await api.chooseImport();
      if (preview) setImporting(preview);
    } catch (error) { notify((error as Error).message, (error as AtlasError).code === 'unavailable' ? 'warning' : 'danger'); }
  }, [notify]);

  const runCommand = useCallback((command: MenuCommand) => {
    switch (command) {
      case 'toggleSidebar': setUi(current => ({ ...current, sidebar: { ...current.sidebar, visible: !current.sidebar.visible } })); break;
      case 'showExplorer': setSidebar({ visible: true }); window.setTimeout(() => document.querySelector<HTMLElement>('.tree-view')?.focus(), 0); break;
      case 'quickOpen': setQuickOpen({ mode: 'all', onPick: (target, pin) => open(target, { pin }) }); break;
      case 'closeTab': setTabs(tabs => tabs.active ? closeTab(tabs, tabs.active) : tabs); break;
      case 'openWorkList': open(viewTarget('work'), { pin: true }); break;
      case 'openActivity': open(viewTarget('activity'), { pin: true }); break;
      case 'openStatistics': open(viewTarget('statistics'), { pin: true }); break;
      case 'importPlan': void startImport(); break;
      case 'exportPlan': {
        const current = active?.target.kind === 'work' ? snapshot.work.find(work => work.id === (active.target as { work: string }).work)
          : active?.target.kind === 'file' ? snapshot.work.find(work => work.id === snapshot.documents.find(file => file.path === (active.target as { path: string }).path)?.workId) : undefined;
        if (current) void exportWork(current);
        else setQuickOpen({ mode: 'work', placeholder: 'Choose a work item to export', onPick: target => { const work = snapshot.work.find(item => target.kind === 'work' && item.id === target.work); if (work) void exportWork(work); } });
        break;
      }
    }
  }, [active, snapshot, open, setTabs, setSidebar, exportWork, startImport]);

  // Menu commands from main; ignore one that repeats a shortcut this window just handled.
  useEffect(() => api.onMenu(command => {
    const last = lastShortcut.current;
    if (last && last.command === command && Date.now() - last.time < 300) return;
    runCommand(command);
  }), [runCommand]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const name = [(event.ctrlKey || event.metaKey) && 'ctrl', event.shiftKey && 'shift', event.altKey && 'alt', event.key.toLowerCase()].filter(Boolean).join('+');
      const command = shortcuts[name];
      if (!command) return;
      event.preventDefault();
      lastShortcut.current = { command, time: Date.now() };
      runCommand(command);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [runCommand]);

  const context = useMemo<WorkbenchApi>(() => ({ snapshot, revision: info.revision, open, retarget, notify }), [snapshot, info.revision, open, retarget, notify]);
  const repositoryMenu = snapshot.repositories.length > 1 ? <SelectMenu label="Repository" icon={<RepoIcon size={16} />} value={repository} onChange={setRepository}
    options={[{ value: 'all', label: 'All' }, ...snapshot.repositories.map(item => ({ value: item.id, label: item.id, count: snapshot.work.filter(work => work.repositories.includes(item.id)).length }))]} /> : null;

  const tabs: TabItem[] = ui.tabs.items.map(tab => describeTab(tab.target, snapshot, tab.preview, tab.id));
  const activeView = active?.target.kind === 'view' ? active.target.view : null;
  const editorKind = active?.target.kind === 'work' && snapshot.work.some(work => active.target.kind === 'work' && work.id === active.target.work) && active.target.section === 'diagrams' ? ' editor-diagrams' : '';

  return <WorkbenchContext.Provider value={context}>
    <div className="workbench">
      <ActivityBar explorer={ui.sidebar.visible} activeView={activeView} activeCount={snapshot.work.filter(work => work.location === 'active').length} issues={snapshot.issues}
        onExplorer={() => setSidebar({ visible: !ui.sidebar.visible })} onView={view => open(viewTarget(view), { pin: true })} />
      <SplitPane size={ui.sidebar.width} min={limits.sidebarMin} max={limits.sidebarMax} visible={ui.sidebar.visible} label="Resize the explorer" onResize={width => setSidebar({ width })}
        start={<Explorer snapshot={snapshot} folderName={info.folder?.name ?? ''} expanded={ui.sidebar.expanded} setExpanded={expanded => setSidebar({ expanded: expanded.slice(-limits.expanded) })} selected={node?.id ?? null} onExportPlan={work => void exportWork(work)} />}
        end={<div className="editor-group">
          <TabStrip tabs={tabs} active={ui.tabs.active} label="Open tabs" onActivate={id => setTabs(state => activateTab(state, id))} onClose={id => setTabs(state => closeTab(state, id))} onPin={id => setTabs(state => pinTab(state, id))} />
          {info.error && <div className="flash flash-warning folder-error" role="alert"><AlertIcon size={16} /><div><p><strong>The planning folder can’t be read right now.</strong> {info.error}</p><p className="muted">Showing the last good view. Atlas reloads when the folder is readable again.</p></div></div>}
          <div ref={editor} className={'editor' + editorKind}>
            {active ? <TabContent key={active.id} target={active.target} snapshot={snapshot} repository={repository} repositoryMenu={repositoryMenu}
              work={{ location, setLocation, search: workSearch, setSearch: setWorkSearch }} />
              : <EmptyEditor platform={info.platform} />}
          </div>
        </div>} />
      {quickOpen && <QuickOpen snapshot={snapshot} mode={quickOpen.mode} placeholder={quickOpen.placeholder} onPick={quickOpen.onPick} onClose={() => setQuickOpen(null)} />}
      {importing && <ImportDialog preview={importing}
        onCancel={() => { void api.cancelImport(importing.token).catch(() => undefined); setImporting(null); }}
        onConfirm={async () => {
          const result = await api.confirmImport(importing.token);
          setImporting(null);
          notify(`Imported as ${workNumber(result.workId)} in ${result.path}. ${result.notes.join(' ')}`.trim());
          open(workTarget(result.workId), { pin: true });
        }} />}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  </WorkbenchContext.Provider>;
}

function describeTab(target: Target, snapshot: Snapshot, preview: boolean, id: string): TabItem {
  if (target.kind === 'view') return { id, label: viewLabels[target.view], icon: viewIcons[target.view], preview };
  if (target.kind === 'work') {
    const work = snapshot.work.find(item => item.id === target.work);
    const label = (work?.title ?? workNumber(target.work)) + (target.section === 'diagrams' ? ' · Diagrams' : '');
    return { id, label, title: work ? workNumber(work.id) + ' · ' + work.path : target.work, icon: work ? <StatusIcon status={workStatus(work)} /> : <IssueOpenedIcon size={16} />, preview };
  }
  return { id, label: target.path.split('/').at(-1) ?? target.path, title: target.path, icon: <FileIcon size={16} />, preview };
}

function TabContent({ target, snapshot, repository, repositoryMenu, work }: {
  target: Target; snapshot: Snapshot; repository: string; repositoryMenu: ReactNode;
  work: { location: string; setLocation(value: string): void; search: string; setSearch(value: string): void };
}) {
  if (target.kind === 'view') {
    if (target.view === 'activity') return <Activity snapshot={snapshot} repository={repository} repositoryMenu={repositoryMenu} />;
    if (target.view === 'statistics') return <Statistics snapshot={snapshot} repository={repository} repositoryMenu={repositoryMenu} />;
    return <WorkList snapshot={snapshot} repository={repository} repositoryMenu={repositoryMenu} {...work} />;
  }
  if (target.kind === 'work') {
    const item = snapshot.work.find(entry => entry.id === target.work);
    if (!item) return <Gone title="This work item is no longer registered" detail={target.work} />;
    return <WorkPage work={item} snapshot={snapshot} target={target} />;
  }
  const file = snapshot.documents.find(document => document.path === target.path);
  if (!file) return <Gone title="This file no longer exists" detail={target.path} />;
  return <FileView file={file} snapshot={snapshot} anchor={target.anchor ?? null} />;
}

function Gone({ title, detail }: { title: string; detail: string }) {
  return <div className="page"><div className="box"><Blankslate icon={<AlertIcon size={24} />} title={title}><code>{detail}</code></Blankslate></div></div>;
}

function EmptyEditor({ platform }: { platform: string }) {
  const key = (letter: string) => (platform === 'darwin' ? '⌘' : 'Ctrl+') + letter;
  return <div className="editor-empty">
    <dl>
      <div><dt>Quick open</dt><dd><kbd>{key('P')}</kbd></dd></div>
      <div><dt>Toggle explorer</dt><dd><kbd>{key('B')}</kbd></dd></div>
      <div><dt>Open folder</dt><dd><kbd>{key('O')}</kbd></dd></div>
    </dl>
  </div>;
}

