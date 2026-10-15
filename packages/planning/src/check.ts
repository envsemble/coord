// Read-only validation for planning registry v1, plan metadata and ledger status headers.
//
// Accepts the contract's plain/quoted scalars and flow/block lists, plus the ledger's block list
// of flat step mappings; this is deliberately not a general YAML parser or migration tool. Quote string values that resemble implicit
// YAML booleans, nulls, numbers, or timestamps. Plain ISO dates remain compatible only in
// the contract's date fields. Ported from the former check_planning.py with the same rules
// and messages.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { ledgerStatus } from './ledger.ts';

const planFields = ['schema_version', 'kind', 'id', 'title', 'repositories', 'created', 'updated', 'design_status', 'implementation_status', 'accepted_at', 'completed_at', 'supersedes', 'superseded_by'];
const repositoryIdentity = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const workIdentity = /^work-[0-9]{4,}$/;
const designStates = new Set(['draft', 'accepted', 'superseded', 'abandoned']);
const implementationStates = new Set(['unknown', 'not_started', 'in_progress', 'partial', 'complete']);
const dateFields = new Set(['created', 'updated', 'accepted_at', 'completed_at']);
const hiddenNames = new Set(['node_modules', '__pycache__', 'dist', 'build']);
// Conservatively cover implicit numeric spellings across YAML 1.1 and 1.2,
// rather than treating resolver differences as evidence of a string value.
const implicitNumber = /^[+-]?(?:0[bBoOxX][0-9a-fA-F_]+|[0-9][0-9_]*(?::[0-9][0-9_]*)+(?:\.[0-9_]*)?|(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9_]+)(?:[eE][+-]?[0-9_]+)?|\.(?:inf|nan))$/i;
const isoDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export type Scalar = string | number | boolean | null;
/** One entry of a list of flat mappings, such as a ledger step. */
export type MetadataEntry = Record<string, Scalar>;
export type MetadataValue = Scalar | Scalar[] | MetadataEntry[];
export type Metadata = Record<string, MetadataValue>;
/** In a ledger header, `steps` holds a block list of flat mappings. */
const ledgerEntryLists = ['steps'];
/** Fields that may start a block list of scalars on the following lines. */
const scalarListFields = new Set(['repositories', 'supersedes']);

/** A metadata header the checker cannot certify; the message names the offending construct. */
export class FrontmatterError extends Error {
  constructor(message: string) { super(message); this.name = 'FrontmatterError'; }
}

// YAML's own whitespace is only space and tab, and its line breaks only \n and \r\n: Unicode
// spaces and separators are content, so trimming and comment detection must not use \s or trim().
const yamlTrim = (value: string) => value.replace(/^[ \t]+|[ \t]+$/g, '');
const blank = (value: string) => value.length > 0 && /^[ \t]*$/.test(value);
/** Characters YAML reads as line breaks or refuses, which a header line must not contain. */
const unsupportedInHeader = /[\r\v\f\x1c-\x1e\x85\u2028\u2029\uFEFF]/;

/** Split a flow sequence or remove a plain scalar comment outside quotes. */
function splitFlow(value: string, splitCommas = true): string[] {
  const parts: string[] = [];
  let start = 0, quote: string | null = null, index = 0;
  while (index < value.length) {
    const char = value[index];
    if (quote) {
      if (quote === '"' && char === '\\') { index += 2; continue; }
      if (char === quote) {
        if (quote === "'" && index + 1 < value.length && value[index + 1] === "'") { index += 2; continue; }
        quote = null;
      }
    } else if ((char === '"' || char === "'") && (index === start || blank(value.slice(start, index)))) {
      quote = char;
    } else if (char === ',' && splitCommas) {
      parts.push(yamlTrim(value.slice(start, index)));
      start = index + 1;
    } else if (char === '#' && (index === 0 || /[ \t]/.test(value[index - 1]))) {
      value = value.slice(0, index);
      break;
    }
    index++;
  }
  if (quote) throw new FrontmatterError('unterminated quoted scalar');
  parts.push(yamlTrim(value.slice(start)));
  return parts;
}

