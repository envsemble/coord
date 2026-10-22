// The typed contract between the renderer and the main process. Every message the window can send
// is on `invokeChannels`; every message main can push is on `eventChannels`. Only types and
// constants live here, so the preload, main and renderer can all import it.
// A window shows the projects of one computer: this one, or another one this app paired with. The
// planning data is the Atlas host's (packages/atlas/src/host/contract.ts): main forwards the window's
// requests about a project to the host of its computer, naming the project by its ID (`projectId`).
import type {
  AccessSettings, AccessState, DiagramEntry, DiagramIndexEntry, DiagramReference, ErrorCode, HostErrorValue, PairedDevice, PairingGrant, PairingLink, Project,
  ProjectState, ProjectStatistics, ProjectStatus, ProjectSummary, ProjectWork, ProjectWorkState, ReferenceInput, ResolvedReference, SearchKind, SearchResult, SessionActivity, Snapshot,
  SnapshotValue, SnapshotWork, WorkActivity, WorkCommit, WorkSession, WorkTimeline,
} from '@envsemble/atlas/host/contract';
import type { DocumentContent } from '@envsemble/atlas/planning/types';

export type {
  AccessSettings, AccessState, DiagramEntry, DiagramIndexEntry, DiagramReference, DocumentContent, ErrorCode, PairedDevice, PairingGrant, Project,
  ProjectState, ProjectStatistics, ProjectStatus, ProjectSummary, ProjectWork, ProjectWorkState, ReferenceInput, ResolvedReference, SearchKind, SearchResult, SessionActivity, Snapshot,
  SnapshotValue, SnapshotWork, WorkActivity, WorkCommit, WorkSession, WorkTimeline,
};

export const invokeChannels = [
  'window:info',
  'projects:list', 'projects:create', 'search:query', 'projects:chooseFolder', 'projects:update', 'project:open', 'project:close',
  'project:snapshot', 'project:work', 'project:document', 'project:diagrams', 'project:diagram', 'project:references', 'project:diagramIndex',
  'project:statistics', 'projects:statistics', 'ui:load', 'ui:save',
  'references:resolve', 'work:sessions', 'work:timeline',
  'shell:reveal', 'shell:openExternal', 'shell:openReference', 'shell:openShown', 'shell:copy',
  'app:command', 'app:theme', 'app:setTheme', 'app:editor', 'app:setEditor', 'app:about',
  'plan:export', 'plan:importChoose', 'plan:importConfirm', 'plan:importCancel',
  'computers:list', 'computers:switch', 'computers:pair', 'computers:forget',
  'access:state', 'access:update', 'access:pairingCreate', 'access:pairingRevoke', 'access:devices', 'access:deviceRevoke',
  'agents:list', 'agents:connect', 'agents:disconnect', 'onboarding:state', 'onboarding:finish',
] as const;
export type InvokeChannel = typeof invokeChannels[number];

export const eventChannels = ['project:changed', 'projects:changed', 'menu:command', 'access:changed'] as const;
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
export const editorNames: Record<Editor, string> = { vscode: 'VS Code', 'vscode-insiders': 'VS Code Insiders', cursor: 'Cursor', windsurf: 'Windsurf', zed: 'Zed', system: 'The system’s application' };

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
  'toggleFiles', 'quickOpen', 'openInEditor', 'newProject', 'projects', 'statistics', 'settings', 'importPlan', 'goBack', 'goForward', 'about',
] as const;
export type MenuCommand = typeof menuCommands[number];

/** An error as it crosses the process boundary: one of the host's error codes, with a message fit to show. */
export type AtlasErrorValue = HostErrorValue;
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

export interface WindowInfo {
  /** The computer whose projects the window shows. */
  computer: ComputerRef;
  version: string;
  platform: string;
  /** Whether the menu offers Reload and the developer tools (unpackaged builds). */
  devTools: boolean;
}
/**
 * A project as a window follows it. `notice`: its planning folder is readable but cannot be watched,
 * or its computer is not reachable right now. `revision` increases whenever its snapshot changes;
 * `files` is the revision at which its files were last read: a later revision changed only its
 * work's statistics or handoffs, which `work` reads without the documents.
 */
