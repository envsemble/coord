// The Atlas host protocol: what crosses the connection between the host (which owns the planning
// folders) and its clients (the desktop app's windows, another computer's Atlas, later a phone).
// Only types and constants live here, so every client can import it. Every method declares the
// scope it requires; the host checks it before any handler runs.
import type { DocumentContent, PlanImportResult, PlanningIndex, Usage } from '@envsemble/atlas-planning';
import type { Provenance } from '@envsemble/atlas-planning/provenance';

/** Raised when the protocol changes incompatibly; a client refuses a host that speaks another version. */
export const protocolVersion = 1;

/**
 * - `planning:read`: read shared planning folders (paired devices).
 * - `owner`: everything, including opening any local folder, importing, and managing access. Only
 *   the desktop app on the same computer holds it, through a token that never leaves memory.
 */
export type Scope = 'planning:read' | 'owner';

export type ErrorCode = 'invalid-argument' | 'not-found' | 'forbidden' | 'unauthorized' | 'unavailable' | 'folder-missing' | 'folder-invalid' | 'cancelled' | 'internal';
export interface HostErrorValue { code: ErrorCode; message: string }

/** Public, unauthenticated: lets a client check it reached the host it paired with before it sends a credential. */
export interface HostDescriptor { protocol: number; hostId: string; name: string; version: string }

export type FolderStatus = 'loading' | 'ready' | 'missing' | 'invalid';
export interface FolderState { folderId: string; name: string; status: FolderStatus; error: string | null; notice: string | null; revision: number }
export interface SharedFolder { folderId: string; name: string }

export interface Snapshot extends PlanningIndex {
  usage: Usage; usageByRepository: Record<string, Usage>; collectionError: string | null;
  /** Every visible folder below the planning root (POSIX-relative), including empty ones. */
  folders: string[];
}
export interface ModelExplains { path: string | null; reference: string; section: string | null; title: string | null }
export interface CatalogEntry {
  handle: string; title: string; revision: string; profile: string; state: string; capturedAt: string | null; coverage: string | null; imported: boolean;
  provenance: Provenance; explains: ModelExplains[];
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
export interface AccessSettings { network: NetworkSettings; sharedFolders: string[] }
export interface AccessState {
  settings: AccessSettings; status: NetworkStatus; addresses: HostAddress[];
  /** Another process (`atlas serve`) holds remote access on this computer; settings are read-only here. */
  managedBy: string | null;
  /** Why remote access cannot be used at all (its settings cannot be read); null when it can. */
  problem: string | null;
}
export interface PairingLink { code: string; expiresAt: string; url: string | null; address: string | null; port: number | null }
export interface PairedDevice { deviceId: string; name: string; platform: string; scopes: Scope[]; pairedAt: string; lastSeenAt: string | null; connected: boolean }
export interface PairRequest { code: string; device: { name: string; platform: string } }
export interface PairResponse { hostId: string; name: string; deviceId: string; token: string; scopes: Scope[] }
export interface SessionInfo { hostId: string; name: string; version: string; scopes: Scope[]; deviceId: string | null }

/** Every request: its parameters, its result, and the scope it needs. */
export interface Methods {
  'host.session': { params: Record<string, never>; result: SessionInfo };
  'folders.shared': { params: Record<string, never>; result: SharedFolder[] };
  'folders.open': { params: { path: string }; result: FolderState };
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
  'access.pairingCreate': { params: { address: string | null }; result: PairingLink };
  'access.pairingRevoke': { params: { code: string }; result: null };
  'access.devices': { params: Record<string, never>; result: PairedDevice[] };
  'access.deviceRevoke': { params: { deviceId: string }; result: null };
}
export type MethodName = keyof Methods;

export const methodScopes: { readonly [M in MethodName]: Scope } = {
  'host.session': 'planning:read',
  'folders.shared': 'planning:read',
  'folders.open': 'owner',
  'folders.subscribe': 'planning:read',
  'folders.unsubscribe': 'planning:read',
  'folder.snapshot': 'planning:read',
  'folder.document': 'planning:read',
  'folder.models': 'planning:read',
  'folder.model': 'planning:read',
  'folder.references': 'planning:read',
  'folder.diagrams': 'planning:read',
  'folder.recordView': 'owner',
  'plan.exportPrepare': 'planning:read',
  'plan.exportDrop': 'planning:read',
  'plan.importRead': 'owner',
  'plan.importConfirm': 'owner',
  'plan.importDrop': 'owner',
  'access.state': 'owner',
  'access.update': 'owner',
  'access.pairingCreate': 'owner',
  'access.pairingRevoke': 'owner',
  'access.devices': 'owner',
  'access.deviceRevoke': 'owner',
};

/** Events the host pushes to a connection. */
export interface Events {
  'folder.changed': FolderState;
  'access.changed': AccessState;
}
export type EventName = keyof Events;

export interface RequestMessage<M extends MethodName = MethodName> { id: number; method: M; params: Methods[M]['params'] }
export type ResponseMessage = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: HostErrorValue };
export interface EventMessage<E extends EventName = EventName> { event: E; data: Events[E] }

/** WebSocket close codes the host uses; a client stops reconnecting after `revoked`. */
export const closeCodes = { revoked: 4401, protocol: 4400, shuttingDown: 4503 } as const;

/** HTTP routes. */
export const routes = { host: '/api/host', pair: '/api/pair', connect: '/api/connect', files: '/api/folders/:folderId/files/*', exports: '/api/exports/:token' } as const;
/** The default port for remote access, when the owner turns it on. */
export const defaultPort = 7346;
/** Pairing codes expire this long after they are created. */
export const pairingLifetime = 5 * 60 * 1000;
/** The pairing link a QR code or a copied link carries: the address and the one-time code. */
export function pairingUrl(address: string, port: number, code: string) {
  const host = address.includes(':') ? '[' + address + ']' : address;
  return `http://${host}:${port}/pair#token=${code}`;
}
