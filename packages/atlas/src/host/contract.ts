// The Atlas host protocol: what crosses the connection between the host (which owns the planning
// folders) and its clients (the desktop app's windows, another computer's Atlas, later a phone).
// Only types and constants live here, so every client can import it. Every method declares the
// scope it requires; the host checks it before any handler runs.
import type { DocumentContent, HandoffLink, PlanningIndex, ProjectState, ProjectSummary as PlanningProjectSummary, ProjectWork, ProjectWorkState, ProjectWorkStatistics, Work } from '../planning/index.ts';
import type { DiagramEntry, DiagramIndexEntry, DiagramReference } from '../planning/reading/diagrams.ts';
import type { PageBuild, PageProblem } from '../planning/pages/pages.ts';

export type { DiagramEntry, DiagramIndexEntry, DiagramReference, HandoffLink, PageBuild, PageProblem, ProjectState, ProjectWork, ProjectWorkState, ProjectWorkStatistics };
/** An Atlas tool's result for a page: its value, or the refusal an agent would read. */
export type ToolOutcome = { ok: true; value: unknown } | { ok: false; error: string };

/** Raised when the protocol changes incompatibly; a client refuses a host that speaks another version. */
export const protocolVersion = 14;

/**
 * Every paired device belongs to the person who owns this computer, so pairing grants the whole
 * computer; only managing who else may pair is a separate grant.
 * - `computer`: what the Atlas app can do on this computer: list, create and change its projects,
 *   and read them. Every paired device has it.
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

/** Whether a project's planning folder can be read: still loading, read, gone, or not a planning folder. */
export type ProjectStatus = 'loading' | 'ready' | 'missing' | 'invalid';
/**
 * A project as the host has it open, for the clients that follow it (projects.subscribe and the
 * project.changed event). `revision` increases whenever its snapshot changes; `files` is the revision
 * at which its files were last read, so a change that leaves `files` as it was changed only its work's
 * statistics or handoffs (project.work has them, without the documents).
 */
export interface OpenProjectState { projectId: string; name: string; status: ProjectStatus; error: string | null; notice: string | null; revision: number; files: number }
/**
 * A project of this computer: a planning folder in its Atlas home, with its name (from its
 * planning.json, else the folder's), its place in the computer's order and its state. `id` (`f-` and
 * 32 hex digits, derived from its planning folder's path) is the `projectId` every request about it names.
 */
export interface Project {
  id: string; name: string; path: string; position: number; state: ProjectState;
  /**
   * The folders the project covers on this computer (planning.json's `folders`, absolute paths): an
   * agent session in one of them, or inside one, belongs to this project.
   */
  folders: string[];
  /** What the hub shows of the project's plans (the project list has it; null when its folder could not be read). */
  summary?: ProjectSummary | null;
}
/** What the search finds: plans, steps, documents and their headings, diagrams and their elements, glossary terms and projects. */
export type SearchKind = 'plan' | 'step' | 'document' | 'heading' | 'diagram' | 'page' | 'element' | 'term' | 'project';
/**
 * A search result in one of the computer's active projects: what it is, its title, a short snippet
 * around the match (null when the title matched), and where it opens: the project (`projectId`, and its
 * name, `projectName`), the
 * work item, the file in the planning folder (`path`, POSIX-relative), a heading anchor, or a diagram element.
 */
export interface SearchResult {
  kind: SearchKind; title: string; snippet: string | null;
  projectId: string; projectName: string; work: string | null; path: string | null; anchor: string | null; element: string | null;
  /** A plan's tags. */
  tags?: string[];
}
/**
 * An agent session linked to a work item, as the hooks record it. `working`: in a turn (seen within
 * the live window). `waiting`: its turn ended, or it asks for permission, and the person has not
 * answered yet; a session that ended, or has waited for a day, is not listed.
 */
export interface SessionActivity {
  session: string; harness: 'claude-code' | 'codex' | 'unknown';
  /** In a turn; waiting for the person, who was asked (Needs you); or out of its turn without asking (idle: waiting on CI, say). */
  state: 'working' | 'waiting' | 'idle';
  /** working: when its turn started; waiting and idle: when its turn ended or it asked. */
  since: string;
  /**
   * working: where its agent time not yet reported begins (the later of its turn's start and its last
   * report on this work item), so a client counts `now - countsFrom` on top of the reported time.
   * waiting and idle: until it began to wait, while its report is not in; else null.
   */
  countsFrom: string | null;
}
/**
 * What agents are doing on a work item now: `waiting` while a linked session asked for the person and
 * none works (Needs you), else `working` while one works or is idle (its agent waits on something
 * else). Work nobody is on has no entry.
 */
