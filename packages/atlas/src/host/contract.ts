// The Atlas host protocol: what crosses the connection between the host (which owns the planning
// folders) and its clients (the desktop app's windows, another computer's Atlas, later a phone).
// Only types and constants live here, so every client can import it. Every method declares the
// scope it requires; the host checks it before any handler runs.
import type { DocumentContent, PlanImportResult, PlanningIndex, Usage } from '../planning/index.ts';
import type { DiagramEntry, DiagramIndexEntry, DiagramReference } from '../planning/reading/diagrams.ts';

export type { DiagramEntry, DiagramIndexEntry, DiagramReference };

/** Raised when the protocol changes incompatibly; a client refuses a host that speaks another version. */
export const protocolVersion = 9;

/**
 * Every paired device belongs to the person who owns this computer, so pairing grants the whole
 * computer; only managing who else may pair is a separate grant.
 * - `computer`: what the Atlas app can do on this computer: list, create and change its projects,
 *   read them, import and export plans, and count document use. Every paired device has it.
 * - `access:manage`: create pairing links, list and revoke paired devices. A device has it when its
 *   pairing link granted it.
 * - `owner`: everything, including the remote-access settings. Only the desktop app on the same
 *   computer holds it, through a token that never leaves memory.
 */
export type Scope = 'computer' | 'access:manage' | 'owner';

export type ErrorCode = 'invalid-argument' | 'not-found' | 'forbidden' | 'unauthorized' | 'unavailable' | 'folder-missing' | 'folder-invalid' | 'cancelled' | 'internal';
export interface HostErrorValue { code: ErrorCode; message: string }

/** Public, unauthenticated: lets a client check it reached the host it paired with before it sends a credential. */
export interface HostDescriptor { protocol: number; hostId: string; name: string; version: string }

export type FolderStatus = 'loading' | 'ready' | 'missing' | 'invalid';
export interface FolderState { folderId: string; name: string; status: FolderStatus; error: string | null; notice: string | null; revision: number }
export type ProjectState = 'active' | 'hidden' | 'archived';
/**
 * A project of this computer: a planning folder in its Atlas home, with its name (from its
 * planning.json, else the folder's), its place in the computer's order and its state. `folderId`
 * identifies it in every request about its folder. A project from before the home (`outsideHome`)
 * is listed until it is moved into the home; agents do not find it until then.
 */
export interface Project {
  folderId: string; name: string; path: string; position: number; state: ProjectState; outsideHome: boolean;
  /**
   * The workspace folders the project covers on this computer (planning.json's `workspaces`, absolute
   * paths): an agent session in one of them, or inside one, belongs to this project.
   */
  workspaces: string[];
  /** What the hub shows of the project's plans (the project list has it; null when its folder could not be read). */
  summary?: ProjectSummary | null;
}
/**
 * Where a work item stands, as the hub groups it: blocked first, then being implemented, then a draft
 * plan, then other open work; `closed` is work in `archive/` (complete, superseded or abandoned).
 */
export type ProjectWorkState = 'blocked' | 'implementing' | 'draft' | 'other' | 'closed';
/** A work item as the hub lists it. */
export interface ProjectWork {
  id: string; title: string; state: ProjectWorkState;
  /** The ledger's blocker, when it is blocked. */
  blocked: string | null;
  /** The plan's `summary` header: a few plain sentences on what the work is and where it stands. */
  summary: string | null;
  /** The ledger's steps, done and in all, and among them the planning steps (`phase: planning`); null without a ledger. */
  steps: { done: number; total: number; planning: { done: number; total: number } } | null;
  /** When the plan last changed: its `updated` header, else its `completed_at` (a date, YYYY-MM-DD). */
  updated: string | null;
  /** How closed work ended: its `implementation_status` complete, or the plan's `design_status` superseded or abandoned. */
  outcome: 'complete' | 'superseded' | 'abandoned' | null;
  /** The step being worked on (the first `doing`), else the next to do (the first `todo`); null without one. */
  step: { title: string; status: 'doing' | 'todo'; phase: 'planning' | 'implementation' } | null;
  /** The plan's `completed_at` (a date, YYYY-MM-DD); null while open. */
  completed: string | null;
  /** What agents spent on it, from the home database's reports; null when none were recorded. */
  statistics: ProjectWorkStatistics | null;
}
/**
 * A work item's statistics for the hub: agent time (measured and estimated, as the plan page counts
 * it), tokens, the model that did most of it and how many others took part, time and tokens by stage,
 * subagents, and the last report. Plan revisions are left to the Statistics page (they need Git).
 */
