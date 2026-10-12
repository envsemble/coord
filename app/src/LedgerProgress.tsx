// The ledger's agreed steps: a progress bar with the work left, and the steps themselves.
// The plan export viewer draws the same markup (packages/planning/viewer/ui.tsx).
import { stepCounts, stepSummary } from '@envsemble/atlas-planning/ledger';
import type { LedgerStep, LedgerStepStatus, StepCounts } from '@envsemble/atlas-planning/types';
import { CompleteIcon, InProgressIcon, OpenIcon } from './icons';

const statusLabels: Record<LedgerStepStatus, string> = { done: 'Done', doing: 'In progress', todo: 'To do' };

/** A bar split into done and in-progress steps, over the steps still to do. Only drawn when there are steps. */
export function StepBar({ counts, compact = false }: { counts: StepCounts; compact?: boolean }) {
  if (!counts.total) return null;
  const share = (count: number) => count / counts.total * 100 + '%';
  // The compact bar sits next to its "2/7" and the row's title, so it is decoration there.
  const semantics = compact ? { 'aria-hidden': true } : { role: 'progressbar', 'aria-label': 'Ledger progress', 'aria-valuetext': stepSummary(counts), 'aria-valuemin': 0, 'aria-valuemax': counts.total, 'aria-valuenow': counts.done };
  return <span className={'step-bar' + (compact ? ' step-bar-compact' : '')} {...semantics}>
    <span className="step-bar-done" style={{ width: share(counts.done) }} />
    <span className="step-bar-doing" style={{ width: share(counts.doing) }} />
  </span>;
}

export function StepIcon({ status }: { status: LedgerStepStatus }) {
  const props = { className: 'step-icon', 'data-status': status, label: statusLabels[status] };
  return status === 'done' ? <CompleteIcon filled {...props} /> : status === 'doing' ? <InProgressIcon {...props} /> : <OpenIcon {...props} />;
}

export function LedgerSteps({ steps }: { steps: LedgerStep[] }) {
  const counts = stepCounts(steps);
  return <div className="ledger-progress">
    <StepBar counts={counts} />
    <p className="ledger-progress-summary">{stepSummary(counts)}</p>
    {steps.length > 0 && <ol className="ledger-steps">{steps.map(step => <li key={step.title} className={'ledger-step ledger-step-' + step.status}>
      <StepIcon status={step.status} /><span>{step.title}</span>
    </li>)}</ol>}
  </div>;
}
