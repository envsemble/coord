// The window for one planning folder: envUI's application shell with its top bar as the window's
// title bar (menus, the computer, search and the window buttons), the pages and the folder's files in
// the sidebar, and the open documents as tabs above the page.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AppShell, Button, Counter, DocumentTabs, Kbd, NavigationItem, Notice, Popover, useAppShell, useToast, type DocumentTab } from '@envsemble/envui';
import { ThemeMenu } from './ThemeMenu';
import { AtlasMark } from '@envsemble/atlas-diagrams/react';
import { ActivityIcon, FileIcon, SearchIcon, StatisticsIcon, WarningIcon, WorkIcon } from './icons';
import { limits, viewNames, type ImportPreview, type MenuCommand } from '../shared/contract';
import type { Issue, Snapshot, Target, UiState, ViewName, WindowInfo, Work } from './types';
import { api, AtlasError } from './api';
import { activateTab, closeTab, openTab, pinTab, retarget as retargetTab } from './tabs';
import { scrollKey, viewLabels, viewTarget, workTarget } from './targets';
import { canGoBack, canGoForward, keyStep, record, sameTarget, shownTarget, showTarget, startHistory, step } from './history';
import { workStatus } from './status';
import { workNumber } from './format';
import { StatusIcon } from './ui';
import { Explorer, nodeForTarget } from './Explorer';
import { QuickOpen } from './QuickOpen';
import { ImportDialog } from './ImportDialog';
import { WorkList } from './WorkList';
import { FileView, WorkPage, workSection } from './WorkPage';
import { Activity } from './Views';
import { Statistics } from './StatisticsPage';
import { Gone } from './Pages';
import { modifierKey, TitleBarStart, type WorkbenchMenus } from './AppMenu';
import { currentFolder } from './Computers';
import { useWorkbench, WorkbenchContext, type Notify, type OpenOptions, type WorkbenchApi } from './workbenchContext';

const viewIcons: Record<ViewName, ReactNode> = { work: <WorkIcon />, activity: <ActivityIcon />, statistics: <StatisticsIcon /> };
const toastVariants = { info: 'neutral', warning: 'info', danger: 'error' } as const;

/** Keys handled in the window; the same shortcuts in the application menu are the fallback. */
const shortcuts: Record<string, MenuCommand> = { 'ctrl+p': 'quickOpen', 'ctrl+b': 'toggleSidebar', 'ctrl+w': 'closeTab', 'ctrl+shift+e': 'showExplorer' };
/** Where the back and forward keys stay: fields, and open menus, lists and dialogs. */
const keepsHistoryKeys = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';
/** Where the mouse's back and forward buttons do nothing: open menus and dialogs, which hold focus. */
const keepsHistoryButtons = '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';

/** What a target shows, a work item at the section it opens on: opening one and then choosing that section is one entry in the history. */
function resolveTarget(target: Target, snapshot: Snapshot): Target {
  const work = target.kind === 'work' ? snapshot.work.find(item => item.id === target.work) : undefined;
  return work && target.kind === 'work' ? { ...target, section: workSection(target, work) } : target;
}

