import { HostRequestError } from '@envsemble/atlas-host';
import { PlanningError } from '@envsemble/atlas-planning';
import type { AtlasErrorValue, ErrorCode } from '../shared/contract.ts';
import { ValidationError } from '../shared/validate.ts';

/** An error whose message is safe and useful to show in the window. */
export class AtlasError extends Error {
  readonly code: ErrorCode;
  /** The code of the error this one reports, such as a PlanExportError code. */
  readonly reason: string | null;
  constructor(code: ErrorCode, message: string, reason: string | null = null) { super(message); this.code = code; this.reason = reason; }
}

const byStatus: Record<number, ErrorCode> = { 400: 'invalid-argument', 403: 'forbidden', 404: 'not-found', 409: 'unavailable', 413: 'unavailable', 415: 'invalid-argument', 422: 'folder-invalid', 503: 'unavailable' };

/** Convert anything thrown by a handler into a structured value; unexpected errors get a generic message. */
export function toErrorValue(error: unknown): { value: AtlasErrorValue; expected: boolean } {
  if (error instanceof AtlasError) return { value: { code: error.code, message: error.message }, expected: true };
  if (error instanceof ValidationError) return { value: { code: 'invalid-argument', message: error.message }, expected: true };
  // The host already chose a message fit for the window (an unexpected host error arrives as a generic one).
  if (error instanceof HostRequestError) return { value: { code: error.code, message: error.message }, expected: error.code !== 'internal' };
  if (error instanceof PlanningError) return { value: { code: byStatus[error.status] ?? 'invalid-argument', message: error.message }, expected: true };
  return { value: { code: 'internal', message: 'Atlas could not complete this request. Details are in the log (Help › Open Logs).' }, expected: false };
}
