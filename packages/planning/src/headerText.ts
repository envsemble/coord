// Change plan and ledger metadata headers the way a careful person would: rewrite the lines of the
// fields that change and leave every other byte alone, including line endings and a byte order
// mark. The ledger's steps are written in the one block form PLANS.md shows.
import type { LedgerStep } from './types.ts';

const BOM = String.fromCharCode(0xfeff);
/** Fields written as plain words; every other string is quoted, so YAML cannot read it as something else. */
const plainFields = new Set(['kind', 'design_status', 'implementation_status']);

export class HeaderError extends Error {
  constructor(message: string) { super(message); this.name = 'HeaderError'; }
}

/** The header block of a Markdown text (between the `---` lines), with its offsets and line ending. */
export function header(text: string) {
  const bom = text.startsWith(BOM) ? 1 : 0;
  const match = /^---(\r?\n)([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text.slice(bom));
  if (!match) return null;
  const start = bom + 3 + match[1].length;
  return { start, end: start + match[2].length, block: match[2], eol: match[1] };
}

/** A metadata value as the header writes it. */
export function yamlValue(field: string, value: string | number | null | string[]): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return '[' + value.map(item => JSON.stringify(item)).join(', ') + ']';
  return plainFields.has(field) && /^[a-z_]+$/.test(value) ? value : JSON.stringify(value);
}

/** Set top-level header fields; a field the header lacks is added at its end. */
export function setFields(text: string, fields: Record<string, string | number | null>): string {
  const found = header(text);
  if (!found) throw new HeaderError('The file has no metadata header.');
  let block = found.block;
  for (const [field, value] of Object.entries(fields)) {
    const line = field + ': ' + yamlValue(field, value);
    const pattern = new RegExp(`^${field}:(?:[ \\t][^\\r\\n]*)?$`, 'm');
    block = pattern.test(block) ? block.replace(pattern, () => line) : block + found.eol + line;
  }
  return text.slice(0, found.start) + block + text.slice(found.end);
}

/** Replace the ledger's `steps` list with these steps, one block entry per step. */
export function setSteps(text: string, steps: readonly LedgerStep[]): string {
  const found = header(text);
  if (!found) throw new HeaderError('The ledger has no metadata header.');
  const lines = found.block.split(/\r?\n/);
  const first = lines.findIndex(line => /^steps:(?:[ \t]|$)/.test(line));
  let last = first;
  // The list runs on while lines are indented, entries or blank.
  while (first >= 0 && last + 1 < lines.length && /^(?:[ \t]|-|$)/.test(lines[last + 1])) last++;
  const indent = (first >= 0 ? lines.slice(first + 1, last + 1).map(line => /^( *)- /.exec(line)?.[1]).find(value => value !== undefined) : undefined) ?? '  ';
  const written = steps.length
    ? ['steps:', ...steps.flatMap(step => [`${indent}- title: ${JSON.stringify(step.title)}`, `${indent}  status: ${step.status}`, ...step.phase ? [`${indent}  phase: ${step.phase}`] : []])]
    : ['steps: []'];
  const next = first >= 0 ? [...lines.slice(0, first), ...written, ...lines.slice(last + 1)] : [...lines, ...written];
  return text.slice(0, found.start) + next.join(found.eol) + text.slice(found.end);
}

/**
 * Add a line to the end of a Markdown section (`## Progress` by default), creating the section at
 * the end of the document when it has none.
 */
export function appendToSection(text: string, line: string, heading = '## Progress'): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(item => item.trim() === heading);
  if (start < 0) return text.replace(/(?:\r?\n)*$/, '') + eol + eol + heading + eol + eol + line + eol;
  let end = lines.findIndex((item, index) => index > start && /^#{1,2} /.test(item));
  if (end < 0) end = lines.length;
  // After the section's last nonblank line.
  let at = end;
  while (at > start + 1 && !lines[at - 1].trim()) at--;
  const insert = at === start + 1 ? ['', line] : [line];
  lines.splice(at, 0, ...insert);
  return lines.join(eol);
}