export interface WorkActivity {
  workId: string; state: 'working' | 'waiting';
  /** working: the earliest working session's turn start (or, with none in a turn, when the latest went idle); waiting: when the latest session began to wait. */
  since: string;
  /** Working sessions first, then waiting and idle ones; latest first within each. */
  sessions: SessionActivity[];
}
/**
 * A project's work (`active/`, in the registry's order, and `closed`: `archive/`, newest first), its
 * last change, what agents are doing on its work now, and the host's clock when it was listed
 * (`now`), against which clients count live agent time.
 */
export interface ProjectSummary extends PlanningProjectSummary { activity: WorkActivity[]; now: string }
/**
 * A reference a planning file makes, as the reader finds it: a PR or issue (`owner/repo#22`, a GitHub
 * URL; `value` its number), a commit (`owner/repo@4ab195a`; `value` the hash) or a file in one of the
 * project's folders (a path; `value` the path, `line` its line). `repository` is the `owner/repo` the
 * text names, or null when it names none; a PR or commit without one leads nowhere.
 */
export interface ReferenceInput { kind: 'pull' | 'commit' | 'path'; repository: string | null; value: string; line: number | null }
/** A file on the host's computer, in one of the project's folders. */
export interface ReferenceFile { path: string; line: number | null }
/**
 * Where a reference leads. `url`: its page on GitHub (a PR, an issue, a commit). `file`: the file on
 * this computer, for a path (in one of the project's folders, or a folder directly inside one, the
 * first that has it). `repository`: the `owner/repo` it names. `pull`: a PR's or issue's title and
 * state, and `title` a commit's subject, when `gh` can tell.
 */
export interface ResolvedReference {
  url: string | null; file: ReferenceFile | null; repository: string | null;
  pull: { title: string; state: 'open' | 'draft' | 'merged' | 'closed'; checks: 'passing' | 'failing' | 'pending' | null } | null;
  title: string | null;
}
/**
 * An agent session on a work item, from the home database: its harness, the model and reasoning
 * effort it used most, its state now, when it started and was last seen, its agent time on this work
 * item, and how to resume it on the host's computer (`resume`, a command run in `folder`). `message`
 * is the last message of its turn, from its log, while it waits for the person; null otherwise.
 */
