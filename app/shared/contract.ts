// The typed contract between the renderer and the main process. Every message the window
// can send is on `invokeChannels`; every message main can push is on `eventChannels`.
// Only types and constants live here, so the preload, main and renderer can all import it.
// The planning data itself is the Atlas host's (packages/host/src/contract.ts): main forwards the
// window's requests to the host of the computer its folder is on, this one or another one.
import type {
  AccessSettings, AccessState, BrowseEntry, BrowseResult, ComputerFolder, DiagramEntry, DiagramIndexEntry, DiagramReference, PairedDevice,
  PairingGrant, PairingLink, Snapshot, ViewEventInput,
} from '@envsemble/atlas-host/contract';
import type { DocumentContent } from '@envsemble/atlas-planning/types';

export type {
  AccessSettings, AccessState, BrowseEntry, BrowseResult, ComputerFolder, DiagramEntry, DiagramIndexEntry, DiagramReference, DocumentContent, PairedDevice,
  PairingGrant, Snapshot, ViewEventInput,
};

export const invokeChannels = [
  'window:info',
  'planning:snapshot', 'planning:document', 'planning:diagrams', 'planning:diagram', 'planning:references', 'planning:diagramIndex',
  'usage:view', 'ui:load', 'ui:save',
  'shell:reveal', 'shell:openExternal', 'shell:copy', 'app:command', 'app:theme', 'app:setTheme', 'app:about',
  'plan:export', 'plan:importChoose', 'plan:importConfirm', 'plan:importCancel',
  'computers:list', 'computers:switch',
  'folders:list', 'folders:open', 'folders:choose', 'folders:browse', 'folders:remove',
  'remote:pair', 'remote:forget',
  'access:state', 'access:update', 'access:pairingCreate', 'access:pairingRevoke', 'access:devices', 'access:deviceRevoke',
] as const;
export type InvokeChannel = typeof invokeChannels[number];

export const eventChannels = ['planning:changed', 'menu:command', 'access:changed', 'folders:changed'] as const;
export type EventChannel = typeof eventChannels[number];

/** Light, dark, or the operating system's choice: kept by main for every window and applied as Electron's native theme. */
export const themePreferences = ['system', 'light', 'dark'] as const;
export type ThemePreference = typeof themePreferences[number];

/**
 * Commands the renderer may ask main to run, from the title bar's menus among others; each one acts
 * on the calling window only (New Window and Exit act on the app).
 */
export const appCommands = [
  'newWindow', 'locate', 'closeFolder', 'closeWindow', 'quit', 'openLogs',
  'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll',
  'zoomIn', 'zoomOut', 'resetZoom', 'toggleFullScreen', 'reload', 'toggleDevTools',
] as const;
export type AppCommand = typeof appCommands[number];

/** Menu items that need the renderer (focus, tabs, dialogs drawn in the window). */
export const menuCommands = [
  'toggleSidebar', 'showExplorer', 'quickOpen', 'closeTab', 'openWorkList', 'openActivity', 'openStatistics', 'importPlan', 'exportPlan', 'connectRemote', 'remoteAccess', 'browseFolder', 'manageFolders', 'closeFolder',
  'goBack', 'goForward', 'about',
] as const;
export type MenuCommand = typeof menuCommands[number];

export type ErrorCode = 'invalid-argument' | 'not-found' | 'forbidden' | 'unauthorized' | 'unavailable' | 'no-folder' | 'folder-missing' | 'folder-invalid' | 'cancelled' | 'internal';
export interface AtlasErrorValue { code: ErrorCode; message: string }
/** Errors cross the process boundary as values, never as thrown Error objects. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AtlasErrorValue };

/** A computer whose planning folders a window can show: this one (hostId null) or one this app paired with. */
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
  folder: { root: string; name: string } | null;
  status: FolderStatus | null;
  /** Set when the folder became unreadable; a ready window then shows its last good view. */
  error: string | null;
  notice: string | null;
  revision: number;
  version: string;
  platform: string;
  /** The computer the window works on: its folder's, or, without a folder, the one its welcome page shows. */
  computer: ComputerRef;
  /** Set when the folder is on another computer. */
  remote: { hostId: string; hostName: string } | null;
  /** Whether View offers Reload and the developer tools (unpackaged builds). */
  devTools: boolean;
}
/** `notice`: the folder is readable but cannot be watched, or its computer is not reachable right now. */
export interface FolderChange { revision: number; status: FolderStatus; error: string | null; notice: string | null }
/** A computer's folder list changed. */
export interface FoldersChange { hostId: string | null; folders: ComputerFolder[] }
/** Remote access changed on a computer this app manages access for. */
export interface AccessChange { hostId: string | null; state: AccessState }

/** A pairing link as the window shows it: with its QR code (an SVG image). */
export interface PairingLinkView extends PairingLink { qrSvg: string | null }