export function Workbench({ info, snapshot, initialUi }: { info: WindowInfo; snapshot: Snapshot; initialUi: UiState }) {
  // The layout and the history of what the window showed (back and forward) change together: each
  // change of what shows is recorded, except a step back or forward.
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  const [{ ui, history }, setWindowState] = useState(() => ({ ui: initialUi, history: startHistory(resolveTarget(shownTarget(initialUi), snapshot)) }));
  const setUi = useCallback((change: (current: UiState) => UiState) => setWindowState(current => {
    const next = change(current.ui);
    if (next === current.ui) return current;
    const shown = shownTarget(next);
    return { ui: next, history: sameTarget(shown, shownTarget(current.ui)) ? current.history : record(current.history, resolveTarget(shown, latestSnapshot.current)) };
  }), []);
  const navigate = useCallback((by: -1 | 1) => setWindowState(current => {
    const moved = step(current.history, by);
    return moved ? { ui: showTarget(current.ui, moved.target), history: moved.history } : current;
  }), []);
  const [quickOpen, setQuickOpen] = useState<null | { mode: 'all' | 'work'; placeholder?: string; onPick(target: Target, pin: boolean): void }>(null);
  const [importing, setImporting] = useState<ImportPreview | null>(null);
  const [repository, setRepository] = useState('all');
  const [workSearch, setWorkSearch] = useState('');
  const [location, setLocation] = useState('active');
  const toast = useToast();
  const page = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const lastShortcut = useRef<{ command: MenuCommand; time: number } | null>(null);
  const notify = useCallback<Notify>((message, tone = 'info') => { toast.show({ message, variant: toastVariants[tone] }); }, [toast]);
  const warn = useCallback((message: string) => notify(message, 'warning'), [notify]);

  // Persist the sidebar, tabs and page for this folder (and for crash recovery), debounced; Close
  // Folder saves at once, before the window lets the folder go.
  const latestUi = useRef(ui);
  latestUi.current = ui;
  useEffect(() => {
    const timer = window.setTimeout(() => { api.saveUi(ui).catch(() => undefined); }, 250);
    return () => window.clearTimeout(timer);
  }, [ui]);
  const closeFolder = useCallback(() => {
    void api.saveUi(latestUi.current).catch(() => undefined).then(() => api.command('closeFolder')).catch(error => notify((error as Error).message, 'warning'));
  }, [notify]);

  // What the window shows: the active tab's document, or else the page (Work, Activity or Statistics).
  const active = ui.tabs.items.find(tab => tab.id === ui.tabs.active);
  const shown: Target = active?.target ?? viewTarget(ui.page);
  const setTabs = useCallback((change: (tabs: UiState['tabs']) => UiState['tabs']) => setUi(current => ({ ...current, tabs: change(current.tabs) })), []);
  const showPage = useCallback((view: ViewName) => setUi(current => ({ ...current, page: view, tabs: { ...current.tabs, active: null } })), []);
  // Views are pages: opening one shows it, leaving the tabs as they are.
  const open = useCallback((target: Target, options: OpenOptions = {}) => {
    if (target.kind === 'view') showPage(target.view);
    else setTabs(tabs => openTab(tabs, target, options.pin ?? false));
  }, [setTabs, showPage]);
  const retarget = useCallback((target: Target) => {
    if (target.kind === 'view') showPage(target.view);
    else setTabs(tabs => tabs.active ? retargetTab(tabs, tabs.active, target) : openTab(tabs, target, true));
  }, [setTabs, showPage]);
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

  const scrolled = scrollKey(resolveTarget(shown, snapshot));
  const anchored = shown.kind !== 'view' && Boolean(shown.anchor);
  // Forget the positions of what no open tab, page or step back or forward shows.
  useEffect(() => {
    const kept = new Set([...ui.tabs.items.map(tab => scrollKey(resolveTarget(tab.target, snapshot))), ...viewNames.map(view => scrollKey(viewTarget(view))), ...history.entries.map(scrollKey)]);
    for (const key of [...scrollPositions.current.keys()]) if (!kept.has(key)) scrollPositions.current.delete(key);
  }, [ui.tabs.items, history.entries, snapshot]);

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
    } catch (error) {
      if ((error as AtlasError).code === 'cancelled') return;
      notify((error as Error).message, (error as AtlasError).code === 'unavailable' ? 'warning' : 'danger');
    }
  }, [notify]);
  const chooseExport = useCallback(() => {
    const current = active?.target.kind === 'work' ? snapshot.work.find(work => work.id === (active.target as { work: string }).work)
      : active?.target.kind === 'file' ? snapshot.work.find(work => work.id === snapshot.documents.find(file => file.path === (active.target as { path: string }).path)?.workId) : undefined;
    if (current) void exportWork(current);
    else setQuickOpen({ mode: 'work', placeholder: 'Choose a work item to export', onPick: target => { const work = snapshot.work.find(item => target.kind === 'work' && item.id === target.work); if (work) void exportWork(work); } });
  }, [active, snapshot, exportWork]);

  const runCommand = useCallback((command: MenuCommand) => {
    switch (command) {
      // envUI's shell compacts a collapsing sidebar even while it holds focus.
      case 'toggleSidebar': setSidebar({ visible: !ui.sidebar.visible }); break;
      case 'showExplorer': setSidebar({ visible: true }); window.setTimeout(() => document.querySelector<HTMLElement>('.explorer-tree [role="tree"], .explorer-tree[role="tree"]')?.focus(), 0); break;
      case 'quickOpen': setQuickOpen({ mode: 'all', onPick: (target, pin) => open(target, { pin }) }); break;
      case 'closeTab': setTabs(tabs => tabs.active ? closeTab(tabs, tabs.active) : tabs); break;
      case 'openWorkList': showPage('work'); break;
      case 'openActivity': showPage('activity'); break;
      case 'openStatistics': showPage('statistics'); break;
      case 'importPlan': void startImport(); break;
      case 'exportPlan': chooseExport(); break;
      case 'closeFolder': closeFolder(); break;
      case 'goBack': navigate(-1); break;
      case 'goForward': navigate(1); break;
    }
  }, [ui.sidebar.visible, open, setTabs, setSidebar, showPage, startImport, chooseExport, closeFolder, navigate]);

  // Menu commands from main; ignore one that repeats a key this window just took, or left to a field.
  useEffect(() => api.onMenu(command => {
    const last = lastShortcut.current;
    if (last && last.command === command && Date.now() - last.time < 300) return;
    runCommand(command);
  }), [runCommand]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const by = keyStep(event, info.platform);
      if (by) {
        // Taken here or left to a field, the key reaches the application menu only as an echo.
        lastShortcut.current = { command: by < 0 ? 'goBack' : 'goForward', time: Date.now() };
        if (event.defaultPrevented || event.isComposing || (event.target instanceof Element && event.target.closest(keepsHistoryKeys))) return;
        event.preventDefault();
        navigate(by);
        return;
      }
      const name = [(event.ctrlKey || event.metaKey) && 'ctrl', event.shiftKey && 'shift', event.altKey && 'alt', event.key.toLowerCase()].filter(Boolean).join('+');
      const command = shortcuts[name];
      if (!command) return;
      event.preventDefault();
      lastShortcut.current = { command, time: Date.now() };
      runCommand(command);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [runCommand, navigate, info.platform]);
  // The mouse's back and forward buttons act as they are released; nothing else takes their presses.
  useEffect(() => {
    const buttonStep = (event: MouseEvent) => event.button === 3 ? -1 : event.button === 4 ? 1 : 0;
    const press = (event: MouseEvent) => { if (buttonStep(event)) event.preventDefault(); };
    const release = (event: MouseEvent) => {
      const by = buttonStep(event);
      if (!by) return;
      event.preventDefault();
      if (!document.activeElement?.closest(keepsHistoryButtons)) navigate(by);
    };
    window.addEventListener('mousedown', press, true);
    window.addEventListener('auxclick', press, true);
    window.addEventListener('mouseup', release, true);
    return () => {
      window.removeEventListener('mousedown', press, true);
      window.removeEventListener('auxclick', press, true);
      window.removeEventListener('mouseup', release, true);
    };
  }, [navigate]);

  const context = useMemo<WorkbenchApi>(() => ({ snapshot, revision: info.revision, open, retarget, notify, remote: info.remote }), [snapshot, info.revision, open, retarget, notify, info.remote]);

  const root = info.folder?.root ?? '';
  const menus: WorkbenchMenus = {
    goBack: () => navigate(-1),
    goForward: () => navigate(1),
    canGoBack: canGoBack(history),
    canGoForward: canGoForward(history),
    quickOpen: () => runCommand('quickOpen'),
    showPage,
    showExplorer: () => runCommand('showExplorer'),
    toggleSidebar: () => runCommand('toggleSidebar'),
    sidebarVisible: ui.sidebar.visible,
    closeTab: () => runCommand('closeTab'),
    canCloseTab: Boolean(active),
    importPlan: () => runCommand('importPlan'),
    exportPlan: () => runCommand('exportPlan'),
    closeFolder,
    isCurrent: currentFolder(info, root),
    // File › Open Folder… on another computer browses it beside the folder this window shows.
    near: snapshot.root,
  };

  const tabs: DocumentTab[] = ui.tabs.items.map(tab => ({ id: tab.id, preview: tab.preview, ...describeTab(tab.target, snapshot) }));
  const activeWork = active?.target.kind === 'work' ? snapshot.work.find(work => active.target.kind === 'work' && work.id === active.target.work) : undefined;
  const fills = Boolean(activeWork && active?.target.kind === 'work' && workSection(active.target, activeWork) === 'diagrams');
  const activeCount = snapshot.work.filter(work => work.location === 'active').length;

  return <WorkbenchContext.Provider value={context}>
    <AppShell className="workbench" topbar="full" titleBar brand={<AtlasMark size={20} label="" />} navigationLabel="Atlas"
      context={<TitleBarStart info={info} workbench={menus} onError={warn} />}
      actions={<>
        <SearchButton platform={info.platform} onClick={() => runCommand('quickOpen')} />
        <Health issues={snapshot.issues} />
        <ThemeMenu />
      </>}
      collapsed={!ui.sidebar.visible} onCollapsedChange={collapsed => setSidebar({ visible: !collapsed })}
      resizable sidebarWidth={ui.sidebar.width} sidebarMinWidth={limits.sidebarMin} sidebarMaxWidth={limits.sidebarMax} onSidebarWidthChange={width => setSidebar({ width: Math.round(width) })}
      navigation={viewNames.map(view => <NavigationItem key={view} icon={viewIcons[view]} selected={!active && ui.page === view} onClick={() => showPage(view)}
        trailing={view === 'work' && activeCount > 0 ? <Counter value={activeCount} aria-label={activeCount + ' active work items'} /> : undefined}>{viewLabels[view]}</NavigationItem>)}
      sidebarContent={<Explorer snapshot={snapshot} folderName={info.folder?.name ?? ''}
        expanded={ui.sidebar.expanded} setExpanded={expanded => setSidebar({ expanded: expanded.slice(-limits.expanded) })} selected={node?.id ?? null} onExportPlan={work => void exportWork(work)} />}>
      <div className={'workbench-body' + (fills ? ' is-filled' : '') + (tabs.length ? ' has-tabs' : '')}>
        {tabs.length > 0 && <DocumentTabs className="workbench-tabs" items={tabs} value={ui.tabs.active} aria-label="Open tabs"
          onValueChange={id => setTabs(state => activateTab(state, id))} onClose={id => setTabs(state => closeTab(state, id))} onPin={id => setTabs(state => pinTab(state, id))} />}
        {info.error && <Notice className="folder-error" tone="warning" announce title={info.remote ? `Atlas can’t read this planning folder on ${info.remote.hostName} right now.` : 'The planning folder can’t be read right now.'}>
          {info.error} {info.remote ? 'Showing the last view.' : 'Showing the last good view. Atlas reloads when the folder is readable again.'}
        </Notice>}
        {info.notice && <Notice className="folder-error" tone="info">{info.notice}</Notice>}
        <div ref={page} className="workbench-page">
          <Shown key={active?.id ?? 'page:' + ui.page} target={shown} snapshot={snapshot} repository={repository} setRepository={setRepository}
            work={{ location, setLocation, search: workSearch, setSearch: setWorkSearch }} />
        </div>
        <ScrollMemory shown={active?.id ?? 'page:' + ui.page} scrollKey={scrolled} anchored={anchored} content={page} positions={scrollPositions} />
      </div>
    </AppShell>
    {quickOpen && <QuickOpen snapshot={snapshot} mode={quickOpen.mode} placeholder={quickOpen.placeholder} onPick={quickOpen.onPick} onClose={() => setQuickOpen(null)} />}
    {importing && <ImportDialog preview={importing}
      onCancel={() => { void api.cancelImport(importing.token).catch(() => undefined); setImporting(null); }}
      onConfirm={async () => {
        const result = await api.confirmImport(importing.token);
        setImporting(null);
        notify(`Imported as ${workNumber(result.workId)} in ${result.path}. ${result.notes.join(' ')}`.trim());
        open(workTarget(result.workId), { pin: true });
      }} />}
  </WorkbenchContext.Provider>;
}

