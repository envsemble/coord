// A window: envUI's window frame with its own title bar (the logo, back and forward, the menu, the
// computer, search, the file panel, record health, the theme and the window buttons) above one place
// at a time: the hub, where it starts and returns when nothing else is open, a plan, a diagram or a
// file of a project, or one of the menu's pages (Projects, Statistics). The file panel slides in over
// a project's page from the right with the files of its project.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button, EmptyState, IconButton, Kbd, Notice, PanelDock, PanelDockHeader, Popover, Select, Spinner, TitleBar, Tooltip, useToast, WindowFrame, type PanelDockMode } from '@envsemble/envui';
import { ThemeMenu } from './ThemeMenu';
import { ErrorIcon, FolderOpenIcon, SearchIcon, StatisticsIcon, WarningIcon } from './icons';
import type { ImportPreview, MenuCommand } from '../shared/contract';
import type { FolderChange, Issue, Project, ProjectChangeRequest, Snapshot, Target, UiState, WindowInfo } from './types';
import { api, AtlasError } from './api';
import { documentTarget, hubPlace, isPage, placeId, placeProject, projectsPlace, scrollKey, statisticsPlace, workTarget, type Place, type ProjectPlace } from './targets';
import { samePath, siblingProject } from './links';
import { canGoBack, canGoForward, currentEntry, keyStep, moveProject, record, samePlace, startHistory, step } from './history';
import { workNumber } from './format';
import { Explorer, nodeForTarget } from './Explorer';
import { QuickOpen } from './QuickOpen';
import { ImportDialog } from './ImportDialog';
import { FileView, WorkPage } from './WorkPage';
import { AtlasWorkPanel } from './AtlasWorkPanel';
import { Hub, type HubFilters } from './Hub';
import { ProjectsPage, type ProjectActions } from './ProjectsPage';
import { Statistics } from './StatisticsPage';
import { Gone } from './Pages';
import { modifierKey, TitleBarStart, type WorkbenchMenus } from './AppMenu';
import { revealIds } from './explorerModel';
import { WorkbenchContext, type Notify, type WorkbenchApi } from './workbenchContext';

const toastVariants = { info: 'neutral', warning: 'info', danger: 'error' } as const;

/** Keys handled in the window; the same shortcuts in the application menu are the fallback. */
const shortcuts: Record<string, MenuCommand> = { 'ctrl+p': 'quickOpen', 'ctrl+shift+e': 'toggleFiles' };
/** Where the back and forward keys stay: fields, and open menus, lists and dialogs. */
const keepsHistoryKeys = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';
/** What the mouse's back and forward buttons only close: open menus, lists and dialogs. */
const keepsHistoryButtons = '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';
const popupOpen = () => Boolean(document.activeElement?.closest(keepsHistoryButtons)) || [...document.querySelectorAll(keepsHistoryButtons)].some(element => element.checkVisibility());

/** A project's folder as the window follows it: its state, its snapshot once read, and the revision it was read at. */
interface Folder { change: FolderChange | null; snapshot: Snapshot | null; read: number; failure: string }

