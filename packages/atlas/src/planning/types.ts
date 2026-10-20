// Planning-folder records shared by the reader, the command and the app.
export interface Document {
  path: string; name: string; title: string; size: number; modified: string;
  key: string; workId: string | null; category: string; format: string;
}
export interface Work {
  id: string; path: string; currentPlan: string | null;
  title: string; location: string; design: string; implementation: string;
  created: string | null; updated: string | null; accepted: string | null;
  completed: string | null; durationDays: number | null; documents: Document[];
  ledger?: string | null; progress?: WorkProgress | null;
  /** Number of diagram files (`.puml`) in this work folder. */
  diagrams?: number;
  /** Agent reports and plan revisions; absent where they were not read. */
  statistics?: WorkStatistics;
  /**
   * The work items this one continues (its plan's `continues`), and those that continue it (their
   * plans' `continues` naming it, in any project of the home): handoffs, oldest work first.
   */
  continues?: HandoffLink[]; continuedIn?: HandoffLink[];
}
/**
 * A work item at the other end of a handoff: its project (`projectId`, the project's ID, its own
 * included; null only when no project of the home has that planning folder, or in a plan export, which
 * opens no other plan; `project` its planning folder's name in the home, `projectName` its name), the
 * work item, and its title, state and outcome as the hub has them (null when the reference names no
 * work item).
 */
export interface HandoffLink {
  projectId: string | null; project: string; projectName: string; workId: string;
  title: string | null; state: 'blocked' | 'implementing' | 'draft' | 'other' | 'closed' | null; outcome: 'complete' | 'superseded' | 'abandoned' | null;
}
/** One agent's working time on a work item: a session's own (subagent null) or one of its subagents'. */
export interface AgentShare { session: string | null; subagent: string | null; model: string | null; effort: string | null; agentMs: number }
/** Tokens by kind: new input, input read from the prompt cache, input written to it, and output. */
export interface TokenKinds { input: number; cacheRead: number; cacheWrite: number; output: number }
/** One model's share of a work item: the reports naming it and the agent time and tokens it spent. */
export interface ModelShare {
  model: string; reports: number; sessions: number;
  /** Measured busy time, plus the time between its unmeasured reports; overlaps other models' time while they work at once. */
  agentMs: number;
  tokens: number | null;
  /** Its measured tokens by kind; null when no session log measured it. */
  tokenKinds: TokenKinds | null;
  /** Its time and tokens by reasoning effort, most time first; empty when no log recorded an effort. */
  efforts: { effort: string; agentMs: number; tokens: number | null }[];
}
/**
 * A work item's stage when a report was made: planning until its plan's design is accepted, and
 * again while a session amends an accepted plan; implementation otherwise.
 */
export type WorkStage = 'planning' | 'implementation';
/** The agent time and tokens of the reports of one stage, measured and estimated as for the work item. */
export interface StageStatistics {
  reports: number; agentMs: number;
  tokens: number | null;
  /** Its measured tokens by kind; null when no report of the stage was measured. */
  tokenKinds: TokenKinds | null;
}
/**
 * What agents reported with `atlas work report` and how often the main plan changed. Agent time and
 * tokens are measured from the agent's session log where the report could read it; otherwise agent
 * time is estimated from the time between a session's reports, and tokens are self-reported.
 */
export interface WorkStatistics {
  reports: number;
  /** Most agent time first. */
  models: ModelShare[];
  /** The model that did most of the work: the most agent time (then tokens, then reports). */
  primaryModel: string | null;
  /** The reasoning effort the primary model worked at most; null when no log recorded one. */
  primaryEffort: string | null;
  tokens: number | null;
  /** The measured tokens by kind; null when no report was measured. Self-reported tokens have no kinds. */
  tokenKinds: TokenKinds | null;
  /**
   * Agent time: measured plus estimated, every agent added up: each session's own working time and
   * each subagent's in full, also while they work at once.
   */
  agentMs: number;
  /**
   * The time at least one agent was working: the union of every report's working intervals across
   * sessions and subagents; reports without intervals, such as those estimated from the time
   * between reports, add their time as is.
   */
  activeMs: number;
  /** Of `activeMs`, the time of reports without intervals, added up rather than merged. */
  unmergedMs: number;
  /** Each agent's working time: sessions (`subagent` null) and their subagents, most time first. */
  agents: AgentShare[];
  /** Agent time measured from session logs. */
  measuredMs: number;
  /** Agent time estimated from the time between reports, for intervals no session log measured. */
  estimatedMs: number;
  /** Reports whose interval was measured from the session log. */
  measuredReports: number;
  /** Agent time and tokens by stage. */
  stages: Record<WorkStage, StageStatistics>;
  /** Subagents measured at work: how many (each once), and their busy time added up, each its own. */
  subagents: { count: number; agentMs: number };
  firstReport: string | null;
  lastReport: string | null;
  /** Commits that changed the main plan after it was added, up to completion or now; null without Git history. */
  planRevisions: number | null;
}
export type LedgerStepStatus = 'todo' | 'doing' | 'done';
/**
 * A ledger step. `phase` is `planning` for the steps of designing the work, which the ledger has from
 * the work's creation, and `proposed` for the implementation steps a plan proposes before the work
 * starts (todo, not counted as progress); a step without it is an implementation step.
 */
export interface LedgerStep { title: string; status: LedgerStepStatus; phase?: 'planning' | 'proposed' }
/** The ledger status header (schema version 2): the agreed steps, `blocked` and the date it changed. */
export interface WorkProgress {
  version: 2;
  /** The steps being worked on, joined. */
  current: string | null;
  /** The steps still to do. */
  next: string[];
  blocked: string | null; updated: string | null;
  /** In the ledger's order. */
  steps: LedgerStep[];
}
export interface StepCounts { total: number; done: number; doing: number; todo: number; remaining: number }
export interface HistoryEntry { id: string; date: string; title: string; files: string[]; workIds: string[] }
export interface Issue { level: 'warning' | 'error'; message: string; workId?: string }
/** What the reader returns for one planning folder. */
export interface PlanningIndex {
  root: string;
  /** The project's name: the registry's `name`, else the folder's own name. */
  name: string;
  loadedAt: string; caseSensitivePaths: boolean; normalizationInsensitivePaths: boolean; work: Work[];
  documents: Document[]; history: HistoryEntry[]; issues: Issue[]; gitAvailable: boolean;
}
export interface DocumentContent {
  path: string; title: string; body: string; format: string;
  metadata: Record<string, unknown> | null; contentHash: string;
}
