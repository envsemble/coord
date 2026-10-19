// A small hand-written validator for everything that reaches the host from a client, and for the
// host's own stored state. Validators return the checked value or throw ValidationError; unknown
// object keys are dropped, never passed through. The desktop app reuses the generic ones for the
// messages its windows send (app/shared/validate.ts).
import type { AccessSettings, MethodName, Methods, PairRequest } from './contract.ts';

export class ValidationError extends Error {}
export type Validator<T> = (value: unknown, at?: string) => T;

/** Planning paths can be long; nothing a client sends needs more. */
export const pathLimit = 2048;

function fail(at: string, expected: string): never {
  throw new ValidationError(`${at || 'value'} must be ${expected}.`);
}

export function string(options: { max?: number; min?: number; pattern?: RegExp } = {}): Validator<string> {
  const { max = pathLimit, min = 0, pattern } = options;
  return (value, at = '') => {
    if (typeof value !== 'string') fail(at, 'a string');
    if (value.length < min || value.length > max) fail(at, `between ${min} and ${max} characters`);
    if (value.includes('\0')) fail(at, 'free of NUL characters');
    if (pattern && !pattern.test(value)) fail(at, 'in the expected format');
    return value;
  };
}
export function integer(minimum: number, maximum: number): Validator<number> {
  return (value, at = '') => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) fail(at, `an integer from ${minimum} to ${maximum}`);
    return value;
  };
}
export const boolean: Validator<boolean> = (value, at = '') => {
  if (typeof value !== 'boolean') fail(at, 'true or false');
  return value;
};
export function oneOf<const T extends readonly string[]>(values: T): Validator<T[number]> {
  return (value, at = '') => {
    if (typeof value !== 'string' || !values.includes(value)) fail(at, 'one of ' + values.join(', '));
    return value as T[number];
  };
}
export function nullable<T>(inner: Validator<T>): Validator<T | null> {
  return (value, at) => value === null ? null : inner(value, at);
}
export function optional<T>(inner: Validator<T>): Validator<T | undefined> {
  return (value, at) => value === undefined ? undefined : inner(value, at);
}
export function array<T>(inner: Validator<T>, maximum: number): Validator<T[]> {
  return (value, at = '') => {
    if (!Array.isArray(value) || value.length > maximum) fail(at, `a list of at most ${maximum} items`);
    return value.map((item, index) => inner(item, `${at}[${index}]`));
  };
}
type Shape<T> = { [K in keyof T]: Validator<T[K]> };
export function object<T extends object>(shape: Shape<T>): Validator<T> {
  return (value, at = '') => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(at, 'an object');
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(shape) as (keyof T & string)[]) {
      const checked = shape[key]((value as Record<string, unknown>)[key], at ? `${at}.${key}` : key);
      if (checked !== undefined) result[key] = checked;
    }
    return result as T;
  };
}

/** Check an argument list exactly: no missing and no extra arguments. */
export function argumentsOf(validators: Validator<unknown>[], values: unknown[]): unknown[] {
  if (values.length > validators.length) throw new ValidationError(`Expected at most ${validators.length} arguments.`);
  return validators.map((validator, index) => validator(values[index], `argument ${index + 1}`));
}

/** A planning-relative POSIX path as the reader reports it. Containment is checked again where files are read. */
export const relativePath = string({ min: 1, max: pathLimit, pattern: /^(?![\\/])(?![a-zA-Z]:)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/ });
export const absolutePath = string({ min: 1, max: pathLimit });
export const workId = string({ min: 6, max: 32, pattern: /^work-[0-9]{4,}$/ });
/** A moment as clients send it: an ISO time with its zone. */
export const isoTime = string({ min: 20, max: 40, pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/ });
/** A diagram file's path in its work folder, relative and inside it. */
export const diagramPath = string({ min: 6, max: pathLimit, pattern: /^(?![\\/])(?![a-zA-Z]:)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.puml$/i });
export const folderId = string({ min: 34, max: 34, pattern: /^f-[a-f0-9]{32}$/ });
export const token = string({ min: 16, max: 80, pattern: /^[a-zA-Z0-9-]+$/ });
export const deviceId = string({ min: 8, max: 64, pattern: /^d-[a-f0-9]{32}$/ });

