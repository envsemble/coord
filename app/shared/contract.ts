// The typed contract between the renderer and the main process. Every message the window can send
// is on `invokeChannels`; every message main can push is on `eventChannels`. Only types and
// constants live here, so the preload, main and renderer can all import it.
// A window shows the projects of one computer: this one, or another one this app paired with. The
// planning data is the Atlas host's (packages/host/src/contract.ts): main forwards the window's
// requests about a project to the host of its computer, naming the project by its folder ID.
import type {
  AccessSettings, AccessState, DiagramEntry, DiagramIndexEntry, DiagramReference, PairedDevice, PairingGrant, PairingLink, Project, ProjectRepository,
  ProjectState, Snapshot, ViewEventInput,
} from '@envsemble/atlas-host/contract';
import type { DocumentContent } from '@envsemble/atlas-planning/types';

export type {
  AccessSettings, AccessState, DiagramEntry, DiagramIndexEntry, DiagramReference, DocumentContent, PairedDevice, PairingGrant, Project, ProjectRepository,
  ProjectState, Snapshot, ViewEventInput,
};

export const invokeChannels = [
  'window:info',
  'projects:list', 'projects:create', 'projects:update', 'projects:adopt', 'project:open',
  'planning:snapshot', 'planning:document', 'planning:diagrams', 'planning:diagram', 'planning:references', 'planning:diagramIndex',
  'usage:view', 'ui:load', 'ui:save',
  'shell:reveal', 'shell:openExternal', 'shell:copy', 'app:command', 'app:theme', 'app:setTheme', 'app:about',
  'plan:export', 'plan:importChoose', 'plan:importConfirm', 'plan:importCancel',
  'computers:list', 'computers:switch',
  'remote:pair', 'remote:forget',
  'access:state', 'access:update', 'access:pairingCreate', 'access:pairingRevoke', 'access:devices', 'access:deviceRevoke',
] as const;
export type InvokeChannel = typeof invokeChannels[number];

export const eventChannels = ['planning:changed', 'projects:changed', 'menu:command', 'access:changed'] as const;
export type EventChannel = typeof eventChannels[number];

/** Light, dark, or the operating system's choice: kept by main for every window and applied as Electron's native theme. */
export const themePreferences = ['system', 'light', 'dark'] as const;
export type ThemePreference = typeof themePreferences[number];

/**
 * Commands the renderer may ask main to run, from the title bar's menus among others; each one acts
 * on the calling window only (New Window and Exit act on the app).
 */
export const appCommands = [
  'newWindow', 'closeWindow', 'quit', 'openLogs',
  'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll',
  'zoomIn', 'zoomOut', 'resetZoom', 'toggleFullScreen', 'reload', 'toggleDevTools',
] as const;
export type AppCommand = typeof appCommands[number];

/** Menu items that need the renderer (focus, tabs, dialogs drawn in the window). */
export const menuCommands = [
  'toggleSidebar', 'toggleFiles', 'quickOpen', 'closeTab', 'closeAllTabs', 'newProject', 'importPlan', 'exportPlan', 'connectRemote', 'remoteAccess',
  'goBack', 'goForward', 'about',
] as const;
export type MenuCommand = typeof menuCommands[number];

export type ErrorCode = 'invalid-argument' | 'not-found' | 'forbidden' | 'unauthorized' | 'unavailable' | 'folder-missing' | 'folder-invalid' | 'cancelled' | 'internal';
export interface AtlasErrorValue { code: ErrorCode; message: string }
/** Errors cross the process boundary as values, never as thrown Error objects. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AtlasErrorValue };

/** A computer whose projects a window can show: this one (hostId null) or one this app paired with. */
export interface ComputerRef { hostId: string | null; name: string }
export type ComputerStatus = 'online' | 'connecting' | 'offline' | 'revoked' | 'mismatch' | 'incompatible';
/** A computer as the computer menu lists it. */
export interface Computer extends ComputerRef {
  status: ComputerStatus;
  /** Why it is not online, when it is not. */
  detail: string | null;
  /** Whether this app may pair and revoke devices there (always on this computer). */
  manageAccess: boolean;
  /** Where it was reached, for a paired computer (shown to tell computers apart). */
  origin: string | null;
}

export type FolderStatus = 'loading' | 'ready' | 'missing' | 'invalid';
export interface WindowInfo {
  /** The computer whose projects the window shows. */
  computer: ComputerRef;
  version: string;
  platform: string;
  /** Whether View offers Reload and the developer tools (unpackaged builds). */
  devTools: boolean;
}
/**
 * A project's folder as a window follows it. `notice`: the folder is readable but cannot be watched,
 * or its computer is not reachable right now. `revision` counts up with every change.
 */
export interface FolderChange { revision: number; status: FolderStatus; error: string | null; notice: string | null }
/** A change of one project's folder, named by its folder ID. */
export interface ProjectChange extends FolderChange { project: string }
/** The projects of a computer changed; the window lists them again. */
export interface ProjectsChange { hostId: string | null }
/** Remote access changed on a computer this app manages access for. */
export interface AccessChange { hostId: string | null; state: AccessState }

/** A pairing link as the window shows it: with its QR code (an SVG image). */
export interface PairingLinkView extends PairingLink { qrSvg: string | null }

/**
 * What a tab shows of its project: its page (the work list, statistics and activity), a work item's
 * plan, one of its diagrams (by its path in the work folder, null for its first; `element` names an
 * element of it), or a file.
 */
