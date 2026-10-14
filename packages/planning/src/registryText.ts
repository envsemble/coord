// Add entries to planning.json the way a careful person would: insert text after the
// last entry in the style of its neighbours, and leave every other byte alone.
import { isDeepStrictEqual } from 'node:util';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
interface Node {
  start: number; end: number; kind: 'object' | 'array' | 'scalar';
  items: Node[]; members: { key: string; keyStart: number; keyEnd: number; value: Node }[];
}

export class RegistryFormatError extends Error {
  constructor(message: string) { super(message); this.name = 'RegistryFormatError'; }
}

const BOM = String.fromCharCode(0xfeff);
const whitespace = new Set([' ', '\t', '\r', '\n']);
function skip(text: string, index: number) {
  while (index < text.length && whitespace.has(text[index])) index++;
  return index;
}
function stringEnd(text: string, index: number) {
  for (let cursor = index + 1; cursor < text.length; cursor++) {
    if (text[cursor] === '\\') cursor++;
    else if (text[cursor] === '"') return cursor + 1;
  }
  throw new RegistryFormatError('planning.json has an unterminated string.');
}
function scan(text: string, index: number): Node {
  const start = skip(text, index);
  const node: Node = { start, end: start, kind: 'scalar', items: [], members: [] };
  const char = text[start];
  if (char === '{' || char === '[') {
    node.kind = char === '{' ? 'object' : 'array';
    const close = char === '{' ? '}' : ']';
    let cursor = skip(text, start + 1);
    if (text[cursor] === close) { node.end = cursor + 1; return node; }
    for (;;) {
      if (node.kind === 'object') {
        cursor = skip(text, cursor);
        if (text[cursor] !== '"') throw new RegistryFormatError('planning.json has an invalid object key.');
        const keyEnd = stringEnd(text, cursor);
        const key = JSON.parse(text.slice(cursor, keyEnd)) as string;
        const colon = skip(text, keyEnd);
        if (text[colon] !== ':') throw new RegistryFormatError('planning.json is missing a colon.');
        const value = scan(text, colon + 1);
        node.members.push({ key, keyStart: cursor, keyEnd, value });
        cursor = skip(text, value.end);
      } else {
        const value = scan(text, cursor);
        node.items.push(value);
        cursor = skip(text, value.end);
      }
      if (text[cursor] === ',') { cursor++; continue; }
      if (text[cursor] === close) { node.end = cursor + 1; return node; }
      throw new RegistryFormatError('planning.json has an unexpected character.');
    }
  }
  if (char === '"') { node.end = stringEnd(text, start); return node; }
  const scalar = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(start, start + 64));
  if (!scalar) throw new RegistryFormatError('planning.json has an invalid value.');
  node.end = start + scalar[0].length;
  return node;
}

function lineIndent(text: string, index: number) {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart, index))![0];
}
function multiline(text: string, node: Node) { return /[\r\n]/.test(text.slice(node.start, node.end)); }

interface Style { eol: string; unit: string }
/** Format a value like `template` (a sibling of the same shape), indenting continuation lines by `indent`. */
function format(value: Json, template: Node | undefined, text: string, indent: string, style: Style): string {
  if (Array.isArray(value)) {
    if (template?.kind === 'array' && template.items.length && multiline(text, template)) {
      const inner = lineIndent(text, template.items[0].start);
      return '[' + style.eol + value.map(item => inner + format(item, template.items[0], text, inner, style)).join(',' + style.eol) + style.eol + lineIndent(text, template.end - 1) + ']';
    }
    if (template?.kind === 'array' && template.items.length) {
      const open = text.slice(template.start + 1, template.items[0].start);
      const close = text.slice(template.items.at(-1)!.end, template.end - 1);
      const separator = template.items.length > 1 ? text.slice(template.items[0].end, template.items[1].start) : ', ';
      return value.length ? '[' + open + value.map(item => format(item, template.items[0], text, indent, style)).join(separator) + close + ']' : '[]';
    }
    return value.length ? '[' + value.map(item => format(item, undefined, text, indent, style)).join(', ') + ']' : '[]';
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    const order = template?.kind === 'object' ? template.members.map(member => member.key) : [];
    entries.sort((a, b) => (order.includes(a[0]) ? order.indexOf(a[0]) : order.length) - (order.includes(b[0]) ? order.indexOf(b[0]) : order.length));
    const memberTemplate = (key: string, item: Json) => template?.members.find(member => member.key === key)?.value
      ?? template?.members.find(member => member.value.kind === (Array.isArray(item) ? 'array' : item && typeof item === 'object' ? 'object' : 'scalar'))?.value;
    if (template?.kind === 'object' && template.members.length && !multiline(text, template)) {
      const first = template.members[0];
      const open = text.slice(template.start + 1, first.keyStart);
      const colon = text.slice(first.keyEnd, first.value.start);
      const close = text.slice(template.members.at(-1)!.value.end, template.end - 1);
      const separator = template.members.length > 1 ? text.slice(first.value.end, template.members[1].keyStart) : ', ';
      return '{' + open + entries.map(([key, item]) => JSON.stringify(key) + colon + format(item, memberTemplate(key, item), text, indent, style)).join(separator) + close + '}';
    }
    const inner = template?.kind === 'object' && template.members.length ? lineIndent(text, template.members[0].keyStart) : indent + style.unit;
    const colon = template?.kind === 'object' && template.members.length ? text.slice(template.members[0].keyEnd, template.members[0].value.start) : ': ';
    const closing = template?.kind === 'object' && template.members.length ? lineIndent(text, template.end - 1) : indent;
    if (!entries.length) return '{}';
    return '{' + style.eol + entries.map(([key, item]) => inner + JSON.stringify(key) + colon + format(item, memberTemplate(key, item), text, inner, style)).join(',' + style.eol) + style.eol + closing + '}';
  }
  return JSON.stringify(value);
}

