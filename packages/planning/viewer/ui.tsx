// Small presentational pieces matching the app's Primer-style components (app/src/ui.tsx, status.ts, format.ts).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BlockedIcon, CheckCircleFillIcon, CircleIcon, CircleSlashIcon, DotFillIcon, IssueClosedIcon, IssueDraftIcon, IssueOpenedIcon, QuestionIcon, SkipIcon } from '@primer/octicons-react';
import { stepCounts, stepSummary } from '../src/ledger.ts';
import type { LedgerStep, LedgerStepStatus } from '../src/types.ts';
import type { Provenance } from '../src/provenance.ts';
import type { PlanView } from './data.ts';

export function Label({ children, tone = 'default', title }: { children: ReactNode; tone?: string; title?: string }) {
  return <span className={'label label-' + tone} title={title}>{children}</span>;
}
export function Counter({ children }: { children: ReactNode }) { return <span className="counter-label">{children}</span>; }
export function ProvenanceLabel({ provenance }: { provenance: Provenance }) {
  if (!provenance.label) return null;
  return <Label tone={provenance.tone} title={provenance.detail || undefined}>{provenance.label}</Label>;
}
export function Blankslate({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="blankslate">{icon}<h3>{title}</h3>{children != null && <p>{children}</p>}{action}</div>;
}

type Status = { key: string; label: string; tone: 'open' | 'done' | 'danger' | 'attention' | 'muted' };
export function workStatus(work: PlanView['work']): Status {
  if (work.design === 'superseded') return { key: 'superseded', label: 'Superseded', tone: 'muted' };
  if (work.design === 'abandoned') return { key: 'abandoned', label: 'Abandoned', tone: 'muted' };
  if (work.implementation === 'complete') return { key: 'complete', label: 'Complete', tone: 'done' };
  if (work.progress?.blocked) return { key: 'blocked', label: 'Blocked', tone: 'danger' };
  if (work.implementation === 'in_progress') return { key: 'in_progress', label: 'In progress', tone: 'open' };
  if (work.implementation === 'partial') return { key: 'partial', label: 'Partially done', tone: 'attention' };
  if (work.design === 'draft') return { key: 'draft', label: 'Draft plan', tone: 'muted' };
  if (work.implementation === 'not_started') return { key: 'not_started', label: 'Not started', tone: 'muted' };
  return { key: 'unknown', label: 'Status unknown', tone: 'muted' };
}
export function StateLabel({ status }: { status: Status }) {
  const props = { size: 14, className: 'status-icon status-' + status.tone };
  const icon = status.key === 'complete' ? <IssueClosedIcon {...props} /> : status.key === 'blocked' ? <BlockedIcon {...props} />
    : status.key === 'draft' ? <IssueDraftIcon {...props} /> : status.key === 'superseded' ? <SkipIcon {...props} />
    : status.key === 'abandoned' ? <CircleSlashIcon {...props} /> : status.key === 'unknown' ? <QuestionIcon {...props} /> : <IssueOpenedIcon {...props} />;
  return <span className={'state-label state-' + status.tone}>{icon}{status.label}</span>;
}

function parse(value: string) { return new Date(value.length === 10 ? value + 'T12:00:00' : value); }
export function absoluteDate(value: string | null | undefined) {
  if (!value) return '';
  const date = parse(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, value.length === 10 ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
export function bytes(value: number) { return value < 1024 ? value + ' B' : value < 1048576 ? Math.round(value / 1024) + ' KB' : (value / 1048576).toFixed(1) + ' MB'; }
export function workNumber(id: string) { return id.replace('work-', '#'); }

export function Dropdown({ label, button, children, buttonClassName = 'btn', className = '' }: { label: string; button: ReactNode; children: (close: () => void) => ReactNode; buttonClassName?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key, true); };
  }, [open]);
  return <div className={'dropdown ' + className} ref={root}>
    <button ref={trigger} type="button" className={buttonClassName} aria-haspopup="dialog" aria-expanded={open} aria-label={label} onClick={() => setOpen(value => !value)}>{button}</button>
    {open && <div className="overlay overlay-start" role="dialog" aria-label={label}>{children(() => { setOpen(false); trigger.current?.focus(); })}</div>}
  </div>;
}

/** The ledger's agreed steps, as the app shows them (app/src/LedgerProgress.tsx). */
const stepLabels: Record<LedgerStepStatus, string> = { done: 'Done', doing: 'In progress', todo: 'To do' };
export function LedgerSteps({ steps }: { steps: LedgerStep[] }) {
  const counts = stepCounts(steps);
  const share = (count: number) => count / counts.total * 100 + '%';
  return <div className="ledger-progress">
    {counts.total > 0 && <span className="step-bar" role="progressbar" aria-label="Ledger progress" aria-valuetext={stepSummary(counts)} aria-valuemin={0} aria-valuemax={counts.total} aria-valuenow={counts.done}>
      <span className="step-bar-done" style={{ width: share(counts.done) }} /><span className="step-bar-doing" style={{ width: share(counts.doing) }} />
    </span>}
    <p className="ledger-progress-summary">{stepSummary(counts)}</p>
    {steps.length > 0 && <ol className="ledger-steps">{steps.map(step => {
      const props = { size: 16, className: 'step-icon step-' + step.status, 'aria-label': stepLabels[step.status] };
      return <li key={step.title} className={'ledger-step ledger-step-' + step.status}>
        {step.status === 'done' ? <CheckCircleFillIcon {...props} /> : step.status === 'doing' ? <DotFillIcon {...props} /> : <CircleIcon {...props} />}<span>{step.title}</span>
      </li>;
    })}</ol>}
  </div>;
}