export interface OpenProjectChange { revision: number; files: number; status: ProjectStatus; error: string | null; notice: string | null }
/** What a window changes of a project: its name, its state, its place in the order or its folders. */
export interface ProjectChangeRequest { name?: string; state?: ProjectState; position?: number; folders?: string[] }
/** A change of one project the window follows, named by its ID. */
export interface ProjectChange extends OpenProjectChange { projectId: string }
/** The projects of a computer changed: `projects` as its host listed them, else the window lists them again. */
export interface ProjectsChange { hostId: string | null; projects?: Project[] }
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
/** Something of a project (by its ID): a plan, a diagram or a file. */
export interface ProjectPlace { projectId: string; target: Target }
/** The Settings page's sections: the agents Atlas connects on this computer, and pairing in both directions. */
export const settingsSections = ['agents', 'computers'] as const;
export type SettingsSection = typeof settingsSections[number];
/**
 * The window's own pages: the hub, with the plans of every project or of one (`projectId`), the
 * Projects page, a project's statistics (no project only while the computer has none), and a
 * section of the Settings page.
 */
export type PagePlace = { page: 'hub'; projectId: string | null } | { page: 'projects' } | { page: 'statistics'; projectId: string | null } | { page: 'settings'; section: SettingsSection };
/** What a window shows: one place at a time. */
export type Place = ProjectPlace | PagePlace;
/** A window's layout: the place it shows, and the width the reader gave a diagram's details (absent for the default). */
export interface UiState {
  place: Place;
  inspectorWidth?: number;
  /** Loaded while the window's computer did not answer: a place of a project not listed yet waits to be loaded again. */
  pending?: boolean;
}
export const defaultUiState: UiState = { place: { page: 'hub', projectId: null } };
/** A window's layout as it loads, with its computer's projects as listed for it when the computer answered: the window starts from them. */
export interface LoadedUi extends UiState { projects?: Project[] }
export const limits = { path: 2048, folders: 20, inspectorMin: 240, inspectorMax: 1200 } as const;
/** A folder's full path: from a drive or a share on Windows, from the root elsewhere. */
export const fullPath = /^(?:[a-zA-Z]:[\\/]|\\\\[^\\/]|\/)/;

/** The agents Atlas can connect on this computer: its plugin installed into each through the agent's own commands. */
export const agentIds = ['claude', 'codex'] as const;
export type AgentId = typeof agentIds[number];
export const agentNames: Record<AgentId, string> = { claude: 'Claude Code', codex: 'Codex' };
/**
 * An agent on this computer: whether its command is on the PATH (`found`), whether the Atlas plugin
 * is installed in it (`connected`), and the version of the plugin it has (null when not connected or unknown).
 */
export interface AgentState { id: AgentId; found: boolean; connected: boolean; version: string | null }
/** What connecting or disconnecting an agent did: its state after, and the error when it failed (a message fit to show). */
export interface AgentChange { agent: AgentState; error: string | null }
/** Whether the onboarding has been finished or skipped on this computer; it shows on launch until then. */
export interface OnboardingState { done: boolean }

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

interface ExportResult { path: string; bytes: number; warnings: string[] }
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
interface ImportResult { workId: string; path: string; files: number; notes: string[] }

/**
 * The bridge the preload script exposes to the renderer as `window.atlas`. Every method maps to
 * one channel and resolves to a Result; errors arrive as structured values, never as exceptions.
 * A `projectId` is a project's ID on the window's computer; a `hostId` of null means this computer.
 */
