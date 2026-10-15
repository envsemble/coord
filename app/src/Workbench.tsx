// A window: envUI's application shell with its top bar as the window's title bar (menus, the
// computer, search, the file panel and the window buttons), the computer's projects in the sidebar,
// and tabs above the page, each showing something of one project: its page, a plan, a diagram or a
// file. Tabs of different projects sit side by side. The file panel slides in over the page from
// the right with the files of the active tab's project.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AppShell, Button, DocumentTabs, EmptyState, IconButton, Kbd, Notice, PanelDock, PanelDockHeader, Popover, Spinner, Tooltip, useAppShell, useToast, type DocumentTab, type PanelDockMode } from '@envsemble/envui';
import { ThemeMenu } from './ThemeMenu';
import { AtlasMark } from '@envsemble/atlas-diagrams/react';
import { DiagramIcon, ErrorIcon, FileIcon, FolderIcon, FolderOpenIcon, SearchIcon, WarningIcon, WorkIcon } from './icons';
import { limits, type ImportPreview, type MenuCommand } from '../shared/contract';
import type { FolderChange, Issue, Project, ProjectState, Snapshot, Target, UiState, WindowInfo } from './types';
import { api, AtlasError } from './api';
import { activateTab, closeAllTabs, closeTab, keyTabs, openTab, pinTab, retarget as retargetTab } from './tabs';
import { projectTarget, scrollKey, workTarget, type Place } from './targets';
import { canGoBack, canGoForward, currentEntry, keyStep, record, samePlace, shownPlace, showPlace, startHistory, step } from './history';
import { workStatus } from './status';
import { workNumber } from './format';
import { StatusIcon } from './ui';
import { Explorer, nodeForTarget } from './Explorer';
import { QuickOpen } from './QuickOpen';
import { ImportDialog } from './ImportDialog';
import { FileView, WorkPage } from './WorkPage';
import { AtlasWorkPanel } from './AtlasWorkPanel';
import { ProjectPage, type WorkFilters } from './ProjectPage';
import { Gone } from './Pages';
import { modifierKey, TitleBarStart, type WorkbenchMenus } from './AppMenu';
import { AppActionsContext, useAppActions } from './Computers';
import { NewProjectDialog, ProjectsNavigation, RenameProjectDialog, SetAsideProjects, type ProjectActions } from './ProjectsSidebar';
import { revealIds } from './explorerModel';
import { WorkbenchContext, type Notify, type OpenOptions, type WorkbenchApi } from './workbenchContext';

const toastVariants = { info: 'neutral', warning: 'info', danger: 'error' } as const;

/** Keys handled in the window; the same shortcuts in the application menu are the fallback. */
const shortcuts: Record<string, MenuCommand> = { 'ctrl+p': 'quickOpen', 'ctrl+b': 'toggleSidebar', 'ctrl+w': 'closeTab', 'ctrl+shift+e': 'toggleFiles' };
/** Where the back and forward keys stay: fields, and open menus, lists and dialogs. */
const keepsHistoryKeys = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';
/** What the mouse's back and forward buttons only close: open menus, lists and dialogs. */
const keepsHistoryButtons = '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';
const popupOpen = () => Boolean(document.activeElement?.closest(keepsHistoryButtons)) || [...document.querySelectorAll(keepsHistoryButtons)].some(element => element.checkVisibility());

/** A project's folder as the window follows it: its state, and its snapshot once read. */
interface Folder { change: FolderChange | null; snapshot: Snapshot | null; failure: string }

