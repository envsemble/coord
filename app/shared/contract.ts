// The typed contract between the renderer and the main process. Every message the window
// can send is on `invokeChannels`; every message main can push is on `eventChannels`.
// Only types and constants live here, so the preload, main and renderer can all import it.
// The planning data itself is the Atlas host's (packages/host/src/contract.ts): main forwards the
// window's requests to the host that owns its folder, this computer's or another one's.
import type {
  AccessSettings, AccessState, Catalog, CatalogEntry, DiagramIndexEntry, ModelExplains, ModelReference, PairedDevice, PairingLink,
  SharedFolder, Snapshot, ViewEventInput,
} from '@envsemble/atlas-host/contract';
import type { DocumentContent } from '@envsemble/atlas-planning/types';

export type {
  AccessSettings, AccessState, Catalog, CatalogEntry, DiagramIndexEntry, DocumentContent, ModelExplains, ModelReference, PairedDevice, SharedFolder, Snapshot, ViewEventInput,
};

export const invokeChannels = [
  'window:info', 'window:recents',
  'planning:snapshot', 'planning:document', 'planning:models', 'planning:model', 'planning:references', 'planning:diagrams',
  'usage:view', 'ui:load', 'ui:save',
  'shell:reveal', 'shell:openExternal', 'shell:copy', 'app:command',
  'plan:export', 'plan:importChoose', 'plan:importConfirm', 'plan:importCancel',
  'remote:list', 'remote:pair', 'remote:folders', 'remote:open', 'remote:forget',
  'access:state', 'access:update', 'access:chooseFolder', 'access:pairingCreate', 'access:pairingRevoke', 'access:devices', 'access:deviceRevoke',
] as const;
export type InvokeChannel = typeof invokeChannels[number];

export const eventChannels = ['planning:changed', 'menu:command', 'access:changed'] as const;
export type EventChannel = typeof eventChannels[number];

/** Commands the renderer may ask main to run; each one acts on the calling window only. */
export const appCommands = ['openFolder', 'openRecent', 'newWindow', 'locate', 'closeWindow', 'openLogs', 'about'] as const;
export type AppCommand = typeof appCommands[number];

/** Menu items that need the renderer (focus, tabs, dialogs drawn in the window). */
export const menuCommands = ['toggleSidebar', 'showExplorer', 'quickOpen', 'closeTab', 'openWorkList', 'openActivity', 'openStatistics', 'importPlan', 'exportPlan', 'connectRemote', 'remoteAccess'] as const;
export type MenuCommand = typeof menuCommands[number];

export type ErrorCode = 'invalid-argument' | 'not-found' | 'forbidden' | 'unauthorized' | 'unavailable' | 'no-folder' | 'folder-missing' | 'folder-invalid' | 'cancelled' | 'internal';
export interface AtlasErrorValue { code: ErrorCode; message: string }
/** Errors cross the process boundary as values, never as thrown Error objects. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AtlasErrorValue };

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
  /** Set when the folder is on another computer; such a window only reads. */
  remote: { hostId: string; hostName: string } | null;
}
/** `notice`: the folder is readable but cannot be watched, or its computer is not reachable right now. */
export interface FolderChange { revision: number; status: FolderStatus; error: string | null; notice: string | null }
export interface RecentFolder { path: string; name: string; parent: string; workItems: number | null; available: boolean }

/** Another computer this app paired with. */
export interface RemoteHost { hostId: string; name: string; origin: string; pairedAt: string; status: 'connecting' | 'connected' | 'offline' | 'revoked' | 'mismatch' | 'incompatible' | 'closed'; detail: string | null }
/** A pairing link as the window shows it: with its QR code (an SVG image). */
export interface PairingLinkView extends PairingLink { qrSvg: string | null }

export type WorkSection = 'plan' | 'ledger' | 'diagrams';
export type ViewName = 'work' | 'activity' | 'statistics';
export type Target =
  | { kind: 'view'; view: ViewName }
  | { kind: 'work'; work: string; section?: WorkSection | null; diagram?: string | null; element?: string | null; anchor?: string | null }
  | { kind: 'file'; path: string; anchor?: string | null };
export interface TabState { id: string; target: Target; preview: boolean }
export interface UiState {
  sidebar: { visible: boolean; width: number; expanded: string[] };
  tabs: { items: TabState[]; active: string | null };
}
export const defaultUiState: UiState = { sidebar: { visible: true, width: 280, expanded: [] }, tabs: { items: [], active: null } };
export const limits = { path: 2048, tabs: 40, expanded: 2000, sidebarMin: 170, sidebarMax: 640 } as const;

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
 */
export interface AtlasBridge {
  info(): Promise<Result<WindowInfo>>;
  recents(): Promise<Result<RecentFolder[]>>;
  snapshot(): Promise<Result<Snapshot>>;
  document(path: string): Promise<Result<DocumentContent>>;
  models(work: string): Promise<Result<Catalog>>;
  model(work: string, handle: string): Promise<Result<unknown>>;
  references(work: string | null, path: string): Promise<Result<ModelReference[]>>;
  diagrams(): Promise<Result<DiagramIndexEntry[]>>;
  recordView(event: ViewEventInput): Promise<Result<void>>;
  loadUi(): Promise<Result<UiState>>;
  saveUi(state: UiState): Promise<Result<void>>;
  reveal(path: string): Promise<Result<void>>;
  openExternal(url: string): Promise<Result<void>>;
  copy(text: string): Promise<Result<void>>;
  command(command: AppCommand, argument?: string): Promise<Result<void>>;
  exportPlan(work: string): Promise<Result<ExportResult | null>>;
  chooseImport(): Promise<Result<ImportPreview | null>>;
  confirmImport(token: string): Promise<Result<ImportResult>>;
  cancelImport(token: string): Promise<Result<void>>;
  remoteHosts(): Promise<Result<RemoteHost[]>>;
  pairRemote(link: string, code: string | null): Promise<Result<{ host: RemoteHost; folders: SharedFolder[] }>>;
  remoteFolders(hostId: string): Promise<Result<SharedFolder[]>>;
  openRemote(hostId: string, folderId: string): Promise<Result<void>>;
  forgetRemote(hostId: string): Promise<Result<void>>;
  accessState(): Promise<Result<AccessState>>;
  updateAccess(settings: AccessSettings): Promise<Result<AccessState>>;
  chooseSharedFolder(): Promise<Result<string | null>>;
  createPairing(address: string | null): Promise<Result<PairingLinkView>>;
  revokePairing(code: string): Promise<Result<void>>;
  devices(): Promise<Result<PairedDevice[]>>;
  revokeDevice(deviceId: string): Promise<Result<void>>;
  onChanged(listener: (change: FolderChange) => void): () => void;
  onMenu(listener: (command: MenuCommand) => void): () => void;
  onAccessChanged(listener: (state: AccessState) => void): () => void;
}
