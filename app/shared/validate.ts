// A tiny hand-written validator for everything that crosses into the main process:
// IPC arguments and persisted window state. Validators return the checked value or
// throw ValidationError; unknown object keys are dropped, never passed through.
import { appCommands, limits, type TabState, type Target, type UiState, type ViewEventInput } from './contract.ts';

export class ValidationError extends Error {}
export type Validator<T> = (value: unknown, at?: string) => T;

function fail(at: string, expected: string): never {
  throw new ValidationError(`${at || 'value'} must be ${expected}.`);
}

export function string(options: { max?: number; min?: number; pattern?: RegExp } = {}): Validator<string> {
  const { max = limits.path, min = 0, pattern } = options;
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
export const relativePath = string({ min: 1, max: limits.path, pattern: /^(?![\\/])(?![a-zA-Z]:)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/ });
export const workId = string({ min: 6, max: 32, pattern: /^work-[0-9]{4,}$/ });
export const modelHandle = string({ min: 26, max: 26, pattern: /^m-[a-f0-9]{24}$/ });
export const token = string({ min: 16, max: 80, pattern: /^[a-zA-Z0-9-]+$/ });
export const command = oneOf(appCommands);
export const url = string({ min: 1, max: 4096 });
export const absolutePath = string({ min: 1, max: limits.path });
export const viewEvent: Validator<ViewEventInput> = object<ViewEventInput>({
  id: string({ min: 8, max: 80, pattern: /^[a-zA-Z0-9-]+$/ }),
  path: relativePath,
  session: string({ min: 8, max: 80, pattern: /^[a-zA-Z0-9-]+$/ }),
  contentHash: nullable(string({ max: 128, pattern: /^[a-f0-9]*$/ })),
});

const anchor = optional(nullable(string({ max: 512 })));
export const target: Validator<Target> = (value, at = 'target') => {
  const kind = object({ kind: oneOf(['view', 'work', 'file'] as const) })(value, at).kind;
  if (kind === 'view') return object<Extract<Target, { kind: 'view' }>>({ kind: oneOf(['view'] as const), view: oneOf(['work', 'activity', 'statistics'] as const) })(value, at);
  if (kind === 'work') return object<Extract<Target, { kind: 'work' }>>({
    kind: oneOf(['work'] as const), work: workId, section: optional(nullable(oneOf(['plan', 'ledger', 'diagrams'] as const))),
    diagram: optional(nullable(modelHandle)), element: optional(nullable(string({ max: 512 }))), anchor,
  })(value, at);
  return object<Extract<Target, { kind: 'file' }>>({ kind: oneOf(['file'] as const), path: relativePath, anchor })(value, at);
};
const tab: Validator<TabState> = object<TabState>({ id: string({ min: 1, max: limits.path + 64 }), target, preview: boolean });
export const uiState: Validator<UiState> = (value, at = 'state') => {
  const state = object<UiState>({
    sidebar: object<UiState['sidebar']>({ visible: boolean, width: integer(limits.sidebarMin, limits.sidebarMax), expanded: array(string({ max: limits.path + 64 }), limits.expanded) }),
    tabs: object<UiState['tabs']>({ items: array(tab, limits.tabs), active: nullable(string({ max: limits.path + 64 })) }),
  })(value, at);
  if (state.tabs.active !== null && !state.tabs.items.some(item => item.id === state.tabs.active)) state.tabs.active = state.tabs.items[0]?.id ?? null;
  return state;
};