export interface ProjectWorkStatistics {
  /** Every agent's working time added up: each session and each subagent in full, also while they work at once. */
  agentMs: number;
  /** The time at least one agent was working: the union of the reports' working intervals (`WorkStatistics.activeMs`). */
  activeMs: number;
  /** Of `activeMs`, the time of reports without intervals, added up rather than merged. */
  unmergedMs: number;
  tokens: number | null; primaryModel: string | null;
  /** The reasoning effort the primary model worked at most (`high`, `medium`…); null when no log recorded one. */
  primaryEffort: string | null;
  otherModels: number;
  planning: { agentMs: number; tokens: number | null }; implementation: { agentMs: number; tokens: number | null };
  subagents: number; lastReport: string | null;
}
/** What the search finds: plans, steps, documents and their headings, diagrams and their elements, glossary terms and projects. */
export type SearchKind = 'plan' | 'step' | 'document' | 'heading' | 'diagram' | 'element' | 'term' | 'project';
/**
 * A search result in one of the computer's active projects: what it is, its title, a short snippet
 * around the match (null when the title matched), and where it opens: the project (`folderId`), the
 * work item, the file in the planning folder (`path`, POSIX-relative), a heading anchor, or a diagram element.
 */
export interface SearchResult {
  kind: SearchKind; title: string; snippet: string | null;
  folderId: string; project: string; work: string | null; path: string | null; anchor: string | null; element: string | null;
}
/**
 * An agent session linked to a work item, as the hooks record it. `working`: in a turn (seen within
 * the live window). `waiting`: its turn ended, or it asks for permission, and the person has not
 * answered yet; a session that ended, or has waited for a day, is not listed.
 */
export interface SessionActivity {
  session: string; harness: 'claude-code' | 'codex' | 'unknown';
  state: 'working' | 'waiting';
  /** working: when its turn started; waiting: when it began to wait. */
  since: string;
  /**
   * working: where its agent time not yet reported begins (the later of its turn's start and its last
   * report on this work item), so a client counts `now - countsFrom` on top of the reported time.
   * waiting: null.
   */
  countsFrom: string | null;
}
/**
 * What agents are doing on a work item now: `working` while any linked session works, else `waiting`
 * while one waits for the person (Needs you). Work nobody is on has no entry.
 */
export interface WorkActivity {
  workId: string; state: 'working' | 'waiting';
  /** working: the earliest working session's turn start; waiting: when the latest session began to wait. */
  since: string;
  /** Working sessions first, then waiting ones; latest first within each. */
  sessions: SessionActivity[];
}
/**
 * A project's repositories, its work (`active/`, in the registry's order, and `closed`: `archive/`,
 * newest first), its last change, what agents are doing on its work now, and the host's clock when
 * it was listed (`now`), against which clients count live agent time.
 */
export interface ProjectSummary { repositories: string[]; active: ProjectWork[]; closed: ProjectWork[]; updated: string | null; activity: WorkActivity[]; now: string }
/**
 * A reference a planning file makes, as the reader finds it: a PR or issue (`repo#22`, a GitHub URL;
 * `value` its number), a commit (`repo@4ab195a`, a bare hash; `value` the hash) or a file in a
 * repository (a path; `value` the path, `line` its line). `repository` is what the text names: a
 * registered repository ID or name, `owner/name` from a URL, or null when it names none.
 */
