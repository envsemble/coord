// The typed contract between the renderer and the main process. Every message the window can send
// is on `invokeChannels`; every message main can push is on `eventChannels`. Only types and
// constants live here, so the preload, main and renderer can all import it.
// A window shows the projects of one computer: this one, or another one this app paired with. The
// planning data is the Coord host's (packages/coord/src/host/contract.ts): main forwards the window's
// requests about a project to the host of its computer, naming the project by its ID (`projectId`).
import type {
  AccessSettings, AccessState, DiagramEntry, DiagramIndexEntry, DiagramReference, ErrorCode, HostErrorValue, PairedDevice, PairingGrant, PairingLink, Project,
  ProjectState, ProjectStatistics, ProjectStatus, ProjectSummary, ProjectWork, ProjectWorkState, ReferenceInput, ResolvedReference, SearchKind, SearchResult, SessionActivity, Snapshot,
  SnapshotValue, SnapshotWork, WorkActivity, WorkCommit, WorkSession, WorkTimeline, PageBuild, PageProblem, ToolOutcome,
} from '@envsemble/coord/host/contract';
import type { DocumentContent } from '@envsemble/coord/planning/types';

export type {
  AccessSettings, AccessState, DiagramEntry, DiagramIndexEntry, DiagramReference, DocumentContent, ErrorCode, PairedDevice, PairingGrant, Project,
  ProjectState, ProjectStatistics, ProjectStatus, ProjectSummary, ProjectWork, ProjectWorkState, ReferenceInput, ResolvedReference, SearchKind, SearchResult, SessionActivity, Snapshot,
  SnapshotValue, SnapshotWork, WorkActivity, WorkCommit, WorkSession, WorkTimeline, PageBuild, PageProblem, ToolOutcome,
};

export const invokeChannels = [
  'window:info',
  'projects:list', 'projects:create', 'search:query', 'projects:chooseFolder', 'projects:update', 'project:open', 'project:close',
  'project:snapshot', 'project:work', 'project:document', 'project:diagrams', 'project:diagram', 'project:arrangement', 'project:arrange', 'project:references', 'project:diagramIndex', 'project:page', 'project:readText', 'project:write', 'project:tool',
  'project:statistics', 'projects:statistics', 'ui:load', 'ui:save',
  'references:resolve', 'work:sessions', 'work:timeline',
  'shell:reveal', 'shell:openExternal', 'shell:openReference', 'shell:copy',
  'app:command', 'app:theme', 'app:setTheme', 'app:about',
  'computers:list', 'computers:switch', 'computers:pair', 'computers:forget',
  'access:state', 'access:update', 'access:pairingCreate', 'access:pairingRevoke', 'access:devices', 'access:deviceRevoke',
  'agents:list', 'agents:checks', 'agents:connect', 'agents:disconnect', 'agents:chooseProgram', 'agents:clearProgram', 'agents:byHand',
  'onboarding:state', 'onboarding:finish',
  'updates:state', 'updates:check', 'updates:download', 'updates:install', 'updates:setChannel',
] as const;
export type InvokeChannel = typeof invokeChannels[number];

export const eventChannels = ['project:changed', 'projects:changed', 'menu:command', 'access:changed', 'updates:changed'] as const;
export type EventChannel = typeof eventChannels[number];

/** Light, dark, or the operating system's choice: kept by main for every window and applied as Electron's native theme. */
export const themePreferences = ['system', 'light', 'dark'] as const;
export type ThemePreference = typeof themePreferences[number];

/**
 * Commands the renderer may ask main to run, from the title bar's menu among others; each one acts
 * on the calling window only (New Window and Exit act on the app).
 */
export const appCommands = [
  'newWindow', 'quit', 'openLogs',
  'zoomIn', 'zoomOut', 'resetZoom', 'toggleFullScreen', 'reload', 'toggleDevTools',
  // The menu of Coord Dev's Dev tag (main/dev.ts); nothing in any other build.
  'devCopyRealData', 'devRemovePlugin',
] as const;
export type AppCommand = typeof appCommands[number];

/** Menu items that need the renderer (focus, pages, dialogs drawn in the window). */
export const menuCommands = [
  'focusFiles', 'quickOpen', 'newProject', 'plans', 'statistics', 'settings', 'goBack', 'goForward', 'about',
] as const;
export type MenuCommand = typeof menuCommands[number];

