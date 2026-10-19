// The typed contract between the renderer and the main process. Every message the window can send
// is on `invokeChannels`; every message main can push is on `eventChannels`. Only types and
// constants live here, so the preload, main and renderer can all import it.
// A window shows the projects of one computer: this one, or another one this app paired with. The
// planning data is the Atlas host's (packages/atlas/src/host/contract.ts): main forwards the window's
// requests about a project to the host of its computer, naming the project by its folder ID.
import type {
  AccessSettings, AccessState, DiagramEntry, DiagramIndexEntry, DiagramReference, PairedDevice, PairingGrant, PairingLink, Project, ProjectRepository,
  ProjectState, ProjectSummary, ProjectWork, ProjectWorkState, ReferenceInput, ResolvedReference, SearchKind, SearchResult, SessionActivity, Snapshot, ViewEventInput,
  WorkActivity, WorkProduct, WorkSession, WorkspaceScan, WorkTimeline,
} from '@envsemble/atlas/host/contract';
import type { DocumentContent } from '@envsemble/atlas/planning/types';

export type {
  AccessSettings, AccessState, DiagramEntry, DiagramIndexEntry, DiagramReference, DocumentContent, PairedDevice, PairingGrant, Project, ProjectRepository,
  ProjectState, ProjectSummary, ProjectWork, ProjectWorkState, ReferenceInput, ResolvedReference, SearchKind, SearchResult, SessionActivity, Snapshot, ViewEventInput,
  WorkActivity, WorkProduct, WorkSession, WorkspaceScan, WorkTimeline,
};

