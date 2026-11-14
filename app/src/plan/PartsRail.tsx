// The parts rail: on the pages of a work item made of parts, and of each of its parts, a column at
// the right with the group and its parts in their order, numbered, each with its status and how far
// its steps are. The one shown is marked; each opens with one click.
import { Text } from '@envsemble/envui';
import { stepCounts } from '@envsemble/atlas/planning/ledger';
import type { Snapshot, Work } from '../types';
import { statusOf } from './status';
import { StatusIcon } from '../ui/badges';
import { workNumber } from '../ui/format';
import { workTarget } from '../navigation/targets';
import { TargetLink, useWindow } from '../window/windowContext';

/** The group a work item belongs to as the rail shows it: the work item itself when it has parts, else the group listing it. */
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
  return <nav className="parts-rail" aria-label={'Parts of ' + workNumber(group.id)}>
    <Text render={<h2 />} variant="body" className="parts-rail-heading">Parts <span className="muted">{group.parts?.length ?? 0}</span></Text>
    {row(group, null)}
    <ol className="parts-rail-list">
      {(group.parts ?? []).map((id, index) => {
        const part = known.get(id);
        return <li key={id}>{part ? row(part, index + 1)
          : <div className="parts-rail-item"><span className="parts-rail-index" aria-hidden="true">{index + 1}</span><span className="parts-rail-text"><span>{workNumber(id)}</span><span className="parts-rail-meta">Not in this project</span></span></div>}</li>;
      })}
    </ol>
  </nav>;
}
