// The ledger's agreed steps: a progress bar with the work left, and the steps themselves. Planning
// steps (settling the design) and implementation steps form one list, told apart by colour, and by
// name for assistive technology. The steps a plan proposes while it is designed follow the planning
// steps, dimmed under a "Proposed" label, outside the progress. While an agent works on the plan, the step in progress pulses, in
// the list and in the bar; while one waits for the person, it turns amber.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { stepCounts, stepSummary } from '@envsemble/coord/planning/ledger';
import type { LedgerStep, LedgerStepStatus, StepCounts } from '@envsemble/coord/planning/types';
import { CompleteIcon, InProgressIcon, OpenIcon } from '../ui/icons';
import { stepPhase, type StepPhase } from './work';

const statusLabels: Record<LedgerStepStatus, string> = { done: 'Done', doing: 'In progress', todo: 'To do' };
const phaseNames: Record<StepPhase, string> = { planning: 'Planning', proposed: 'Proposed', implementation: 'Implementation' };

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

function StepIcon({ status, phase = 'implementation' }: { status: LedgerStepStatus; phase?: StepPhase }) {
  const props = { className: 'step-icon', 'data-status': status, 'data-phase': phase, label: phase === 'implementation' ? statusLabels[status] : phaseNames[phase] + ' step, ' + statusLabels[status].toLowerCase() };
  return status === 'done' ? <CompleteIcon filled {...props} /> : status === 'doing' ? <InProgressIcon {...props} /> : <OpenIcon {...props} />;
}

/** How long a step the search found stays marked. */
const foundFor = 2500;

/**
 * The progress bar and count over every step, planning and implementation, then the steps in one list.
 * A step the search found (`found`, by its title) is scrolled into view and marked for a moment. The
 * list opens with the work the plan
 * continues (`before`) and ends with the work that continues it (`after`): list items, not steps.
 */
export function LedgerSteps({ steps, found = null, before = null, after = null }: { steps: LedgerStep[]; found?: string | null; before?: ReactNode; after?: ReactNode }) {
  const list = useRef<HTMLOListElement>(null);
  const [marked, setMarked] = useState<string | null>(null);
  const shown = Boolean(found && steps.some(step => step.title === found));
  useEffect(() => {
    if (!found || !shown) return;
    setMarked(found);
    const item = [...list.current?.children ?? []].find(element => (element as HTMLElement).dataset.step === found);
    item?.scrollIntoView({ block: 'nearest' });
    const timer = window.setTimeout(() => setMarked(null), foundFor);
    return () => window.clearTimeout(timer);
  }, [found, shown]);
  const counts = stepCounts(steps);
  const planning = stepCounts(steps.filter(step => stepPhase(step) === 'planning'));
  return <div className="ledger-progress">
    <StepBar counts={counts} planning={planning} />
    <p className="ledger-progress-summary">{stepSummary(counts)}</p>
    {(steps.length > 0 || before || after) && <ol ref={list} className="ledger-steps">{before}{steps.map((step, index) => {
      const phase = stepPhase(step);
      const item = <li key={step.title} className={'ledger-step ledger-step-' + step.status} data-phase={phase} data-step={step.title} data-found={marked === step.title ? '' : undefined}
        title={phaseNames[phase] + ' step: ' + step.title + ', ' + statusLabels[step.status].toLowerCase()}>
        <StepIcon status={step.status} phase={phase} /><span>{step.title}</span>
      </li>;
      return phase === 'proposed' && (index === 0 || stepPhase(steps[index - 1]) !== 'proposed') ? [<li key=" proposed" className="ledger-proposed" aria-hidden>Proposed</li>, item] : item;
    })}{after}</ol>}
  </div>;
}