/**
 * Return `source` with `entries` appended to the top-level array `key`, formatted like the
 * array's existing elements. Throws when the result would not parse to exactly the
 * original registry plus the new entries.
 */
export function appendRegistryEntries(source: string, key: string, entries: Json[]): string {
  if (!entries.length) return source;
  const bom = source.startsWith(BOM) ? 1 : 0;
  const root = scan(source, bom);
  if (root.kind !== 'object' || skip(source, root.end) !== source.length) throw new RegistryFormatError('planning.json must be one JSON object.');
  const member = root.members.find(item => item.key === key);
  if (!member || member.value.kind !== 'array') throw new RegistryFormatError(`planning.json needs a ${key} array.`);
  const array = member.value;
  const style: Style = { eol: source.includes('\r\n') ? '\r\n' : '\n', unit: '  ' };
  if (root.members.length && multiline(source, root)) style.unit = lineIndent(source, root.members[0].keyStart) || style.unit;
  let result: string;
  if (array.items.length) {
    const last = array.items.at(-1)!;
    const first = array.items[0];
    const indent = multiline(source, array) ? lineIndent(source, last.start) : lineIndent(source, member.keyStart);
    const separator = array.items.length > 1
      ? source.slice(array.items.at(-2)!.end, last.start)
      : multiline(source, array) ? ',' + style.eol + lineIndent(source, first.start) : ', ';
    const added = entries.map(entry => format(entry, last, source, indent, style)).join(separator);
    result = source.slice(0, last.end) + separator + added + source.slice(last.end);
  } else {
    const indent = lineIndent(source, member.keyStart);
    const inner = indent + style.unit;
    const added = '[' + style.eol + entries.map(entry => inner + format(entry, undefined, source, inner, style)).join(',' + style.eol) + style.eol + indent + ']';
    result = source.slice(0, array.start) + added + source.slice(array.end);
  }
  const before = JSON.parse(source.slice(bom)) as Record<string, Json[]>;
  const expected = { ...before, [key]: [...before[key], ...entries] };
  let after: unknown;
  try { after = JSON.parse(result.slice(bom)); } catch { throw new RegistryFormatError('planning.json could not be extended without changing its format.'); }
  if (!isDeepStrictEqual(after, expected)) throw new RegistryFormatError('planning.json could not be extended without changing its format.');
  return result;
}

/**
 * Return `source` with members of the entry whose `id` is `id` in the top-level array `key` set to
 * new values, each written in place of the old value; every other byte stays. Only members the
 * entry already has can be changed. Throws when the result would not parse to exactly the original
 * registry with those values changed.
 */
export function updateRegistryEntry(source: string, key: string, id: string, changes: Record<string, Json>): string {
  const bom = source.startsWith(BOM) ? 1 : 0;
  const root = scan(source, bom);
  if (root.kind !== 'object' || skip(source, root.end) !== source.length) throw new RegistryFormatError('planning.json must be one JSON object.');
  const array = root.members.find(item => item.key === key)?.value;
  if (!array || array.kind !== 'array') throw new RegistryFormatError(`planning.json needs a ${key} array.`);
  const index = array.items.findIndex(item => item.kind === 'object' && item.members.some(member => member.key === 'id' && source.slice(member.value.start, member.value.end) === JSON.stringify(id)));
  if (index < 0) throw new RegistryFormatError(`planning.json has no ${key} entry ${id}.`);
  const entry = array.items[index];
  const style: Style = { eol: source.includes('\r\n') ? '\r\n' : '\n', unit: '  ' };
  // Replace from the end, so earlier offsets stay valid.
  const replacements = Object.entries(changes).map(([name, value]) => {
    const member = entry.members.find(item => item.key === name);
    if (!member) throw new RegistryFormatError(`The ${key} entry ${id} has no ${name} to change.`);
    return { member, text: format(value, member.value, source, lineIndent(source, member.keyStart), style) };
  }).sort((a, b) => b.member.value.start - a.member.value.start);
  let result = source;
  for (const { member, text } of replacements) result = result.slice(0, member.value.start) + text + result.slice(member.value.end);
  const before = JSON.parse(source.slice(bom)) as Record<string, Record<string, Json>[]>;
  const expected = { ...before, [key]: before[key].map((item, position) => position === index ? { ...item, ...changes } : item) };
  let after: unknown;
  try { after = JSON.parse(result.slice(bom)); } catch { throw new RegistryFormatError('planning.json could not be changed without changing its format.'); }
  if (!isDeepStrictEqual(after, expected)) throw new RegistryFormatError('planning.json could not be changed without changing its format.');
  return result;
}
