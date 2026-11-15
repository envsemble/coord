// Granting the Coord home to the agents, so they can edit planning prose from any checkout: Claude
// Code's permissions.additionalDirectories (settings.json) and Codex's [sandbox_workspace_write]
// writable_roots (config.toml). Each edit changes only that list and keeps the rest of the file as
// it was written.
import path from 'node:path';
import { folderKey } from '../home/database.ts';

const same = (left: string, right: string) => folderKey(path.resolve(left)) === folderKey(path.resolve(right));

// Where the members of a JSON object or the items of a list are in the text (of valid JSON).
interface JsonContainer { close: number; items: { key: string | null; start: number; end: number }[] }
const skipSpace = (text: string, index: number) => { while (/[ \t\r\n]/.test(text[index] ?? '')) index++; return index; };
function stringEnd(text: string, index: number) {
  index++;
  while (text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
  return index + 1;
}
function valueEnd(text: string, index: number): number {
  if (text[index] === '"') return stringEnd(text, index);
  if (text[index] === '{' || text[index] === '[') return jsonContainer(text, index).close + 1;
  while (index < text.length && !/[ \t\r\n,\]}]/.test(text[index])) index++;
  return index;
}
function jsonContainer(text: string, open: number): JsonContainer {
  const items: JsonContainer['items'] = [];
  let index = skipSpace(text, open + 1);
  while (text[index] !== '}' && text[index] !== ']') {
    let key: string | null = null;
    if (text[open] === '{') {
      const end = stringEnd(text, index);
      key = JSON.parse(text.slice(index, end)) as string;
      index = skipSpace(text, skipSpace(text, end) + 1);
    }
    const end = valueEnd(text, index);
    items.push({ key, start: index, end });
    index = skipSpace(text, end);
    if (text[index] === ',') index = skipSpace(text, index + 1);
  }
  return { close: index, items };
}
/** Insert a member (or, with a null key, a list item) after the container's last one, in the style of its lines. */
function insertJson(text: string, container: JsonContainer, key: string | null, value: unknown, unit: string, eol: string) {
  const last = container.items.at(-1);
  const multiline = last !== undefined && /\n/.test(text.slice(last.end, container.close));
  const indent = multiline ? /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', last.start) + 1))![0] : '';
  const rendered = multiline ? JSON.stringify(value, null, unit).replace(/\n/g, eol + indent) : JSON.stringify(value, null, 1).replace(/\n\s*/g, ' ');
  const item = (key === null ? '' : JSON.stringify(key) + ': ') + rendered;
  if (!last) return text.slice(0, container.close) + item + text.slice(container.close);
  return text.slice(0, last.end) + (multiline ? ',' + eol + indent : ', ') + item + text.slice(last.end);
}

/**
 * Claude Code's settings with `directory` in permissions.additionalDirectories, changing only that
 * list (or adding the key or `permissions`) and keeping the rest of the text as it is; null when it
 * is there already.
 */
export function grantClaudeDirectory(text: string | null, directory: string): string | null {
  const settings = text === null || !text.trim() ? {} : JSON.parse(text.replace(/^﻿/, '')) as Record<string, unknown>;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('the settings are not a JSON object');
  const permissions = settings.permissions === undefined ? {} : settings.permissions;
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) throw new Error('permissions is not an object');
  const listed = (permissions as Record<string, unknown>).additionalDirectories, directories = listed === undefined ? [] : listed;
  if (!Array.isArray(directories)) throw new Error('permissions.additionalDirectories is not a list');
  if (directories.some(item => typeof item === 'string' && same(item, directory))) return null;
  const unit = /^﻿?\{\r?\n([ \t]+)"/.exec(text ?? '')?.[1] ?? '  ';
  const eol = text?.includes('\r\n') ? '\r\n' : '\n';
  if (text === null || !Object.keys(settings).length) {
    return JSON.stringify({ ...settings, permissions: { additionalDirectories: [directory] } }, null, unit).replace(/\n/g, eol) + eol;
  }
  // Duplicate keys: JSON.parse keeps the last, and so does this.
  const top = jsonContainer(text, text.indexOf('{'));
  const member = top.items.findLast(item => item.key === 'permissions');
  if (!member) return insertJson(text, top, 'permissions', { additionalDirectories: [directory] }, unit, eol);
  const inner = jsonContainer(text, member.start);
  const list = inner.items.findLast(item => item.key === 'additionalDirectories');
  if (!list) return insertJson(text, inner, 'additionalDirectories', [directory], unit, eol);
  return insertJson(text, jsonContainer(text, list.start), null, directory, unit, eol);
}