/** An error as it crosses the process boundary: one of the host's error codes, with a message fit to show. */
export type CoordErrorValue = HostErrorValue;
/** Errors cross the process boundary as values, never as thrown Error objects. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: CoordErrorValue };

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
  /** Whether this is Coord Dev (`npm run dev`, on a copy of the data): the title bar says Dev, a tag that is also its menu. */
  dev: boolean;
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
/** The Settings page's sections: general (the theme), the agents Coord connects on this computer, pairing in both directions, and Coord's updates. */
export const settingsSections = ['general', 'agents', 'computers', 'updates'] as const;
export type SettingsSection = typeof settingsSections[number];
/**
 * The window's own pages: the hub, with the plans of every project or of one (`projectId`), where
 * projects are made and managed too, a project's statistics (no project only while the computer has none), and a
 * section of the Settings page.
 */
export type PagePlace = { page: 'hub'; projectId: string | null } | { page: 'statistics'; projectId: string | null } | { page: 'settings'; section: SettingsSection };
/** What a window shows: one place at a time. */
export type Place = ProjectPlace | PagePlace;
/** A window's layout: the place it shows. */
export interface UiState {
  place: Place;
  /** Loaded while the window's computer did not answer: a place of a project not listed yet waits to be loaded again. */
  pending?: boolean;
}
export const defaultUiState: UiState = { place: { page: 'hub', projectId: null } };
/** A window's layout as it loads, with its computer's projects as listed for it when the computer answered: the window starts from them. */
export interface LoadedUi extends UiState { projects?: Project[] }
export const limits = { path: 2048, folders: 20 } as const;
/** A folder's full path: from a drive or a share on Windows, from the root elsewhere. */
export const fullPath = /^(?:[a-zA-Z]:[\\/]|\\\\[^\\/]|\/)/;

/** The agents Coord can connect on this computer: its plugin installed into each through the agent's own commands. */
export const agentIds = ['claude', 'codex'] as const;
export type AgentId = typeof agentIds[number];
export const agentNames: Record<AgentId, string> = { claude: 'Claude Code', codex: 'Codex' };
/**
 * Whether a connected agent runs Coord: ready (a session of it ran Coord's hooks since it was
 * connected, the last at `at`), waiting for a first session, or a warning: Codex does not trust
 * Coord's hooks (`untrusted`), or a session used Coord's tools without its hooks running (`no-hooks`).
 */
export type AgentCheck = { status: 'ready'; at: string } | { status: 'waiting' | 'untrusted' | 'no-hooks' };
/**
 * An agent on this computer: whether its program is found (`found`: the one chosen for it, else on
 * the PATH), the program chosen for it (`program`, null when the PATH's is used), whether the Coord
 * plugin is installed in it (`connected`), the version of the plugin it has (null when not connected
 * or unknown), and, connected, whether it runs Coord (`check`).
 */
export interface AgentState { id: AgentId; found: boolean; program: string | null; connected: boolean; version: string | null; check: AgentCheck | null }
/** What connecting or disconnecting an agent did: its state after, and the error when it failed (a message fit to show). */
export interface AgentChange { agent: AgentState; error: string | null }
/** What connecting an agent by hand takes: the marketplace folder the app connects agents to, and the marketplace's name. */
export interface AgentFolder { directory: string; marketplace: string; plugin: string }
/** Whether the onboarding has been finished on this computer; it shows on launch until then. */
export interface OnboardingState { done: boolean }

/** Where Coord's updates come from: its stable releases, or a build of its development branch each night. */
export const updateChannels = ['stable', 'nightly'] as const;
export type UpdateChannel = typeof updateChannels[number];
/** Whether a version is a nightly build's (`0.9.1-nightly.20261114.42`): its updates follow the nightly channel, and its title bar says Nightly. */
export const isNightlyVersion = (version: string) => /-nightly\./.test(version);
/**
 * Where the installed app's update stands: off for this run (a development or test build, or a
 * Linux build not run as its AppImage, with why), nothing to do (`checkedAt`: the last check that
 * found nothing, null before one), checking, a newer build on offer, downloading it, downloaded and
 * ready to restart into, or the last step failed (a message fit to show).
 */
export type UpdateStatus =
  | { kind: 'off'; reason: string }
  | { kind: 'idle'; checkedAt: string | null }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'failed'; message: string };
/** The running build's version, the channel it follows, and its update. */
export interface UpdateState { version: string; channel: UpdateChannel; status: UpdateStatus }

/** What the menu's About Coord shows. */
export interface AboutInfo {
  version: string;
  electron: string;
  chromium: string;
  node: string;
  /** The operating system, its version and the processor architecture, such as Windows 10.0.26200 (x64). */
  system: string;
  /** The Coord home. */
  dataFolder: string;
}