export interface AtlasBridge {
  info(): Promise<Result<WindowInfo>>;
  /** The projects of the window's computer, in their order. */
  projects(): Promise<Result<Project[]>>;
  /** A new project on the window's computer, from the bundled templates, covering folders there. */
  createProject(name: string, folders: string[]): Promise<Result<Project>>;
  /** Search every active project of the window's computer: plans, steps, documents, headings, diagrams, elements, glossary terms and projects, best first. */
  search(query: string): Promise<Result<SearchResult[]>>;
  /** A folder on this computer, chosen in the system's folder dialog; null when none was chosen. */
  chooseFolder(): Promise<Result<string | null>>;
  /** Rename a project, archive it or bring it back, move it in the order, or set its folders. */
  updateProject(projectId: string, change: ProjectChangeRequest): Promise<Result<Project>>;
  /** Start following a project; its state now, and changes as project:changed. */
  openProject(projectId: string): Promise<Result<OpenProjectChange>>;
  /** Stop following a project (the window no longer shows it). */
  closeProject(projectId: string): Promise<Result<void>>;
  /** The project's snapshot as its host sends it: each document once (withWorkDocuments gives the work items theirs). */
  snapshot(projectId: string): Promise<Result<SnapshotValue>>;
  /** The project's work items alone, without their documents: for a change of their statistics or handoffs. */
  work(projectId: string): Promise<Result<SnapshotWork[]>>;
  document(projectId: string, path: string): Promise<Result<DocumentContent>>;
  /** A work item's diagram files. */
  diagrams(projectId: string, work: string): Promise<Result<DiagramEntry[]>>;
  /** A diagram's viewer payload, by its path in the work folder, with its family's. */
  diagram(projectId: string, work: string, path: string): Promise<Result<unknown>>;
  /** The diagrams a document links to. */
  references(projectId: string, work: string | null, path: string): Promise<Result<DiagramReference[]>>;
  /** Every diagram of a project, for quick open. */
  diagramIndex(projectId: string): Promise<Result<DiagramIndexEntry[]>>;
  /** A project's statistics for a period (ISO times; `from` null: since its first report, `to` null: until now), by day or week. */
  projectStatistics(projectId: string, from: string | null, to: string | null, unit: 'day' | 'week'): Promise<Result<ProjectStatistics>>;
  /** The statistics of every active project together (all plans), for a period as projectStatistics has it. */
  allStatistics(from: string | null, to: string | null, unit: 'day' | 'week'): Promise<Result<ProjectStatistics>>;
  loadUi(): Promise<Result<LoadedUi>>;
  saveUi(state: UiState): Promise<Result<void>>;
  /** Resolve what a planning file references: PRs, commits, files in the project's folders (each in order; null leads nowhere). */
  resolveReferences(projectId: string, items: ReferenceInput[]): Promise<Result<(ResolvedReference | null)[]>>;
  /** A work item's sessions and the commits and PRs they made. */
  workSessions(projectId: string, work: string): Promise<Result<{ sessions: WorkSession[]; commits: WorkCommit[] }>>;
  /** A work item's time and its sessions' working and waiting stretches. */
  workTimeline(projectId: string, work: string): Promise<Result<WorkTimeline>>;
  reveal(projectId: string, path: string): Promise<Result<void>>;
  /** Open a web address in the browser, or an application's link (`t3-thread://`…) in its application, this computer's only. */
  openExternal(url: string): Promise<Result<void>>;
  /** Open the file a path reference names in the editor, at its line; only for a project on this computer. */
  openReference(projectId: string, reference: ReferenceInput): Promise<Result<void>>;
  /**
   * Open in: open the file the window shows (`place`, as last saved with saveUi) in the editor without
   * asking (with the system's choice, show it in its folder); only for a project on this computer.
   */
  openShown(place: Place, path: string): Promise<Result<void>>;
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
  exportPlan(projectId: string, work: string): Promise<Result<ExportResult | null>>;
  chooseImport(projectId: string): Promise<Result<ImportPreview | null>>;
  confirmImport(token: string): Promise<Result<ImportResult>>;
  cancelImport(token: string): Promise<Result<void>>;
  /** This computer and the computers this app paired with, each checked for whether it answers. */
  computers(): Promise<Result<Computer[]>>;
  /** Show another computer's projects, in this window or a new one. */
  switchComputer(hostId: string | null, newWindow: boolean): Promise<Result<void>>;
  /** Pair with another computer's Atlas from its pairing link (or its address and a code). */
  pairComputer(link: string, code: string | null): Promise<Result<Computer>>;
  /** Forget a paired computer here, with this app's rows of its projects. */
  forgetComputer(hostId: string): Promise<Result<void>>;
  accessState(hostId: string | null): Promise<Result<AccessState>>;
  updateAccess(settings: AccessSettings): Promise<Result<AccessState>>;
  createPairing(hostId: string | null, address: string | null, grant: PairingGrant): Promise<Result<PairingLinkView>>;
  revokePairing(hostId: string | null, code: string): Promise<Result<void>>;
  devices(hostId: string | null): Promise<Result<PairedDevice[]>>;
  revokeDevice(hostId: string | null, deviceId: string): Promise<Result<void>>;
  /** Claude Code and Codex on this computer, checked now. */
  agents(): Promise<Result<AgentState[]>>;
  /** Install the Atlas plugin into an agent (and grant it the Atlas home); the result says how it went. */
  connectAgent(id: AgentId): Promise<Result<AgentChange>>;
  /** Uninstall the Atlas plugin from an agent. */
  disconnectAgent(id: AgentId): Promise<Result<AgentChange>>;
  onboarding(): Promise<Result<OnboardingState>>;
  /** The onboarding was finished or skipped: it no longer shows on launch. */
  finishOnboarding(): Promise<Result<void>>;
  onChanged(listener: (change: ProjectChange) => void): () => void;
  onProjectsChanged(listener: (change: ProjectsChange) => void): () => void;
  onMenu(listener: (command: MenuCommand) => void): () => void;
  onAccessChanged(listener: (change: AccessChange) => void): () => void;
}
