import type { ReactNode } from 'react';
import { BlockedIcon, CircleSlashIcon, IssueClosedIcon, IssueDraftIcon, IssueOpenedIcon, QuestionIcon, SkipIcon } from './icons';
import type { WorkStatus } from './status';
import type { Provenance } from '@envsemble/atlas-planning/provenance';

export function Label({ children, tone = 'default', title }: { children: ReactNode; tone?: string; title?: string }) {
  return <span className={'label label-' + tone} title={title}>{children}</span>;
}
export function Counter({ children }: { children: ReactNode }) { return <span className="counter-label">{children}</span>; }

export function StatusIcon({ status, size = 16 }: { status: WorkStatus; size?: number }) {
  const props = { size, className: 'status-icon status-' + status.tone, 'aria-label': status.label };
  switch (status.key) {
    case 'complete': return <IssueClosedIcon {...props} />;
    case 'blocked': return <BlockedIcon {...props} />;
    case 'draft': return <IssueDraftIcon {...props} />;
    case 'superseded': return <SkipIcon {...props} />;
    case 'abandoned': return <CircleSlashIcon {...props} />;
    case 'unknown': return <QuestionIcon {...props} />;
    default: return <IssueOpenedIcon {...props} />;
  }
}
/** GitHub-style state pill: filled for open/done/blocked, outlined otherwise. */
export function StateLabel({ status }: { status: WorkStatus }) {
  return <span className={'state-label state-' + status.tone}><StatusIcon status={status} size={14} />{status.label}</span>;
}
export function ProvenanceLabel({ provenance, title }: { provenance: Provenance; title?: string }) {
  if (!provenance.label) return null;
  return <Label tone={provenance.tone} title={title ?? (provenance.detail || undefined)}>{provenance.label}</Label>;
}

export function Blankslate({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="blankslate">{icon}<h3>{title}</h3>{children != null && <p>{children}</p>}{action}</div>;
}
export function Spinner({ size = 16 }: { size?: number }) {
  return <svg className="spinner" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" /><path d="M15 8a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
