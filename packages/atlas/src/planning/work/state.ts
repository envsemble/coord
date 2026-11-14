// A work item's state, as its agents declare it in the plan's header: whose turn it is, and what
// for. Atlas never guesses it and never changes it on its own; the tools set it as they change the
// work (created: planning; started or reopened: working; accepted or closed: none), and agents set
// it at each start and handoff with the `state` tool.
//
//   state: your_turn
//   state_note: "Merge envsemble/atlas#35"
//   state_since: "2026-11-14T10:20:00.000Z"
import type { StateKind, WorkState } from '../types.ts';

export const stateKinds: readonly StateKind[] = ['planning', 'working', 'waiting', 'your_turn', 'blocked'];
/** The kinds whose note says what for: what the user is to do, what the work waits on, why it is blocked. */
export const stateNeedsNote: ReadonlySet<StateKind> = new Set(['your_turn', 'waiting', 'blocked']);
export const stateNoteLimit = 300;
export const stateFields = ['state', 'state_note', 'state_since'] as const;
const isoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export const isStateKind = (value: unknown): value is StateKind => typeof value === 'string' && (stateKinds as readonly string[]).includes(value);

/** The state a plan's header declares, or null when it declares none (or one that does not read). */
export function stateOf(metadata: Record<string, unknown>): WorkState | null {
  if (!isStateKind(metadata.state)) return null;
  const note = typeof metadata.state_note === 'string' && metadata.state_note.trim() ? metadata.state_note.trim() : null;
  const since = typeof metadata.state_since === 'string' && isoTime.test(metadata.state_since) && !Number.isNaN(Date.parse(metadata.state_since)) ? metadata.state_since : null;
  return { kind: metadata.state, note, since };
}

/** What is wrong with a plan header's state fields, for `atlas check`. */
export function stateProblems(metadata: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const { state, state_note: note, state_since: since } = metadata;
  if (state !== undefined && state !== null && !isStateKind(state)) problems.push('state must be one of ' + stateKinds.join(', ') + ', or null');
  if (note !== undefined && note !== null && (typeof note !== 'string' || /[\r\n]/.test(note) || note.length > stateNoteLimit)) problems.push(`state_note must be one line of at most ${stateNoteLimit} characters, or null`);
  if (since !== undefined && since !== null && (typeof since !== 'string' || !isoTime.test(since) || Number.isNaN(Date.parse(since)))) problems.push('state_since must be an ISO time string, such as "2026-11-14T10:20:00Z", or null');
  if (isStateKind(state) && stateNeedsNote.has(state) && (typeof note !== 'string' || !note.trim())) problems.push(`state ${state} needs a state_note saying what for`);
  return problems;
}
