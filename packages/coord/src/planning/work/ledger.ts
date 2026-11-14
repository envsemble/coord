// The ledger status header (PLANS.md, "Ledger status"), schema version 2: the agreed steps of the
// work, each todo, doing or done, so progress and the work left can be shown: the planning steps
// (`phase: planning`) from the work's creation, the steps the plan proposes while it is designed
// (`phase: proposed`, todo, outside the progress), then the implementation steps (no phase). Both the
// YAML reader (planningIndex.ts) and the restricted checker (check.ts) validate headers here, so they
// cannot disagree. No imports: the app window uses this module too.
import type { LedgerStep, LedgerStepStatus, StepCounts, WorkProgress } from '../types.ts';

export const ledgerStepStatuses: readonly LedgerStepStatus[] = ['todo', 'doing', 'done'];
const ledgerFields = ['schema_version', 'kind', 'work_id', 'updated', 'blocked', 'steps'];
const stepFields = ['title', 'status', 'phase'];
const phases = ['planning', 'proposed', 'implementation'];

/** A ledger header that does not follow the contract; the message says what is wrong. */
export class LedgerStatusError extends Error {
  constructor(message: string) { super(message); this.name = 'LedgerStatusError'; }
}

function calendarDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const milliseconds = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value ? value : null;
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const textOrNull = (value: unknown) => value === null || text(value);

/** A header has exactly the version 2 fields. */
function requireFields(metadata: Record<string, unknown>) {
  const missing = ledgerFields.filter(field => !Object.hasOwn(metadata, field));
  if (missing.length) throw new LedgerStatusError('Ledger status is missing ' + missing.join(', ') + '.');
  const extra = Object.keys(metadata).filter(field => !ledgerFields.includes(field));
  if (extra.length) throw new LedgerStatusError('Ledger status does not use ' + extra.join(', ') + '.');
}

function steps(value: unknown): LedgerStep[] {
  if (!Array.isArray(value)) throw new LedgerStatusError('Ledger steps must be a list.');
  const titles = new Set<string>();
  return value.map((step, index) => {
    const at = 'Ledger step ' + (index + 1);
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new LedgerStatusError(at + ' must have a title and a status.');
    const entry = step as Record<string, unknown>;
    const unknown = Object.keys(entry).filter(field => !stepFields.includes(field));
    if (unknown.length) throw new LedgerStatusError(at + ' has unknown fields: ' + unknown.join(', ') + '.');
    if (typeof entry.title !== 'string') throw new LedgerStatusError(at + ' title must be a quoted string.');
    if (!text(entry.title)) throw new LedgerStatusError(at + ' needs a nonempty title.');
    if (typeof entry.status !== 'string' || !(ledgerStepStatuses as readonly string[]).includes(entry.status)) throw new LedgerStatusError(at + ' status must be todo, doing or done.');
    if (Object.hasOwn(entry, 'phase') && !phases.includes(entry.phase as string)) throw new LedgerStatusError(at + ' phase must be planning, proposed or implementation.');
    if (entry.phase === 'proposed' && entry.status !== 'todo') throw new LedgerStatusError(at + ' is proposed, so its status must be todo.');
    const title = entry.title.trim();
    if (titles.has(title)) throw new LedgerStatusError('Ledger step titles must be unique: ' + title + '.');
    titles.add(title);
    return { title, status: entry.status as LedgerStepStatus, ...(entry.phase === 'planning' || entry.phase === 'proposed') && { phase: entry.phase } };
  });
}

/**
 * Validate a ledger header and return its status. Throws LedgerStatusError when the header does
 * not follow the contract (schema version 2), so current and upcoming work stay unknown.
 */
export function ledgerStatus(metadata: Record<string, unknown>, workId: string): WorkProgress {
  if (metadata.schema_version !== 2) throw new LedgerStatusError('Ledger schema_version must be 2.');
  requireFields(metadata);
  if (metadata.kind !== 'ledger') throw new LedgerStatusError('Ledger kind must be ledger.');
  if (metadata.work_id !== workId) throw new LedgerStatusError('Ledger work_id must match the registered work.');
  if (metadata.updated !== null && !calendarDate(metadata.updated)) throw new LedgerStatusError('Ledger updated must be an ISO date or null.');
  if (!textOrNull(metadata.blocked)) throw new LedgerStatusError('Ledger blocked must be a nonempty string or null.');
  const list = steps(metadata.steps);
  const doing = list.filter(step => step.status === 'doing').map(step => step.title);
  return { version: 2, current: doing.length ? doing.join('; ') : null, next: agreed(list).filter(step => step.status === 'todo').map(step => step.title), blocked: metadata.blocked as string | null, updated: calendarDate(metadata.updated), steps: list };
}

/** The agreed steps: all but the proposed ones, which only preview the plan's steps. */
export const agreed = (steps: readonly LedgerStep[]) => steps.filter(step => step.phase !== 'proposed');

/** How far the agreed steps are (proposed steps aside): the estimate of work left is the steps not yet done. */
export function stepCounts(all: readonly LedgerStep[]): StepCounts {
  const steps = agreed(all);
  const done = steps.filter(step => step.status === 'done').length;
  const doing = steps.filter(step => step.status === 'doing').length;
  return { total: steps.length, done, doing, todo: steps.length - done - doing, remaining: steps.length - done };
}

/** The progress in words: "2 of 7 steps done · 5 left". */
export function stepSummary(counts: StepCounts): string {
  if (!counts.total) return 'No steps agreed yet';
  if (!counts.remaining) return counts.total === 1 ? 'The only step is done' : `All ${counts.total} steps done`;
  return `${counts.done} of ${counts.total} ${counts.total === 1 ? 'step' : 'steps'} done · ${counts.remaining} left`;
}