// Just enough of TOML to edit one key of a config.toml safely, and to read Codex's hook trust
// (trust.ts): its tables and keys (quoted keys read as what they name), where each value is, and
// nothing inside strings or comments. Anything else throws, and the file is left alone.
const tomlSpace = (text: string, index: number) => { while (text[index] === ' ' || text[index] === '\t') index++; return index; };
const tomlLineEnd = (text: string, index: number) => { while (index < text.length && text[index] !== '\n' && text[index] !== '\r') index++; return index; };
/** The TOML string starting at `index`: where it ends, and its text. */
export function tomlStringAt(text: string, index: number): { end: number; value: string } {
  const quote = text[index];
  if (text.startsWith(quote.repeat(3), index)) {
    let cursor = index + 3;
    while (cursor < text.length && !text.startsWith(quote.repeat(3), cursor)) cursor += quote === '"' && text[cursor] === '\\' ? 2 : 1;
    if (cursor >= text.length) throw new Error('a multi-line string does not end');
    // Up to two more quotes belong to the string.
    let end = cursor + 3;
    while (text[end] === quote && end < cursor + 5) end++;
    return { end, value: text.slice(index + 3, end - 3).replace(/^\r?\n/, '') };
  }
  let cursor = index + 1;
  while (cursor < text.length && text[cursor] !== quote && text[cursor] !== '\n') cursor += quote === '"' && text[cursor] === '\\' ? 2 : 1;
  if (text[cursor] !== quote) throw new Error('a string does not end on its line');
  const raw = text.slice(index, cursor + 1);
  return { end: cursor + 1, value: quote === "'" ? raw.slice(1, -1) : tomlBasic(raw.slice(1, -1)) };
}
const tomlEscapes: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };
/** A basic string's text, its escapes decoded as TOML defines them. */
function tomlBasic(body: string) {
  if (/[\u0000-\u0008\u000A-\u001F\u007F]/.test(body)) throw new Error('a string holds a control character');
  return body.replace(/\\(?:u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8})|x([0-9A-Fa-f]{2})|(.))/g, (_, short: string, long: string, byte: string, other: string) => {
    if (short || long || byte) return String.fromCodePoint(parseInt(short ?? long ?? byte, 16));
    if (other in tomlEscapes) return tomlEscapes[other];
    throw new Error('a string has an unknown escape');
  });
}
/** The dotted key starting at `index`, as its parts. */
function tomlKeyAt(text: string, index: number): { end: number; path: string[] } {
  const path: string[] = [], bare = /[A-Za-z0-9_-]+/y;
  for (;;) {
    index = tomlSpace(text, index);
    if (text[index] === '"' || text[index] === "'") {
      if (text.startsWith(text[index].repeat(3), index)) throw new Error('a key could not be read');
      const read = tomlStringAt(text, index);
      path.push(read.value);
      index = read.end;
    } else {
      bare.lastIndex = index;
      const part = bare.exec(text)?.[0];
      if (!part) throw new Error('a key could not be read');
      path.push(part);
      index += part.length;
    }
    index = tomlSpace(text, index);
    if (text[index] !== '.') return { end: index, path };
    index++;
  }
}
/** Where the value starting at `index` ends: a string, list or inline table whole, else at the comment or line end. */
function tomlValueEnd(text: string, index: number): number {
  const start = index;
  let depth = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'") { index = tomlStringAt(text, index).end; if (!depth) return index; continue; }
    if (char === '#' || char === '\n' || char === '\r') {
      if (!depth) break;
      index = char === '#' ? tomlLineEnd(text, index) : index + 1;
      continue;
    }
    if (char === '[' || char === '{') depth++;
    else if (char === ']' || char === '}') { if (!depth) break; if (!--depth) return index + 1; }
    index++;
  }
  if (depth) throw new Error('a list or inline table does not end');
  while (index > start && (text[index - 1] === ' ' || text[index - 1] === '\t')) index--;
  if (index === start) throw new Error('a key has no value');
  return index;
}
export interface TomlTable { path: string[]; array: boolean; lineEnd: number }
export interface TomlKey { table: string[]; key: string[]; start: number; value: number }
export function tomlStructure(text: string): { tables: TomlTable[]; keys: TomlKey[] } {
  const tables: TomlTable[] = [], keys: TomlKey[] = [];
  let table: string[] = [], index = text.startsWith('﻿') ? 1 : 0;
  while (index < text.length) {
    if (/[ \t\r\n]/.test(text[index])) { index++; continue; }
    if (text[index] === '#') { index = tomlLineEnd(text, index); continue; }
    let header: TomlTable | null = null;
    if (text[index] === '[') {
      const array = text[index + 1] === '[';
      const read = tomlKeyAt(text, index + (array ? 2 : 1));
      if (!text.startsWith(array ? ']]' : ']', read.end)) throw new Error('a table header could not be read');
      index = read.end + (array ? 2 : 1);
      table = read.path;
      tables.push(header = { path: read.path, array, lineEnd: 0 });
    } else {
      const read = tomlKeyAt(text, index);
      if (text[read.end] !== '=') throw new Error('a line is neither a table header nor a key');
      const value = tomlSpace(text, read.end + 1);
      keys.push({ table, key: read.path, start: index, value });
      index = tomlValueEnd(text, value);
    }
    // The rest of the line may hold only a comment.
    index = tomlSpace(text, index);
    if (text[index] === '#') index = tomlLineEnd(text, index);
    if (index < text.length && text[index] !== '\n' && text[index] !== '\r') throw new Error('a line holds more than one key or table');
    if (header) header.lineEnd = index;
  }
  return { tables, keys };
}

