// Handoffs between plans, as the ledger and status lines show them: the work a plan continues, above
// its steps, and the work that continues it, after them. Each by its number and title, with its
// project's name when it is another project's; it opens that plan unless the reference names no work
// item Coord can find (no title, or a project not in the home), then it stays text. Pure, so it is
// unit-tested.
import type { HandoffLink } from '@envsemble/coord/planning/types';
import { workNumber } from '../ui/format';

export interface Handoff {
  key: string;
  /** "#0023". */
  number: string;
  /** Its title; null when no work item of that number was found. */
  title: string | null;
  /** Its project's name when it is not the plan's own project. */
  project: string | null;
  /** Where it opens; null when it cannot. */
  open: { projectId: string; work: string } | null;
}

export function handoff(link: HandoffLink, own: string): Handoff {
  return {
    key: (link.projectId ?? link.project) + ':' + link.workId,
    number: workNumber(link.workId),
    title: link.title,
    project: link.projectId === own ? null : link.projectName || link.project,
    open: link.title !== null && link.projectId !== null ? { projectId: link.projectId, work: link.workId } : null,
  };
}

/** A plan's handoffs: the work it continues and the work that continues it, in the order recorded. */
export function handoffs(work: { continues?: HandoffLink[]; continuedIn?: HandoffLink[] }, own: string): { continues: Handoff[]; continuedIn: Handoff[] } {
  return { continues: (work.continues ?? []).map(link => handoff(link, own)), continuedIn: (work.continuedIn ?? []).map(link => handoff(link, own)) };
}

/** Where closed work continues, for its status line: only once it has ended (`closed`). */
export const continuation = (closed: boolean, work: { continuedIn?: HandoffLink[] }, own: string): Handoff[] => closed ? (work.continuedIn ?? []).map(link => handoff(link, own)) : [];