export interface ReferenceInput { kind: 'pull' | 'commit' | 'path'; repository: string | null; value: string; line: number | null }
/** A file on the host's computer, in one of the project's local checkouts. */
export interface ReferenceFile { path: string; line: number | null }
/**
 * Where a reference leads. `url`: its page on the repository's host (a PR, an issue, a commit), when
 * the repository's remote names one. `file`: the file on this computer, for a path (from the plan's
 * repositories first, then the project's, then any checkout that has it). `repository`: the registered
 * repository it was found in. `pull`: a PR's or issue's title and state, when `gh` can tell. `title`: a
 * commit's subject, when a local checkout has it. `choices`: the other repositories a bare hash is in.
 */
export interface ResolvedReference {
  url: string | null; file: ReferenceFile | null; repository: string | null;
  pull: { title: string; state: 'open' | 'draft' | 'merged' | 'closed'; checks: 'passing' | 'failing' | 'pending' | null } | null;
  title: string | null;
  choices: { repository: string; url: string | null; title: string | null }[];
}
/**
 * An agent session on a work item, from the home database: its harness, the model and reasoning
 * effort it used most, its state now, when it started and was last seen, its agent time on this work
 * item, and how to resume it on the host's computer (`resume`, a command run in `folder`). `message`
 * is the last message of its turn, from its log, while it waits for the person; null otherwise.
 */
export interface WorkSession {
  session: string; harness: 'claude-code' | 'codex' | 'unknown';
  model: string | null; effort: string | null;
  state: 'working' | 'waiting' | 'ended';
  startedAt: string; lastSeen: string; agentMs: number;
  folder: string | null; resume: string | null;
  message: string | null;
}
/** A commit a session on the work item made, or a PR it opened, as its hooks saw them. */
export interface WorkProduct {
  kind: 'commit' | 'pull'; session: string; at: string;
  /** The registered repository, else the checkout's folder name; null when unknown. */
  repository: string | null;
  /** The commit's hash, or the PR's number. */
  id: string;
  title: string | null; url: string | null;
  /** The branch the commit was made on, or the PR's head branch. */
  branch: string | null;
}
/**
 * A work item's time: how long it was planned (created to accepted) and implemented (accepted to
 * completed, or now), how long its sessions waited for the person, and one lane per session and
 * subagent with its working and waiting stretches ([start, end], ISO times; an open one ends now).
 */
export interface WorkTimeline {
  plannedMs: number | null; implementingMs: number | null; waitedMs: number;
  lanes: { session: string; subagent: string | null; model: string | null; effort: string | null; working: [string, string][]; waiting: [string, string][] }[];
}
/** A repository a project covers: its ID in planning.json, its name and its Git remote. */
export interface ProjectRepository { id: string; name: string; remote: string | null }
/** The Git checkouts found in a workspace folder (the folder itself and the folders directly inside it), as a new project would register them. */
export interface WorkspaceScan { folder: string; repositories: ProjectRepository[] }

export interface Snapshot extends PlanningIndex {
  usage: Usage; usageByRepository: Record<string, Usage>; collectionError: string | null;
  /** Every visible folder below the planning root (POSIX-relative), including empty ones. */
  folders: string[];
}
export interface ViewEventInput { id: string; path: string; session: string; contentHash: string | null }

export interface PreparedExport { token: string; bytes: number; warnings: string[]; fileName: string }
export interface ImportPreviewValue {
  token: string; title: string; originalId: string | null; origin: string | null; location: string | null;
  exportedAt: string | null; atlasVersion: string | null; newId: string | null; newFolder: string | null;
  files: number; bytes: number; diagrams: string[];
}
export type ImportResultValue = Pick<PlanImportResult, 'workId' | 'path' | 'files' | 'notes'>;