export type Target =
  | { kind: 'project' }
  | { kind: 'work'; work: string; anchor?: string | null }
  | { kind: 'diagram'; work: string; path: string | null; element?: string | null }
  | { kind: 'file'; path: string; anchor?: string | null };
/** A tab: what it shows, of which project (by its folder ID). */
export interface TabState { id: string; project: string; target: Target; preview: boolean }
/** A window's layout: its sidebar and its tabs, and the width the reader gave a diagram's details (absent for the default). */
export interface UiState {
  sidebar: { visible: boolean; width: number };
  tabs: { items: TabState[]; active: string | null };
  inspectorWidth?: number;
}
export const defaultUiState: UiState = { sidebar: { visible: true, width: 280 }, tabs: { items: [], active: null } };
export const limits = { path: 2048, tabs: 40, sidebarMin: 170, sidebarMax: 640, inspectorMin: 240, inspectorMax: 1200 } as const;

/** What Help › About Atlas shows. */
export interface AboutInfo {
  version: string;
  electron: string;
  chromium: string;
  node: string;
  /** The operating system, its version and the processor architecture, such as Windows 10.0.26200 (x64). */
  system: string;
  /** The Atlas home. */
  dataFolder: string;
}

export interface ExportResult { path: string; bytes: number; warnings: string[] }
export interface ImportPreview {
  token: string;
  file: string;
  title: string;
  originalId: string | null;
  origin: string | null;
  location: string | null;
  exportedAt: string | null;
  atlasVersion: string | null;
  newId: string | null;
  newFolder: string | null;
  files: number;
  bytes: number;
  diagrams: string[];
  warnings: string[];
}
export interface ImportResult { workId: string; path: string; files: number; notes: string[] }

/**
 * The bridge the preload script exposes to the renderer as `window.atlas`. Every method maps to
 * one channel and resolves to a Result; errors arrive as structured values, never as exceptions.
 * A `project` is a project's folder ID on the window's computer; a `hostId` of null means this computer.
 */
export interface AtlasBridge {
  info(): Promise<Result<WindowInfo>>;
  /** The projects of the window's computer, in their order. */
  projects(): Promise<Result<Project[]>>;
  /** A new project on the window's computer, from the bundled templates. */
  createProject(name: string, repositories: ProjectRepository[]): Promise<Result<Project>>;
  /** Rename a project, hide, archive or show it, or move it in the order. */
  updateProject(project: string, change: { name?: string; state?: ProjectState; position?: number }): Promise<Result<Project>>;
  /** Move a project outside the computer's Atlas home into it; it comes back under its new folder ID. */
  adoptProject(project: string): Promise<Result<Project>>;
  /** Start following a project's folder; its state now, and changes as planning:changed. */
  openProject(project: string): Promise<Result<FolderChange>>;
  snapshot(project: string): Promise<Result<Snapshot>>;
  document(project: string, path: string): Promise<Result<DocumentContent>>;
  /** A work item's diagram files. */
  diagrams(project: string, work: string): Promise<Result<DiagramEntry[]>>;
  /** A diagram's viewer payload, by its path in the work folder, with its family's. */
  diagram(project: string, work: string, path: string): Promise<Result<unknown>>;
  /** The diagrams a document links to. */
  references(project: string, work: string | null, path: string): Promise<Result<DiagramReference[]>>;
  /** Every diagram of a project, for quick open. */
  diagramIndex(project: string): Promise<Result<DiagramIndexEntry[]>>;
  recordView(project: string, event: ViewEventInput): Promise<Result<void>>;
  loadUi(): Promise<Result<UiState>>;
  saveUi(state: UiState): Promise<Result<void>>;
  reveal(project: string, path: string): Promise<Result<void>>;
  openExternal(url: string): Promise<Result<void>>;
  copy(text: string): Promise<Result<void>>;
  command(command: AppCommand): Promise<Result<void>>;
  /** The app's theme preference. Windows follow it through `prefers-color-scheme`. */
  theme(): Promise<Result<ThemePreference>>;
  setTheme(preference: ThemePreference): Promise<Result<void>>;
  /** The versions and the Atlas home Help › About Atlas shows. */
  about(): Promise<Result<AboutInfo>>;
  exportPlan(project: string, work: string): Promise<Result<ExportResult | null>>;
  chooseImport(project: string): Promise<Result<ImportPreview | null>>;
  confirmImport(token: string): Promise<Result<ImportResult>>;
  cancelImport(token: string): Promise<Result<void>>;
  /** This computer and the computers this app paired with, each checked for whether it answers. */
  computers(): Promise<Result<Computer[]>>;
  /** Show another computer's projects, in this window or a new one. */
  switchComputer(hostId: string | null, newWindow: boolean): Promise<Result<void>>;
  pairRemote(link: string, code: string | null): Promise<Result<Computer>>;
  forgetRemote(hostId: string): Promise<Result<void>>;
  accessState(hostId: string | null): Promise<Result<AccessState>>;
  updateAccess(settings: AccessSettings): Promise<Result<AccessState>>;
  createPairing(hostId: string | null, address: string | null, grant: PairingGrant): Promise<Result<PairingLinkView>>;
  revokePairing(hostId: string | null, code: string): Promise<Result<void>>;
  devices(hostId: string | null): Promise<Result<PairedDevice[]>>;
  revokeDevice(hostId: string | null, deviceId: string): Promise<Result<void>>;
  onChanged(listener: (change: ProjectChange) => void): () => void;
  onProjectsChanged(listener: (change: ProjectsChange) => void): () => void;
  onMenu(listener: (command: MenuCommand) => void): () => void;
  onAccessChanged(listener: (change: AccessChange) => void): () => void;
}
