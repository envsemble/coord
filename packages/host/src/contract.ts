// The Atlas host protocol: what crosses the connection between the host (which owns the planning
// folders) and its clients (the desktop app's windows, another computer's Atlas, later a phone).
// Only types and constants live here, so every client can import it. Every method declares the
// scope it requires; the host checks it before any handler runs.
import type { DocumentContent, PlanImportResult, PlanningIndex, Usage } from '@envsemble/atlas-planning';
import type { Provenance } from '@envsemble/atlas-planning/provenance';

/** Raised when the protocol changes incompatibly; a client refuses a host that speaks another version. */
export const protocolVersion = 3;

/**
 * Every paired device belongs to the person who owns this computer, so pairing grants the whole
 * computer; only managing who else may pair is a separate grant.
 * - `computer`: what the Atlas app can do on this computer: browse its folders, open any planning
 *   folder, read it, import and export plans, and count document use. Every paired device has it.
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
/**
 * One planning folder in the computer's folder list: every folder opened on this computer, from any
 * device or the command line, newest first. Every device sees the same list.
 */
export interface ComputerFolder {
  folderId: string; path: string; name: string;
  /** When anyone last opened it; null for one carried over from before the list existed. */
  openedAt: string | null;
  /** False when the folder is gone (moved or deleted); it stays listed, marked missing, until removed. */
  available: boolean;
  workItems: number | null;
}
/** A folder on the computer, as the folder browser shows it. */
export interface BrowseEntry { name: string; path: string; planning: boolean }
/** A folder's subfolders, or, for a null path, where browsing starts (the home folder and the drives). */
export interface BrowseResult { path: string | null; parent: string | null; planning: boolean; folders: BrowseEntry[]; truncated: boolean }

export interface Snapshot extends PlanningIndex {
  usage: Usage; usageByRepository: Record<string, Usage>; collectionError: string | null;
  /** Every visible folder below the planning root (POSIX-relative), including empty ones. */
  folders: string[];
}
export interface ModelExplains { path: string | null; reference: string; section: string | null; title: string | null }
export interface CatalogEntry {
  handle: string; title: string; revision: string; profile: string; state: string; capturedAt: string | null; coverage: string | null; imported: boolean;
  provenance: Provenance; explains: ModelExplains[];
  /**
   * Models laid out together share it: a capture and the proposals over its snapshot. `folder.model`
   * answers for one of them with the others' payloads too (as `siblings`). Absent from older hosts.
   */
  family?: string | null;
}
export interface Catalog { models: CatalogEntry[]; issues: string[]; invalidHandles: string[] }
export interface ModelReference { handle: string; workId: string; title: string; elementId: string | null; elementName: string | null; label: string; section: string | null; provenance: Provenance }
export interface DiagramIndexEntry { workId: string; handle: string; title: string; provenance: Provenance }
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
  'folders.list': { params: Record<string, never>; result: ComputerFolder[] };
  /** `remember: false` reopens a folder without moving it on the folder list (a reconnection, a restored window). */
  'folders.open': { params: { path: string; remember?: boolean }; result: FolderState };
  'folders.remove': { params: { folderId: string }; result: null };
  'folders.browse': { params: { path: string | null }; result: BrowseResult };
  'folders.subscribe': { params: { folderId: string }; result: FolderState };
  'folders.unsubscribe': { params: { folderId: string }; result: null };
  'folder.snapshot': { params: { folderId: string }; result: Snapshot };
  'folder.document': { params: { folderId: string; path: string }; result: DocumentContent };
  'folder.models': { params: { folderId: string; work: string }; result: Catalog };
  'folder.model': { params: { folderId: string; work: string; handle: string }; result: unknown };
  'folder.references': { params: { folderId: string; work: string | null; path: string }; result: ModelReference[] };
  'folder.diagrams': { params: { folderId: string }; result: DiagramIndexEntry[] };
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
  'folders.list': 'computer',
  'folders.open': 'computer',
  'folders.remove': 'computer',
  'folders.browse': 'computer',
  'folders.subscribe': 'computer',
  'folders.unsubscribe': 'computer',
  'folder.snapshot': 'computer',
  'folder.document': 'computer',
  'folder.models': 'computer',
  'folder.model': 'computer',
  'folder.references': 'computer',
  'folder.diagrams': 'computer',
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
  /** The computer's folder list changed (a folder was opened or removed). */
  'folders.changed': { folders: ComputerFolder[] };
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