/** How the host can be reached from other devices. Off unless the owner turns it on. */
export interface NetworkSettings { enabled: boolean; address: string | null; port: number }
export type AddressKind = 'loopback' | 'tailscale' | 'lan';
export interface HostAddress { address: string; kind: AddressKind; label: string }
export interface NetworkStatus { listening: boolean; address: string | null; port: number | null; error: string | null }
export interface AccessSettings { network: NetworkSettings }
export interface AccessState {
  settings: AccessSettings; status: NetworkStatus; addresses: HostAddress[];
  /** Another process (`atlas serve`) holds remote access on this computer; settings are read-only here. */
  managedBy: string | null;
  /** Why remote access cannot be used at all (its settings cannot be read); null when it can. */
  problem: string | null;
}
/** What a pairing link grants: the whole computer, and Manage access when chosen. `label` names the device. */
export interface PairingGrant { label: string | null; manageAccess: boolean }
export interface PairingLink extends PairingGrant { code: string; expiresAt: string; url: string | null; address: string | null; port: number | null }
export interface PairedDevice { deviceId: string; name: string; platform: string; scopes: Scope[]; pairedAt: string; lastSeenAt: string | null; connected: boolean }
export interface PairRequest { code: string; device: { name: string; platform: string } }
export interface PairResponse { hostId: string; name: string; deviceId: string; token: string; scopes: Scope[] }
export interface SessionInfo { hostId: string; name: string; version: string; scopes: Scope[]; deviceId: string | null }

/** Every request: its parameters, its result, and the scope it needs. */
export interface Methods {
  'host.session': { params: Record<string, never>; result: SessionInfo };
  /** The computer's projects (the planning folders in its home), in their order. */
  'projects.list': { params: Record<string, never>; result: Project[] };
  /**
   * A new project: a planning folder in the home made from the templates, as its own Git repository,
   * covering the workspace folders given and registering the repositories found in them (or the
   * repositories given, when `repositories` is set).
   */
  'projects.create': { params: { name: string; workspaces: string[]; repositories?: ProjectRepository[] }; result: Project };
  /** Search every active project of the computer, best matches first (at most `limit`, default 50). */
  'search.query': { params: { query: string; limit?: number }; result: SearchResult[] };
  /** Resolve the references a planning file of the project makes (each in order; null when it leads nowhere). */
  'references.resolve': { params: { folderId: string; work: string | null; items: ReferenceInput[] }; result: (ResolvedReference | null)[] };
  /** A work item's sessions, newest first, and the commits and PRs they made, newest first. */
  'work.sessions': { params: { folderId: string; work: string }; result: { sessions: WorkSession[]; products: WorkProduct[] } };
  /** A work item's time and its sessions' working and waiting stretches. */
  'work.timeline': { params: { folderId: string; work: string }; result: WorkTimeline };
  /** The Git checkouts in a folder on this computer, for a new project's preview. */
  'projects.scan': { params: { folder: string }; result: WorkspaceScan };
  /**
   * Rename a project (its planning.json's name), hide, archive or show it, move it in the order, or set
   * its workspace folders (registering the repositories found in folders it did not cover before).
   */
  'projects.update': { params: { folderId: string; name?: string; state?: ProjectState; position?: number; workspaces?: string[] }; result: Project };
  /** Move a project outside the home into it, with its statistics; it keeps its place, state and tabs, under a new folder ID. */
  'projects.adopt': { params: { folderId: string }; result: Project };
  'folders.subscribe': { params: { folderId: string }; result: FolderState };
  'folders.unsubscribe': { params: { folderId: string }; result: null };
  'folder.snapshot': { params: { folderId: string }; result: Snapshot };
  'folder.document': { params: { folderId: string; path: string }; result: DocumentContent };
  /** A work item's diagrams: its `.puml` files, by their paths in the work folder. */
  'folder.diagrams': { params: { folderId: string; work: string }; result: DiagramEntry[] };
  /** A diagram's viewer payload, with the payloads of the rest of its family (`siblings`), laid out together. */
  'folder.diagram': { params: { folderId: string; work: string; path: string }; result: unknown };
  /** The diagrams a document links to, under the headings the links sit under. */
  'folder.references': { params: { folderId: string; work: string | null; path: string }; result: DiagramReference[] };
  /** Every diagram of the folder, for quick open. */
  'folder.diagramIndex': { params: { folderId: string }; result: DiagramIndexEntry[] };
  'folder.recordView': { params: { folderId: string; event: ViewEventInput }; result: null };
  'plan.exportPrepare': { params: { folderId: string; work: string }; result: PreparedExport };
  'plan.exportDrop': { params: { token: string }; result: null };
  'plan.importRead': { params: { folderId: string; file: string }; result: ImportPreviewValue };
  'plan.importConfirm': { params: { folderId: string; token: string }; result: ImportResultValue };
  'plan.importDrop': { params: { token: string }; result: null };
  'access.state': { params: Record<string, never>; result: AccessState };
  'access.update': { params: { settings: AccessSettings }; result: AccessState };
  'access.pairingCreate': { params: { address: string | null } & PairingGrant; result: PairingLink };
  'access.pairingRevoke': { params: { code: string }; result: null };
  'access.devices': { params: Record<string, never>; result: PairedDevice[] };
  'access.deviceRevoke': { params: { deviceId: string }; result: null };
}
export type MethodName = keyof Methods;