export interface WorkSession {
  session: string; harness: 'claude-code' | 'codex' | 'unknown';
  /** The session's own title, as its harness names it (Claude Code's latest `ai-title`, Codex's thread name); null when it has none. */
  title: string | null;
  model: string | null; effort: string | null;
  state: 'working' | 'waiting' | 'idle' | 'ended';
  startedAt: string; lastSeen: string; agentMs: number;
  folder: string | null; resume: string | null;
  message: string | null;
  /** What it is doing now, read from its log's end while it is on the work (and for the latest session when none is): its latest message and last actions (newest first); else null. */
  now: { message: string | null; actions: { kind: 'edit' | 'command' | 'atlas' | 'agent' | 'tool'; text: string; failed?: boolean }[] } | null;
}
/** A commit a session on the work item made, or a PR it opened, as its hooks saw them. */
export interface WorkCommit {
  kind: 'commit' | 'pull'; session: string; at: string;
  /** The repository as `owner/repo`, from the checkout's remote or the PR's address; else the checkout's folder name; null when unknown. */
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
/**
 * A period's figures on a project's statistics page: every agent's time added up (`agentMs`), the time
 * at least one agent worked (`activeMs`: the union of the reports' working intervals, reports
 * without them added as is), the plans completed in it (their `completed_at` within the period), the
 * median time from acceptance to completion of those plans (null without any), and the time the
 * project's sessions waited for the person (waits at once counted once, as work.timeline counts them).
 */
export interface ProjectPeriodFigures { agentMs: number; activeMs: number; plansCompleted: number; medianImplementingMs: number | null; waitedMs: number }
/**
 * One day or week of a project's statistics. `start` is when it begins, at midnight in the host's
 * local time (a week begins on Monday), as an ISO time. Time is put where it was worked, by the
 * reports' working intervals (split at the bucket's bounds); a report without intervals counts at
 * its report time. `agents`: agent time by model and reasoning effort (null where no log named one),
 * most first; `completed`: the plans completed in it.
 */
export interface ProjectStatisticsBucket {
  start: string;
  agents: { model: string | null; effort: string | null; agentMs: number }[];
  activeMs: number;
  completed: { id: string; title: string }[];
}
/**
 * A project's statistics for a period, from `from` (null: since its first report) up to `to` (the
 * host's now when not given), by day or week: the period's figures and the period before's (as
 * long, just before it; null when the period has no start), its buckets, and agent time and tokens by model and reasoning effort (most time first).
 */
export interface ProjectStatistics {
  from: string | null; to: string; unit: 'day' | 'week';
  current: ProjectPeriodFigures; previous: ProjectPeriodFigures | null;
  buckets: ProjectStatisticsBucket[];
  models: { model: string | null; effort: string | null; agentMs: number; tokens: number | null }[];
}
export interface Snapshot extends PlanningIndex {
  /** Every visible folder below the planning root (POSIX-relative), including empty ones. */
  folders: string[];
}
/** A work item as project.snapshot and project.work send it: without its documents, which the snapshot lists once. */
export type SnapshotWork = Omit<Work, 'documents'>;
/** A snapshot as project.snapshot sends it: each document once, in `documents`; withWorkDocuments gives the work items theirs again. */
export interface SnapshotValue extends Omit<Snapshot, 'work'> { work: SnapshotWork[] }
/** A snapshot to send: its work items without their documents. */
export function snapshotValue(snapshot: Snapshot): SnapshotValue {
  return { ...snapshot, work: snapshot.work.map(({ documents: _documents, ...item }) => item) };
}
/**
 * A snapshot as sent, with each work item's documents again: those of the snapshot it owns (`workId`),
 * its plan first, then by path, as the reader orders them.
 */
export function withWorkDocuments(value: SnapshotValue): Snapshot {
  const owned = new Map<string, Snapshot['documents']>();
  for (const document of value.documents) if (document.workId !== null) owned.set(document.workId, [...owned.get(document.workId) ?? [], document]);
  return { ...value, work: value.work.map(item => ({ ...item, documents: (owned.get(item.id) ?? []).sort((a, b) => Number(b.category === 'plan') - Number(a.category === 'plan') || a.path.localeCompare(b.path)) })) };
}

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
  /** A new project: a planning folder in the home made from the templates, as its own Git repository, covering the folders given. */
  'projects.create': { params: { name: string; folders: string[] }; result: Project };
  /** Search every active project of the computer, best matches first (at most `limit`, default 50). */
  'search.query': { params: { query: string; limit?: number }; result: SearchResult[] };
  /** Resolve the references a planning file of the project makes (each in order; null when it leads nowhere). */
  'references.resolve': { params: { projectId: string; items: ReferenceInput[] }; result: (ResolvedReference | null)[] };
  /** A work item's sessions, newest first, and the commits and PRs they made, newest first. */
  'work.sessions': { params: { projectId: string; work: string }; result: { sessions: WorkSession[]; commits: WorkCommit[] } };
  /** A work item's time and its sessions' working and waiting stretches. */
  'work.timeline': { params: { projectId: string; work: string }; result: WorkTimeline };
  /** A project's statistics for a period (ISO times; null: from its first report, or to now), by day or week. */
  'project.statistics': { params: { projectId: string; from: string | null; to: string | null; unit: 'day' | 'week' }; result: ProjectStatistics };
  /** Several projects' statistics together, as one (all plans: the app's active projects), for a period as project.statistics has it. */
  'projects.statistics': { params: { projectIds: string[]; from: string | null; to: string | null; unit: 'day' | 'week' }; result: ProjectStatistics };
  /** Rename a project (its planning.json's name), archive it or bring it back, move it in the order, or set its folders. */
  'projects.update': { params: { projectId: string; name?: string; state?: ProjectState; position?: number; folders?: string[] }; result: Project };
  'projects.subscribe': { params: { projectId: string }; result: OpenProjectState };
  'projects.unsubscribe': { params: { projectId: string }; result: null };
  'project.snapshot': { params: { projectId: string }; result: SnapshotValue };
  /** The work items alone, for a change of their statistics or handoffs only (OpenProjectState.files unchanged). */
  'project.work': { params: { projectId: string }; result: SnapshotWork[] };
  'project.document': { params: { projectId: string; path: string }; result: DocumentContent };
  /** A work item's diagrams: its `.puml` files, by their paths in the work folder. */
  'project.diagrams': { params: { projectId: string; work: string }; result: DiagramEntry[] };
  /** A diagram's viewer payload, with the payloads of the rest of its family (`siblings`), laid out together. */
  'project.diagram': { params: { projectId: string; work: string; path: string }; result: unknown };
  /** How a reader arranged a diagram (its family's, for a capture's later captures and proposals): each element's top-left corner by id; null when it is laid out automatically. */
  'project.arrangement': { params: { projectId: string; work: string; path: string }; result: Record<string, [number, number]> | null };
  /** Save a diagram's arrangement beside its family's first file (`name.layout.json`), or remove it (null) to lay it out automatically. */
  'project.arrange': { params: { projectId: string; work: string; path: string; positions: Record<string, [number, number]> | null }; result: null };
  /** The diagrams a document links to, under the headings the links sit under. */
  'project.references': { params: { projectId: string; work: string | null; path: string }; result: DiagramReference[] };
  /** Every diagram of the project, for quick open. */
  'project.diagramIndex': { params: { projectId: string }; result: DiagramIndexEntry[] };
  /** Build a page (`path`: its folder, `<work>/pages/<name>`) for a window to run: its code, or why it does not build. */
  'project.page': { params: { projectId: string; path: string }; result: PageBuild };
  /** Write a text file in the planning folder (a page's choices or data), making its folders. */
  'project.write': { params: { projectId: string; path: string; content: string }; result: null };
  /** Run one of the Atlas tools agents use (work_status, step and the rest) in the project's planning folder, for a page. */
  'project.tool': { params: { projectId: string; name: string; input: Record<string, unknown> }; result: ToolOutcome };
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
  'project.statistics': 'computer',
  'projects.statistics': 'computer',
  'projects.update': 'computer',
  'projects.subscribe': 'computer',
  'projects.unsubscribe': 'computer',
  'project.snapshot': 'computer',
  'project.work': 'computer',
  'project.document': 'computer',
  'project.diagrams': 'computer',
  'project.diagram': 'computer',
  'project.arrangement': 'computer',
  'project.arrange': 'computer',
  'project.references': 'computer',
  'project.diagramIndex': 'computer',
  'project.page': 'computer',
  'project.write': 'computer',
  'project.tool': 'computer',
  'access.state': 'access:manage',
  'access.update': 'owner',
  'access.pairingCreate': 'access:manage',
  'access.pairingRevoke': 'access:manage',
  'access.devices': 'access:manage',
  'access.deviceRevoke': 'access:manage',
};