export const invokeChannels = [
  'window:info',
  'projects:list', 'projects:create', 'search:query', 'projects:scan', 'projects:chooseFolder', 'projects:update', 'projects:adopt', 'project:open', 'project:close',
  'planning:snapshot', 'planning:document', 'planning:diagrams', 'planning:diagram', 'planning:references', 'planning:diagramIndex',
  'usage:view', 'ui:load', 'ui:save',
  'references:resolve', 'work:sessions', 'work:timeline',
  'shell:reveal', 'shell:openExternal', 'shell:openReference', 'shell:copy',
  'app:command', 'app:theme', 'app:setTheme', 'app:editor', 'app:setEditor', 'app:about',
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
 * The editor files open in: VS Code (the default) and editors like it, each through its own link
 * (`vscode://file/…:line`), or the system's application for the file (`system`, without its line).
 * A fixed choice, so a page can never make Atlas run a command of its own.
 */
export const editors = ['vscode', 'vscode-insiders', 'cursor', 'windsurf', 'zed', 'system'] as const;
export type Editor = typeof editors[number];
export const editorNames: Record<Editor, string> = { vscode: 'Visual Studio Code', 'vscode-insiders': 'VS Code Insiders', cursor: 'Cursor', windsurf: 'Windsurf', zed: 'Zed', system: 'The system’s application' };

/**
 * Commands the renderer may ask main to run, from the title bar's menu among others; each one acts
 * on the calling window only (New Window and Exit act on the app).
 */
export const appCommands = [
  'newWindow', 'quit', 'openLogs',
  'zoomIn', 'zoomOut', 'resetZoom', 'toggleFullScreen', 'reload', 'toggleDevTools',
] as const;
export type AppCommand = typeof appCommands[number];

/** Menu items that need the renderer (focus, pages, dialogs drawn in the window). */
export const menuCommands = [
  'toggleFiles', 'quickOpen', 'newProject', 'projects', 'statistics', 'importPlan', 'connectRemote', 'remoteAccess', 'goBack', 'goForward', 'about',
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
  /** Whether the menu offers Reload and the developer tools (unpackaged builds). */
  devTools: boolean;
}
/**
 * A project's folder as a window follows it. `notice`: the folder is readable but cannot be watched,
 * or its computer is not reachable right now. `revision` counts up with every change.
 */
export interface FolderChange { revision: number; status: FolderStatus; error: string | null; notice: string | null }
/** What a window changes of a project: its name, its state, its place in the order or its workspace folders. */
export interface ProjectChangeRequest { name?: string; state?: ProjectState; position?: number; workspaces?: string[] }
/** A change of one project's folder, named by its folder ID. */
export interface ProjectChange extends FolderChange { project: string }
/**
 * The projects of a computer changed: `projects` as its host listed them, else the window lists them
 * again. `moved`: a project moved under a new folder ID.
 */
export interface ProjectsChange { hostId: string | null; projects?: Project[]; moved?: { from: string; to: string } }
/** Remote access changed on a computer this app manages access for. */
export interface AccessChange { hostId: string | null; state: AccessState }

/** A pairing link as the window shows it: with its QR code (an SVG image). */
export interface PairingLinkView extends PairingLink { qrSvg: string | null }

/**
 * What a window shows of a project: a work item's plan, with a
 * ledger step the search found pointed out in its progress (`step`, by its title), or its statistics
 * (`view`), one of its diagrams (by its path in the work folder, null for its first; `element` names an element of
 * it), or a file.
 */
export type Target =
  | { kind: 'work'; work: string; anchor?: string | null; step?: string | null; view?: 'statistics' | null }
  | { kind: 'diagram'; work: string; path: string | null; element?: string | null }
  | { kind: 'file'; path: string; anchor?: string | null };
/** Something of a project (by its folder ID): a plan, a diagram or a file. */
export interface ProjectPlace { project: string; target: Target }
/**
 * The window's own pages: the hub, with the plans of every project or of one (`project`), the
 * Projects page, and a project's statistics (no project only while the computer has none).
 */
export type PagePlace = { page: 'hub'; project: string | null } | { page: 'projects' } | { page: 'statistics'; project: string | null };
/** What a window shows: one place at a time. */
export type Place = ProjectPlace | PagePlace;
/** A window's layout: the place it shows, and the width the reader gave a diagram's details (absent for the default). */
export interface UiState {
  place: Place;
  inspectorWidth?: number;
  /** Loaded while the window's computer did not answer: a place of a project not listed yet waits to be loaded again. */
  pending?: boolean;
}
export const defaultUiState: UiState = { place: { page: 'hub', project: null } };
export const limits = { path: 2048, workspaces: 20, inspectorMin: 240, inspectorMax: 1200 } as const;
/** A folder's full path: from a drive or a share on Windows, from the root elsewhere. */
export const fullPath = /^(?:[a-zA-Z]:[\\/]|\\\\[^\\/]|\/)/;

/** What the menu's About Atlas shows. */
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
  /** A new project on the window's computer, from the bundled templates, covering workspace folders there. */
  createProject(name: string, workspaces: string[]): Promise<Result<Project>>;
  /** Search every active project of the window's computer: plans, steps, documents, headings, diagrams, elements, glossary terms and projects, best first. */
  search(query: string): Promise<Result<SearchResult[]>>;
  /** The Git checkouts in a folder on this computer, as a new project would register them. */
  scanFolder(folder: string): Promise<Result<WorkspaceScan>>;
  /** A folder on this computer, chosen in the system's folder dialog; null when none was chosen. */
  chooseFolder(): Promise<Result<string | null>>;
  /** Rename a project, hide, archive or show it, move it in the order, or set its workspace folders. */
  updateProject(project: string, change: ProjectChangeRequest): Promise<Result<Project>>;
  /** Move a project outside the computer's Atlas home into it; it comes back under its new folder ID. */
  adoptProject(project: string): Promise<Result<Project>>;
  /** Start following a project's folder; its state now, and changes as planning:changed. */
  openProject(project: string): Promise<Result<FolderChange>>;
  /** Stop following a project's folder (the window no longer shows it). */
  closeProject(project: string): Promise<Result<void>>;
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
  /** Resolve what a planning file references: PRs, commits, files in the project's repositories (each in order; null leads nowhere). */
  resolveReferences(project: string, work: string | null, items: ReferenceInput[]): Promise<Result<(ResolvedReference | null)[]>>;
  /** A work item's sessions and the commits and PRs they made. */
  workSessions(project: string, work: string): Promise<Result<{ sessions: WorkSession[]; products: WorkProduct[] }>>;
  /** A work item's time and its sessions' working and waiting stretches. */
  workTimeline(project: string, work: string): Promise<Result<WorkTimeline>>;
  reveal(project: string, path: string): Promise<Result<void>>;
  /** Open a web address in the browser, or an application's link (`t3-thread://`…) in its application, this computer's only. */
  openExternal(url: string): Promise<Result<void>>;
  /** Open the file a path reference names in the editor, at its line; only for a project on this computer. */
  openReference(project: string, work: string | null, reference: ReferenceInput): Promise<Result<void>>;
  /** The editor files open in, and choosing another. */
  editor(): Promise<Result<Editor>>;
  setEditor(editor: Editor): Promise<Result<void>>;
  copy(text: string): Promise<Result<void>>;
  command(command: AppCommand): Promise<Result<void>>;
  /** The app's theme preference. Windows follow it through `prefers-color-scheme`. */
  theme(): Promise<Result<ThemePreference>>;
  setTheme(preference: ThemePreference): Promise<Result<void>>;
  /** The versions and the Atlas home About Atlas shows. */
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
