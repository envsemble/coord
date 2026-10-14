// `atlas check`: check files or whole planning folders. Plans, ledgers, the registry and statistics
// lines go through the planning check (validatePlanning), whose findings are attributed to the file
// they name; other kinds of file are checked by the checker registered for their extension.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { validatePlanning } from './check.ts';

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

/**
 * Checkers for other kinds of file, by extension (such as `.puml`). Diagram files get theirs once
 * the diagram checker lands; until then they are not checked.
 */
export const fileCheckers = new Map<string, FileChecker>();

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

/** The file a planning check message is about (`active/x/plan.md: ...`), or null for a registry message. */
function subject(message: string) {
  const match = /^([^\s:]+?\.(?:md|jsonl)|[^\s:]+\/\.atlas): /.exec(message.replaceAll('\\', '/'));
  return match ? match[1] : null;
}

/**
 * Check paths: a planning folder is checked whole; a file or folder inside one is checked for the
 * findings about it (planning.json gets the registry's). Paths outside every planning folder are
 * errors. Several paths in one planning folder share one check.
 */
export function checkPaths(paths: string[]): CheckResult[] {
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
    const { errors, warnings } = validatePlanning(root);
    const about = (message: string) => {
      if (group.whole) return true;
      const named = subject(message);
      return group.files.some(file => named === null ? file === 'planning.json' : named === file || named.startsWith(file + '/') || (file.endsWith('statistics.jsonl') && named === file.replace(/\/statistics\.jsonl$/, '')));
    };
    const result: CheckResult = { planningFolder: root, files: group.whole ? [] : group.files, errors: errors.filter(about), warnings: warnings.filter(about) };
    for (const file of group.whole ? checkedFiles(root) : group.files) {
      const checker = fileCheckers.get(path.posix.extname(file).toLowerCase());
      if (!checker || !statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile()) continue;
      const found = checker(root, file);
      result.errors.push(...found.errors);
      result.warnings.push(...found.warnings);
    }
    results.push(result);
  }
  return results;
}
