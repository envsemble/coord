import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import { Link } from '@envsemble/envui';
import type { Place, ProjectWork, Snapshot, Target } from './types';

/** `project`: open it in another project of the window's computer than the one shown (by folder ID). */
export interface OpenOptions { project?: string }
export type Notify = (message: string, tone?: 'info' | 'warning' | 'danger') => void;
/** What a page of a project works with: its project, read, and the window's ways to show more. */
export interface WorkbenchApi {
  /** The project, by its folder ID. */
  project: string;
  /** Its name. */
  projectName: string;
  snapshot: Snapshot;
  /** Increases whenever the project's folder changes on disk; views refetch what they show. */
  revision: number;
  /** Show a target of this project (or of the one given). */
  open(target: Target, options?: OpenOptions): void;
  /** Show any place: the hub, a page, or something of a project. */
  go(place: Place): void;
  /** A work item as the project list sums it up (its summary among others), when it lists it. */
  listed(work: string): ProjectWork | undefined;
  /** The project of the window's computer in a sibling folder of this one's in the Atlas home, by the folder's name (its folder ID), if one is listed. */
  sibling(folder: string): string | null;
  /** Open a document, work folder or diagram of another project by its path there, once that project is read. */
  openPath(project: string, path: string, anchor: string | null): void;
  /** Change what shows within the same item: a heading, a diagram, an element. */
  retarget(target: Target): void;
  notify: Notify;
  /** Set when the project is on another computer: its files are not on this one. */
  remote: { hostId: string; hostName: string } | null;
  /** The width the reader gave a diagram's details, kept with the window's layout; null for the default. */
  inspectorWidth: number | null;
  setInspectorWidth(width: number): void;
  /** Export a work item's plan to a file. */
  exportPlan(work: string): void;
}

export const WorkbenchContext = createContext<WorkbenchApi | null>(null);

export function useWorkbench(): WorkbenchApi {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error('useWorkbench outside the workbench');
  return value;
}

/** A link to a target; `rowTarget` makes it cover its interactive row (envUI), without being dragged away as a link. */
export function TargetLink({ target, children, className, title, id, underline = false, rowTarget = false }: { target: Target; children: ReactNode; className?: string; title?: string; id?: string; underline?: boolean; rowTarget?: boolean }) {
  const { open } = useWorkbench();
  const activate = (event: MouseEvent) => {
    event.preventDefault();
    open(target);
  };
  return <Link id={id} href="#" underline={underline} className={className} title={title} onClick={activate}
    {...(rowTarget && { 'data-row-target': '', draggable: false })}>{children}</Link>;
}
