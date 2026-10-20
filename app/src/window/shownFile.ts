// The file a place shows, for Open in Editor: the plan's page and its statistics open the document
// the page reads (its plan, else its README…), a diagram its source, a file itself. Pages without a
// plan (the hub, Projects, a project's statistics) show none. Pure, so it is unit-tested.
import type { Snapshot, Target } from '../types';
import { defaultDocument } from '../plan/work';

/** The planning folder's path of the file a target shows; null when it shows none. */
export function shownFile(target: Target, snapshot: Snapshot): string | null {
  if (target.kind === 'file') return target.path;
  const work = snapshot.work.find(item => item.id === target.work);
  if (!work) return null;
  if (target.kind === 'diagram' && target.path) return work.path + '/' + target.path;
  return defaultDocument(work)?.path ?? null;
}
