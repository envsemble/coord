import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import { Link } from '@envsemble/envui';
import type { Snapshot, Target } from './types';

export interface OpenOptions { pin?: boolean }
export type Notify = (message: string, tone?: 'info' | 'warning' | 'danger') => void;
export interface WorkbenchApi {
  snapshot: Snapshot;
  /** Increases whenever the folder changes on disk; views refetch what they show. */
  revision: number;
  open(target: Target, options?: OpenOptions): void;
  /** Change what the active tab shows within the same item; this pins the tab. */
  retarget(target: Target): void;
  notify: Notify;
  /** Set when the folder is on another computer: it only reads, and its files are not on this one. */
  remote: { hostId: string; hostName: string } | null;
  /** The width the reader gave a diagram's details in this folder, kept with its layout; null for the default. */
  inspectorWidth: number | null;
  setInspectorWidth(width: number): void;
}

export const WorkbenchContext = createContext<WorkbenchApi | null>(null);

export function useWorkbench(): WorkbenchApi {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error('useWorkbench outside the workbench');
  return value;
}

/** A link that opens a target in a tab; Ctrl/Cmd-click (or middle click) opens it pinned. */
/** A link to a target; `rowTarget` makes it cover its interactive row (envUI), without being dragged away as a link. */
export function TargetLink({ target, children, className, title, id, underline = false, rowTarget = false }: { target: Target; children: ReactNode; className?: string; title?: string; id?: string; underline?: boolean; rowTarget?: boolean }) {
  const { open } = useWorkbench();
  const activate = (event: MouseEvent) => {
    event.preventDefault();
    open(target, { pin: event.ctrlKey || event.metaKey || event.button === 1 });
  };
  return <Link id={id} href="#" underline={underline} className={className} title={title} onClick={activate} onAuxClick={event => { if (event.button === 1) activate(event); }}
    {...(rowTarget && { 'data-row-target': '', draggable: false })}>{children}</Link>;
}
