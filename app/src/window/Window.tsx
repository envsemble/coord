// A window: envUI's Scaffold with one row at the top, the title bar (the logo, back and forward,
// Plans, File, View and Help, the computer, search, record health, the theme and the window
// buttons), above one place at a time: the hub, where it starts and returns when nothing else is
// open and where projects are made and managed, a plan, a diagram or a file of a project, a
// project's statistics or Settings. A plan and its pages have the plan's own files at their left,
// and the parts of the work it belongs to in a rail at their right.
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Alert, Breadcrumbs, Button, Kbd, Panes, Popover, Scaffold, Spinner, TopBar, useToast } from '@envsemble/envui';
import { EmptyState } from '../ui/EmptyState';
import { ThemeMenu } from '../titleBar/ThemeMenu';
import { ErrorIcon, SearchIcon, WarningIcon } from '../ui/icons';
import type { MenuCommand } from '../../shared/contract';
import type { Issue, LoadedUi, OpenProjectChange, Project, ProjectChangeRequest, SettingsSection, Snapshot, SnapshotWork, Target, Work, WindowInfo } from '../types';
import { api, AtlasError } from '../api';
import { documentTarget, hubPlace, isPage, placeId, placeProject, scrollKey, settingsPlace, statisticsPlace, workTarget, type Place, type ProjectPlace } from '../navigation/targets';
import { samePath, siblingProject } from '../reader/links';
import { canGoBack, canGoForward, currentEntry, keyStep, record, samePlace, startHistory, step } from '../navigation/history';
import { workNumber } from '../ui/format';
import { FilesContext, focusPlanFiles, nodeForTarget, placeWork, PlanFiles, type FilesState } from '../files/Explorer';
import { SearchPopup } from '../navigation/SearchPopup';
import type { SearchDestination } from '../navigation/search';
import { PlanPage } from '../plan/PlanPage';
import { PartsRail, partsGroup } from '../plan/PartsRail';
import { FilePage } from '../reader/FilePage';
import { Hub, type HubFilters } from '../hub/Hub';
import { NewProjectDialog, type ProjectActions } from '../projects/ProjectDialogs';
import { Gone, Page } from '../ui/Page';
import { modifierKey, TitleBarStart, type WindowMenus } from '../titleBar/TitleBar';
import { revealIds } from '../files/explorerModel';
import { ReadingContext, WindowContext, type Notify, type OpenOptions, type WindowActions, type WindowReading } from './windowContext';
import { arrived, liveActivity } from '../plan/agentTime';
import { SettingsPage } from '../settings/SettingsPage';

// The diagrams and the statistics pages load when they are first shown, so a window starts lighter.
const DiagramsView = lazy(() => import('../diagrams/DiagramsView').then(module => ({ default: module.DiagramsView })));
const WorkStatisticsPage = lazy(() => import('../statistics/WorkStatisticsPage').then(module => ({ default: module.WorkStatisticsPage })));
const ProjectStatisticsPage = lazy(() => import('../statistics/ProjectStatisticsPage').then(module => ({ default: module.ProjectStatisticsPage })));
const AllStatisticsPage = lazy(() => import('../statistics/ProjectStatisticsPage').then(module => ({ default: module.AllStatisticsPage })));
/** What shows while a page that loads when first shown arrives. */
const loadingPage = <div className="page-state" aria-busy="true"><Spinner size="lg" label="Loading" /></div>;

const toastTones = { info: 'neutral', warning: 'info', danger: 'danger' } as const;

/** Keys handled in the window; the same shortcuts in the application menu are the fallback. */
const shortcuts: Record<string, MenuCommand> = { 'ctrl+p': 'quickOpen', 'ctrl+shift+e': 'focusFiles', 'ctrl+,': 'settings' };
/** Where the back and forward keys stay: fields, and open menus, lists and dialogs. */
const keepsHistoryKeys = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';
/** What the mouse's back and forward buttons only close: open menus, lists and dialogs. */
const keepsHistoryButtons = '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';
/** Whether the hub's search field has focus. */
const inSearchField = () => Boolean(document.activeElement?.closest('.hub-search'));
const popupOpen = () => Boolean(document.activeElement?.closest(keepsHistoryButtons)) || [...document.querySelectorAll(keepsHistoryButtons)].some(element => element.checkVisibility());