export function Workbench({ info, initialUi }: { info: WindowInfo; initialUi: UiState }) {
  const toast = useToast();
  const notify = useCallback<Notify>((message, tone = 'info') => { toast.show({ message, variant: toastVariants[tone] }); }, [toast]);
  const warn = useCallback((message: string) => notify(message, 'warning'), [notify]);
  const actions = useAppActions();

  // ---- The computer's projects, and the folders the window follows ------------------------------
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsError, setProjectsError] = useState('');
  useEffect(() => {
    let current = true;
    const load = () => api.projects().then(next => { if (current) { setProjects(next); setProjectsError(''); } }, error => { if (current) { setProjects(previous => previous ?? []); setProjectsError((error as Error).message); } });
    void load();
    const off = api.onProjectsChanged(() => { void load(); });
    return () => { current = false; off(); };
  }, []);
  const [folders, setFolders] = useState<Record<string, Folder>>({});
  const following = useRef(new Set<string>());
  const latest = useRef(new Map<string, number>());
  const setFolder = useCallback((project: string, change: (folder: Folder) => Folder) => setFolders(current => ({ ...current, [project]: change(current[project] ?? { change: null, snapshot: null, failure: '' }) })), []);
  const refresh = useCallback(async (project: string, revision: number) => {
    latest.current.set(project, Math.max(latest.current.get(project) ?? 0, revision));
    try {
      const snapshot = await api.snapshot(project);
      if (revision >= (latest.current.get(project) ?? 0)) setFolder(project, folder => ({ ...folder, snapshot, failure: '' }));
    } catch (error) { if (revision >= (latest.current.get(project) ?? 0)) setFolder(project, folder => ({ ...folder, failure: (error as Error).message })); }
  }, [setFolder]);
  useEffect(() => api.onChanged(change => {
    if (!following.current.has(change.project)) return;
    setFolder(change.project, folder => ({ ...folder, change }));
    if (change.status === 'ready') void refresh(change.project, change.revision);
  }), [refresh, setFolder]);
  /** Follow projects' folders (their tabs show, or quick open searches them) and read them. */
  const follow = useCallback((wanted: string[]) => {
    for (const project of wanted) {
      if (following.current.has(project)) continue;
      following.current.add(project);
      api.openProject(project).then(change => {
        setFolder(project, folder => folder.change && folder.change.revision > change.revision ? folder : { ...folder, change });
        if (change.status === 'ready') void refresh(project, change.revision);
      }, error => setFolder(project, folder => ({ ...folder, failure: (error as Error).message })));
    }
  }, [refresh, setFolder]);
  const snapshots = useMemo(() => Object.fromEntries(Object.entries(folders).flatMap(([project, folder]) => folder.snapshot ? [[project, folder.snapshot]] : [])), [folders]);

  // ---- The layout and the history of what the window showed --------------------------------------
  // The layout and the history (back and forward) change together: each change of what shows is
  // recorded, except a step back or forward.
  const [{ ui, history }, setWindowState] = useState(() => {
    const keyed = { ...initialUi, tabs: keyTabs(initialUi.tabs) };
    return { ui: keyed, history: startHistory(shownPlace(keyed)) };
  });
  const setUi = useCallback((change: (current: UiState) => UiState) => setWindowState(current => {
    const next = change(current.ui);
    if (next === current.ui) return current;
    const shown = shownPlace(next);
    return { ui: next, history: samePlace(shown, shownPlace(current.ui)) ? current.history : record(current.history, shown) };
  }), []);
  // A step back or forward from main (the menu, or the mouse's buttons over the title bar's empty
  // space), which the same press reaching the page a moment later repeats; any other step ends it.
  const lastMenuStep = useRef<{ command: MenuCommand; time: number } | null>(null);
  const navigate = useCallback((by: -1 | 1) => {
    lastMenuStep.current = null;
    setWindowState(current => {
      const moved = step(current.history, by);
      return moved ? { ui: showPlace(current.ui, moved.place), history: moved.history } : current;
    });
  }, []);
  // Persist the layout, debounced.
  useEffect(() => {
    const timer = window.setTimeout(() => { api.saveUi(ui).catch(() => undefined); }, 250);
    return () => window.clearTimeout(timer);
  }, [ui]);

  const active = ui.tabs.items.find(tab => tab.id === ui.tabs.active);
  const activeProject = active?.project ?? null;
  // The projects the tabs show are followed.
  useEffect(() => { follow([...new Set(ui.tabs.items.map(tab => tab.project))]); }, [ui.tabs.items, follow]);

  const setTabs = useCallback((change: (tabs: UiState['tabs']) => UiState['tabs']) => setUi(current => ({ ...current, tabs: change(current.tabs) })), [setUi]);
  const openPlace = useCallback((place: Place, pin = false) => setTabs(tabs => openTab(tabs, place.project, place.target, pin)), [setTabs]);
  const setSidebar = useCallback((change: Partial<UiState['sidebar']>) => setUi(current => ({ ...current, sidebar: { ...current.sidebar, ...change } })), [setUi]);
  const setInspectorWidth = useCallback((width: number) => setUi(current => current.inspectorWidth === width ? current : { ...current, inspectorWidth: width }), [setUi]);

  // ---- The file panel ---------------------------------------------------------------------------
  const [files, setFiles] = useState<PanelDockMode | null>(null);
  const [expanded, setExpanded] = useState<Record<string, string[]>>({});
  const activeSnapshot = activeProject ? folders[activeProject]?.snapshot ?? null : null;
  const node = active && activeSnapshot ? nodeForTarget(active.target, activeSnapshot) : null;
  // Reveal the active tab's item in the file panel.
  useEffect(() => {
    if (!activeProject || !node) return;
    const reveal = active?.target.kind === 'file' ? revealIds(active.target.path) : node.reveal;
    setExpanded(current => {
      const open = current[activeProject] ?? [];
      const missing = reveal.filter(id => !open.includes(id));
      return missing.length ? { ...current, [activeProject]: [...open, ...missing] } : current;
    });
  }, [activeProject, node?.id]);

  // ---- Commands -----------------------------------------------------------------------------------
  const [quickOpen, setQuickOpen] = useState<null | { mode: 'all' | 'work'; placeholder?: string; onPick(place: Place, pin: boolean): void }>(null);
  const [importing, setImporting] = useState<ImportPreview | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [workFilters, setWorkFilters] = useState<Record<string, { location: string; search: string }>>({});

  const exportWork = useCallback(async (project: string, work: string) => {
    try {
      const result = await api.exportPlan(project, work);
      if (result) notify(`Exported ${workNumber(work)} to ${result.path}` + (result.warnings.length ? ' — ' + result.warnings.join(' ') : ''), result.warnings.length ? 'warning' : 'info');
    } catch (error) { notify((error as Error).message, (error as AtlasError).code === 'unavailable' ? 'warning' : 'danger'); }
  }, [notify]);
  const startImport = useCallback(async () => {
    if (!activeProject) { notify('Open a project first: the plan is imported into the project of the tab you are in.', 'warning'); return; }
    try {
      const preview = await api.chooseImport(activeProject);
      if (preview) setImporting(preview);
    } catch (error) {
      if ((error as AtlasError).code === 'cancelled') return;
      notify((error as Error).message, (error as AtlasError).code === 'unavailable' ? 'warning' : 'danger');
    }
  }, [activeProject, notify]);
  const searchProjects = useCallback(() => { if (projects) follow(projects.filter(project => project.state === 'active').map(project => project.folderId)); }, [projects, follow]);
  const chooseExport = useCallback(() => {
    const target = active?.target;
    const work = target?.kind === 'work' || target?.kind === 'diagram' ? target.work
      : target?.kind === 'file' && activeSnapshot ? activeSnapshot.documents.find(file => file.path === target.path)?.workId ?? null : null;
    if (active && work) { void exportWork(active.project, work); return; }
    searchProjects();
    setQuickOpen({ mode: 'work', placeholder: 'Choose a work item to export', onPick: place => { if (place.target.kind === 'work') void exportWork(place.project, place.target.work); } });
  }, [active, activeSnapshot, exportWork, searchProjects]);
  const closeAll = useCallback(() => setTabs(closeAllTabs), [setTabs]);

  const runCommand = useCallback((command: MenuCommand) => {
    switch (command) {
      // envUI's shell compacts a collapsing sidebar even while it holds focus.
      case 'toggleSidebar': setSidebar({ visible: !ui.sidebar.visible }); break;
      case 'toggleFiles': setFiles(mode => mode === 'open' || mode === 'maximized' ? null : 'open'); break;
      case 'quickOpen': searchProjects(); setQuickOpen({ mode: 'all', onPick: (place, pin) => openPlace(place, pin) }); break;
      case 'closeTab': setTabs(tabs => tabs.active ? closeTab(tabs, tabs.active) : tabs); break;
      case 'closeAllTabs': closeAll(); break;
      case 'newProject': setNewProject(true); break;
      case 'importPlan': void startImport(); break;
      case 'exportPlan': chooseExport(); break;
      case 'goBack': navigate(-1); break;
      case 'goForward': navigate(1); break;
    }
  }, [ui.sidebar.visible, openPlace, setTabs, setSidebar, searchProjects, startImport, chooseExport, closeAll, navigate]);

  // Menu commands from main; ignore one that repeats a key this window just took, or left to a field.
  const lastShortcut = useRef<{ command: MenuCommand; time: number } | null>(null);
  const closingPress = useRef(0);
  useEffect(() => api.onMenu(command => {
    const last = lastShortcut.current;
    if (last && last.command === command && Date.now() - last.time < 300) return;
    if (command === 'goBack' || command === 'goForward') {
      if (Date.now() - closingPress.current < 300) return;
      runCommand(command);
      lastMenuStep.current = { command, time: Date.now() };
      return;
    }
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
  // A menu or dialog open as the button goes down closes on that press, which then does nothing more.
  useEffect(() => {
    const buttonStep = (event: MouseEvent) => event.button === 3 ? -1 : event.button === 4 ? 1 : 0;
    let closing = false;
    const press = (event: MouseEvent) => {
      if (!buttonStep(event)) return;
      event.preventDefault();
      if (event.type !== 'mousedown') return;
      closing = popupOpen();
      if (closing) closingPress.current = Date.now();
    };
    const release = (event: MouseEvent) => {
      const by = buttonStep(event);
      if (!by) return;
      event.preventDefault();
      const command = by < 0 ? 'goBack' : 'goForward';
      // Main's echo of this press (Windows and Linux report the buttons to the window too) adds
      // nothing, and nor does this press when main's came first.
      lastShortcut.current = { command, time: Date.now() };
      const echo = lastMenuStep.current;
      lastMenuStep.current = null;
      if (closing) { closing = false; return; }
      if (!echo || echo.command !== command || Date.now() - echo.time >= 300) navigate(by);
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

  // ---- Projects in the sidebar ----------------------------------------------------------------------
  const updateProject = useCallback((project: Project, change: { name?: string; state?: ProjectState; position?: number }) =>
    api.updateProject(project.folderId, change).then(updated => setProjects(current => current?.map(item => item.folderId === updated.folderId ? updated : item) ?? current)), []);
  const projectActions = useMemo<ProjectActions>(() => ({
    // A project's page opens as a kept tab: it is where its work starts.
    open: project => openPlace({ project: project.folderId, target: projectTarget() }, true),
    update: (project, change) => { updateProject(project, change).then(() => api.projects().then(setProjects), error => notify((error as Error).message, 'danger')); },
    rename: project => setRenaming(project),
    create: () => setNewProject(true),
  }), [openPlace, updateProject, notify]);
  // File › New Project… opens the dialog here, where the new project's page opens.
  const windowActions = useMemo(() => ({ ...actions, newProject: () => setNewProject(true) }), [actions]);

  // ---- What shows ---------------------------------------------------------------------------------
  const page = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const entryPositions = useRef(new Map<number, number>());
  const shown = shownPlace(ui);
  const revisit = entryPositions.current.has(currentEntry(history));
  const anchored = Boolean(shown && 'anchor' in shown.target && shown.target.anchor) && !revisit;
  const placed: Place | null = shown && revisit && 'anchor' in shown.target && shown.target.anchor ? { ...shown, target: { ...shown.target, anchor: null } as Target } : shown;
  // Forget the positions of what no open tab or step back or forward shows.
  useEffect(() => {
    const kept = new Set([...ui.tabs.items.map(tab => scrollKey(tab)), ...history.entries.flatMap(entry => entry ? [scrollKey(entry)] : [])]);
    for (const key of [...scrollPositions.current.keys()]) if (!kept.has(key)) scrollPositions.current.delete(key);
    const entries = new Set(history.ids);
    for (const id of [...entryPositions.current.keys()]) if (!entries.has(id)) entryPositions.current.delete(id);
  }, [ui.tabs.items, history.entries, history.ids]);

  const projectOf = (folderId: string) => projects?.find(project => project.folderId === folderId);
  /** What a tab's content works with, for its project. */
  const scope = useCallback((project: string, snapshot: Snapshot, revision: number): WorkbenchApi => ({
    project, projectName: projects?.find(item => item.folderId === project)?.name ?? snapshot.name, snapshot, revision,
    open: (target: Target, options: OpenOptions = {}) => openPlace({ project: options.project ?? project, target }, options.pin ?? false),
    retarget: (target: Target) => setTabs(tabs => tabs.active ? retargetTab(tabs, tabs.active, project, target) : openTab(tabs, project, target, true)),
    notify, remote: info.computer.hostId === null ? null : { hostId: info.computer.hostId, hostName: info.computer.name },
    inspectorWidth: ui.inspectorWidth ?? null, setInspectorWidth, exportPlan: work => { void exportWork(project, work); },
  }), [projects, openPlace, setTabs, notify, info.computer, ui.inspectorWidth, setInspectorWidth, exportWork]);
  const activeFolder = activeProject ? folders[activeProject] : undefined;
  const activeScope = useMemo(() => activeProject && activeFolder?.snapshot ? scope(activeProject, activeFolder.snapshot, activeFolder.change?.revision ?? 0) : null, [activeProject, activeFolder, scope]);

  const menus: WorkbenchMenus = {
    goBack: () => navigate(-1),
    goForward: () => navigate(1),
    canGoBack: canGoBack(history),
    canGoForward: canGoForward(history),
    quickOpen: () => runCommand('quickOpen'),
    toggleFiles: () => runCommand('toggleFiles'),
    filesVisible: files === 'open' || files === 'maximized',
    toggleSidebar: () => runCommand('toggleSidebar'),
    sidebarVisible: ui.sidebar.visible,
    closeTab: () => runCommand('closeTab'),
    closeAllTabs: closeAll,
    canCloseTab: Boolean(active),
    importPlan: () => runCommand('importPlan'),
    exportPlan: () => runCommand('exportPlan'),
  };

  const tabs: DocumentTab[] = ui.tabs.items.map(tab => ({ id: tab.id, preview: tab.preview, ...describeTab(tab.target, folders[tab.project]?.snapshot ?? null, projectOf(tab.project)) }));
  const fills = active?.target.kind === 'diagram' && Boolean(activeFolder?.snapshot);
  // As tall as the room below the tabs allows.
  const filePanel = files && activeScope ? [{ id: 'files', title: 'Files', label: 'Files', mode: files, active: true, icon: <FolderOpenIcon />, preferredWidth: 360, height: 100000, tooltip: 'Files of ' + activeScope.projectName }] : [];

  return <AppActionsContext.Provider value={windowActions}>
    <AppShell className="workbench" topbar="full" titleBar brand={<AtlasMark size={20} label="" />} navigationLabel="Projects"
      context={<TitleBarStart info={info} workbench={menus} onError={warn} />}
      actions={<>
        <SearchButton platform={info.platform} onClick={() => runCommand('quickOpen')} />
        <Tooltip content={'Files (' + modifierKey(info.platform) + '+Shift+E)'} side="bottom">
          <IconButton variant="text" className="files-button" icon={<FolderOpenIcon />} aria-label="Files" aria-pressed={menus.filesVisible} aria-keyshortcuts={(info.platform === 'darwin' ? 'Meta' : 'Control') + '+Shift+E'} onClick={() => runCommand('toggleFiles')} />
        </Tooltip>
        {activeFolder?.snapshot && <Health issues={activeFolder.snapshot.issues} open={work => activeProject && openPlace({ project: activeProject, target: workTarget(work) }, true)} />}
        <ThemeMenu />
      </>}
      collapsed={!ui.sidebar.visible} onCollapsedChange={collapsed => setSidebar({ visible: !collapsed })}
      resizable sidebarWidth={ui.sidebar.width} sidebarMinWidth={limits.sidebarMin} sidebarMaxWidth={limits.sidebarMax} onSidebarWidthChange={width => setSidebar({ width: Math.round(width) })}
      navigation={<ProjectsNavigation projects={projects} error={projectsError} selected={active?.target.kind === 'project' ? activeProject : null} actions={projectActions} />}
      sidebarContent={<SetAsideProjects projects={projects} selected={active?.target.kind === 'project' ? activeProject : null} actions={projectActions} />}>
      <div className={'workbench-body' + (fills ? ' is-filled' : '') + (tabs.length ? ' has-tabs' : '')}>
        {tabs.length > 0 && <DocumentTabs className="workbench-tabs" items={tabs} value={ui.tabs.active} aria-label="Open tabs"
          onValueChange={id => setTabs(state => activateTab(state, id))} onClose={id => setTabs(state => closeTab(state, id))} onPin={id => setTabs(state => pinTab(state, id))}
          onCloseAll={closeAll} />}
        <div ref={page} className="workbench-page">
          <Shown key={active?.id ?? 'none'} place={placed} folder={activeFolder} project={activeProject ? projectOf(activeProject) : undefined} scope={activeScope}
            work={activeProject ? filtersOf(workFilters, setWorkFilters, activeProject) : null} />
        </div>
        <ScrollMemory shown={active?.id ?? 'none'} scrollKey={shown ? scrollKey(shown) : 'none'} anchored={anchored} entry={currentEntry(history)} content={page} positions={scrollPositions} entryPositions={entryPositions} />
        {activeScope && <PanelDock className="file-dock" panels={filePanel} onModeChange={(_id, mode) => setFiles(mode)} onClose={() => setFiles(null)}>
          {() => <WorkbenchContext.Provider value={activeScope}>
            <PanelDockHeader title="Files" meta={activeScope.projectName} />
            <Explorer snapshot={activeScope.snapshot} expanded={expanded[activeScope.project] ?? []} setExpanded={next => setExpanded(current => ({ ...current, [activeScope.project]: next }))} selected={node?.id ?? null} />
          </WorkbenchContext.Provider>}
        </PanelDock>}
      </div>
    </AppShell>
    {quickOpen && projects && <QuickOpen projects={projects.filter(project => project.state === 'active' || project.folderId === activeProject)} snapshots={snapshots} mode={quickOpen.mode} placeholder={quickOpen.placeholder} onPick={quickOpen.onPick} onClose={() => setQuickOpen(null)} />}
    {importing && activeProject && <ImportDialog preview={importing}
      onCancel={() => { void api.cancelImport(importing.token).catch(() => undefined); setImporting(null); }}
      onConfirm={async () => {
        const result = await api.confirmImport(importing.token);
        setImporting(null);
        notify(`Imported as ${workNumber(result.workId)} in ${result.path}. ${result.notes.join(' ')}`.trim());
        openPlace({ project: activeProject, target: workTarget(result.workId) }, true);
      }} />}
    {newProject && <NewProjectDialog computer={info.computer.name} onClose={() => setNewProject(false)} onCreated={project => {
      setProjects(current => current && !current.some(item => item.folderId === project.folderId) ? [...current, project] : current);
      openPlace({ project: project.folderId, target: projectTarget() }, true);
    }} />}
    {renaming && <RenameProjectDialog project={renaming} onClose={() => setRenaming(null)} onRename={name => updateProject(renaming, { name })} />}
  </AppActionsContext.Provider>;
}

/** A project's work filters, kept while the window is open. */
function filtersOf(all: Record<string, { location: string; search: string }>, set: (change: (current: Record<string, { location: string; search: string }>) => Record<string, { location: string; search: string }>) => void, project: string): WorkFilters {
  const current = all[project] ?? { location: 'active', search: '' };
  return {
    location: current.location, search: current.search,
    setLocation: location => set(previous => ({ ...previous, [project]: { ...current, ...previous[project], location } })),
    setSearch: search => set(previous => ({ ...previous, [project]: { ...current, ...previous[project], search } })),
  };
}

function describeTab(target: Target, snapshot: Snapshot | null, project: Project | undefined): Omit<DocumentTab, 'id' | 'preview'> {
  const owner = project ? ' · ' + project.name : '';
  if (target.kind === 'project') return { label: project?.name ?? snapshot?.name ?? 'Project', title: project?.path, icon: <FolderIcon /> };
  if (target.kind === 'work' || target.kind === 'diagram') {
    const work = snapshot?.work.find(item => item.id === target.work);
    const diagram = target.kind === 'diagram' ? (target.path ?? '').split('/').at(-1)?.replace(/\.puml$/i, '') : null;
    const label = target.kind === 'diagram' ? (diagram || 'Diagrams') + ' · ' + (work?.title ?? workNumber(target.work)) : work?.title ?? workNumber(target.work);
    return { label, title: (work ? workNumber(work.id) + ' · ' + work.path : target.work) + owner, icon: target.kind === 'diagram' ? <DiagramIcon /> : work ? <StatusIcon status={workStatus(work)} decorative /> : <WorkIcon /> };
  }
  return { label: target.path.split('/').at(-1) ?? target.path, title: target.path + owner, icon: <FileIcon /> };
}

/**
 * Keep the scroll position of what each tab shows (a project's page, a plan, a file) while
 * switching, where it was last read; a tab that moves to another item starts at the top, and one
 * opened at a heading leaves the scrolling to the reader. A step back or forward finds its entry
 * where it was left instead. A document loads again after the switch, so a saved position is
 * reapplied as the content grows, until the user scrolls or three seconds pass, and nothing is saved
 * meanwhile. The shell's content area scrolls, below the title bar and the sticky tabs.
 */
function ScrollMemory({ shown, scrollKey: key, anchored, entry, content: contentRef, positions, entryPositions }: {
  shown: string; scrollKey: string; anchored: boolean; entry: number; content: RefObject<HTMLDivElement | null>;
  positions: RefObject<Map<string, number>>; entryPositions: RefObject<Map<number, number>>;
}) {
  const { getScrollElement } = useAppShell();
  useLayoutEffect(() => {
    const element = getScrollElement();
    if (!element) return;
    // An entry shown before (a step back or forward) is where it was left; anything else where its
    // document was last read, or at its heading.
    const target = entryPositions.current.get(entry) ?? (anchored ? null : positions.current.get(key) ?? 0);
    if (target !== null) element.scrollTop = target;
    let restoring = Boolean(target);
    let placed = element.scrollTop;
    // Where this entry is, kept for coming back to it; a scroll event, unlike the cleanup, still
    // reads this entry's content.
    let left = element.scrollTop;
    // The browser's scroll anchoring would move the page as it grows; the restore places it instead.
    if (restoring) element.style.overflowAnchor = 'none';
    const content = contentRef.current;
    const observer = restoring && content ? new ResizeObserver(() => { if (restoring) { element.scrollTop = target!; placed = left = element.scrollTop; } }) : null;
    const stop = () => { if (restoring) element.style.overflowAnchor = ''; restoring = false; observer?.disconnect(); };
    if (observer && content) observer.observe(content);
    const timer = window.setTimeout(stop, 3000);
    const remember = () => {
      // The reader scrolled (also with keys pressed outside the page): the page left where the restore
      // put it, also as far as the content allows now.
      if (restoring && Math.abs(element.scrollTop - placed) > 1 && Math.abs(element.scrollTop - Math.min(placed, element.scrollHeight - element.clientHeight)) > 1) stop();
      if (!restoring) { positions.current.set(key, element.scrollTop); left = element.scrollTop; }
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
      entryPositions.current.set(entry, left);
    };
  }, [shown, key, entry, getScrollElement]);
  return null;
}

/** What the active tab shows, in its project's scope; or, without a tab, a way to start. */
function Shown({ place, folder, project, scope, work }: { place: Place | null; folder: Folder | undefined; project: Project | undefined; scope: WorkbenchApi | null; work: WorkFilters | null }) {
  if (!place) return <EmptyState className="page-empty workbench-empty" icon={<FolderIcon />} title="Open a project" description="Choose a project in the sidebar to see its work, statistics and activity, or press Ctrl+P to find a plan, a document or a diagram." />;
  const change = folder?.change;
  if (change?.status === 'missing' || (!folder?.snapshot && (change?.status === 'invalid' || folder?.failure))) {
    return <EmptyState className="page-empty" icon={<ErrorIcon />} title={change?.status === 'missing' ? 'This project’s folder was moved or deleted' : 'This project can’t be read'}
      description={<>{(project?.path ?? folder?.snapshot?.root) && <bdi className="folder-problem-path">{project?.path ?? folder?.snapshot?.root}</bdi>} {change?.error ?? folder?.failure} Atlas reads it again as soon as it can.</>} />;
  }
  if (!scope || !folder?.snapshot) return <div className="page-state" aria-busy="true"><Spinner size="large" label={'Reading ' + (project?.name ?? 'the project')} /></div>;
  const snapshot = folder.snapshot;
  const { target } = place;
  let content;
  if (target.kind === 'project') content = <ProjectPage project={project} snapshot={snapshot} work={work!} />;
  else if (target.kind === 'work' || target.kind === 'diagram') {
    const item = snapshot.work.find(entry => entry.id === target.work);
    content = !item ? <Gone title="This work item is no longer registered" detail={target.work} />
      : target.kind === 'work' ? <WorkPage work={item} snapshot={snapshot} target={target} />
      : <div className="work-page section-diagrams"><AtlasWorkPanel key={item.id} work={item} target={target} /></div>;
  } else {
    const file = snapshot.documents.find(document => document.path === target.path);
    content = !file ? <Gone title="This file no longer exists" detail={target.path} /> : <FileView file={file} snapshot={snapshot} anchor={target.anchor ?? null} />;
  }
  return <WorkbenchContext.Provider value={scope}>
    {change?.error && <Notice className="folder-error" tone="warning" announce title={scope.remote ? `Atlas can’t read this project on ${scope.remote.hostName} right now.` : 'This project can’t be read right now.'}>
      {change.error} {scope.remote ? 'Showing the last view.' : 'Showing the last good view. Atlas reloads when the folder is readable again.'}
    </Notice>}
    {change?.notice && <Notice className="folder-error" tone="info">{change.notice}</Notice>}
    {content}
  </WorkbenchContext.Provider>;
}

/** The title bar's search: quick open for work items, documents and diagrams of every project. */
function SearchButton({ platform, onClick }: { platform: string; onClick(): void }) {
  return <Button variant="secondary" className="search-button" startIcon={<SearchIcon />} onClick={onClick} aria-label="Search" aria-keyshortcuts={platform === 'darwin' ? 'Meta+P' : 'Control+P'}>
    <span className="search-button-label">Search</span><span className="search-button-keys"><Kbd keys={[modifierKey(platform), 'P']} /></span>
  </Button>;
}

/** Record health of the active tab's project: problems in its planning records, each linking to its work item. */
function Health({ issues, open }: { issues: Issue[]; open(work: string): void }) {
  if (!issues.length) return null;
  const errors = issues.some(issue => issue.level === 'error');
  const label = issues.length + ' record health ' + (issues.length === 1 ? 'note' : 'notes');
  return <Popover aria-label="Record health" title="Record health" width="wide"
    trigger={<Button variant="text" className={'health-button' + (errors ? ' has-errors' : '')} startIcon={<WarningIcon />} aria-label={label}>{issues.length}</Button>}>
    {close => <ul className="health-list">{issues.map((issue, index) => <li key={index} data-level={issue.level}>
      <WarningIcon className="health-icon" />
      <span>{issue.workId && <><Button variant="text" underline className="health-link" onClick={() => { close(); open(issue.workId!); }}>{workNumber(issue.workId)}</Button>{' '}</>}{issue.message}</span>
    </li>)}</ul>}
  </Popover>;
}

