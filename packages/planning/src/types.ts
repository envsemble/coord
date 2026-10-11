// Planning-folder records shared by the reader, the command and the app.
export interface Repository { id: string; name: string; path?: string }
export interface Document {
  path: string; name: string; title: string; size: number; modified: string;
  key: string; workId: string | null; repositories: string[]; category: string; format: string;
}
export interface Work {
  id: string; path: string; repositories: string[]; currentPlan: string | null;
  title: string; location: string; design: string; implementation: string;
  created: string | null; updated: string | null; accepted: string | null;
  completed: string | null; durationDays: number | null; documents: Document[];
  ledger?: string | null; progress?: WorkProgress | null;
  /** Number of Atlas models in this work folder's `.atlas/models`. */
  diagrams?: number;
}
export type LedgerStepStatus = 'todo' | 'doing' | 'done';
export interface LedgerStep { title: string; status: LedgerStepStatus }
/** The ledger status header. Version 2 lists the agreed steps; version 1 (legacy) has only current and next. */
export interface WorkProgress {
  version: 1 | 2;
  /** Version 2: the steps being worked on, joined; version 1: the reported current focus. */
  current: string | null;
  /** Version 2: the steps still to do; version 1: the reported next steps. */
  next: string[];
  blocked: string | null; updated: string | null;
  /** Version 2 only, in the ledger's order; null for a version-1 header. */
  steps: LedgerStep[] | null;
}
export interface StepCounts { total: number; done: number; doing: number; todo: number; remaining: number }
export interface HistoryEntry { id: string; date: string; title: string; files: string[]; workIds: string[]; repositories: string[] }
export interface Issue { level: 'warning' | 'error'; message: string; workId?: string }
export interface DocumentUsage {
  key: string; path: string; views: number; sessions: number; lastViewed: string | null;
  reports: number; tasks: number; unassigned: number; lastConsulted: string | null;
}
export interface Usage {
  dashboardSince: string | null; agentSince: string | null;
  views: number; documentsViewed: number; sessions: number;
  reports: number; documentsConsulted: number; tasks: number; unassigned: number; failures: number;
  documents: DocumentUsage[];
}
/** What the reader returns for one planning folder, before usage statistics are attached. */
export interface PlanningIndex {
  root: string; loadedAt: string; caseSensitivePaths: boolean; normalizationInsensitivePaths: boolean; repositories: Repository[]; work: Work[];
  documents: Document[]; history: HistoryEntry[]; issues: Issue[]; gitAvailable: boolean;
}
export interface DocumentContent {
  path: string; title: string; body: string; format: string;
  metadata: Record<string, unknown> | null; contentHash: string;
}