export type WorkSection = 'plan' | 'ledger' | 'diagrams';
export type ViewName = 'work' | 'activity' | 'statistics';
/** `diagram` is a diagram file's path in the work folder; `element`, an element of it by name. */
export type Target =
  | { kind: 'view'; view: ViewName }
  | { kind: 'work'; work: string; section?: WorkSection | null; diagram?: string | null; element?: string | null; anchor?: string | null }
  | { kind: 'file'; path: string; anchor?: string | null };
export interface TabState { id: string; target: Target; preview: boolean }
/**
 * A window's layout for its folder. Tabs hold documents (work items and files); the views (Work,
 * Activity and Statistics) are pages of their own, and `page` shows while no tab is active.
 */
export interface UiState {
  sidebar: { visible: boolean; width: number; expanded: string[] };
  tabs: { items: TabState[]; active: string | null };
  page: ViewName;
  /** The width the reader gave a diagram's details, in pixels; absent for the default. */
  inspectorWidth?: number;
}
export const viewNames = ['work', 'activity', 'statistics'] as const satisfies readonly ViewName[];
export const defaultUiState: UiState = { sidebar: { visible: true, width: 280, expanded: [] }, tabs: { items: [], active: null }, page: 'work' };
export const limits = { path: 2048, tabs: 40, expanded: 2000, sidebarMin: 170, sidebarMax: 640, inspectorMin: 240, inspectorMax: 1200 } as const;

/** What Help › About Atlas shows. */
export interface AboutInfo {
  version: string;
  electron: string;
  chromium: string;
  node: string;
  /** The operating system, its version and the processor architecture, such as Windows 10.0.26200 (x64). */
  system: string;
  /** The per-user Atlas data folder. */
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
 * A `hostId` of null means this computer.
 */
export interface AtlasBridge {
  info(): Promise<Result<WindowInfo>>;
  snapshot(): Promise<Result<Snapshot>>;
  document(path: string): Promise<Result<DocumentContent>>;
  /** A work item's diagram files. */
  diagrams(work: string): Promise<Result<DiagramEntry[]>>;
  /** A diagram's viewer payload, by its path in the work folder, with its family's. */
  diagram(work: string, path: string): Promise<Result<unknown>>;
  /** The diagrams a document links to. */
  references(work: string | null, path: string): Promise<Result<DiagramReference[]>>;
  /** Every diagram of the folder, for quick open. */
  diagramIndex(): Promise<Result<DiagramIndexEntry[]>>;
  recordView(event: ViewEventInput): Promise<Result<void>>;
  loadUi(): Promise<Result<UiState>>;
  saveUi(state: UiState): Promise<Result<void>>;
  reveal(path: string): Promise<Result<void>>;
  openExternal(url: string): Promise<Result<void>>;
  copy(text: string): Promise<Result<void>>;
  command(command: AppCommand): Promise<Result<void>>;
  /** The app's theme preference. Windows follow it through `prefers-color-scheme`. */
  theme(): Promise<Result<ThemePreference>>;
  setTheme(preference: ThemePreference): Promise<Result<void>>;
  /** The versions and the data folder Help › About Atlas shows. */
  about(): Promise<Result<AboutInfo>>;
  exportPlan(work: string): Promise<Result<ExportResult | null>>;
  chooseImport(): Promise<Result<ImportPreview | null>>;
  confirmImport(token: string): Promise<Result<ImportResult>>;
  cancelImport(token: string): Promise<Result<void>>;
  /** This computer and the computers this app paired with, each checked for whether it answers. */
  computers(): Promise<Result<Computer[]>>;
  /** Work on another computer: its only folder, the one last viewed there, or its welcome page. */
  switchComputer(hostId: string | null, newWindow: boolean): Promise<Result<void>>;
  /** A computer's folder list. */
  folders(hostId: string | null): Promise<Result<ComputerFolder[]>>;
  openFolder(hostId: string | null, path: string, newWindow: boolean): Promise<Result<void>>;
  /** Choose a folder on this computer with the system's dialog. */
  chooseFolder(newWindow: boolean): Promise<Result<void>>;
  /** The folders of another computer, for the in-app folder browser. */
  browse(hostId: string, path: string | null): Promise<Result<BrowseResult>>;
  removeFolder(hostId: string | null, folderId: string): Promise<Result<void>>;
  pairRemote(link: string, code: string | null): Promise<Result<Computer>>;
  forgetRemote(hostId: string): Promise<Result<void>>;
  accessState(hostId: string | null): Promise<Result<AccessState>>;
  updateAccess(settings: AccessSettings): Promise<Result<AccessState>>;
  createPairing(hostId: string | null, address: string | null, grant: PairingGrant): Promise<Result<PairingLinkView>>;
  revokePairing(hostId: string | null, code: string): Promise<Result<void>>;
  devices(hostId: string | null): Promise<Result<PairedDevice[]>>;
  revokeDevice(hostId: string | null, deviceId: string): Promise<Result<void>>;
  onChanged(listener: (change: FolderChange) => void): () => void;
  onMenu(listener: (command: MenuCommand) => void): () => void;
  onAccessChanged(listener: (change: AccessChange) => void): () => void;
  onFoldersChanged(listener: (change: FoldersChange) => void): () => void;
}
