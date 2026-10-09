import type { PlanningIndex, Usage } from '@atlas/planning/types';

export type { Document, DocumentContent, DocumentUsage, HistoryEntry, Issue, Repository, Usage, Work, WorkProgress } from '@atlas/planning/types';
export interface Snapshot extends PlanningIndex {
  usage: Usage; usageByRepository: Record<string, Usage>; collectionError: string | null;
}
export interface PlanningRootInfo { path: string; name: string; parent: string; workItems: number | null; error?: string }
export interface PlanningRoots { current: PlanningRootInfo; recent: PlanningRootInfo[]; discovered: PlanningRootInfo[] }