/**
 * A project's folder as the window follows it: its state, its snapshot once read, the revision it was
 * read at, and the revision of the files it has (OpenProjectChange.files).
 */
interface Folder { change: OpenProjectChange | null; snapshot: Snapshot | null; read: number; files: number; failure: string }

/** A listing as text, without the host's clock (`now`), which every listing has anew: listings that read the same are one. */
const listingText = (projects: Project[]) => JSON.stringify(projects, (key, value) => key === 'now' ? undefined : value);
/**
 * The snapshot with its work items as read again (their statistics or handoffs changed): each keeps
 * its documents, and one that reads the same stays as it was, as does the snapshot when all do.
 */
function withWork(snapshot: Snapshot, work: SnapshotWork[]): Snapshot {
  const before = new Map(snapshot.work.map(item => [item.id, item]));
  let changed = work.length !== snapshot.work.length;
  const next = work.map((item, index) => {
    const known = before.get(item.id);
    if (!known) { changed = true; return { ...item, documents: [] }; }
    const { documents, ...rest } = known;
    if (snapshot.work[index] === known && JSON.stringify(rest) === JSON.stringify(item)) return known;
    changed = true;
    return { ...item, documents };
  });
  return changed ? { ...snapshot, work: next } : snapshot;
}

export function AtlasWindow({ info, initialUi }: { info: WindowInfo; initialUi: LoadedUi }) {
  const toast = useToast();
  const notify = useCallback<Notify>((message, tone = 'info') => { toast.show({ message, tone: toastTones[tone] }); }, [toast]);
  const warn = useCallback((message: string) => notify(message, 'warning'), [notify]);

  // ---- The computer's projects, and the folders the window follows ------------------------------
  // The window starts from the listing its layout loaded with, when it has one.
  const [projects, setProjects] = useState<Project[] | null>(initialUi.projects ?? null);
  const [projectsError, setProjectsError] = useState('');
  /** List the projects again; the latest listing wins. */
  const listProjects = useRef(() => {});
  useEffect(() => {
    let current = true;
    let asked = 0;
    // A listing that reads as the one shown changes nothing, so nothing that shows it draws again.
    const listed = (next: Project[]) => { setProjects(previous => previous && listingText(previous) === listingText(next) ? previous : next); setProjectsError(''); };
    const load = () => {
      const ask = ++asked;
      api.projects().then(next => { if (current && ask === asked) listed(next); }, error => { if (current && ask === asked) { setProjects(previous => previous ?? []); setProjectsError((error as Error).message); } });
    };
    listProjects.current = load;
    if (!initialUi.projects) load();
    // The host's own listing comes with the change, when it has one; a listing on its way is older.
    const off = api.onProjectsChanged(change => { if (change.projects) { asked++; listed(change.projects); } else load(); });
    return () => { current = false; off(); };
  }, []);
  // Live agent time counts on the host's clock from when each listing arrived here.
  useEffect(() => { for (const project of projects ?? []) if (project.summary) arrived(project.summary); }, [projects]);
  const [folders, setFolders] = useState<Record<string, Folder>>({});
  const following = useRef(new Set<string>());
  const latest = useRef(new Map<string, number>());
  const setFolder = useCallback((projectId: string, change: (folder: Folder) => Folder) => setFolders(current => ({ ...current, [projectId]: change(current[projectId] ?? { change: null, snapshot: null, read: 0, files: 0, failure: '' }) })), []);
  /** Read a project's folder again at a revision: all of it when its files changed (`whole`), else only its work items. */
  const refresh = useCallback(async (projectId: string, revision: number, files: number, whole: boolean) => {
    latest.current.set(projectId, Math.max(latest.current.get(projectId) ?? 0, revision));
    const newest = () => revision >= (latest.current.get(projectId) ?? 0);
    try {
      if (whole) {
        const snapshot = await api.snapshot(projectId);
        if (newest()) setFolder(projectId, folder => ({ ...folder, snapshot, read: revision, files, failure: '' }));
      } else {
        const work = await api.work(projectId);
        if (newest()) setFolder(projectId, folder => folder.snapshot ? { ...folder, snapshot: withWork(folder.snapshot, work), read: revision, failure: '' } : folder);
      }
    } catch (error) { if (newest()) setFolder(projectId, folder => ({ ...folder, failure: (error as Error).message })); }
  }, [setFolder]);
  useEffect(() => api.onChanged(change => {
    if (following.current.has(change.projectId)) setFolder(change.projectId, folder => ({ ...folder, change }));
  }), [setFolder]);
  /** Follow projects' folders: their changes reach the window (and the project list), and the one shown is read. */
  const follow = useCallback((wanted: string[]) => {
    for (const projectId of wanted) {
      if (following.current.has(projectId)) continue;
      following.current.add(projectId);
      api.openProject(projectId).then(change => setFolder(projectId, folder => folder.change && folder.change.revision > change.revision ? folder : { ...folder, change }),
        error => setFolder(projectId, folder => ({ ...folder, failure: (error as Error).message })));
    }
  }, [setFolder]);
  /** Stop following a project's folder: nothing in the window shows it. */
  const unfollow = useCallback((projectId: string) => {
    if (!following.current.delete(projectId)) return;
    latest.current.delete(projectId);
    setFolders(current => { const { [projectId]: _gone, ...rest } = current; return rest; });
    api.closeProject(projectId).catch(() => undefined);
  }, []);

  // ---- What the window shows, and the history of what it showed -----------------------------------
  // The place and the history (back and forward) change together: each change of place is recorded,
  // except a step back or forward.
  const [{ ui, history }, setWindowState] = useState(() => {
    const { projects: _listed, ...ui } = initialUi;
    return { ui, history: startHistory(ui.place) };
  });
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
  const reading = isPage(place) ? (place.page === 'statistics' ? place.projectId : null) : place.projectId;
  const projectPlace = isPage(place) ? null : place;
  const readFolder = reading ? folders[reading] : undefined;
  // The hub filtered to a project follows its folder, so its plans' changes reach it. The hub of
  // every project follows none (each folder followed is a session of its own on the host): it lists
  // the projects again each time it shows and as the window comes forward.
  const watching = isPage(place) && place.page === 'hub' ? place.projectId : null;
  const hubShown = isPage(place) && place.page === 'hub';
  const starting = useRef(true);
  useEffect(() => {
    if (!hubShown) return;
    // (The window lists them as it starts anyway.)
    if (!starting.current) listProjects.current();
    const again = () => listProjects.current();
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [hubShown]);
  useEffect(() => { starting.current = false; }, []);
  const wanted = useMemo(() => [...new Set([reading, watching].filter((projectId): projectId is string => Boolean(projectId)))], [reading, watching]);
  const wantedRef = useRef(wanted);
  wantedRef.current = wanted;
  useEffect(() => { follow(wanted); }, [wanted, follow]);
  // Folders nothing shows any more are let go a moment later.
  useEffect(() => {
    const timer = window.setTimeout(() => { for (const projectId of [...following.current]) if (!wantedRef.current.includes(projectId)) unfollow(projectId); }, 1000);
    return () => window.clearTimeout(timer);
  }, [wanted, unfollow]);
  // The folder shown is read again whenever it changes: all of it when its files did, else its work items.
  useEffect(() => {
    const change = readFolder?.change;
    if (reading && readFolder && change?.status === 'ready' && readFolder.read < change.revision) void refresh(reading, change.revision, change.files, !readFolder.snapshot || readFolder.files < change.files);
  }, [reading, readFolder?.change?.revision, readFolder?.change?.status, refresh]);
  // A plan no longer in its project falls back to the project's plans in the hub.
  const missing = projectPlace && projectPlace.target.kind !== 'file' && readFolder?.snapshot && readFolder.change && readFolder.read >= readFolder.change.revision
    && !readFolder.snapshot.work.some(work => work.id === (projectPlace.target as { work: string }).work) ? projectPlace : null;
  useEffect(() => {
    if (!missing) return;
    notify(`${workNumber((missing.target as { work: string }).work)} is no longer in ${projects?.find(project => project.id === missing.projectId)?.name ?? 'this project'}.`, 'warning');
    replace(hubPlace(missing.projectId));
  }, [missing]);

  // ---- The open plan's files ----------------------------------------------------------------------
  const [expanded, setExpanded] = useState<Record<string, string[]>>({});
  const readSnapshot = readFolder?.snapshot ?? null;
  const node = projectPlace && readSnapshot ? nodeForTarget(projectPlace.target, readSnapshot) : null;
  // The plan whose files the Files card lists: the one shown, or the one whose file or diagram is,
  // with its folders open as they were left, by project.
  const filesWork = projectPlace && readSnapshot ? placeWork(projectPlace.target, readSnapshot) : null;
  // Reveal the shown item among the plan's files.
  useEffect(() => {
    if (!projectPlace || !node) return;
    const reveal = projectPlace.target.kind === 'file' ? revealIds(projectPlace.target.path) : node.reveal;
    setExpanded(current => {
      const open = current[projectPlace.projectId] ?? [];
      const missingIds = reveal.filter(id => !open.includes(id));
      return missingIds.length ? { ...current, [projectPlace.projectId]: [...open, ...missingIds] } : current;
    });
  }, [projectPlace?.projectId, node?.id]);

  // ---- Commands -----------------------------------------------------------------------------------
  // The search popup and its query, which the hub's search field shows and types into too.
  const [search, setSearch] = useState<string | null>(null);
  // Focus the hub's field gets back, as the search closes or the window comes forward again, does not
  // open the search; focus moved into it by the user does. Leaving the field ends that.
  const searchQuiet = useRef(false);
  // Whether the search opened from the hub's field, where focus returns as it closes.
  const searchOpen = useRef<{ fromField: boolean } | null>(null);
  /** Open the search, with a query typed (none keeps what it has); `focused`: the hub's field took focus. */
  const openSearch = useCallback((query?: string, focused = false) => {
    if (focused && searchQuiet.current) return;
    searchOpen.current ??= { fromField: inSearchField() };
    setSearch(current => query ?? current ?? '');
  }, []);
  const closeSearch = useCallback(() => { searchQuiet.current = searchOpen.current?.fromField ?? false; searchOpen.current = null; setSearch(null); }, []);
  /** The hub's field lost focus: to the user moving on, not to the window going to the background. */
  const windowAway = useRef(false);
  const searchFieldLeft = useCallback(() => { if (document.hasFocus() && !windowAway.current) searchQuiet.current = false; }, []);
  // Away from the hub, its field is gone: shown again, focus moved into it opens the search.
  useEffect(() => { if (!hubShown) searchQuiet.current = false; }, [hubShown]);
  useEffect(() => {
    const away = () => { windowAway.current = true; if (inSearchField()) searchQuiet.current = true; };
    const back = () => { windowAway.current = false; };
    window.addEventListener('blur', away);
    window.addEventListener('focus', back);
    return () => { window.removeEventListener('blur', away); window.removeEventListener('focus', back); };
  }, []);
  const [creatingProject, setCreatingProject] = useState(false);
  const [hubFilters, setHubFilters] = useState<HubFilters>({ state: 'open' });
  const projectOf = useCallback((projectId: string | null) => projects?.find(project => project.id === projectId), [projects]);

  /** Statistics, from the menu: all plans'. */
  const showStatistics = useCallback(() => go(statisticsPlace(null)), [go]);
  /** Settings, at a section; without one, at the section shown, or Agents. */
  const showSettings = useCallback((section?: SettingsSection) => setWindowState(current => {
    const shown = current.ui.place;
    const next = section ? settingsPlace(section) : isPage(shown) && shown.page === 'settings' ? shown : settingsPlace();
    return { ui: { ...current.ui, place: next }, history: record(current.history, next) };
  }), []);
  const filesState = useMemo<FilesState>(() => ({
    expanded: projectPlace ? expanded[projectPlace.projectId] ?? [] : [], selected: node?.id ?? null,
    setExpanded: next => { if (projectPlace) setExpanded(current => ({ ...current, [projectPlace.projectId]: next })); },
  }), [expanded, projectPlace?.projectId, node?.id]);

  const runCommand = useCallback((command: MenuCommand) => {
    switch (command) {
      // The plan's files take the keyboard.
      case 'focusFiles': focusPlanFiles(); break;
      case 'quickOpen': openSearch(); break;
      case 'newProject': setCreatingProject(true); break;
      case 'plans': go(hubPlace()); break;
      case 'statistics': showStatistics(); break;
      case 'settings': showSettings(); break;
      case 'goBack': navigate(-1); break;
      case 'goForward': navigate(1); break;
    }
  }, [go, showStatistics, showSettings, navigate, openSearch]);

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
    // A back or forward key that a popup keeps to itself (the search's field) is still noted, so its
    // echo from the application menu is ignored too.
    const note = (event: KeyboardEvent) => { const by = keyStep(event, info.platform); if (by) lastShortcut.current = { command: by < 0 ? 'goBack' : 'goForward', time: Date.now() }; };
    window.addEventListener('keydown', note, true);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', note, true); window.removeEventListener('keydown', key); };
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
    const updated = await api.updateProject(project.id, change);
    setProjects(current => current?.map(item => item.id === updated.id ? updated : item) ?? current);
  }, []);
  const projectActions = useMemo<ProjectActions>(() => ({
    update: updateProject,
    change: (project, change) => updateProject(project, change).catch(error => notify((error as Error).message, 'danger')),
    created: project => {
      setProjects(current => current && !current.some(item => item.id === project.id) ? [...current, project] : current);
      notify(`Created ${project.name} in ${project.path}`);
    },
    go,
    notify: message => notify(message, 'warning'),
  }), [updateProject, notify, go]);

  // ---- What shows ---------------------------------------------------------------------------------
  const page = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const entryPositions = useRef(new Map<number, number>());
  const revisit = entryPositions.current.has(currentEntry(history));
  const anchored = Boolean(projectPlace && 'anchor' in projectPlace.target && projectPlace.target.anchor) && !revisit;
  // A step back or forward finds a document where it was left, not at the heading it was opened at
  // (nor at the ledger step the search found).
  const found = projectPlace && 'anchor' in projectPlace.target && (projectPlace.target.anchor || (projectPlace.target.kind === 'work' && projectPlace.target.step));
  const placed: Place = projectPlace && revisit && found ? { ...projectPlace, target: { ...projectPlace.target, anchor: null, ...projectPlace.target.kind === 'work' && { step: null } } as Target } : place;
  // Forget the positions of what no step back or forward shows.
  useEffect(() => {
    const kept = new Set(history.entries.map(scrollKey));
    for (const key of [...scrollPositions.current.keys()]) if (!kept.has(key)) scrollPositions.current.delete(key);
    const entries = new Set(history.ids);
    for (const id of [...entryPositions.current.keys()]) if (!entries.has(id)) entryPositions.current.delete(id);
  }, [history.entries, history.ids]);

  /** Open a path of a project (read first when the window does not have it yet) as what it is. */
  const openPath = useCallback(async (projectId: string, path: string, anchor: string | null) => {
    // Followed while it is read; let go again unless it is shown.
    const release = () => { if (!wantedRef.current.includes(projectId)) unfollow(projectId); };
    try {
      const known = folders[projectId]?.snapshot;
      // Opened before it is followed, so the snapshot is asked for once the folder is open.
      if (!known) await api.openProject(projectId);
      follow([projectId]);
      const snapshot = known ?? await api.snapshot(projectId);
      const file = snapshot.documents.find(document => samePath(document.path, path, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths));
      const work = snapshot.work.find(item => samePath(item.path, path.replace(/\/$/, ''), snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths));
      const target = file ? documentTarget(file, snapshot.work.find(item => item.id === file.workId), anchor) : work ? workTarget(work.id, anchor) : null;
      if (!target) { release(); notify('This document is not in ' + (projectOf(projectId)?.name ?? 'that project') + ': ' + path, 'warning'); return; }
      go({ projectId, target });
    } catch (error) { release(); notify((error as Error).message, 'warning'); }
  }, [folders, projectOf, go, notify, follow, unfollow]);
  // What a page of a project works with: the project and the window's ways to show more, which stay
  // the same while the project is read and listed again (they use the latest folders and projects as
  // they run), and what changes with each reading and listing.
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const owner = projectOf(reading);
  const projectName = owner?.name ?? readSnapshot?.name ?? '';
  const scope = useMemo<WindowActions | null>(() => {
    if (!reading) return null;
    const show = (target: Target, options: OpenOptions = {}) => go({ projectId: options.projectId ?? reading, target });
    return {
      projectId: reading, projectName, open: show, go, retarget: target => show(target),
      sibling: folder => siblingProject(projectsRef.current ?? [], reading, folder),
      openPath: (other, path, anchor) => { void openPathRef.current(other, path, anchor); },
      notify, remote: info.computer.hostId === null ? null : { hostId: info.computer.hostId, hostName: info.computer.name },
      inspectorWidth: ui.inspectorWidth ?? null, setInspectorWidth,
    };
  }, [reading, projectName, go, notify, info.computer, ui.inspectorWidth, setInspectorWidth]);
  const summary = owner?.summary;
  const read = useMemo<WindowReading | null>(() => readSnapshot && {
    snapshot: readSnapshot, revision: readFolder?.change?.revision ?? 0, files: readFolder?.files ?? 0,
    listed: work => summary ? [...summary.active, ...summary.closed].find(item => item.id === work) : undefined,
    activity: work => liveActivity(summary, work),
  }, [readSnapshot, readFolder?.change?.revision, readFolder?.files, summary]);

  const back = canGoBack(history), forward = canGoForward(history);
  const shownProject = isPage(place) ? (place.page === 'hub' ? place.projectId : null) : place.projectId;
  const menus = useMemo<WindowMenus>(() => ({
    goBack: () => navigate(-1),
    goForward: () => navigate(1),
    canGoBack: back,
    canGoForward: forward,
    projects,
    shownProject,
    plans: projectId => go(hubPlace(projectId)),
    statistics: showStatistics,
    newProject: () => runCommand('newProject'),
    settings: showSettings,
  }), [navigate, back, forward, projects, shownProject, go, showStatistics, runCommand, showSettings]);
  // All plans' statistics are read again when the listing's statistics or projects change, not with every listing.
  const statisticsMark = useMemo(() => JSON.stringify(projects?.map(project => [project.id, project.state, project.summary && [...project.summary.active, ...project.summary.closed].map(work => work.statistics)])), [projects]);
  /** Open what the search found: a place, or a file of a project at a heading or a diagram's element. */
  const choose = useCallback((destination: SearchDestination) => {
    if ('place' in destination) go(destination.place);
    else void openPath(destination.projectId, destination.path, destination.anchor);
  }, [go, openPath]);
  const fills = projectPlace?.target.kind === 'diagram' && Boolean(readSnapshot);
  /** The project the search lists the documents and diagrams of: the one a plan, diagram or file of shows. */
  const searchScope = useMemo(() => projectPlace && reading && readSnapshot ? { projectId: reading, snapshot: readSnapshot } : null, [Boolean(projectPlace), reading, readSnapshot]);

  let content;
  if (isPage(placed) && placed.page === 'hub') content = <Hub projects={projects} error={projectsError} filter={placed.projectId} filters={hubFilters} setFilters={setHubFilters} go={go} query={search ?? ''} search={openSearch} left={searchFieldLeft} platform={info.platform}
    computer={info.computer.name} local={info.computer.hostId === null} actions={projectActions} newProject={() => setCreatingProject(true)} />;
  else if (isPage(placed) && placed.page === 'settings') content = <SettingsPage section={placed.section} computer={info.computer} go={showSettings} />;
  // All plans' statistics: every active project together.
  else if (isPage(placed) && !placed.projectId) content = <Suspense fallback={loadingPage}><AllStatisticsPage revision={statisticsMark} trail={<Breadcrumbs className="breadcrumb" items={[{ label: 'Plans', onClick: () => go(hubPlace()) }, { label: 'Statistics' }]} />} /></Suspense>;
  else content = <ProjectContent place={placed} folder={readFolder} project={owner} scope={scope} read={read}
    statisticsTrail={<Breadcrumbs className="breadcrumb" items={[{ label: 'Plans', onClick: () => go(hubPlace()) }, { label: projectOf(reading)?.name ?? 'Project', onClick: projectOf(reading)?.state === 'archived' ? undefined : () => go(hubPlace(reading)) }, { label: 'Statistics' }]} />} />;

  // The plan's files, in the Scaffold's navigation region at the left from a medium width up, while a
  // plan, its pages or one of its files show.
  const files = filesWork && scope && read ? <WindowContext.Provider value={scope}><ReadingContext.Provider value={read}>
    <FilesContext.Provider value={filesState}><PlanFiles work={filesWork} /></FilesContext.Provider>
  </ReadingContext.Provider></WindowContext.Provider> : null;
  return <Scaffold className="atlas-window" scroll="body" topBarSpan="full" bodyRef={setScroller}
    navigation={files ? { drawer: files } : undefined} navigationForms={files ? { compact: 'none', medium: 'drawer', expanded: 'drawer', large: 'drawer' } : { compact: 'none', medium: 'none', expanded: 'none', large: 'none' }}
    topBar={<TopBar titleBar className="window-title-bar"
      start={<TitleBarStart info={info} menus={menus} onError={warn} />}
      actions={<>
        {/* On the hub, its own search field is the search. */}
        {!hubShown && <SearchButton platform={info.platform} onClick={() => runCommand('quickOpen')} />}
        {scope && read && <Health issues={read.snapshot.issues} open={work => go({ projectId: scope.projectId, target: workTarget(work) })} />}
        <ThemeMenu />
      </>} />}>
    <div className={'window-body' + (fills ? ' is-filled' : '')}>
      <div ref={page} className="window-page">{content}</div>
      <ScrollMemory scroller={scroller} scrollKey={scrollKey(placed)} shown={placeId(placed)} anchored={anchored} entry={currentEntry(history)} content={page} positions={scrollPositions} entryPositions={entryPositions} />
    </div>
    {search !== null && projects && <SearchPopup projects={projects} open={searchScope} query={search} setQuery={setSearch} onChoose={choose} onClose={closeSearch} />}
    {creatingProject && <NewProjectDialog computer={info.computer.name} local={info.computer.hostId === null} onClose={() => setCreatingProject(false)} onCreated={projectActions.created} />}
  </Scaffold>;
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
  scroller: HTMLElement | null; shown: string; scrollKey: string; anchored: boolean; entry: number; content: RefObject<HTMLDivElement | null>;
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
function ProjectContent({ place, folder, project, scope, read, statisticsTrail }: {
  place: Place; folder: Folder | undefined; project: Project | undefined; scope: WindowActions | null; read: WindowReading | null; statisticsTrail: ReactNode;
}) {
  const change = folder?.change;
  // A project's statistics keep their breadcrumb and heading above why they show nothing yet.
  const frame = (state: ReactNode) => isPage(place) ? <Page className="statistics-page" title="Statistics" breadcrumbs={statisticsTrail}>{state}</Page> : state;
  if (change?.status === 'missing' || (!folder?.snapshot && (change?.status === 'invalid' || folder?.failure))) {
    return frame(<EmptyState className="page-empty" icon={<ErrorIcon />} title={change?.status === 'missing' ? 'This project’s folder was moved or deleted' : 'This project can’t be read'}
      description={<>{(project?.path ?? folder?.snapshot?.root) && <bdi className="folder-problem-path">{project?.path ?? folder?.snapshot?.root}</bdi>} {change?.error ?? folder?.failure} Atlas reads it again as soon as it can.</>} />);
  }
  if (!scope || !read || !folder?.snapshot) return frame(<div className="page-state" aria-busy="true"><Spinner size="lg" label={'Reading ' + (project?.name ?? 'the project')} /></div>);
  const snapshot = folder.snapshot;
  let content;
  if (isPage(place)) content = <Suspense fallback={loadingPage}><ProjectStatisticsPage trail={statisticsTrail} /></Suspense>;
  else {
    const { target } = place as ProjectPlace;
    if (target.kind === 'work' || target.kind === 'diagram') {
      const item = snapshot.work.find(entry => entry.id === target.work);
      content = !item ? <div className="page-state" aria-busy="true"><Spinner size="lg" label="Reading the plan" /></div>
        : target.kind === 'diagram' ? <div className="work-page is-diagrams"><Suspense fallback={loadingPage}><DiagramsView key={item.id} work={item} target={target} /></Suspense></div>
        : <PlanFrame work={item} snapshot={snapshot}>{target.view === 'statistics' ? <Suspense fallback={loadingPage}><WorkStatisticsPage work={item} /></Suspense> : <PlanPage work={item} snapshot={snapshot} target={target} />}</PlanFrame>;
    } else {
      const file = snapshot.documents.find(document => document.path === target.path);
      const page = !file ? <Gone title="This file no longer exists" detail={target.path} /> : <FilePage file={file} snapshot={snapshot} anchor={target.anchor ?? null} />;
      content = <PlanFrame work={placeWork(target, snapshot)} snapshot={snapshot}>{page}</PlanFrame>;
    }
  }
  return <WindowContext.Provider value={scope}><ReadingContext.Provider value={read}>
    {change?.error && <Alert className="folder-error" tone="warning" announce title={scope.remote ? `Atlas can’t read this project on ${scope.remote.hostName} right now.` : 'This project can’t be read right now.'}>
      {change.error} {scope.remote ? 'Showing the last view.' : 'Showing the last good view. Atlas reloads when the folder is readable again.'}
    </Alert>}
    {change?.notice && <Alert className="folder-error" tone="info">{change.notice}</Alert>}
    {content}
  </ReadingContext.Provider></WindowContext.Provider>;
}