function describeTab(target: Target, snapshot: Snapshot): Omit<DocumentTab, 'id' | 'preview'> {
  if (target.kind === 'view') return { label: viewLabels[target.view], icon: viewIcons[target.view] };
  if (target.kind === 'work') {
    const work = snapshot.work.find(item => item.id === target.work);
    const label = (work?.title ?? workNumber(target.work)) + (target.section === 'diagrams' ? ' · Diagrams' : '');
    return { label, title: work ? workNumber(work.id) + ' · ' + work.path : target.work, icon: work ? <StatusIcon status={workStatus(work)} decorative /> : <WorkIcon /> };
  }
  return { label: target.path.split('/').at(-1) ?? target.path, title: target.path, icon: <FileIcon /> };
}

/**
 * Keep the scroll position of what each tab or page shows (its view, work section or file) while
 * switching; a tab that moves to another section or file starts at the top, and one opened at a
 * heading leaves the scrolling to the reader. A document loads again after the switch, so a saved
 * position is reapplied as the content grows, until the user scrolls or three seconds pass, and
 * nothing is saved meanwhile. The shell's content area scrolls, below the title bar and the sticky
 * tabs.
 */
function ScrollMemory({ shown, scrollKey: key, anchored, content: contentRef, positions }: {
  shown: string; scrollKey: string; anchored: boolean; content: RefObject<HTMLDivElement | null>; positions: RefObject<Map<string, number>>;
}) {
  const { getScrollElement } = useAppShell();
  useLayoutEffect(() => {
    const element = getScrollElement();
    if (!element) return;
    const target = anchored ? null : positions.current.get(key) ?? 0;
    if (target !== null) element.scrollTop = target;
    let restoring = Boolean(target);
    let placed = element.scrollTop;
    // The browser's scroll anchoring would move the page as it grows; the restore places it instead.
    if (restoring) element.style.overflowAnchor = 'none';
    const content = contentRef.current;
    const observer = restoring && content ? new ResizeObserver(() => { if (restoring) { element.scrollTop = target!; placed = element.scrollTop; } }) : null;
    const stop = () => { if (restoring) element.style.overflowAnchor = ''; restoring = false; observer?.disconnect(); };
    if (observer && content) observer.observe(content);
    const timer = window.setTimeout(stop, 3000);
    const remember = () => {
      // The reader scrolled (also with keys pressed outside the page): the page left where the restore
      // put it, also as far as the content allows now.
      if (restoring && Math.abs(element.scrollTop - placed) > 1 && Math.abs(element.scrollTop - Math.min(placed, element.scrollHeight - element.clientHeight)) > 1) stop();
      if (!restoring) positions.current.set(key, element.scrollTop);
    };
    // The document's scrolling reaches the window; an element's, the element.
    const scroller: EventTarget = element === document.scrollingElement ? window : element;
    // The reader's own scrolling stops it: the wheel or touch anywhere, and keys or presses in the
    // page or what holds it (the scrollbar, the shell's content area), not keys pressed in the
    // sidebar or the tabs.
    const interrupt = (event: Event) => {
      const at = event.target;
      if (event.type === 'wheel' || event.type === 'touchstart' || !(at instanceof Node) || !content || at.contains(content) || content.contains(at)) stop();
    };
    const inputs = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const;
    for (const name of inputs) window.addEventListener(name, interrupt, { capture: true, passive: true });
    scroller.addEventListener('scroll', remember, { passive: true });
    return () => {
      stop();
      window.clearTimeout(timer);
      for (const name of inputs) window.removeEventListener(name, interrupt, { capture: true });
      scroller.removeEventListener('scroll', remember);
    };
  }, [shown, key, getScrollElement]);
  return null;
}

