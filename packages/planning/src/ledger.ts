// The ledger status header (PLANS.md, "Ledger status"). Version 2 holds the agreed steps of the
// work, each todo, doing or done, so progress and the work left can be shown: the planning steps
// (`phase: planning`) from the work's creation, then the implementation steps (no phase). Version 1 (current
// focus and a list of next steps) stays readable as legacy. Both the YAML reader (planning.ts) and
// the restricted checker (check.ts) validate headers here, so they cannot disagree. No imports:
// the app window and the plan export viewer use this module too.
import type { LedgerStep, LedgerStepStatus, StepCounts, WorkProgress } from './types.ts';

export const ledgerStepStatuses: readonly LedgerStepStatus[] = ['todo', 'doing', 'done'];
const version1Fields = ['schema_version', 'kind', 'work_id', 'updated', 'current', 'next', 'blocked'];
const version2Fields = ['schema_version', 'kind', 'work_id', 'updated', 'blocked', 'steps'];
const stepFields = ['title', 'status', 'phase'];
const phases = ['planning', 'implementation'];

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

/** Version 1 headers are legacy and tolerate extra fields; version 2 accepts only its own. */
function requireFields(metadata: Record<string, unknown>, fields: string[], exact: boolean) {
  const missing = fields.filter(field => !Object.hasOwn(metadata, field));
  if (exact && missing.includes('steps') && (Object.hasOwn(metadata, 'current') || Object.hasOwn(metadata, 'next'))) throw new LedgerStatusError('Ledger status version 2 lists steps in place of current and next.');
  if (missing.length) throw new LedgerStatusError('Ledger status is missing ' + missing.join(', ') + '.');
  const extra = exact ? Object.keys(metadata).filter(field => !fields.includes(field)) : [];
  if (extra.length) throw new LedgerStatusError('Ledger status version 2 does not use ' + extra.join(', ') + (extra.some(field => field === 'current' || field === 'next') ? '; its steps replace current and next.' : '.'));
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
    if (Object.hasOwn(entry, 'phase') && !phases.includes(entry.phase as string)) throw new LedgerStatusError(at + ' phase must be planning or implementation.');
    const title = entry.title.trim();
    if (titles.has(title)) throw new LedgerStatusError('Ledger step titles must be unique: ' + title + '.');
    titles.add(title);
    return { title, status: entry.status as LedgerStepStatus, ...entry.phase === 'planning' && { phase: 'planning' as const } };
  });
}

/**
 * Validate a ledger header and return its status. Throws LedgerStatusError when the header does
 * not follow the contract for its version, so current and upcoming work stay unknown.
 */
export function ledgerStatus(metadata: Record<string, unknown>, workId: string): WorkProgress {
  const version = metadata.schema_version;
  if (version !== 1 && version !== 2) throw new LedgerStatusError('Ledger schema_version must be 1 or 2.');
  requireFields(metadata, version === 1 ? version1Fields : version2Fields, version === 2);
  if (metadata.kind !== 'ledger') throw new LedgerStatusError('Ledger kind must be ledger.');
  if (metadata.work_id !== workId) throw new LedgerStatusError('Ledger work_id must match the registered work.');
  if (metadata.updated !== null && !calendarDate(metadata.updated)) throw new LedgerStatusError('Ledger updated must be an ISO date or null.');
  if (!textOrNull(metadata.blocked)) throw new LedgerStatusError('Ledger blocked must be a nonempty string or null.');
  const updated = calendarDate(metadata.updated);
  const blocked = metadata.blocked as string | null;
  if (version === 1) {
    if (!textOrNull(metadata.current)) throw new LedgerStatusError('Ledger current must be a nonempty string or null.');
    if (!Array.isArray(metadata.next) || metadata.next.some(step => !text(step))) throw new LedgerStatusError('Ledger next must be a list of nonempty strings.');
    return { version: 1, current: metadata.current as string | null, next: metadata.next as string[], blocked, updated, steps: null };
  }
  const list = steps(metadata.steps);
  const doing = list.filter(step => step.status === 'doing').map(step => step.title);
  return { version: 2, current: doing.length ? doing.join('; ') : null, next: list.filter(step => step.status === 'todo').map(step => step.title), blocked, updated, steps: list };
}

/** How far the agreed steps are: the estimate of work left is the steps not yet done. */
export function stepCounts(steps: readonly LedgerStep[]): StepCounts {
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
