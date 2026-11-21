// `coord check`: check files or whole planning folders. Plans, ledgers and the registry go through
// the planning check (validatePlanning), whose findings are attributed to the file they name; other
// kinds of file are checked by the checker registered for their extension. A diagram in a work
// folder that no Markdown document of its work item links is a warning: plans link their diagrams.
// A work item's page is built, as Coord shows it, whenever any of its files is checked.
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import coord from '@envsemble/coord-diagrams';
import { validatePlanning } from './check.ts';
import { moveForward } from '../registry/moveForward.ts';
import { buildPage, listPages, pageFile, pageOf, readPageFile } from '../pages/pages.ts';

export interface CheckResult {
  /** The planning folder checked. */
  planningFolder: string;
  /** The files asked about, relative to the planning folder; empty for the whole folder. */
  files: string[];
  errors: string[];
  warnings: string[];
}
/** Checks one file of a planning folder (relative path, POSIX separators); findings name the file. */
export type FileChecker = (planningFolder: string, file: string) => { errors: string[]; warnings: string[] };

/** Checkers for other kinds of file, by extension. Diagram files (`.puml`) have theirs from the start. */
export const fileCheckers = new Map<string, FileChecker>();

function inside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
/**
 * A diagram's problems, as `file:line:column: message`. The files its header names (a proposal's
 * baseline, a scenario's class diagram) are read relative to it, and only inside the planning folder.
 */
const checkDiagramFile: FileChecker = (planningFolder, file) => {
  const root = realpathSync(planningFolder);
  const filename = path.join(root, ...file.split('/'));
  const read = (reference: string) => {
    try {
      const target = realpathSync(path.resolve(path.dirname(filename), reference));
      return inside(root, target) ? readFileSync(target, 'utf8') : null;
    } catch { return null; }
  };
  const errors: string[] = [], warnings: string[] = [];
  for (const problem of coord.checkDiagram(readFileSync(filename, 'utf8'), { path: file, read }))
    (problem.severity === 'error' ? errors : warnings).push(`${file}:${problem.line}:${problem.column}: ${problem.message}`);
  return { errors, warnings };
};
fileCheckers.set('.puml', checkDiagramFile);

/** The planning folder a path is in: the nearest folder upward with a planning.json. */
export function planningFolderOf(target: string): string | null {
  let folder = path.resolve(target);
  if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) folder = path.dirname(folder);
  for (;;) {
    if (statSync(path.join(folder, 'planning.json'), { throwIfNoEntry: false })?.isFile()) return folder;
    const parent = path.dirname(folder);
    if (parent === folder) return null;
    folder = parent;
  }
}

/** The files of a planning folder that a registered checker reads (hidden and build folders aside). */
function checkedFiles(root: string, relative = ''): string[] {
  if (!fileCheckers.size) return [];
  const found: string[] = [];
  for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build'].includes(entry.name)) continue;
    const child = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) found.push(...checkedFiles(root, child));
    else if (entry.isFile() && fileCheckers.has(path.posix.extname(entry.name).toLowerCase())) found.push(child);
  }
  return found;
}

/** The file a planning check message is about (`active/x/plan.md: ...`, or `active/x/plan.md:17: ...` at a line), or null for a registry message. */
function subject(message: string) {
  const match = /^([^\s:]+?\.md)(?::\d+)?: /.exec(message.replaceAll('\\', '/'));
  return match ? match[1] : null;
}

/**
 * Check paths: a planning folder is checked whole; a file or folder inside one is checked for the
 * findings about it (planning.json gets the registry's). Paths outside every planning folder are
 * errors. Several paths in one planning folder share one check.
 */
export async function checkPaths(paths: string[]): Promise<CheckResult[]> {
  const groups = new Map<string, { files: string[]; whole: boolean }>();
  const outside: string[] = [];
  for (const target of paths) {
    const root = planningFolderOf(target);
    if (!root) { outside.push(target); continue; }
    const group = groups.get(root) ?? { files: [], whole: false };
    groups.set(root, group);
    const relative = path.relative(root, path.resolve(target)).split(path.sep).join('/');
    if (!relative) group.whole = true;
    else group.files.push(relative);
  }
  const results: CheckResult[] = outside.map(target => ({ planningFolder: path.resolve(target), files: [], errors: [target + ': not inside a planning folder (no planning.json above it)'], warnings: [] }));
  for (const [root, group] of groups) {
    // A folder of the earlier registry version is moved forward first.
    await moveForward(root).catch(() => false);
    const { errors, warnings } = validatePlanning(root);
    const about = (message: string) => {
      if (group.whole) return true;
      const named = subject(message);
      return group.files.some(file => named === null ? file === 'planning.json' : named === file || named.startsWith(file + '/'));
    };
    const result: CheckResult = { planningFolder: root, files: group.whole ? [] : group.files, errors: errors.filter(about), warnings: warnings.filter(about) };
    const files = group.whole ? checkedFiles(root) : group.files;
    for (const file of files) {
      const checker = fileCheckers.get(path.posix.extname(file).toLowerCase());
      if (!checker || !statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile()) continue;
      const found = checker(root, file);
      result.errors.push(...found.errors);
      result.warnings.push(...found.warnings);
    }
    const diagrams = files.filter(file => /\.puml$/i.test(file));
    if (diagrams.length) result.warnings.push(...await unlinkedDiagrams(root, diagrams));
    const touched = group.files.map(pageOf).filter((page): page is string => page !== null);
    const pages = group.whole || touched.length ? await everyPage(root) : [];
    result.errors.push(...await pageProblems(root, group.whole ? pages : touched.filter(page => pages.includes(page))));
    results.push(result);
  }
  return results;
}