/** Events the host pushes to a connection. */
export interface Events {
  'project.changed': OpenProjectState;
  /** The computer's projects changed (one was added, renamed, archived or moved). */
  'projects.changed': { projects: Project[] };
  /** Remote access changed: sent to connections that may manage access. */
  'access.changed': AccessState;
}
export type EventName = keyof Events;

export type ResponseMessage = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: HostErrorValue };
export interface EventMessage<E extends EventName = EventName> { event: E; data: Events[E] }

/** WebSocket close codes the host uses; a client stops reconnecting after `revoked`. */
export const closeCodes = { revoked: 4401, protocol: 4400, shuttingDown: 4503 } as const;

/** HTTP routes. */
export const routes = { host: '/api/host', pair: '/api/pair', connect: '/api/connect', files: '/api/projects/:projectId/files/*' } as const;
/** The default port for remote access, when the owner turns it on. */
export const defaultPort = 7346;
/** Pairing codes expire this long after they are created. */
export const pairingLifetime = 5 * 60 * 1000;
/** The pairing link a QR code or a copied link carries: the address and the one-time code. */
export function pairingUrl(address: string, port: number, code: string) {
  const host = address.includes(':') ? '[' + address + ']' : address;
  return `http://${host}:${port}/pair#token=${code}`;
}