/** The page or document the window shows. */
function Shown({ target, snapshot, repository, setRepository, work }: {
  target: Target; snapshot: Snapshot; repository: string; setRepository(value: string): void;
  work: { location: string; setLocation(value: string): void; search: string; setSearch(value: string): void };
}) {
  const filter = { repository, setRepository };
  if (target.kind === 'view') {
    if (target.view === 'activity') return <Activity snapshot={snapshot} {...filter} />;
    if (target.view === 'statistics') return <Statistics snapshot={snapshot} {...filter} />;
    return <WorkList snapshot={snapshot} {...filter} {...work} />;
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

/** The title bar's search: quick open for work items, files and diagrams. */
function SearchButton({ platform, onClick }: { platform: string; onClick(): void }) {
  return <Button variant="secondary" className="search-button" startIcon={<SearchIcon />} onClick={onClick} aria-label="Search" aria-keyshortcuts={platform === 'darwin' ? 'Meta+P' : 'Control+P'}>
    <span className="search-button-label">Search</span><span className="search-button-keys"><Kbd keys={[modifierKey(platform), 'P']} /></span>
  </Button>;
}

/** Record health: problems in the planning records, each linking to its work item. */
function Health({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  const errors = issues.some(issue => issue.level === 'error');
  const label = issues.length + ' record health ' + (issues.length === 1 ? 'note' : 'notes');
  return <Popover aria-label="Record health" title="Record health" width="wide"
    trigger={<Button variant="text" className={'health-button' + (errors ? ' has-errors' : '')} startIcon={<WarningIcon />} aria-label={label}>{issues.length}</Button>}>
    {close => <HealthList issues={issues} onOpen={close} />}
  </Popover>;
}
function HealthList({ issues, onOpen }: { issues: Issue[]; onOpen(): void }) {
  const { open } = useWorkbench();
  return <ul className="health-list">{issues.map((issue, index) => <li key={index} data-level={issue.level}>
    <WarningIcon className="health-icon" />
    <span>{issue.workId && <><Button variant="text" underline className="health-link" onClick={() => { onOpen(); open(workTarget(issue.workId!), { pin: true }); }}>{workNumber(issue.workId)}</Button>{' '}</>}{issue.message}</span>
  </li>)}</ul>;
}