/**
 * A page of a plan (the plan, its statistics, a file): with the parts rail beside it, in envUI's
 * supporting pane, when the work item is made of parts or is one of them. In a narrow window the rail
 * is a sheet that Parts opens. A diagram fills the window instead.
 */
function PlanFrame({ work, snapshot, children }: { work: Work | null; snapshot: Snapshot; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const group = partsGroup(work, snapshot);
  if (!group || !work) return children;
  return <Panes.Root behavior="supporting" open={open} onOpenChange={setOpen} defaultWidth={18} className="plan-frame">
    <Panes.Main label={work.title} className="plan-frame-page">
      <Panes.Trigger variant="secondary" size="sm" className="parts-trigger">Parts</Panes.Trigger>
      {children}
    </Panes.Main>
    <Panes.Supporting label={'Parts of ' + workNumber(group.id)} className="plan-frame-parts"><PartsRail group={group} shown={work.id} /></Panes.Supporting>
  </Panes.Root>;
}

/** The title bar's search: plans, documents, diagrams and projects (away from the hub, whose search field opens the same). */
function SearchButton({ platform, onClick }: { platform: string; onClick(): void }) {
  // envUI's search trigger, on the title bar's own colour: the icon, its label and the shortcut's keys at its end.
  return <Button variant="ghost" className="search-button" startIcon={<SearchIcon />} end={<span className="search-button-keys"><Kbd keys={[modifierKey(platform), 'P']} /></span>}
    onClick={onClick} aria-label="Search" aria-keyshortcuts={platform === 'darwin' ? 'Meta+P' : 'Control+P'}>
    <span className="search-button-label">Search</span>
  </Button>;
}

/** Record health of the shown project: problems in its planning records, each linking to its work item. */
function Health({ issues, open }: { issues: Issue[]; open(work: string): void }) {
  if (!issues.length) return null;
  const errors = issues.some(issue => issue.level === 'error');
  const label = issues.length + ' record health ' + (issues.length === 1 ? 'note' : 'notes');
  return <Popover aria-label="Record health" title="Record health" width="lg"
    trigger={<Button variant="ghost" className={'health-button' + (errors ? ' has-errors' : '')} startIcon={<WarningIcon />} aria-label={label}>{issues.length}</Button>}>
    {close => <ul className="health-list">{issues.map((issue, index) => <li key={index} data-level={issue.level}>
      <WarningIcon className="health-icon" />
      <span>{issue.workId && <><Button variant="text" underline className="health-link" onClick={() => { close(); open(issue.workId!); }}>{workNumber(issue.workId)}</Button>{' '}</>}{issue.message}</span>
    </li>)}</ul>}
  </Popover>;
}
