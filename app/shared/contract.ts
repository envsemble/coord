// The typed contract between the renderer and the main process. Every message the window
// can send is on `invokeChannels`; every message main can push is on `eventChannels`.
// Only types and constants live here, so the preload, main and renderer can all import it.
import type { DocumentContent, PlanningIndex, Usage } from '@envsemble/atlas-planning/types';
import type { Provenance } from '@envsemble/atlas-planning/provenance';

export const invokeChannels = [
  'window:info', 'window:recents',
  'planning:snapshot', 'planning:document', 'planning:models', 'planning:model', 'planning:references', 'planning:diagrams',
  'usage:view', 'ui:load', 'ui:save',
  'shell:reveal', 'shell:openExternal', 'app:command',
  'plan:export', 'plan:importChoose', 'plan:importConfirm', 'plan:importCancel',
] as const;
export type InvokeChannel = typeof invokeChannels[number];

export const eventChannels = ['planning:changed', 'menu:command'] as const;
export type EventChannel = typeof eventChannels[number];

/** Commands the renderer may ask main to run; each one acts on the calling window only. */
export const appCommands = ['openFolder', 'openRecent', 'newWindow', 'locate', 'closeWindow', 'openLogs', 'about'] as const;
export type AppCommand = typeof appCommands[number];

/** Menu items that need the renderer (focus, tabs, dialogs drawn in the window). */
export const menuCommands = ['toggleSidebar', 'showExplorer', 'quickOpen', 'closeTab', 'openWorkList', 'openActivity', 'openStatistics', 'importPlan', 'exportPlan'] as const;
export type MenuCommand = typeof menuCommands[number];

export type ErrorCode = 'invalid-argument' | 'not-found' | 'forbidden' | 'unavailable' | 'no-folder' | 'folder-missing' | 'folder-invalid' | 'cancelled' | 'internal';
export interface AtlasErrorValue { code: ErrorCode; message: string }
/** Errors cross the process boundary as values, never as thrown Error objects. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AtlasErrorValue };

export type FolderStatus = 'loading' | 'ready' | 'missing' | 'invalid';
export interface WindowInfo {
  folder: { root: string; name: string } | null;
  status: FolderStatus | null;
  /** Set when the folder became unreadable; a ready window then shows its last good view. */
  error: string | null;
  revision: number;
  version: string;
  platform: string;
}
export interface FolderChange { revision: number; status: FolderStatus; error: string | null }
export interface RecentFolder { path: string; name: string; parent: string; workItems: number | null; available: boolean }

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

export type { DocumentContent };

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
  command(command: AppCommand, argument?: string): Promise<Result<void>>;
  exportPlan(work: string): Promise<Result<ExportResult | null>>;
  chooseImport(): Promise<Result<ImportPreview | null>>;
  confirmImport(token: string): Promise<Result<ImportResult>>;
  cancelImport(token: string): Promise<Result<void>>;
  onChanged(listener: (change: FolderChange) => void): () => void;
  onMenu(listener: (command: MenuCommand) => void): () => void;
}
