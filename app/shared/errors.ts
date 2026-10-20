// The error both sides of the bridge throw: main for a failure the window may show, the renderer for
// a failure the bridge returned. Its code is one of the host's error codes, so components can check it.
import type { ErrorCode } from './contract.ts';

/** An error whose message is safe and useful to show in the window. */
export class AtlasError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) { super(message); this.name = 'AtlasError'; this.code = code; }
}