/** An IPv4 or IPv6 literal (no host names: a name could be re-pointed at another machine). */
export const ipAddress = string({ min: 2, max: 64, pattern: /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[0-9a-fA-F:]+:[0-9a-fA-F:.]*)$/ });
export const port = integer(1024, 65535);
/** A pairing code as typed: letters and digits, optionally grouped with dashes or spaces. */
export const pairingCode = string({ min: 16, max: 24, pattern: /^[0-9A-Za-z]{4}(?:[- ]?[0-9A-Za-z]{4}){3}$/ });
const untrimmedText = (max: number) => string({ min: 1, max, pattern: /^[^\u0000-\u001f\u007f-\u009f]+$/ });

/** A device's name or platform as shown to the owner: trimmed, and not blank. */
export const deviceText = (max: number): Validator<string> => {
  const check = untrimmedText(max);
  return (value, at = '') => {
    const text = check(value, at).trim();
    if (!text) fail(at, 'a name that is not blank');
    return text;
  };
};
/** An address to listen on: one of this computer's own, never "every address" (0.0.0.0 or ::). */
export const listenAddress: Validator<string> = (value, at = '') => {
  const address = ipAddress(value, at);
  if (/^(?:0\.0\.0\.0|::|(?:0{1,4}:){7}0{1,4}|::ffff:0\.0\.0\.0)$/i.test(address)) fail(at, 'one address of this computer, not every address');
  return address;
};
const networkSettings = object<AccessSettings['network']>({ enabled: boolean, address: nullable(listenAddress), port });
export const accessSettings: Validator<AccessSettings> = object<AccessSettings>({ network: networkSettings });
/** A project's name: one line, at most 100 characters, not blank. */
export const projectName = deviceText(100);
export const pairRequest: Validator<PairRequest> = object<PairRequest>({
  code: pairingCode,
  device: object<PairRequest['device']>({ name: deviceText(80), platform: deviceText(40) }),
});

const none = object<Record<string, never>>({});
/** The parameters of every method, checked before its handler runs. */
export const methodParams: { readonly [M in MethodName]: Validator<Methods[M]['params']> } = {
  'host.session': none,
  'projects.list': none,
  'projects.create': object({ name: projectName, folders: array(absolutePath, 20) }),
  'search.query': object({ query: string({ min: 1, max: 200 }), limit: optional(integer(1, 200)) }),
  'references.resolve': object({ folderId, items: array(object({ kind: oneOf(['pull', 'commit', 'path'] as const), repository: nullable(string({ min: 1, max: 200 })), value: string({ min: 1, max: 1000 }), line: nullable(integer(1, 10_000_000)) }), 500) }),
  'work.sessions': object({ folderId, work: workId }),
  'work.timeline': object({ folderId, work: workId }),
  'project.statistics': object({ folderId, from: nullable(isoTime), to: nullable(isoTime), unit: oneOf(['day', 'week'] as const) }),
  'projects.statistics': object({ folderIds: array(folderId, 500), from: nullable(isoTime), to: nullable(isoTime), unit: oneOf(['day', 'week'] as const) }),
  'projects.update': object({ folderId, name: optional(projectName), state: optional(oneOf(['active', 'archived'] as const)), position: optional(integer(0, 100000)), folders: optional(array(absolutePath, 20)) }),
  'folders.subscribe': object({ folderId }),
  'folders.unsubscribe': object({ folderId }),
  'folder.snapshot': object({ folderId }),
  'folder.document': object({ folderId, path: relativePath }),
  'folder.diagrams': object({ folderId, work: workId }),
  'folder.diagram': object({ folderId, work: workId, path: diagramPath }),
  'folder.references': object({ folderId, work: nullable(workId), path: relativePath }),
  'folder.diagramIndex': object({ folderId }),
  'plan.exportPrepare': object({ folderId, work: workId }),
  'plan.exportDrop': object({ token }),
  'plan.importRead': object({ folderId, file: absolutePath }),
  'plan.importConfirm': object({ folderId, token }),
  'plan.importDrop': object({ token }),
  'access.state': none,
  'access.update': object({ settings: accessSettings }),
  'access.pairingCreate': object({ address: nullable(listenAddress), label: nullable(deviceText(80)), manageAccess: boolean }),
  'access.pairingRevoke': object({ code: pairingCode }),
  'access.devices': none,
  'access.deviceRevoke': object({ deviceId }),
};
