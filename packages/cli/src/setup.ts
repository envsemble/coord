// `atlas setup`: make Atlas part of every agent session on this computer. It creates the Atlas home
// (moving the old data folder's files into it, refused while an older Atlas uses them), grants the home to Claude Code
// (permissions.additionalDirectories) and Codex ([sandbox_workspace_write] writable_roots) so agents
// can edit planning prose from any checkout, and installs the Atlas plugin into each harness on PATH
// through the harness's own commands. Running it again changes nothing. --dry-run only says what it
// would do. HOME/USERPROFILE, CLAUDE_CONFIG_DIR, CODEX_HOME and PATH choose what it touches.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atlasAppRunning, atlasHome, legacyData, legacyDataDirectory, migrateLegacyData, prepareHome, samePlatformPath } from '@envsemble/atlas-planning';
import { hostRunning } from '@envsemble/atlas-host';
import { parseOptions, positionals, wantsHelp, type Output } from './args.ts';

const line = 'Usage: atlas setup [--dry-run]';
/** The Atlas repository: its marketplace manifests name the plugin in plugin/. */
export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function userHome(environment: NodeJS.ProcessEnv) {
  return (process.platform === 'win32' ? environment.USERPROFILE || environment.HOME : environment.HOME) || homedir();
}
const same = (left: string, right: string) => samePlatformPath(path.resolve(left), path.resolve(right));

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

/** The strings of the TOML array starting at `start` (a `[`), and where it ends. */
function tomlArray(text: string, start: number): { end: number; items: string[] } {
  const items: string[] = [];
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === ']') return { end: index + 1, items };
    if (char === '#') { while (index < text.length && text[index] !== '\n') index++; continue; }
    if (char === "'") {
      const close = text.indexOf("'", index + 1);
      if (close < 0) break;
      items.push(text.slice(index + 1, close));
      index = close + 1;
      continue;
    }
    if (char === '"') {
      let cursor = index + 1;
      while (cursor < text.length && text[cursor] !== '"') cursor += text[cursor] === '\\' ? 2 : 1;
      items.push(JSON.parse(text.slice(index, cursor + 1)));
      index = cursor + 1;
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
 * table); null when it is there already.
 */
