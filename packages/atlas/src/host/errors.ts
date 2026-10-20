// Errors that cross the connection as values. A HostError's message is safe to show a user;
// anything else is reported as a generic internal error and logged on the host.
import { PlanExportError, PlanningError } from '../planning/index.ts';
import type { ErrorCode, HostErrorValue } from './contract.ts';

export class HostError extends Error {
  readonly code: ErrorCode;
  /** The code of the error this one reports, such as a PlanExportError code. */
  readonly reason: string | null;
  constructor(code: ErrorCode, message: string, reason: string | null = null) { super(message); this.name = 'HostError'; this.code = code; this.reason = reason; }
}

/** What the host logs: lifecycle events and failures. */
export interface Logger {
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

const byStatus: Record<number, ErrorCode> = { 400: 'invalid-argument', 403: 'forbidden', 404: 'not-found', 409: 'unavailable', 413: 'unavailable', 415: 'invalid-argument', 422: 'folder-invalid', 503: 'unavailable' };
const exportCodes: Record<string, ErrorCode> = {
  FORMAT: 'invalid-argument', VERSION: 'invalid-argument', PATH: 'invalid-argument', DUPLICATE: 'invalid-argument', INTEGRITY: 'invalid-argument', LIMIT: 'invalid-argument',
  ROLLBACK: 'internal', SOURCE: 'folder-invalid', WORK: 'not-found', TARGET: 'folder-invalid', CONFLICT: 'unavailable',
};

/** Convert anything thrown by a handler into a value; unexpected errors get a generic message. */
export function toErrorValue(error: unknown): { value: HostErrorValue; expected: boolean } {
  if (error instanceof HostError) return { value: { code: error.code, message: error.message }, expected: true };
  if (error instanceof PlanningError) return { value: { code: byStatus[error.status] ?? 'invalid-argument', message: error.message }, expected: true };
  if (error instanceof PlanExportError) return { value: { code: exportCodes[error.code] ?? 'invalid-argument', message: error.message }, expected: true };
  return { value: { code: 'internal', message: 'Atlas could not complete this request. Details are in the log (Open Logs, in the menu).' }, expected: false };
}
