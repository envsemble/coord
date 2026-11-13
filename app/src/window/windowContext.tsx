// What a page of a project works with from its window, as two contexts the window provides: the
// project and the window's ways to show more, and what changes as the project is read again; and a
// link to a target of the project.
import { createContext, useContext, useMemo, type MouseEvent, type ReactNode } from 'react';
import { Link } from '@envsemble/envui';
import type { Place, ProjectWork, Snapshot, Target } from '../types';
import type { LiveActivity } from '../plan/agentTime';

/** `projectId`: open it in another project of the window's computer than the one shown. */
export interface OpenOptions { projectId?: string }
export type Notify = (message: string, tone?: 'info' | 'warning' | 'danger') => void;
/**
 * What a page of a project works with: its project, and the window's ways to show more. These stay
 * the same while the project is read again and listed again (WindowReading has what changes), so
 * what depends on them alone, like the reader's rendering of a document, is not drawn again.
 */
export interface WindowActions {
  /** The project, by its ID. */
  projectId: string;
  /** Its name. */
  projectName: string;
  /** Show a target of this project (or of the one given). */
  open(target: Target, options?: OpenOptions): void;
  /** Show any place: the hub, a page, or something of a project. */
  go(place: Place): void;
  /** The project of the window's computer in a sibling folder of this one's in the Atlas home, by the folder's name (its project ID), if one is listed. */
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
}
/** What changes of a project as its folder is read again and the projects are listed again. */
export interface WindowReading {
  snapshot: Snapshot;
  /** Increases whenever the project's snapshot changes (its work's statistics included); views refetch what they show. */
  revision: number;
  /** Increases whenever the project's files were read again; what is read from the files alone is refetched with it. */
  files: number;
  /** A work item as the project list sums it up (its summary among others), when it lists it. */
  listed(work: string): ProjectWork | undefined;
  /** What agents do on a work item now, as the project list says; null when nobody is on it. */
  activity(work: string): LiveActivity | null;
}
export type WindowApi = WindowActions & WindowReading;

export const WindowContext = createContext<WindowActions | null>(null);
export const ReadingContext = createContext<WindowReading | null>(null);

/** Everything a page of a project works with; it draws again whenever the project is read or listed again. */
export function useWindow(): WindowApi {
  const actions = useContext(WindowContext);
  const reading = useContext(ReadingContext);
  const value = useMemo(() => actions && reading && { ...actions, ...reading }, [actions, reading]);
  if (!value) throw new Error('useWindow outside a page of a project');
  return value;
}
/** The project and the window's ways to show more, without what changes as the project is read again. */
export function useWindowActions(): WindowActions {
  const value = useContext(WindowContext);
  if (!value) throw new Error('useWindowActions outside a page of a project');
  return value;
}

/** A link to a target; `rowTarget` makes it cover its interactive row (envUI), without being dragged away as a link. */
export function TargetLink({ target, children, className, title, id, underline = false, rowTarget = false }: { target: Target; children: ReactNode; className?: string; title?: string; id?: string; underline?: boolean; rowTarget?: boolean }) {
  const { open } = useWindowActions();
  const activate = (event: MouseEvent) => {
    event.preventDefault();
    open(target);
  };
  return <Link id={id} href="#" underline={underline} className={className} title={title} onClick={activate}
    {...(rowTarget && { 'data-row-target': '', draggable: false })}>{children}</Link>;
}