export function grantCodexRoot(text: string | null, directory: string): string | null {
  const source = text ?? '';
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const entry = tomlString(directory);
  if (/^[ \t]*sandbox_workspace_write[ \t]*=/m.test(source)) throw new Error('sandbox_workspace_write is an inline table; add the home to its writable_roots by hand');
  const header = /^[ \t]*\[[ \t]*sandbox_workspace_write[ \t]*\][ \t]*(?:#[^\r\n]*)?$/m.exec(source);
  // The key: in the table, or as a dotted key before the first table.
  let section: { start: number; end: number } | null = null;
  let keyPattern: RegExp;
  if (header) {
    const start = header.index + header[0].length;
    const next = /^[ \t]*\[/m.exec(source.slice(start));
    section = { start, end: next ? start + next.index : source.length };
    keyPattern = /^[ \t]*writable_roots[ \t]*=[ \t]*/m;
  } else {
    const first = /^[ \t]*\[/m.exec(source);
    section = { start: 0, end: first ? first.index : source.length };
    keyPattern = /^[ \t]*sandbox_workspace_write\.writable_roots[ \t]*=[ \t]*/m;
  }
  const found = keyPattern.exec(source.slice(section.start, section.end));
  if (found) {
    const open = section.start + found.index + found[0].length;
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
  if (header) {
    const at = header.index + header[0].length;
    return source.slice(0, at) + eol + 'writable_roots = [' + entry + ']' + source.slice(at);
  }
  // The table defined by dotted keys (`sandbox_workspace_write.network_access = true`) cannot also
  // have a header: add the key as one more dotted key, before the first.
  const dotted = /^[ \t]*sandbox_workspace_write[ \t]*\./m.exec(source.slice(section.start, section.end));
  if (dotted) return source.slice(0, dotted.index) + 'sandbox_workspace_write.writable_roots = [' + entry + ']' + eol + source.slice(dotted.index);
  const table = '[sandbox_workspace_write]' + eol + 'writable_roots = [' + entry + ']' + eol;
  return !source ? table : source + (source.endsWith('\n') ? eol : eol + eol) + table;
}

/** A program on PATH, as Windows finds it too (atlas.cmd, claude.exe). */
export function onPath(name: string, environment: NodeJS.ProcessEnv): string | null {
  const extensions = process.platform === 'win32' ? (environment.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const folder of (environment.PATH ?? environment.Path ?? '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(folder, name + extension.toLowerCase());
      if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
    }
  }
  return null;
}

/** Run a harness's command; Windows runs .cmd and .bat files through the shell. */
function run(program: string, args: string[], environment: NodeJS.ProcessEnv) {
  const viaShell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(program);
  const quote = (value: string) => '"' + value.replace(/"/g, '""') + '"';
  const result = viaShell
    ? spawnSync([program, ...args].map(quote).join(' '), { shell: true, env: environment, encoding: 'utf8', windowsHide: true, timeout: 180000 })
    : spawnSync(program, args, { env: environment, encoding: 'utf8', windowsHide: true, timeout: 180000 });
  return { status: result.status ?? 1, output: ((result.stdout ?? '') + (result.stderr ?? '') + (result.error ? result.error.message : '')).trim() };
}

function writeAtomically(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + process.pid + '.tmp';
  writeFileSync(temporary, text);
  renameSync(temporary, file);
}

export async function setup(args: string[], out: Output, environment: NodeJS.ProcessEnv = process.env) {
  if (wantsHelp(args)) { out.stdout(line); return 0; }
  const { positional, flags } = parseOptions(args, { values: [], flags: ['dry-run'] }, line);
  positionals(positional, [], line);
  const dryRun = flags.has('dry-run');
  let failed = false;

  const user = userHome(environment);
  const home = atlasHome(undefined, environment, user);
  // The old data folder's files move into the default home, but never while an older Atlas app or
  // `atlas serve` uses them (the app holds Electron's lock there, a host its remote-access lock).
  const legacy = environment.ATLAS_HOME ? null : legacyDataDirectory(environment, process.platform, user);
  if (legacy && (await legacyData(legacy)).length && (atlasAppRunning(legacy) || await hostRunning(legacy))) {
    out.stderr(`atlas: Atlas is running and uses ${legacy}. Quit it (the app or atlas serve), then run atlas setup again: setup moves its settings and statistics from there into ${home}.`);
    return 1;
  }
  if (dryRun) {
    out.stdout(existsSync(home) ? `Atlas home: ${home}` : `Would create the Atlas home: ${home}`);
    const pending = legacy ? await legacyData(legacy) : [];
    if (pending.length) out.stdout(`Would move from ${legacy}: ${pending.join(', ')}`);
  } else {
    await prepareHome({ environment, home: user });
    out.stdout(`Atlas home: ${home}`);
    if (legacy) {
      const migration = await migrateLegacyData(home, legacy);
      if (migration.moved.length) out.stdout(`Moved from ${legacy}: ${migration.moved.join(', ')}`);
      if (migration.merged.length) out.stdout(`Merged into the home's usage statistics (the old copies are in ${path.join(home, 'legacy')}): ${migration.merged.join(', ')}`);
      if (migration.setAside.length) out.stdout(`The home had its own, so the old copies are in ${path.join(home, 'legacy')}: ${migration.setAside.join(', ')}`);
      for (const item of migration.failed) { failed = true; out.stderr(`Not moved from ${legacy}: ${item}`); }
    }
  }

  const marketplace = (JSON.parse(readFileSync(path.join(repository, '.claude-plugin', 'marketplace.json'), 'utf8')) as { name: string }).name;
  // Claude Code reads a plugin from a folder marketplace in place. Codex copies it when it is added,
  // so adding it again refreshes the copy; and it keeps a marketplace's first source, so one added
  // from another checkout is replaced.
  const harnesses = [
    {
      name: 'Claude Code', program: 'claude', config: environment.CLAUDE_CONFIG_DIR || path.join(user, '.claude'), file: 'settings.json', where: 'permissions.additionalDirectories', grant: grantClaudeDirectory,
      install: [['plugin', 'marketplace', 'add', repository], ['plugin', 'install', 'atlas@' + marketplace]], replace: null,
    },
    {
      name: 'Codex', program: 'codex', config: environment.CODEX_HOME || path.join(user, '.codex'), file: 'config.toml', where: '[sandbox_workspace_write] writable_roots', grant: grantCodexRoot,
      install: [['plugin', 'marketplace', 'add', repository], ['plugin', 'add', 'atlas@' + marketplace]], replace: ['plugin', 'marketplace', 'remove', marketplace],
    },
  ];
  for (const harness of harnesses) {
    const program = onPath(harness.program, environment);
    if (!program && !existsSync(harness.config)) { out.stdout(`${harness.name}: not found (no ${harness.program} on PATH, no ${harness.config}); skipped.`); continue; }
    const file = path.join(harness.config, harness.file);
    try {
      const next = harness.grant(existsSync(file) ? readFileSync(file, 'utf8') : null, home);
      if (next === null) out.stdout(`${harness.name}: the home is already granted in ${file}.`);
      else {
        if (!dryRun) writeAtomically(file, next);
        out.stdout(`${harness.name}: ${dryRun ? 'would grant' : 'granted'} the home in ${file} (${harness.where}).`);
      }
    } catch (error) {
      failed = true;
      out.stderr(`${harness.name}: ${file} was left as it is: ${(error as Error).message}.`);
    }
    if (!program) { out.stdout(`${harness.name}: ${harness.program} is not on PATH, so the Atlas plugin was not installed.`); continue; }
    for (const command of harness.install) {
      const shown = [harness.program, ...command].join(' ');
      if (dryRun) { out.stdout('Would run: ' + shown); continue; }
      let result = run(program, command, environment);
      if (result.status !== 0 && harness.replace && command === harness.install[0] && /different source/i.test(result.output)) {
        const removed = run(program, harness.replace, environment);
        out.stdout('Ran: ' + [harness.program, ...harness.replace].join(' ') + ' (it named another checkout)');
        if (removed.status === 0) result = run(program, command, environment);
      }
      if (result.status === 0 || /already/i.test(result.output) && !/different source/i.test(result.output)) out.stdout('Ran: ' + shown + (result.status === 0 ? '' : ' (already done)'));
      else { failed = true; out.stderr(`${harness.name}: ${shown} failed (exit ${result.status}): ${result.output.split(/\r?\n/).slice(-3).join(' ')}`); }
    }
  }
  if (!dryRun && !failed) out.stdout('Atlas is set up. Start a new agent session to load the plugin.');
  return failed ? 1 : 0;
}
