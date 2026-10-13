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
  /** Agent reports and plan revisions; absent where they were not read. */
  statistics?: WorkStatistics;
}
/** Tokens by kind: new input, input read from the prompt cache, input written to it, and output. */
export interface TokenKinds { input: number; cacheRead: number; cacheWrite: number; output: number }
/** One model's share of a work item: the reports naming it and the agent time and tokens it spent. */
export interface ModelUsage {
  model: string; reports: number; sessions: number;
  /** Measured busy time, plus the time between its unmeasured reports; overlaps other models' time while they work at once. */
  agentMs: number;
  tokens: number | null;
  /** Its measured tokens by kind; null when no session log measured it. */
  tokenKinds: TokenKinds | null;
}
/**
 * What agents reported with `atlas work report` and how often the main plan changed. Agent time and
 * tokens are measured from the agent's session log where the report could read it; otherwise agent
 * time is estimated from the time between a session's reports, and tokens are self-reported.
 */
export interface WorkStatistics {
  reports: number;
  /** Lines of the statistics file that are not valid reports. */
  invalid: number;
  /** Most agent time first. */
  models: ModelUsage[];
  /** The model that did most of the work: the most agent time (then tokens, then reports). */
  primaryModel: string | null;
  tokens: number | null;
  /** The measured tokens by kind; null when no report was measured. Self-reported tokens have no kinds. */
  tokenKinds: TokenKinds | null;
  /** Agent time: measured plus estimated. */
  agentMs: number;
  /** Agent time measured from session logs. */
  measuredMs: number;
  /** Agent time estimated from the time between reports, for intervals no session log measured. */
  estimatedMs: number;
  /** Reports whose interval was measured from the session log. */
  measuredReports: number;
  firstReport: string | null;
  lastReport: string | null;
  /** Commits that changed the main plan after it was added, up to completion or now; null without Git history. */
  planRevisions: number | null;
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
