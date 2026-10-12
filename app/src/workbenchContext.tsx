import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import type { Snapshot, Target } from './types';

export interface OpenOptions { pin?: boolean }
export interface WorkbenchApi {
  snapshot: Snapshot;
  /** Increases whenever the folder changes on disk; views refetch what they show. */
  revision: number;
  open(target: Target, options?: OpenOptions): void;
  /** Change what the active tab shows within the same item; this pins the tab. */
  retarget(target: Target): void;
  notify(message: string, tone?: 'info' | 'warning' | 'danger'): void;
  /** Set when the folder is on another computer: it only reads, and its files are not on this one. */
  remote: { hostId: string; hostName: string } | null;
}

export const WorkbenchContext = createContext<WorkbenchApi | null>(null);

export function useWorkbench(): WorkbenchApi {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error('useWorkbench outside the workbench');
  return value;
}

/** A link that opens a target in a tab; Ctrl/Cmd-click (or middle click) opens it pinned. */
export function TargetLink({ target, children, className, title, id }: { target: Target; children: ReactNode; className?: string; title?: string; id?: string }) {
  const { open } = useWorkbench();
  const activate = (event: MouseEvent) => {
    event.preventDefault();
    open(target, { pin: event.ctrlKey || event.metaKey || event.button === 1 });
  };
  return <a id={id} href="#" className={className} title={title} onClick={activate} onAuxClick={event => { if (event.button === 1) activate(event); }}>{children}</a>;
}