export function Workbench({ info, initialUi }: { info: WindowInfo; initialUi: UiState }) {
  const toast = useToast();
  const notify = useCallback<Notify>((message, tone = 'info') => { toast.show({ message, variant: toastVariants[tone] }); }, [toast]);
  const warn = useCallback((message: string) => notify(message, 'warning'), [notify]);

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
  const setFolder = useCallback((project: string, change: (folder: Folder) => Folder) => setFolders(current => ({ ...current, [project]: change(current[project] ?? { change: null, snapshot: null, read: 0, failure: '' }) })), []);
  const refresh = useCallback(async (project: string, revision: number) => {
    latest.current.set(project, Math.max(latest.current.get(project) ?? 0, revision));
    try {
      const snapshot = await api.snapshot(project);
      if (revision >= (latest.current.get(project) ?? 0)) setFolder(project, folder => ({ ...folder, snapshot, read: revision, failure: '' }));
    } catch (error) { if (revision >= (latest.current.get(project) ?? 0)) setFolder(project, folder => ({ ...folder, failure: (error as Error).message })); }
  }, [setFolder]);
  useEffect(() => api.onChanged(change => {
    if (following.current.has(change.project)) setFolder(change.project, folder => ({ ...folder, change }));
  }), [setFolder]);
  /** Follow projects' folders: their changes reach the window (and the project list), and the one shown is read. */
  const follow = useCallback((wanted: string[]) => {
    for (const project of wanted) {
      if (following.current.has(project)) continue;
      following.current.add(project);
      api.openProject(project).then(change => setFolder(project, folder => folder.change && folder.change.revision > change.revision ? folder : { ...folder, change }),
        error => setFolder(project, folder => ({ ...folder, failure: (error as Error).message })));
    }
  }, [setFolder]);
  /** Stop following a project's folder: nothing in the window shows it. */
  const unfollow = useCallback((project: string) => {
    if (!following.current.delete(project)) return;
    latest.current.delete(project);
    setFolders(current => { const { [project]: _gone, ...rest } = current; return rest; });
    api.closeProject(project).catch(() => undefined);
  }, []);

  // ---- What the window shows, and the history of what it showed -----------------------------------
  // The place and the history (back and forward) change together: each change of place is recorded,
  // except a step back or forward.
  const [{ ui, history }, setWindowState] = useState(() => ({ ui: initialUi, history: startHistory(initialUi.place) }));
  const place = ui.place;
  const go = useCallback((next: Place) => setWindowState(current => ({ ui: { ...current.ui, place: next }, history: record(current.history, next) })), []);
  /** Show another place instead of the current one, which history forgets (a plan that is gone). */
  const replace = useCallback((next: Place) => setWindowState(current => {
    const entries = [...current.history.entries];
    entries[current.history.index] = next;
    return { ui: { ...current.ui, place: next }, history: { ...current.history, entries } };
  }), []);
  // A step back or forward from main (the menu, or the mouse's buttons over the title bar's empty
  // space), which the same press reaching the page a moment later repeats; any other step ends it.
  const lastMenuStep = useRef<{ command: MenuCommand; time: number } | null>(null);
  const navigate = useCallback((by: -1 | 1) => {
    lastMenuStep.current = null;
    setWindowState(current => {
      const moved = step(current.history, by);
      return moved ? { ui: { ...current.ui, place: moved.place }, history: moved.history } : current;
    });
  }, []);
  // A project moved into its computer's home, from this window or another: what shows of it follows its new folder ID.
  useEffect(() => api.onProjectsChanged(({ moved }) => {
    if (!moved) return;
    unfollow(moved.from);
    setWindowState(current => moveProject(current, moved.from, moved.to));
  }), [unfollow]);
  // Persist the layout, debounced.
  useEffect(() => {
    const timer = window.setTimeout(() => { api.saveUi(ui).catch(() => undefined); }, 250);
    return () => window.clearTimeout(timer);
  }, [ui]);
  // A place of a project whose computer had not answered as the window opened comes once it lists it,
  // unless the window has moved on.
  const restoring = useRef(Boolean(initialUi.pending));
  useEffect(() => {
    if (!restoring.current || !projects?.length) return;
    api.loadUi().then(loaded => {
      if (!loaded.pending) restoring.current = false;
      setWindowState(current => current.history.entries.length > 1 || samePlace(current.ui.place, loaded.place) ? current : { ui: { ...current.ui, place: loaded.place }, history: startHistory(loaded.place) });
    }, () => undefined);
  }, [projects]);
  const setInspectorWidth = useCallback((width: number) => setWindowState(current => current.ui.inspectorWidth === width ? current : { ...current, ui: { ...current.ui, inspectorWidth: width } }), []);

  /** The project whose folder the window reads: that of a plan, diagram or file, or of the statistics. */
  const reading = isPage(place) ? (place.page === 'statistics' ? place.project : null) : place.project;
  const projectPlace = isPage(place) ? null : place;
  const readFolder = reading ? folders[reading] : undefined;
  // The project of the plan last open, for the Statistics page.
  const lastProject = useRef<string | null>(projectPlace?.project ?? null);
  if (projectPlace) lastProject.current = projectPlace.project;
  // The hub follows every active project's folder too, so their plans' changes reach it.
  const watching = useMemo(() => isPage(place) && place.page === 'hub' ? (projects ?? []).filter(project => project.state === 'active').map(project => project.folderId) : [], [place, projects]);
  const wanted = useMemo(() => [...new Set([...reading ? [reading] : [], ...watching])], [reading, watching]);
  const wantedRef = useRef(wanted);
  wantedRef.current = wanted;
  useEffect(() => { follow(wanted); }, [wanted, follow]);
  // Folders nothing shows any more are let go a moment later.
  useEffect(() => {
    const timer = window.setTimeout(() => { for (const project of [...following.current]) if (!wantedRef.current.includes(project)) unfollow(project); }, 1000);
    return () => window.clearTimeout(timer);
  }, [wanted, unfollow]);
  // The folder shown is read again whenever it changes.
  useEffect(() => {
    if (reading && readFolder?.change?.status === 'ready' && readFolder.read < readFolder.change.revision) void refresh(reading, readFolder.change.revision);
  }, [reading, readFolder?.change?.revision, readFolder?.change?.status, refresh]);
  // A plan no longer in its project falls back to the project's plans in the hub.
  const missing = projectPlace && projectPlace.target.kind !== 'file' && readFolder?.snapshot && readFolder.change && readFolder.read >= readFolder.change.revision
    && !readFolder.snapshot.work.some(work => work.id === (projectPlace.target as { work: string }).work) ? projectPlace : null;
  useEffect(() => {
    if (!missing) return;
    notify(`${workNumber((missing.target as { work: string }).work)} is no longer in ${projects?.find(project => project.folderId === missing.project)?.name ?? 'this project'}.`, 'warning');
    replace(hubPlace(missing.project));
  }, [missing]);

  // ---- The file panel ---------------------------------------------------------------------------
  const [files, setFiles] = useState<PanelDockMode | null>(null);
  const [expanded, setExpanded] = useState<Record<string, string[]>>({});
  const readSnapshot = readFolder?.snapshot ?? null;
  const node = projectPlace && readSnapshot ? nodeForTarget(projectPlace.target, readSnapshot) : null;
  // Reveal the shown item in the file panel.
  useEffect(() => {
    if (!projectPlace || !node) return;
    const reveal = projectPlace.target.kind === 'file' ? revealIds(projectPlace.target.path) : node.reveal;
    setExpanded(current => {
      const open = current[projectPlace.project] ?? [];
      const missingIds = reveal.filter(id => !open.includes(id));
      return missingIds.length ? { ...current, [projectPlace.project]: [...open, ...missingIds] } : current;
    });
  }, [projectPlace?.project, node?.id]);

  // ---- Commands -----------------------------------------------------------------------------------
  const [quickOpen, setQuickOpen] = useState(false);
  const [importing, setImporting] = useState<{ preview: ImportPreview; project: string } | null>(null);
  const [hubFilters, setHubFilters] = useState<HubFilters>({ query: '', state: 'open' });
  const projectOf = useCallback((folderId: string | null) => projects?.find(project => project.folderId === folderId), [projects]);

  const exportWork = useCallback(async (project: string, work: string) => {
    try {
      const result = await api.exportPlan(project, work);
      if (result) notify(`Exported ${workNumber(work)} to ${result.path}` + (result.warnings.length ? ' — ' + result.warnings.join(' ') : ''), result.warnings.length ? 'warning' : 'info');
    } catch (error) { notify((error as Error).message, (error as AtlasError).code === 'unavailable' ? 'warning' : 'danger'); }
  }, [notify]);
  /** Import a plan into the project the window shows (a plan of it, its statistics, or the hub filtered to it), or the only one. */
  const startImport = useCallback(async () => {
    const active = (projects ?? []).filter(project => project.state === 'active');
    const project = placeProject(place) ?? (active.length === 1 ? active[0].folderId : null);
    if (!project) { notify('Choose the project to import into first: open one of its plans, or choose it in the hub’s project filter.', 'warning'); return; }
    try {
      const preview = await api.chooseImport(project);
      if (preview) setImporting({ preview, project });
    } catch (error) {
      if ((error as AtlasError).code === 'cancelled') return;
      notify((error as Error).message, (error as AtlasError).code === 'unavailable' ? 'warning' : 'danger');
    }
  }, [projects, place, notify]);
  /** The Statistics page: of the project of the plan last open, else the first project. */
  const showStatistics = useCallback(() => {
    const all = projects ?? [];
    const project = projectOf(lastProject.current) ?? all.find(item => item.state === 'active') ?? all[0];
    go(statisticsPlace(project?.folderId ?? null));
  }, [projects, projectOf, go]);
  const filesOffered = Boolean(projectPlace);

  const runCommand = useCallback((command: MenuCommand) => {
    switch (command) {
      case 'toggleFiles': if (filesOffered) setFiles(mode => mode === 'open' || mode === 'maximized' ? null : 'open'); break;
      case 'quickOpen': setQuickOpen(true); break;
      case 'projects': go(projectsPlace()); break;
      case 'statistics': showStatistics(); break;
      case 'importPlan': void startImport(); break;
      case 'goBack': navigate(-1); break;
      case 'goForward': navigate(1); break;
    }
  }, [filesOffered, go, showStatistics, startImport, navigate]);

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

  // ---- Projects -----------------------------------------------------------------------------------
  const updateProject = useCallback(async (project: Project, change: ProjectChangeRequest) => {
    const updated = await api.updateProject(project.folderId, change);
    setProjects(current => current?.map(item => item.folderId === updated.folderId ? updated : item) ?? current);
  }, []);
  const projectActions = useMemo<ProjectActions>(() => ({
    update: updateProject,
    change: (project, change) => { updateProject(project, change).catch(error => notify((error as Error).message, 'danger')); },
    // The project comes back under a new folder ID, which every window showing it follows.
    adopt: project => {
      api.adoptProject(project.folderId).then(moved => {
        notify(`Moved ${moved.name} into the Atlas home: ${moved.path}`);
        return api.projects().then(setProjects);
      }, error => { if ((error as AtlasError).code !== 'cancelled') notify((error as Error).message, 'danger'); });
    },
    created: project => {
      setProjects(current => current && !current.some(item => item.folderId === project.folderId) ? [...current, project] : current);
      notify(`Created ${project.name} in ${project.path}`);
    },
    go,
  }), [updateProject, notify, go]);

  // ---- What shows ---------------------------------------------------------------------------------
  const page = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const entryPositions = useRef(new Map<number, number>());
  const revisit = entryPositions.current.has(currentEntry(history));
  const anchored = Boolean(projectPlace && 'anchor' in projectPlace.target && projectPlace.target.anchor) && !revisit;
  // A step back or forward finds a document where it was left, not at the heading it was opened at.
  const placed: Place = projectPlace && revisit && 'anchor' in projectPlace.target && projectPlace.target.anchor ? { ...projectPlace, target: { ...projectPlace.target, anchor: null } as Target } : place;
  // Forget the positions of what no step back or forward shows.
  useEffect(() => {
    const kept = new Set(history.entries.map(scrollKey));
    for (const key of [...scrollPositions.current.keys()]) if (!kept.has(key)) scrollPositions.current.delete(key);
    const entries = new Set(history.ids);
    for (const id of [...entryPositions.current.keys()]) if (!entries.has(id)) entryPositions.current.delete(id);
  }, [history.entries, history.ids]);

  /** Open a path of a project (read first when the window does not have it yet) as what it is. */
  const openPath = useCallback(async (project: string, path: string, anchor: string | null) => {
    // Followed while it is read; let go again unless it is shown.
    const release = () => { if (!wantedRef.current.includes(project)) unfollow(project); };
    try {
      const known = folders[project]?.snapshot;
      // Opened before it is followed, so the snapshot is asked for once the folder is open.
      if (!known) await api.openProject(project);
      follow([project]);
      const snapshot = known ?? await api.snapshot(project);
      const file = snapshot.documents.find(document => samePath(document.path, path, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths));
      const work = snapshot.work.find(item => samePath(item.path, path.replace(/\/$/, ''), snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths));
      const target = file ? documentTarget(file, snapshot.work.find(item => item.id === file.workId), anchor) : work ? workTarget(work.id, anchor) : null;
      if (!target) { release(); notify('This document is not in ' + (projectOf(project)?.name ?? 'that project') + ': ' + path, 'warning'); return; }
      go({ project, target });
    } catch (error) { release(); notify((error as Error).message, 'warning'); }
  }, [folders, projectOf, go, notify, follow, unfollow]);
  /** What a page of a project works with. */
  const scope = useMemo<WorkbenchApi | null>(() => {
    if (!reading || !readSnapshot) return null;
    const owner = projectOf(reading);
    const show = (target: Target, options: { project?: string } = {}) => go({ project: options.project ?? reading, target });
    return {
      project: reading, projectName: owner?.name ?? readSnapshot.name, snapshot: readSnapshot, revision: readFolder?.change?.revision ?? 0,
      open: show, go, retarget: target => show(target),
      listed: work => owner?.summary ? [...owner.summary.active, ...owner.summary.closed].find(item => item.id === work) : undefined,
      sibling: folder => siblingProject(projects ?? [], reading, folder),
      openPath: (other, path, anchor) => { void openPath(other, path, anchor); },
      notify, remote: info.computer.hostId === null ? null : { hostId: info.computer.hostId, hostName: info.computer.name },
      inspectorWidth: ui.inspectorWidth ?? null, setInspectorWidth, exportPlan: work => { void exportWork(reading, work); },
    };
  }, [reading, readSnapshot, readFolder?.change?.revision, projects, projectOf, go, openPath, notify, info.computer, ui.inspectorWidth, setInspectorWidth, exportWork]);

  const menus: WorkbenchMenus = {
    goHome: () => go(hubPlace()),
    goBack: () => navigate(-1),
    goForward: () => navigate(1),
    canGoBack: canGoBack(history),
    canGoForward: canGoForward(history),
    projects: () => runCommand('projects'),
    statistics: () => runCommand('statistics'),
    importPlan: () => runCommand('importPlan'),
  };
  const filesVisible = filesOffered && (files === 'open' || files === 'maximized');
  const fills = projectPlace?.target.kind === 'diagram' && Boolean(readSnapshot);
  // As tall as the room below the title bar allows.
  const filePanel = files && projectPlace && scope ? [{ id: 'files', title: 'Files', label: 'Files', mode: files, active: true, icon: <FolderOpenIcon />, preferredWidth: 360, height: 100000, tooltip: 'Files of ' + scope.projectName }] : [];

  let content;
  if (isPage(placed) && placed.page === 'hub') content = <Hub projects={projects} error={projectsError} filter={placed.project} filters={hubFilters} setFilters={setHubFilters} go={go} />;
  else if (isPage(placed) && placed.page === 'projects') content = <ProjectsPage projects={projects} error={projectsError} computer={info.computer.name} local={info.computer.hostId === null} actions={projectActions} />;
  else if (isPage(placed) && !placed.project) content = <EmptyState className="page-empty" icon={<StatisticsIcon />} title="No projects yet" description="Statistics are kept for each project." />;
  else content = <ProjectContent place={placed} folder={readFolder} project={projectOf(reading)} scope={scope}
    statisticsControls={<Select className="statistics-project" density="compact" aria-label="Project" value={reading} onValueChange={value => { if (value) go(statisticsPlace(value)); }}
      options={(projects ?? []).filter(project => project.state === 'active' || project.folderId === reading).map(project => ({ value: project.folderId, label: project.name }))} />} />;

  return <WindowFrame className="workbench" scrollRef={setScroller} titleBar={<TitleBar className="workbench-title-bar"
    start={<TitleBarStart info={info} workbench={menus} onError={warn} />}
    end={<>
      <SearchButton platform={info.platform} onClick={() => runCommand('quickOpen')} />
      <Tooltip content={filesOffered ? 'Files (' + modifierKey(info.platform) + '+Shift+E)' : 'Files: open a plan first'} side="bottom">
        <IconButton variant="text" className="files-button" icon={<FolderOpenIcon />} aria-label="Files" aria-pressed={filesVisible} aria-disabled={!filesOffered || undefined}
          aria-keyshortcuts={(info.platform === 'darwin' ? 'Meta' : 'Control') + '+Shift+E'} onClick={() => runCommand('toggleFiles')} />
      </Tooltip>
      {scope && <Health issues={scope.snapshot.issues} open={work => go({ project: scope.project, target: workTarget(work) })} />}
      <ThemeMenu />
    </>} />}>
    <div className={'workbench-body' + (fills ? ' is-filled' : '')}>
      <div ref={page} className="workbench-page">{content}</div>
      <ScrollMemory scroller={scroller} scrollKey={scrollKey(placed)} shown={placeId(placed)} anchored={anchored} entry={currentEntry(history)} content={page} positions={scrollPositions} entryPositions={entryPositions} />
      {projectPlace && scope && <PanelDock className="file-dock" panels={filePanel} onModeChange={(_id, mode) => setFiles(mode)} onClose={() => setFiles(null)}>
        {() => <WorkbenchContext.Provider value={scope}>
          <PanelDockHeader title="Files" meta={scope.projectName} />
          <Explorer snapshot={scope.snapshot} expanded={expanded[scope.project] ?? []} setExpanded={next => setExpanded(current => ({ ...current, [scope.project]: next }))} selected={node?.id ?? null} />
        </WorkbenchContext.Provider>}
      </PanelDock>}
    </div>
    {quickOpen && projects && <QuickOpen projects={projects} open={projectPlace && scope ? { project: scope.project, snapshot: scope.snapshot } : null} onPick={go} onClose={() => setQuickOpen(false)} />}
    {importing && <ImportDialog preview={importing.preview} project={projectOf(importing.project)?.name ?? 'this project'}
      onCancel={() => { void api.cancelImport(importing.preview.token).catch(() => undefined); setImporting(null); }}
      onConfirm={async () => {
        const result = await api.confirmImport(importing.preview.token);
        setImporting(null);
        notify(`Imported as ${workNumber(result.workId)} in ${result.path}. ${result.notes.join(' ')}`.trim());
        go({ project: importing.project, target: workTarget(result.workId) });
      }} />}
  </WindowFrame>;
}

