// The ledger's agreed steps: a progress bar with the work left, and the steps themselves. Planning
// steps (settling the design) and implementation steps form one list, told apart by colour, and by
// name for assistive technology. While an agent works on the plan, the step in progress pulses, in
// the list and in the bar; while one waits for the person, it turns amber.
// The plan export viewer draws the same markup (packages/atlas/viewer/ui.tsx), without activity.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { stepCounts, stepSummary } from '@envsemble/atlas/planning/ledger';
import type { LedgerStep, LedgerStepStatus, StepCounts } from '@envsemble/atlas/planning/types';
import { CompleteIcon, InProgressIcon, OpenIcon } from './icons';
import { stepPhase, type StepPhase } from '../work/work';
import type { ActivityState } from './status';

const statusLabels: Record<LedgerStepStatus, string> = { done: 'Done', doing: 'In progress', todo: 'To do' };

/**
 * A bar split into done and in-progress steps, over the steps still to do; the planning steps among
 * them (`planning`, a part of `counts`) in their own colour; the steps in progress pulse while an
 * agent works (`live`). Only drawn when there are steps.
 */
export function StepBar({ counts, planning, compact = false, live = null }: { counts: StepCounts; planning?: { done: number; doing: number }; compact?: boolean; live?: ActivityState }) {
  if (!counts.total) return null;
  const share = (count: number) => count / counts.total * 100 + '%';
  const early = planning ?? { done: 0, doing: 0 };
  // The compact bar sits next to its "2/7" and the row's title, so it is decoration there.
  const semantics = compact ? { 'aria-hidden': true } : { role: 'progressbar', 'aria-label': 'Ledger progress', 'aria-valuetext': stepSummary(counts), 'aria-valuemin': 0, 'aria-valuemax': counts.total, 'aria-valuenow': counts.done };
  return <span className={'step-bar' + (compact ? ' step-bar-compact' : '')} data-live={live ?? undefined} {...semantics}>
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

/** How long a step the search found stays marked. */
const foundFor = 2500;

/**
 * The progress bar and count over every step, planning and implementation, then the steps in one list.
 * A step the search found (`found`, by its title) is scrolled into view and marked for a moment. The
 * step in progress shows what agents do on the plan (`live`). The list opens with the work the plan
 * continues (`before`) and ends with the work that continues it (`after`): list items, not steps.
 */
export function LedgerSteps({ steps, found = null, live = null, before = null, after = null }: { steps: LedgerStep[]; found?: string | null; live?: ActivityState; before?: ReactNode; after?: ReactNode }) {
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
    <StepBar counts={counts} planning={planning} live={live} />
    <p className="ledger-progress-summary">{stepSummary(counts)}</p>
    {(steps.length > 0 || before || after) && <ol ref={list} className="ledger-steps">{before}{steps.map(step => {
      const phase = stepPhase(step);
      return <li key={step.title} className={'ledger-step ledger-step-' + step.status} data-phase={phase} data-step={step.title} data-found={marked === step.title ? '' : undefined}
        data-live={step.status === 'doing' && live ? live : undefined}
        title={(phase === 'planning' ? 'Planning' : 'Implementation') + ' step: ' + step.title + ', ' + statusLabels[step.status].toLowerCase()}>
        <StepIcon status={step.status} phase={phase} /><span>{step.title}</span>
      </li>;
    })}{after}</ol>}
  </div>;
}