/** Every page of the folder's work items, by its folder. */
async function everyPage(root: string): Promise<string[]> {
  let items: { path?: unknown }[];
  try { items = JSON.parse(readFileSync(path.join(root, 'planning.json'), 'utf8').replace(/^\uFEFF/, '')).work_items; } catch { return []; }
  if (!Array.isArray(items)) return [];
  const pages: string[] = [];
  for (const item of items) {
    if (typeof item?.path !== 'string') continue;
    const location = item.path.replace(/\/+$/, '');
    for (const name of await listPages(path.join(root, ...location.split('/')))) pages.push(location + '/pages/' + name);
  }
  return pages;
}
/** Why the pages given (their folders) do not build, as `file:line:column: problem`. */
async function pageProblems(root: string, pages: string[]): Promise<string[]> {
  const problems: string[] = [];
  for (const page of new Set(pages)) {
    if (!statSync(path.join(root, ...page.split('/')), { throwIfNoEntry: false })?.isDirectory()) continue;
    const read = await readPageFile(path.join(root, ...page.split('/')));
    if (!read.ok) problems.push(`${page}/${pageFile}: ${read.problem}`);
    const built = await buildPage(root, path.join(root, ...page.split('/')));
    if (built.ok) continue;
    for (const problem of built.problems) problems.push(`${problem.file ?? page}${problem.line ? `:${problem.line}:${problem.column ?? 1}` : ''}: ${problem.text}`);
  }
  return problems;
}

/** The Markdown and diagram files of a folder, relative to it (hidden and build folders aside). */
function workFiles(folder: string, relative = ''): string[] {
  const found: string[] = [];
  let entries;
  try { entries = readdirSync(path.join(folder, relative), { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build'].includes(entry.name)) continue;
    const child = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) found.push(...workFiles(folder, child));
    else if (entry.isFile() && /\.(?:md|puml)$/i.test(entry.name)) found.push(child);
  }
  return found;
}

/**
 * Warnings for the diagrams given (relative to the planning folder) that sit in a registered work
 * folder and that no Markdown document in the planning folder links. The work item's own documents
 * are read first; the rest of the folder only for a diagram they do not link. The Markdown parser
 * loads only here.
 */
async function unlinkedDiagrams(root: string, diagrams: string[]): Promise<string[]> {
  let items: { id?: unknown; path?: unknown }[];
  try { items = JSON.parse(readFileSync(path.join(root, 'planning.json'), 'utf8').replace(/^﻿/, '')).work_items; } catch { return []; }
  if (!Array.isArray(items)) return [];
  const [{ diagramLinks }, { markdownBody }] = await Promise.all([import('../reading/diagramLinks.ts'), import('../reading/headings.ts')]);
  const key = (value: string) => process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value;
  const linked = new Set<string>(), read = new Set<string>();
  const readLinks = (documents: string[]) => {
    for (const relative of documents) {
      if (read.has(relative)) continue;
      read.add(relative);
      try { for (const link of diagramLinks(markdownBody(readFileSync(path.join(root, ...relative.split('/')), 'utf8')), relative)) linked.add(key(link.target)); }
      catch { /* An unreadable document links nothing. */ }
    }
  };
  const markdown = (files: string[]) => files.filter(name => /\.md$/i.test(name));
  const unlinked: string[] = [];
  for (const item of items) {
    if (typeof item?.id !== 'string' || typeof item.path !== 'string') continue;
    const location = item.path.replace(/\/+$/, '');
    const asked = diagrams.filter(file => key(file).startsWith(key(location) + '/'));
    if (!asked.length) continue;
    readLinks(markdown(workFiles(path.join(root, ...location.split('/')))).map(file => location + '/' + file));
    unlinked.push(...asked.filter(file => !linked.has(key(file))));
  }
  if (unlinked.length) readLinks(markdown(workFiles(root)));
  return unlinked.filter(file => !linked.has(key(file))).map(file => `${file}: no document links this diagram; link it from the plan under the heading it explains`);
}