export const methodScopes: { readonly [M in MethodName]: Scope } = {
  'host.session': 'computer',
  'projects.list': 'computer',
  'projects.create': 'computer',
  'search.query': 'computer',
  'references.resolve': 'computer',
  'work.sessions': 'computer',
  'work.timeline': 'computer',
  // A folder on this computer, by path: the app's own, like plan.importRead.
  'projects.scan': 'owner',
  'projects.update': 'computer',
  'projects.adopt': 'computer',
  'folders.subscribe': 'computer',
  'folders.unsubscribe': 'computer',
  'folder.snapshot': 'computer',
  'folder.document': 'computer',
  'folder.diagrams': 'computer',
  'folder.diagram': 'computer',
  'folder.references': 'computer',
  'folder.diagramIndex': 'computer',
  'folder.recordView': 'computer',
  'plan.exportPrepare': 'computer',
  'plan.exportDrop': 'computer',
  // A file on this computer, by path: the app's own. Another device sends its file to routes.imports.
  'plan.importRead': 'owner',
  'plan.importConfirm': 'computer',
  'plan.importDrop': 'computer',
  'access.state': 'access:manage',
  'access.update': 'owner',
  'access.pairingCreate': 'access:manage',
  'access.pairingRevoke': 'access:manage',
  'access.devices': 'access:manage',
  'access.deviceRevoke': 'access:manage',
};

/** Events the host pushes to a connection. */
export interface Events {
  'folder.changed': FolderState;
  /** The computer's projects changed (one was added, renamed, hidden, archived or moved). */
  'projects.changed': { projects: Project[] };
  /** Remote access changed: sent to connections that may manage access. */
  'access.changed': AccessState;
}
export type EventName = keyof Events;

export interface RequestMessage<M extends MethodName = MethodName> { id: number; method: M; params: Methods[M]['params'] }
export type ResponseMessage = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: HostErrorValue };
export interface EventMessage<E extends EventName = EventName> { event: E; data: Events[E] }

/** WebSocket close codes the host uses; a client stops reconnecting after `revoked`. */
export const closeCodes = { revoked: 4401, protocol: 4400, shuttingDown: 4503 } as const;

/** HTTP routes. */
export const routes = { host: '/api/host', pair: '/api/pair', connect: '/api/connect', files: '/api/folders/:folderId/files/*', imports: '/api/folders/:folderId/imports', exports: '/api/exports/:token' } as const;
/** The default port for remote access, when the owner turns it on. */
export const defaultPort = 7346;
/** Pairing codes expire this long after they are created. */
export const pairingLifetime = 5 * 60 * 1000;
/** The pairing link a QR code or a copied link carries: the address and the one-time code. */
export function pairingUrl(address: string, port: number, code: string) {
  const host = address.includes(':') ? '[' + address + ']' : address;
  return `http://${host}:${port}/pair#token=${code}`;
}