/**
 * Keep the scroll position of each place (a page, a plan, a file) while moving between them, where
 * it was last read; a place shown afresh starts at the top, and one opened at a heading leaves the
 * scrolling to the reader. A step back or forward finds its entry where it was left instead. A
 * document loads again after the move, so a saved position is reapplied as the content grows, until
 * the user scrolls or three seconds pass, and nothing is saved meanwhile. The window frame's content
 * scrolls, below the title bar.
 */
function ScrollMemory({ scroller: element, shown, scrollKey: key, anchored, entry, content: contentRef, positions, entryPositions }: {
  scroller: HTMLDivElement | null; shown: string; scrollKey: string; anchored: boolean; entry: number; content: RefObject<HTMLDivElement | null>;
  positions: RefObject<Map<string, number>>; entryPositions: RefObject<Map<number, number>>;
}) {
  useLayoutEffect(() => {
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
    // The reader's own scrolling stops it: the wheel or touch anywhere, and keys or presses in the
    // page or what holds it (the scrollbar, the frame's content area), not keys pressed in the title bar.
    const interrupt = (event: Event) => {
      const at = event.target;
      if (event.type === 'wheel' || event.type === 'touchstart' || !(at instanceof Node) || !content || at.contains(content) || content.contains(at)) stop();
    };
    const inputs = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const;
    for (const name of inputs) window.addEventListener(name, interrupt, { capture: true, passive: true });
    element.addEventListener('scroll', remember, { passive: true });
    return () => {
      stop();
      window.clearTimeout(timer);
      for (const name of inputs) window.removeEventListener(name, interrupt, { capture: true });
      element.removeEventListener('scroll', remember);
      entryPositions.current.set(entry, left);
    };
  }, [shown, key, entry, element]);
  return null;
}