function scalar(raw: string, allowDate = false): Scalar {
  const value = yamlTrim(splitFlow(raw, false)[0]);
  if (value.startsWith('"')) {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch (error) { throw new FrontmatterError((error as Error).message); }
    if (typeof parsed !== 'string') throw new FrontmatterError('expected quoted string');
    return parsed;
  }
  if (value.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(value)) throw new FrontmatterError('invalid single-quoted scalar');
    return value.slice(1, -1).replaceAll("''", "'");
  }
  const lowered = value.toLowerCase();
  if (['null', '~', ''].includes(lowered)) return null;
  if (['true', 'false', 'yes', 'no', 'on', 'off', 'y', 'n'].includes(lowered)) return ['true', 'yes', 'on', 'y'].includes(lowered);
  if (/^[+-]?[0-9]+$/.test(value)) return Number.parseInt(value, 10);
  const plainDate = isoDate.test(value);
  if (plainDate && allowDate) return value;
  if (implicitNumber.test(value) || plainDate || /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:[Tt]|[ \t]+)[0-9]/.test(value)) {
    throw new FrontmatterError('ambiguous implicit YAML scalar; quote intended strings');
  }
  if (['{', '&', '*', '!', '|', '>'].some(indicator => value.startsWith(indicator))) {
    throw new FrontmatterError('unsupported structured YAML; metadata uses scalars and lists');
  }
  if (/:(?=[ \t]|$)/.test(value)) throw new FrontmatterError('invalid plain scalar mapping delimiter; quote the string');
  if (/^(?:[@`,\]}%]|[-?](?:[ \t]|$))/.test(value)) throw new FrontmatterError('invalid plain scalar leading indicator; quote the string');
  return value;
}

/** Find the closing bracket outside scalar quotes and YAML comments. */
function flowList(value: string): Scalar[] {
  let quote: string | null = null, start = 1, index = 1;
  while (index < value.length) {
    const char = value[index];
    if (quote) {
      if (quote === '"' && char === '\\') { index += 2; continue; }
      if (char === quote) {
        if (quote === "'" && index + 1 < value.length && value[index + 1] === "'") { index += 2; continue; }
        quote = null;
      }
    } else if ((char === '"' || char === "'") && (index === start || blank(value.slice(start, index)))) {
      quote = char;
    } else if (char === ',') {
      start = index + 1;
    } else if (char === '#' && (index === 0 || /[ \t]/.test(value[index - 1]))) {
      break;
    } else if (char === ']') {
      // After the list: nothing, or a comment separated by whitespace (YAML refuses `]#comment`).
      if (!/^(?:[ \t]*|[ \t]+#.*)$/.test(value.slice(index + 1))) throw new FrontmatterError('unexpected content after flow list');
      const contents = yamlTrim(value.slice(1, index));
      if (!contents) return [];
      const parts = splitFlow(contents);
      // YAML flow lists permit a trailing comma; it is not a null item.
      if (contents.endsWith(',')) parts.pop();
      return parts.map(part => scalar(part));
    }
    index++;
  }
  throw new FrontmatterError('missing flow list closing delimiter outside quotes/comments');
}

/** Split on YAML's line breaks (\n and \r\n), without a trailing empty line. */
function splitLines(text: string) {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * Parse a metadata header, or return null when the document has none. `entryLists` names the
 * fields that hold a block list of flat mappings (a ledger's `steps`); elsewhere such a field
 * is an ordinary scalar or list.
 */
export function parseFrontmatter(text: string, options: { entryLists?: readonly string[] } = {}): Metadata | null {
  const entryLists = new Set(options.entryLists ?? []);
  const lines = splitLines(text.replace(/^\uFEFF/, ''));
  if (!lines.length || lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new FrontmatterError('missing frontmatter closing delimiter');
  const fields: Metadata = Object.create(null);
  let blockKey: string | null = null;
  // In a list of mappings, YAML structure is indentation: every entry's dash must be in the same
  // column, and every field of an entry in the column of its first field. Only spaces indent.
  let dashColumn = -1, fieldColumn = -1;
  let entry: MetadataEntry | null = null;
  const setEntryField = (key: string, value: string) => {
    if (Object.hasOwn(entry!, key)) throw new FrontmatterError('duplicate field in ' + blockKey + ' entry: ' + key);
    if (!value || value.startsWith('#')) throw new FrontmatterError(blockKey + ' entries hold scalar values; ' + key + ' is empty');
    if (value.startsWith('[')) throw new FrontmatterError(blockKey + ' entries hold scalar values, not lists');
    entry![key] = scalar(value);
  };
  const closeBlock = () => {
    if (blockKey && entryLists.has(blockKey) && !(fields[blockKey] as MetadataEntry[]).length) {
      throw new FrontmatterError(blockKey + ' has no entries; write "' + blockKey + ': []" when there are none');
    }
  };
  for (const line of lines.slice(1, end)) {
    if (unsupportedInHeader.test(line)) throw new FrontmatterError('unsupported character in metadata (a line break or byte order mark YAML does not accept)');
    if (/^[ \t]*$/.test(line)) {
      if (line.includes('\t')) throw new FrontmatterError('blank metadata lines may not contain tabs');
      continue;
    }
    if (/^[ \t]*#/.test(line)) continue;
    if (blockKey && entryLists.has(blockKey) && /^[ \t]/.test(line)) {
      if (/^ *\t/.test(line) || !/^ +[^ \t]/.test(line)) throw new FrontmatterError(blockKey + ' entries are indented with spaces only');
      const start = /^( *)(- +)([a-z_]+):(?: (.*))?$/.exec(line);
      if (start) {
        if (dashColumn >= 0 && start[1].length !== dashColumn) throw new FrontmatterError('every ' + blockKey + ' entry starts with "-" in the same column');
        dashColumn = start[1].length;
        fieldColumn = start[1].length + start[2].length;
        entry = Object.create(null) as MetadataEntry;
        (fields[blockKey] as MetadataEntry[]).push(entry);
        setEntryField(start[3], yamlTrim(start[4] ?? ''));
        continue;
      }
      const field = /^( *)([a-z_]+):(?: (.*))?$/.exec(line);
      if (field && entry && field[1].length === fieldColumn) { setEntryField(field[2], yamlTrim(field[3] ?? '')); continue; }
      throw new FrontmatterError('unsupported line in ' + blockKey + ' (each field of an entry is "key: value", aligned under the first): ' + line);
    }
    if (blockKey && entryLists.has(blockKey) && line.startsWith('-')) {
      const start = /^(- +)([a-z_]+):(?: (.*))?$/.exec(line);
      if (!start) throw new FrontmatterError('unsupported line in ' + blockKey + ': ' + line);
      if (dashColumn > 0) throw new FrontmatterError('every ' + blockKey + ' entry starts with "-" in the same column');
      dashColumn = 0;
      fieldColumn = start[1].length;
      entry = Object.create(null) as MetadataEntry;
      (fields[blockKey] as MetadataEntry[]).push(entry);
      setEntryField(start[2], yamlTrim(start[3] ?? ''));
      continue;
    }
    const item = /^[ \t]*-[ \t]+(.+)$/.exec(line);
    if (item && blockKey && scalarListFields.has(blockKey)) { (fields[blockKey] as Scalar[]).push(scalar(item[1])); continue; }
    // `key:value` without a space is not a mapping in YAML.
    const match = /^([a-z_]+):(?:[ \t]+(.*))?$/.exec(line);
    if (!match) throw new FrontmatterError('unsupported metadata line: ' + line);
    const key = match[1], value = yamlTrim(match[2] ?? '');
    if (Object.hasOwn(fields, key)) throw new FrontmatterError('duplicate metadata field: ' + key);
    closeBlock();
    blockKey = null; entry = null; dashColumn = -1; fieldColumn = -1;
    if (!value || value.startsWith('#')) {
      if (scalarListFields.has(key) || entryLists.has(key)) { fields[key] = []; blockKey = key; }
      else fields[key] = null;
    } else if (value.startsWith('[')) {
      fields[key] = flowList(value);
      if (entryLists.has(key) && (fields[key] as Scalar[]).length) throw new FrontmatterError(key + ' entries use a block list, one "- title:" entry per line');
    }
    else fields[key] = scalar(value, dateFields.has(key));
  }
  closeBlock();
  return fields;
}

function calendarError(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1) return 'year ' + year + ' is out of range';
  if (month < 1 || month > 12) return 'month must be in 1..12';
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return 'day is out of range for month';
  return null;
}
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInteger = (value: unknown) => typeof value === 'number' && Number.isInteger(value);
const exists = (target: string) => statSync(target, { throwIfNoEntry: false }) !== undefined;
const isDirectory = (target: string) => statSync(target, { throwIfNoEntry: false })?.isDirectory() ?? false;
const isFile = (target: string) => statSync(target, { throwIfNoEntry: false })?.isFile() ?? false;
// Path comparisons follow the host's path rules: case-insensitive on Windows.
const pathKey = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
function within(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}
/** Resolve symbolic links for the existing part of a path, keeping any missing remainder. */
function resolveLenient(target: string) {
  let ancestor = path.resolve(target);
  const suffix: string[] = [];
  for (;;) {
    try { return path.join(realpathSync.native(ancestor), ...suffix); }
    catch {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return path.resolve(target);
      suffix.unshift(path.basename(ancestor)); ancestor = parent;
    }
  }
}
/**
 * Undecodable bytes are reported, never silently replaced. A metadata header keeps its byte order
 * mark, so the parser removes exactly one, as the app does; other text loses it.
 */
function readText(filename: string, keepByteOrderMark = false) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(filename));
  return keepByteOrderMark ? text : text.replace(/^\uFEFF/, '');
}
function sameSet(first: Set<string>, second: Set<string>) {
  return first.size === second.size && [...first].every(item => second.has(item));
}

/** Return errors and warnings without modifying any repository file. */
export function validatePlanning(inputRoot: string): { errors: string[]; warnings: string[] } {
  const root = resolveLenient(inputRoot);
  const errors: string[] = [], warnings: string[] = [];
  let registry: unknown;
  try { registry = JSON.parse(readText(path.join(root, 'planning.json'))); }
  catch (error) { return { errors: ['planning.json: ' + (error as Error).message], warnings }; }
  if (!isObject(registry)) return { errors: ['planning.json must be an object'], warnings };
  if (!isInteger(registry.schema_version) || registry.schema_version !== 1) errors.push('registry schema_version must be integer 1');
  for (const field of ['repositories', 'work_items']) if (!Array.isArray(registry[field])) errors.push(field + ' must be an array');
  // The project's name, which the app shows; the folder's own name without it.
  if (Object.hasOwn(registry, 'name') && (typeof registry.name !== 'string' || !registry.name.trim() || registry.name.length > 100)) errors.push('name must be a nonempty string of at most 100 characters when supplied');
  // The workspace folders the project covers on this computer: a session in one belongs to it.
  if (Object.hasOwn(registry, 'workspaces') && (!Array.isArray(registry.workspaces) || registry.workspaces.some(item => typeof item !== 'string' || !item.trim() || !path.isAbsolute(item)))) errors.push('workspaces must be an array of absolute folder paths when supplied');
  if (errors.length) return { errors, warnings };
  const repositories = registry.repositories as unknown[], workItems = registry.work_items as unknown[];

  const repositoryIds = new Set<string>();
  function scope(value: unknown, label: string) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
      errors.push(label + ' must be an array of repository IDs');
      return new Set<string>();
    }
    const unique = new Set(value as string[]);
    if (unique.size !== value.length) errors.push(label + ' contains duplicate repository IDs');
    const unknown = [...unique].filter(id => !repositoryIds.has(id)).sort();
    if (unknown.length) errors.push(label + ' contains unknown repository IDs: ' + unknown.join(', '));
    return unique;
  }
  function contained(value: unknown, label: string) {
    if (typeof value !== 'string' || !value || value.includes('\\')) {
      errors.push(label + ' must be a nonempty POSIX relative path');
      return null;
    }
    const parts = value.split('/').filter(part => part !== '' && part !== '.');
    if (value.startsWith('/') || parts.includes('..') || value.includes(':') || !parts.length) {
      errors.push(label + ' must stay inside planning');
      return null;
    }
    if (parts.some(part => part.startsWith('.') || hiddenNames.has(part))) {
      errors.push(label + ' is hidden from the dashboard');
      return null;
    }
    const target = resolveLenient(path.join(root, value));
    if (!within(root, target)) {
      errors.push(label + ' resolves outside planning');
      return null;
    }
    if (path.relative(root, target).split(path.sep).some(part => part.startsWith('.') || hiddenNames.has(part))) {
      errors.push(label + ' resolves to a path hidden from the dashboard');
      return null;
    }
    if (!exists(target)) errors.push(label + ' does not exist: ' + value);
    return target;
  }

  repositories.forEach((entry, index) => {
    const label = `repositories[${index}]`;
    if (!isObject(entry)) { errors.push(label + ' must be an object'); return; }
    const id = entry.id;
    if (typeof id !== 'string' || !repositoryIdentity.test(id)) errors.push(label + ' has invalid id');
    else if (repositoryIds.has(id)) errors.push('duplicate repository id: ' + id);
    else repositoryIds.add(id);
    if (typeof entry.name !== 'string' || !entry.name.trim()) errors.push(label + ' needs a nonempty name');
    for (const field of ['path', 'remote']) {
      const value = entry[field];
      if (Object.hasOwn(entry, field) && (typeof value !== 'string' || !value.trim())) errors.push(label + '.' + field + ' must be a nonempty string when supplied');
    }
  });

  const workIds = new Set<string>(), locations = new Set<string>();
  const plans: { pointer: string; metadata: Metadata; workId: unknown; workScope: Set<string>; location: unknown }[] = [];
  /** Per work ID, the ledger's open items: steps not done, and blocked. */
  const openItems = new Map<string, number>();
  workItems.forEach((entry, index) => {
    const label = `work_items[${index}]`;
    if (!isObject(entry)) { errors.push(label + ' must be an object'); return; }
    const workId = entry.id;
    if (typeof workId !== 'string' || !workIdentity.test(workId)) errors.push(label + ' has invalid id');
    else if (workIds.has(workId)) errors.push('duplicate work id: ' + workId);
    else workIds.add(workId);
    const location = contained(entry.path, label + '.path');
    if (location !== null && locations.has(pathKey(location))) errors.push(label + ' duplicates a retained location');
    if (location !== null) locations.add(pathKey(location));
    const workScope = scope(entry.repositories, label + '.repositories');
    if (!workScope.size) warnings.push(label + ': legacy repository scope is unknown');
    if (!Object.hasOwn(entry, 'current_plan')) { errors.push(label + ' needs an explicit current_plan or null'); return; }
    const pointer = entry.current_plan;
    if (pointer === null) { warnings.push(label + ': main plan is unidentified'); return; }
    const planPath = contained(pointer, label + '.current_plan');
    if (planPath === null) return;
    if (location !== null && !(pathKey(planPath) === pathKey(location) || (isDirectory(location) && within(location, planPath)))) {
      errors.push(label + '.current_plan is outside its work item');
    }
    if (!isFile(planPath)) { errors.push(label + '.current_plan must identify a file'); return; }
    if (location !== null && isDirectory(location) && pathKey(planPath) !== pathKey(path.join(location, 'plan.md'))) {
      warnings.push(String(pointer) + ': retained legacy main plan name; normalize to root plan.md during organization');
    }
    let metadata: Metadata | null;
    try { metadata = parseFrontmatter(readText(planPath, true)); }
    catch (error) { errors.push(String(pointer) + ': ' + (error as Error).message); return; }
    if (metadata === null) { warnings.push(String(pointer) + ': legacy plan has no frontmatter; metadata not validated'); return; }
    plans.push({ pointer: String(pointer), metadata, workId, workScope, location: entry.path });
  });

  for (const { pointer, metadata, workId, workScope, location } of plans) {
    const prefix = pointer + ': ';
    const missing = planFields.filter(field => !Object.hasOwn(metadata, field)).sort();
    if (missing.length) errors.push(prefix + 'missing fields: ' + missing.join(', '));
    if (!isInteger(metadata.schema_version) || metadata.schema_version !== 1) errors.push(prefix + 'schema_version must be integer 1');
    if (metadata.kind !== 'plan') errors.push(prefix + 'kind must be plan');
    if (metadata.id !== workId) errors.push(prefix + 'id disagrees with registry');
    if (typeof metadata.title !== 'string' || !metadata.title.trim()) errors.push(prefix + 'title must be a nonempty string');
    // The summary is optional in the contract, but active work keeps one for the people and agents who find it.
    if (metadata.summary !== undefined && metadata.summary !== null && typeof metadata.summary !== 'string') errors.push(prefix + 'summary must be a string or null');
    else if (typeof location === 'string' && location.startsWith('active/') && !(typeof metadata.summary === 'string' && metadata.summary.trim())) {
      warnings.push(prefix + 'no summary: add one to the header, two or three plain sentences on what the work is, why, and where it stands');
    }
    if (!sameSet(scope(metadata.repositories, prefix + 'repositories'), workScope)) errors.push(prefix + 'repository scope disagrees with registry');
    for (const [field, allowed] of [['design_status', designStates], ['implementation_status', implementationStates]] as const) {
      const value = metadata[field];
      if (typeof value !== 'string' || !allowed.has(value)) errors.push(prefix + 'invalid ' + field);
    }
    const dates: Record<string, string> = {};
    for (const field of ['created', 'updated', 'accepted_at', 'completed_at']) {
      const value = metadata[field];
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string' || !isoDate.test(value) || calendarError(value)) errors.push(prefix + field + ' must be an ISO date string or null');
      else dates[field] = value;
    }
    const chronology = [['created', 'updated'], ['accepted_at', 'updated'], ['completed_at', 'updated'], ['created', 'accepted_at'], ['created', 'completed_at'], ['accepted_at', 'completed_at']];
    if (chronology.some(([earlier, later]) => dates[earlier] && dates[later] && dates[earlier] > dates[later])) errors.push(prefix + 'Recorded lifecycle dates are out of order');
    if (metadata.completed_at !== null && metadata.completed_at !== undefined && metadata.implementation_status !== 'complete') errors.push(prefix + 'completed_at requires complete implementation_status');
    if (metadata.accepted_at !== null && metadata.accepted_at !== undefined && metadata.design_status === 'draft') errors.push(prefix + 'draft cannot claim accepted_at');
    const replaced = metadata.supersedes;
    if (!Array.isArray(replaced) || replaced.some(item => typeof item !== 'string' || !workIds.has(item))) errors.push(prefix + 'supersedes must list registered work IDs');
    else if (new Set(replaced as Scalar[]).size !== replaced.length || (replaced as Scalar[]).includes(workId as string)) errors.push(prefix + 'supersedes contains duplicate or self IDs');
    const replacement = metadata.superseded_by;
    if (replacement !== null && replacement !== undefined && (typeof replacement !== 'string' || !workIds.has(replacement) || replacement === workId)) {
      errors.push(prefix + 'superseded_by must identify another registered work item or null');
    }
  }

  for (const entry of workItems) {
    if (!isObject(entry) || typeof entry.path !== 'string') continue;
    const location = contained(entry.path, 'ledger work location');
    if (location === null || !isDirectory(location)) continue;
    const ledger = path.join(location, 'ledger.md');
    if (!isFile(ledger)) continue;
    if (contained(path.relative(root, ledger).split(path.sep).join('/'), 'ledger') === null) continue;
    try {
      const metadata = parseFrontmatter(readText(ledger, true), { entryLists: ledgerEntryLists });
      if (metadata === null) continue; // Retained historical prose does not establish current activity.
      const updated = metadata.updated;
      const invalidDate = typeof updated === 'string' && isoDate.test(updated) ? calendarError(updated) : null;
      if (invalidDate) throw new FrontmatterError(invalidDate);
      if (typeof entry.id !== 'string') continue;
      let status;
      try { status = ledgerStatus(metadata, entry.id); }
      catch (error) { throw new FrontmatterError('invalid ledger status metadata: ' + (error as Error).message); }
      openItems.set(entry.id, (status.steps ?? []).filter(step => step.status !== 'done').length + (status.blocked ? 1 : 0));
    } catch (error) {
      errors.push(path.relative(root, ledger) + ': ' + (error as Error).message);
    }
  }
  // Archived work is complete, superseded or abandoned: archiving never hides work still open.
  for (const { pointer, metadata, workId, location } of plans) {
    if (typeof location !== 'string' || !location.startsWith('archive/') || metadata.design_status === 'superseded' || metadata.design_status === 'abandoned') continue;
    const open = openItems.get(String(workId)) ?? 0;
    if (open || metadata.implementation_status === 'in_progress') {
      errors.push(pointer + ': archived ' + (open ? `with ${open} open ledger ${open === 1 ? 'item' : 'items'}` : 'while its implementation is in_progress') + ' but neither superseded nor abandoned; reopen it, close it, or give it that disposition');
    }
  }
  return { errors, warnings };
}

