// The parts rail: on the pages of a work item made of parts, and of each of its parts, a column at
// the right with the group and its parts in their order, numbered, each with its status and how far
// its steps are. The one shown is marked; each opens with one click.
import { List, Text } from '@envsemble/envui';
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
  const { snapshot, activity } = useWindow();
  const known = new Map(snapshot.work.map(item => [item.id, item]));
  const row = (work: Work, index: number | null, key?: string) => {
    const status = statusOf(work, activity(work.id)?.state ?? null);
    return <List.Item key={key} interactive current={work.id === shown} className="parts-rail-item" data-group={index === null || undefined}
      start={<span className="parts-rail-start">{index !== null && <span className="parts-rail-index" aria-hidden="true">{index}</span>}<StatusIcon status={status} /></span>}
      label={<TargetLink target={workTarget(work.id)} rowTarget title={work.title + ' · ' + status.label}>{work.title}</TargetLink>}
      description={workNumber(work.id) + (stepsText(work) && ' · ' + stepsText(work))} />;
  };
  return <nav className="parts-rail" aria-label={'Parts of ' + workNumber(group.id)}>
    <Text render={<h2 />} variant="body" className="parts-rail-heading">Parts <span className="muted">{group.parts?.length ?? 0}</span></Text>
    <List.Root density="sm" aria-label={workNumber(group.id) + ' ' + group.title}>{row(group, null)}</List.Root>
    <List.Root density="sm" className="parts-rail-list" aria-label={'Parts of ' + workNumber(group.id) + ', in order'}>
      {(group.parts ?? []).map((id, index) => {
        const part = known.get(id);
        return part ? row(part, index + 1, id)
          : <List.Item key={id} className="parts-rail-item" start={<span className="parts-rail-start"><span className="parts-rail-index" aria-hidden="true">{index + 1}</span></span>} label={workNumber(id)} description="Not in this project" />;
      })}
    </List.Root>
  </nav>;
}
