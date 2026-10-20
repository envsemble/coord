import { HostRequestError } from '@envsemble/atlas/host';
import { PlanningError } from '@envsemble/atlas/planning';
import type { AtlasErrorValue, ErrorCode } from '../shared/contract.ts';
import { AtlasError } from '../shared/errors.ts';
import { ValidationError } from '../shared/validate.ts';

export { AtlasError };

const byStatus: Record<number, ErrorCode> = { 400: 'invalid-argument', 403: 'forbidden', 404: 'not-found', 409: 'unavailable', 413: 'unavailable', 415: 'invalid-argument', 422: 'folder-invalid', 503: 'unavailable' };

/** Convert anything thrown by a handler into a structured value; unexpected errors get a generic message. */
export function toErrorValue(error: unknown): { value: AtlasErrorValue; expected: boolean } {
  if (error instanceof AtlasError) return { value: { code: error.code, message: error.message }, expected: true };
  if (error instanceof ValidationError) return { value: { code: 'invalid-argument', message: error.message }, expected: true };
  // The host already chose a message fit for the window (an unexpected host error arrives as a generic one).
  if (error instanceof HostRequestError) return { value: { code: error.code, message: error.message }, expected: error.code !== 'internal' };
  if (error instanceof PlanningError) return { value: { code: byStatus[error.status] ?? 'invalid-argument', message: error.message }, expected: true };
  return { value: { code: 'internal', message: 'Atlas could not complete this request. Details are in the log (Open Logs, in the menu).' }, expected: false };
}
