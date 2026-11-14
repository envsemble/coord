// Errors that cross the connection as values. A HostError's message is safe to show a user;
// anything else is reported as a generic internal error and logged on the host.
import { PlanningError } from '../planning/index.ts';
import type { ErrorCode, HostErrorValue } from './contract.ts';

export class HostError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) { super(message); this.name = 'HostError'; this.code = code; }
}

/** What the host logs: lifecycle events and failures. */
export interface Logger {
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

const byStatus: Record<number, ErrorCode> = { 400: 'invalid-argument', 403: 'forbidden', 404: 'not-found', 409: 'unavailable', 413: 'unavailable', 415: 'invalid-argument', 422: 'folder-invalid', 503: 'unavailable' };

/** Convert anything thrown by a handler into a value; unexpected errors get a generic message. */
export function toErrorValue(error: unknown): { value: HostErrorValue; expected: boolean } {
  if (error instanceof HostError) return { value: { code: error.code, message: error.message }, expected: true };
  if (error instanceof PlanningError) return { value: { code: byStatus[error.status] ?? 'invalid-argument', message: error.message }, expected: true };
  return { value: { code: 'internal', message: 'Atlas could not complete this request. Details are in the log (Open Logs, in the menu).' }, expected: false };
}