/** What the window shows of a project, in its scope: a plan, a diagram, a file or its statistics; or why it cannot. */
function ProjectContent({ place, folder, project, scope, statisticsControls }: { place: Place; folder: Folder | undefined; project: Project | undefined; scope: WorkbenchApi | null; statisticsControls: ReactNode }) {
  const change = folder?.change;
  if (change?.status === 'missing' || (!folder?.snapshot && (change?.status === 'invalid' || folder?.failure))) {
    return <EmptyState className="page-empty" icon={<ErrorIcon />} title={change?.status === 'missing' ? 'This project’s folder was moved or deleted' : 'This project can’t be read'}
      description={<>{(project?.path ?? folder?.snapshot?.root) && <bdi className="folder-problem-path">{project?.path ?? folder?.snapshot?.root}</bdi>} {change?.error ?? folder?.failure} Atlas reads it again as soon as it can.</>} />;
  }
  if (!scope || !folder?.snapshot) return <div className="page-state" aria-busy="true"><Spinner size="large" label={'Reading ' + (project?.name ?? 'the project')} /></div>;
  const snapshot = folder.snapshot;
  let content;
  if (isPage(place)) content = <Statistics snapshot={snapshot} controls={statisticsControls} />;
  else {
    const { target } = place as ProjectPlace;
    if (target.kind === 'work' || target.kind === 'diagram') {
      const item = snapshot.work.find(entry => entry.id === target.work);
      content = !item ? <div className="page-state" aria-busy="true"><Spinner size="large" label="Reading the plan" /></div>
        : target.kind === 'work' ? <WorkPage work={item} snapshot={snapshot} target={target} />
        : <div className="work-page section-diagrams"><AtlasWorkPanel key={item.id} work={item} target={target} /></div>;
    } else {
      const file = snapshot.documents.find(document => document.path === target.path);
      content = !file ? <Gone title="This file no longer exists" detail={target.path} /> : <FileView file={file} snapshot={snapshot} anchor={target.anchor ?? null} />;
    }
  }
  return <WorkbenchContext.Provider value={scope}>
    {change?.error && <Notice className="folder-error" tone="warning" announce title={scope.remote ? `Atlas can’t read this project on ${scope.remote.hostName} right now.` : 'This project can’t be read right now.'}>
      {change.error} {scope.remote ? 'Showing the last view.' : 'Showing the last good view. Atlas reloads when the folder is readable again.'}
    </Notice>}
    {change?.notice && <Notice className="folder-error" tone="info">{change.notice}</Notice>}
    {content}
  </WorkbenchContext.Provider>;
}

/** The title bar's search: quick open for every plan, and the documents and diagrams of the open plan's project. */
function SearchButton({ platform, onClick }: { platform: string; onClick(): void }) {
  return <Button variant="secondary" className="search-button" startIcon={<SearchIcon />} onClick={onClick} aria-label="Search" aria-keyshortcuts={platform === 'darwin' ? 'Meta+P' : 'Control+P'}>
    <span className="search-button-label">Search</span><span className="search-button-keys"><Kbd keys={[modifierKey(platform), 'P']} /></span>
  </Button>;
}

/** Record health of the shown project: problems in its planning records, each linking to its work item. */
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
