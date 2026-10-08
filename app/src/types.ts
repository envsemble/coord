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
}
export interface WorkProgress { current: string | null; next: string[]; blocked: string | null; updated: string | null }
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
export interface Snapshot {
  root: string; loadedAt: string; caseSensitivePaths: boolean; normalizationInsensitivePaths: boolean; repositories: Repository[]; work: Work[];
  documents: Document[]; history: HistoryEntry[]; issues: Issue[];
  gitAvailable: boolean; usage: Usage; usageByRepository: Record<string, Usage>; collectionError: string | null;
}
export interface DocumentContent {
  path: string; title: string; body: string; format: string;
  metadata: Record<string, unknown> | null; contentHash: string;
}