/**
 * The bridge the preload script exposes to the renderer as `window.coord`. Every method maps to
 * one channel and resolves to a Result; errors arrive as structured values, never as exceptions.
 * A `projectId` is a project's ID on the window's computer; a `hostId` of null means this computer.
 */
export interface CoordBridge {
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
  /** How a reader arranged a diagram (shared by its family's layers): each element's top-left corner by id; null when laid out automatically. */
  arrangement(projectId: string, work: string, path: string): Promise<Result<Record<string, [number, number]> | null>>;
  /** Save a diagram's arrangement, or remove it (null) to lay it out automatically again. */
  arrange(projectId: string, work: string, path: string, positions: Record<string, [number, number]> | null): Promise<Result<null>>;
  /** The diagrams a document links to. */
  references(projectId: string, work: string | null, path: string): Promise<Result<DiagramReference[]>>;
  /** Every diagram of a project, for quick open. */
  diagramIndex(projectId: string): Promise<Result<DiagramIndexEntry[]>>;
  /** Build a page, by its folder in the planning folder (`<work>/pages/<name>`), for its frame to run. */
  page(projectId: string, path: string): Promise<Result<PageBuild>>;
  /** A file of the planning folder as text, whatever its kind, for a page. */
  readText(projectId: string, path: string): Promise<Result<string>>;
  /** Write a text file in the planning folder, for a page. */
  writeFile(projectId: string, path: string, content: string): Promise<Result<null>>;
  /** Run a Coord tool (work_status, step and the rest) in the project's planning folder, for a page. */
  tool(projectId: string, name: string, input: Record<string, unknown>): Promise<Result<ToolOutcome>>;
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
  /** Open the file a path reference names in VS Code, at its line; only for a project on this computer. */
  openReference(projectId: string, reference: ReferenceInput): Promise<Result<void>>;
  copy(text: string): Promise<Result<void>>;
  command(command: AppCommand): Promise<Result<void>>;
  /** The app's theme preference. Windows follow it through `prefers-color-scheme`. */
  theme(): Promise<Result<ThemePreference>>;
  setTheme(preference: ThemePreference): Promise<Result<void>>;
  /** The versions and the Coord home About Coord shows. */
  about(): Promise<Result<AboutInfo>>;
  /** This computer and the computers this app paired with, each checked for whether it answers. */
  computers(): Promise<Result<Computer[]>>;
  /** Show another computer's projects, in this window or a new one. */
  switchComputer(hostId: string | null, newWindow: boolean): Promise<Result<void>>;
  /** Pair with another computer's Coord from its pairing link (or its address and a code). */
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
  /** The agents as last checked, with whether each connected one runs Coord read now (cheap: no agent's command runs). */
  agentChecks(): Promise<Result<AgentState[]>>;
  /** Choose an agent's program in a file dialog (null when cancelled); the result's error says why the file chosen cannot be it. */
  chooseAgentProgram(id: AgentId): Promise<Result<AgentChange | null>>;
  /** Forget the program chosen for an agent: the PATH's is used again. */
  clearAgentProgram(id: AgentId): Promise<Result<AgentState>>;
  /** What connecting an agent by hand takes. */
  agentFolder(): Promise<Result<AgentFolder>>;
  /** Install the Coord plugin into an agent (and grant it the Coord home); the result says how it went. */
  connectAgent(id: AgentId): Promise<Result<AgentChange>>;
  /** Uninstall the Coord plugin from an agent. */
  disconnectAgent(id: AgentId): Promise<Result<AgentChange>>;
  onboarding(): Promise<Result<OnboardingState>>;
  /** The onboarding was finished: it no longer shows on launch. */
  finishOnboarding(): Promise<Result<void>>;
  /** Coord's update: the version running, its channel and where its update stands. */
  updates(): Promise<Result<UpdateState>>;
  /** Look for a newer build on the channel now. */
  checkForUpdates(): Promise<Result<UpdateState>>;
  /** Download the build on offer. */
  downloadUpdate(): Promise<Result<UpdateState>>;
  /** Quit Coord, install the downloaded build and start it again. */
  installUpdate(): Promise<Result<void>>;
  /** Follow the stable or the nightly channel from now on. */
  setUpdateChannel(channel: UpdateChannel): Promise<Result<UpdateState>>;
  onChanged(listener: (change: ProjectChange) => void): () => void;
  onProjectsChanged(listener: (change: ProjectsChange) => void): () => void;
  onMenu(listener: (command: MenuCommand) => void): () => void;
  onAccessChanged(listener: (change: AccessChange) => void): () => void;
  onUpdatesChanged(listener: (state: UpdateState) => void): () => void;
}
