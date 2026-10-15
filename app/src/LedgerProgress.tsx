// The ledger's agreed steps: a progress bar with the work left, and the steps themselves. Planning
// steps (settling the design) and implementation steps form one list, told apart by colour, and by
// name for assistive technology.
// The plan export viewer draws the same markup (packages/planning/viewer/ui.tsx).
import { stepCounts, stepSummary } from '@envsemble/atlas-planning/ledger';
import type { LedgerStep, LedgerStepStatus, StepCounts } from '@envsemble/atlas-planning/types';
import { CompleteIcon, InProgressIcon, OpenIcon } from './icons';
import { stepPhase, type StepPhase } from './work';

const statusLabels: Record<LedgerStepStatus, string> = { done: 'Done', doing: 'In progress', todo: 'To do' };

/**
 * A bar split into done and in-progress steps, over the steps still to do; the planning steps among
 * them (`planning`, a part of `counts`) in their own colour. Only drawn when there are steps.
 */
export function StepBar({ counts, planning, compact = false }: { counts: StepCounts; planning?: { done: number; doing: number }; compact?: boolean }) {
  if (!counts.total) return null;
  const share = (count: number) => count / counts.total * 100 + '%';
  const early = planning ?? { done: 0, doing: 0 };
  // The compact bar sits next to its "2/7" and the row's title, so it is decoration there.
  const semantics = compact ? { 'aria-hidden': true } : { role: 'progressbar', 'aria-label': 'Ledger progress', 'aria-valuetext': stepSummary(counts), 'aria-valuemin': 0, 'aria-valuemax': counts.total, 'aria-valuenow': counts.done };
  return <span className={'step-bar' + (compact ? ' step-bar-compact' : '')} {...semantics}>
    {early.done > 0 && <span className="step-bar-planning-done" style={{ width: share(early.done) }} />}
    <span className="step-bar-done" style={{ width: share(counts.done - early.done) }} />
    {early.doing > 0 && <span className="step-bar-planning-doing" style={{ width: share(early.doing) }} />}
    <span className="step-bar-doing" style={{ width: share(counts.doing - early.doing) }} />
  </span>;
}

export function StepIcon({ status, phase = 'implementation' }: { status: LedgerStepStatus; phase?: StepPhase }) {
  const props = { className: 'step-icon', 'data-status': status, 'data-phase': phase, label: phase === 'planning' ? 'Planning step, ' + statusLabels[status].toLowerCase() : statusLabels[status] };
  return status === 'done' ? <CompleteIcon filled {...props} /> : status === 'doing' ? <InProgressIcon {...props} /> : <OpenIcon {...props} />;
}

/** The progress bar and count over every step, planning and implementation, then the steps in one list. */
export function LedgerSteps({ steps }: { steps: LedgerStep[] }) {
  const counts = stepCounts(steps);
  const planning = stepCounts(steps.filter(step => stepPhase(step) === 'planning'));
  return <div className="ledger-progress">
    <StepBar counts={counts} planning={planning} />
    <p className="ledger-progress-summary">{stepSummary(counts)}</p>
    {steps.length > 0 && <ol className="ledger-steps">{steps.map(step => {
      const phase = stepPhase(step);
      return <li key={step.title} className={'ledger-step ledger-step-' + step.status} data-phase={phase}
        title={(phase === 'planning' ? 'Planning' : 'Implementation') + ' step: ' + step.title + ', ' + statusLabels[step.status].toLowerCase()}>
        <StepIcon status={step.status} phase={phase} /><span>{step.title}</span>
      </li>;
    })}</ol>}
  </div>;
}