/** The strings of the TOML list starting at `start` (a `[`), and where it ends. */
function tomlArray(text: string, start: number): { end: number; items: string[] } {
  const items: string[] = [];
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === ']') return { end: index + 1, items };
    if (char === '#') { index = tomlLineEnd(text, index); continue; }
    if (char === "'" || char === '"') {
      const read = tomlStringAt(text, index);
      items.push(read.value);
      index = read.end;
      continue;
    }
    if (!/[\s,]/.test(char)) throw new Error('writable_roots holds something other than strings');
    index++;
  }
  throw new Error('writable_roots is not a complete list');
}
const tomlString = (value: string) => value.includes("'") || /[\r\n]/.test(value) ? JSON.stringify(value) : "'" + value + "'";

/**
 * Codex's config.toml with `directory` in [sandbox_workspace_write] writable_roots, changing only
 * that list (or adding the key, as a dotted key when the table is defined by dotted keys, or the
 * table); null when it is there already. Throws, saying what to add by hand, when the file is
 * written in a way this cannot edit safely.
 */
export function grantCodexRoot(text: string | null, directory: string): string | null {
  const source = text ?? '';
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const entry = tomlString(directory);
  const name = 'sandbox_workspace_write';
  try {
    const { tables, keys } = tomlStructure(source);
    const is = (path: string[], ...expected: string[]) => path.length === expected.length && path.every((part, index) => part === expected[index]);
    const full = keys.map(key => ({ ...key, path: [...key.table, ...key.key] }));
    if (tables.some(table => table.array && table.path[0] === name)) throw new Error(`${name} is a list of tables`);
    if (full.some(key => is(key.path, name))) throw new Error(`${name} is an inline table`);
    if ([...full, ...tables].some(item => item.path.length > 2 && item.path[0] === name && item.path[1] === 'writable_roots')) throw new Error('writable_roots is not a list');
    const roots = full.find(key => is(key.path, name, 'writable_roots'));
    if (roots) {
      const open = roots.value;
      if (source[open] !== '[') throw new Error('writable_roots is not a list');
      const { end, items } = tomlArray(source, open);
      if (items.some(item => same(item, directory))) return null;
      const inner = source.slice(open + 1, end - 1);
      let replaced: string;
      if (!items.length) replaced = '[' + entry + ']';
      else if (!/[\r\n]/.test(inner)) replaced = '[' + inner.replace(/[ \t,]*$/, '') + ', ' + entry + ']';
      else {
        // One item per line: a new line in the style of the last, before the closing bracket's line.
        const lines = inner.split(/\r?\n/);
        const last = [...lines].reverse().find(item => /['"]/.test(item)) ?? '';
        const indent = /^[ \t]*/.exec(last)![0];
        const closing = lines.pop()!;
        while (lines.length && !lines.at(-1)!.trim()) lines.pop();
        const lastIndex = lines.length - 1;
        if (!/,\s*(?:#.*)?$/.test(lines[lastIndex])) lines[lastIndex] = lines[lastIndex].replace(/(['"])(\s*(?:#.*)?)$/, '$1,$2');
        replaced = '[' + [...lines, indent + entry + ',', closing].join(eol) + ']';
      }
      return source.slice(0, open) + replaced + source.slice(end);
    }
    const header = tables.find(table => !table.array && is(table.path, name));
    if (header) return source.slice(0, header.lineEnd) + eol + 'writable_roots = [' + entry + ']' + source.slice(header.lineEnd);
    // The table defined by dotted keys (`sandbox_workspace_write.network_access = true`) cannot also
    // have a header: add the key as one more dotted key, before the first.
    const dotted = full.find(key => !key.table.length && key.path[0] === name);
    if (dotted) {
      const at = Math.max(source.lastIndexOf('\n', dotted.start - 1) + 1, source.startsWith('﻿') ? 1 : 0);
      return source.slice(0, at) + name + '.writable_roots = [' + entry + ']' + eol + source.slice(at);
    }
    const table = '[' + name + ']' + eol + 'writable_roots = [' + entry + ']' + eol;
    return !source ? table : source + (source.endsWith('\n') ? eol : eol + eol) + table;
  } catch (error) {
    throw new Error(`${(error as Error).message}; add ${entry} to [${name}] writable_roots by hand`);
  }
}
