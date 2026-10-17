// Small presentational pieces matching the app's (app/src/ui: ui.tsx, status.ts, format.ts, LedgerProgress.tsx), on envUI.
import type { ReactNode } from 'react';
import { Badge } from '@envsemble/envui';
import { Block } from '@envsemble/envui/icons/Block';
import { CheckCircle } from '@envsemble/envui/icons/CheckCircle';
import { DoNotDisturbOn } from '@envsemble/envui/icons/DoNotDisturbOn';
import { EditNote } from '@envsemble/envui/icons/EditNote';
import { Help } from '@envsemble/envui/icons/Help';
import { Pending } from '@envsemble/envui/icons/Pending';
import { RadioButtonUnchecked } from '@envsemble/envui/icons/RadioButtonUnchecked';
import { SkipNext } from '@envsemble/envui/icons/SkipNext';
import { stepCounts, stepSummary } from '../src/planning/work/ledger.ts';
import type { LedgerStep, LedgerStepStatus } from '../src/planning/types.ts';
import type { Provenance } from '../src/planning/reading/provenance.ts';
import type { PlanView } from './data.ts';

export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  if (!provenance.label) return null;
  return <Badge tone={provenance.tone} title={provenance.detail || undefined}>{provenance.label}</Badge>;
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'done';
type Status = { key: string; label: string; tone: Tone };
export function workStatus(work: PlanView['work']): Status {
  if (work.design === 'superseded') return { key: 'superseded', label: 'Superseded', tone: 'neutral' };
  if (work.design === 'abandoned') return { key: 'abandoned', label: 'Abandoned', tone: 'neutral' };
  if (work.implementation === 'complete') return { key: 'complete', label: 'Complete', tone: 'done' };
  if (work.progress?.blocked) return { key: 'blocked', label: 'Blocked', tone: 'danger' };
  if (work.implementation === 'in_progress') return { key: 'in_progress', label: 'In progress', tone: 'success' };
  if (work.implementation === 'partial') return { key: 'partial', label: 'Partially done', tone: 'warning' };
  if (work.design === 'draft') return { key: 'draft', label: 'Draft plan', tone: 'neutral' };
  if (work.implementation === 'not_started') return { key: 'not_started', label: 'Not started', tone: 'neutral' };
  return { key: 'unknown', label: 'Status unknown', tone: 'neutral' };
}
const statusIcons: Record<string, (props: { className: string; 'data-tone': string }) => ReactNode> = {
  complete: CheckCircle, blocked: Block, draft: EditNote, superseded: SkipNext, abandoned: DoNotDisturbOn, unknown: Help, in_progress: Pending, partial: Pending,
};
export function StatusBadge({ status }: { status: Status }) {
  const Icon = statusIcons[status.key] ?? RadioButtonUnchecked;
  return <Badge className="state-label" tone={status.tone} icon={<Icon className="status-icon" data-tone={status.tone} />}>{status.label}</Badge>;
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

/**
 * The ledger's agreed steps, as the app shows them (app/src/ui/LedgerProgress.tsx): planning steps
 * (`phase: planning`) and implementation steps in one list, the planning ones in their own colour.
 */
const stepLabels: Record<LedgerStepStatus, string> = { done: 'Done', doing: 'In progress', todo: 'To do' };
export function LedgerSteps({ steps }: { steps: LedgerStep[] }) {
  const counts = stepCounts(steps);
  const planning = stepCounts(steps.filter(step => step.phase === 'planning'));
  const share = (count: number) => count / counts.total * 100 + '%';
  return <div className="ledger-progress">
    {counts.total > 0 && <span className="step-bar" role="progressbar" aria-label="Ledger progress" aria-valuetext={stepSummary(counts)} aria-valuemin={0} aria-valuemax={counts.total} aria-valuenow={counts.done}>
      {planning.done > 0 && <span className="step-bar-planning-done" style={{ width: share(planning.done) }} />}
      <span className="step-bar-done" style={{ width: share(counts.done - planning.done) }} />
      {planning.doing > 0 && <span className="step-bar-planning-doing" style={{ width: share(planning.doing) }} />}
      <span className="step-bar-doing" style={{ width: share(counts.doing - planning.doing) }} />
    </span>}
    <p className="ledger-progress-summary">{stepSummary(counts)}</p>
    {steps.length > 0 && <ol className="ledger-steps">{steps.map(step => {
      const phase = step.phase === 'planning' ? 'planning' : 'implementation';
      const props = { className: 'step-icon', 'data-status': step.status, 'data-phase': phase, label: phase === 'planning' ? 'Planning step, ' + stepLabels[step.status].toLowerCase() : stepLabels[step.status] };
      return <li key={step.title} className={'ledger-step ledger-step-' + step.status} data-phase={phase}
        title={(phase === 'planning' ? 'Planning' : 'Implementation') + ' step: ' + step.title + ', ' + stepLabels[step.status].toLowerCase()}>
        {step.status === 'done' ? <CheckCircle filled {...props} /> : step.status === 'doing' ? <Pending {...props} /> : <RadioButtonUnchecked {...props} />}<span>{step.title}</span>
      </li>;
    })}</ol>}
  </div>;
}
