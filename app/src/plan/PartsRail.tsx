// The parts rail: on the pages of each part of a work item of several parts, a column at the right
// with its parts in their numbers' order, each with its status and how far its steps are. The one
// shown is marked; each opens with one click.
import { Text } from '@envsemble/envui';
import { stepCounts } from '@envsemble/coord/planning/ledger';
import type { Snapshot, Work } from '../types';
import { statusOf } from './status';
import { StatusIcon } from '../ui/badges';
import { parseWorkId } from '@envsemble/coord/planning/ids';
import { wholeNumber, workNumber } from '../ui/format';
import { workTarget } from '../navigation/targets';
import { TargetLink, useWindow } from '../window/windowContext';

/** The first part of the work item a part belongs to, when the work item has several: it knows the others. */
export function partsGroup(work: Work | null, snapshot: Snapshot): Work | null {
  if (!work) return null;
  if (work.parts?.length) return work;
  return work.partOf ? snapshot.work.find(item => item.id === work.partOf && item.parts?.length) ?? null : null;
}

/** How far a work item's agreed steps are, in a few words: "3 of 6", "done" or nothing when it has none. */
function stepsText(work: Work): string {
  const counts = stepCounts(work.progress?.steps ?? []);
  if (!counts.total) return '';
  return counts.remaining ? counts.done + ' of ' + counts.total : 'All done';
}

export function PartsRail({ group, shown }: { group: Work; shown: string }) {
  const { snapshot } = useWindow();
  const known = new Map(snapshot.work.map(item => [item.id, item]));
  const row = (work: Work, index: number | null) => {
    const status = statusOf(work);
    const steps = stepsText(work);
    return <div className="parts-rail-item" aria-current={work.id === shown ? 'page' : undefined}>
      <span className="parts-rail-index" aria-hidden="true">{index ?? ''}</span>
      <StatusIcon status={status} />
      <span className="parts-rail-text">
        <TargetLink className="parts-rail-link" target={workTarget(work.id)} title={work.title + ' · ' + status.label}>{work.title}</TargetLink>
        <span className="parts-rail-meta">{workNumber(work.id)}{steps && ' · ' + steps}</span>
      </span>
    </div>;
  };
  const number = (id: string, at: number) => parseWorkId(id)?.part ?? at + 1;
  return <nav className="parts-rail" aria-label={'Parts of ' + wholeNumber(group.id)}>
    <Text render={<h2 />} variant="body" className="parts-rail-heading">Parts <span className="muted">{1 + (group.parts?.length ?? 0)}</span></Text>
    <ol className="parts-rail-list">
      {[group.id, ...group.parts ?? []].map((id, index) => {
        const part = known.get(id);
        return <li key={id}>{part ? row(part, number(id, index))
          : <div className="parts-rail-item"><span className="parts-rail-index" aria-hidden="true">{number(id, index)}</span><span className="parts-rail-text"><span>{workNumber(id)}</span><span className="parts-rail-meta">Not in this project</span></span></div>}</li>;
      })}
    </ol>
  </nav>;
}
