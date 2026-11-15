// The planning-state commands: where, project create, work
// status|create|state|update|search|accept|start|step|close|reopen, check and home. They call the
// planning operations the MCP server calls too, print JSON on success, and exit 1 with the reason
// (and any open items) when an operation is refused.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptWork, addSteps, proposeSteps, searchWork, coordHome, checkPaths, createProject, createWork, finishWork, findPlanning, homePlanningFolders, planningName,
  planningFolderOf, readRegistry, readTemplates, removeStep, renameStep, reopenWork, resolvePlanningFolder, setState, setStepStatus, startWork, updateWork, withDatabaseAsync, workStatus,
  type LedgerStepStatus,
} from '../../planning/index.ts';
import { parseOptions, positionals, UsageError, wantsHelp, type Output } from '../args.ts';

export const planningUsage = `  coord where [--cwd <dir>]
  coord project create --name <name> [--folder <folder>...] [--json]
  coord work status <work-id> [--planning-dir <dir>]
  coord work create --title <title> [--summary <text>] [--slug <slug>] [--continues <work>...] [--tag <tag>...] [--part-of <work-id>] [--planning-dir <dir>]
  coord work state <work-id> <planning|working|waiting|your_turn|blocked|none> [<note>] [--planning-dir <dir>]
  coord work update <work-id> [--add-tag <tag>...] [--remove-tag <tag>...] [--continues <work>... | --no-continues] [--parts <work-id>... | --no-parts] [--planning-dir <dir>]
  coord work search [<word>...] [--tag <tag>...] [--status open|closed|all] [--planning-dir <dir>]
  coord work accept <work-id> [--planning-dir <dir>]
  coord work start <work-id> [--step <title>...] [--planning-dir <dir>]
  coord work step add <work-id> <title>... [--planning-dir <dir>]
  coord work step propose <work-id> [<title>...] [--planning-dir <dir>]
  coord work step set <work-id> <title> <todo|doing|done> [--planning-dir <dir>]
  coord work step rename <work-id> <title> <new-title> [--planning-dir <dir>]
  coord work step remove <work-id> <title> [--planning-dir <dir>]
  coord work close <work-id> [--superseded-by <work-id> | --abandoned] [--reason <why>] [--planning-dir <dir>]
  coord work reopen <work-id> --step <title>... [--planning-dir <dir>]
  coord check [<path>...]
  coord home [list]`;

const usageOf = (command: string) => 'Usage: ' + planningUsage.split('\n').filter(line => line.trim().startsWith(command + ' ') || line.trim() === command).map(line => line.trim()).join('\n       ');
const print = (out: Output, value: unknown) => out.stdout(JSON.stringify(value));
const planningDir = (values: Record<string, string>, work: string | null) => resolvePlanningFolder({ planningFolder: values['planning-dir'], cwd: process.cwd(), work });

/** `coord where`: the projects (planning folders of the home) this folder belongs to, with their names and active work, and every active project of the home in brief. */
export async function where(args: string[], out: Output) {
  const line = usageOf('coord where');
  if (wantsHelp(args)) { out.stdout(line); return 0; }
  const { positional, values } = parseOptions(args, { values: ['cwd'] }, line);
  positionals(positional, [], line);
  print(out, await findPlanning(path.resolve(values.cwd ?? '.')));
  return 0;
}

/** A project as `project create` and the Coord tool `project_create` describe it. */
export interface CreatedProject { name: string; planningFolder: string; folders: string[] }

/**
 * Create a project in the home as the app's host does: from the templates the coord skill bundles in
 * this checkout (as `coord serve` reads them), with its first commit and its row in the home database.
 */
export async function createHomeProject(request: { name: string; folders: string[] }): Promise<CreatedProject> {
  const templates = await readTemplates(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../templates/planning'));
  const row = await withDatabaseAsync(coordHome(), database => createProject(database, request, templates));
  return { name: row.name, planningFolder: row.folder, folders: (await readRegistry(row.folder)).folders };
}

/** `coord project create`: a new project in the home, covering the folders given. */
export async function project(args: string[], out: Output) {
  const [action, ...rest] = args;
  const line = usageOf('coord project create');
  if (action !== 'create') throw new UsageError(action === undefined ? 'the following arguments are required: create' : 'unknown project command: ' + action, line);
  if (wantsHelp(rest)) { out.stdout(line); return 0; }
  const { positional, values, lists, flags } = parseOptions(rest, { values: ['name'], lists: ['folder'], flags: ['json'] }, line);
  positionals(positional, [], line);
  if (!values.name) throw new UsageError('the following arguments are required: --name', line);
  const created = await createHomeProject({ name: values.name, folders: (lists.folder ?? []).map(folder => path.resolve(folder)) });
  if (flags.has('json')) { print(out, created); return 0; }
  out.stdout(`Created the project ${created.name} in ${created.planningFolder}` + (created.folders.length ? `, covering ${created.folders.join(', ')}.` : '; it covers no folders yet (add them from the project menu of the app’s plans, or in its planning.json).'));
  return 0;
}

const steps = ['add', 'propose', 'set', 'rename', 'remove'];
/** `coord work <operation>`; `work report` is handled by main.ts. */
export async function work(operation: string | undefined, args: string[], out: Output) {
  const line = usageOf(operation === 'step' ? `coord work step ${steps.includes(args[0]) ? args[0] : ''}`.trim() : 'coord work ' + operation);
  if (wantsHelp(args)) { out.stdout(line); return 0; }
  switch (operation) {
    case 'status': case 'accept': {
      const { positional, values } = parseOptions(args, { values: ['planning-dir'] }, line);
      const [id] = positionals(positional, ['work-id'], line);
      const root = await planningDir(values, id);
      print(out, operation === 'status' ? await workStatus(root, id) : await acceptWork(root, id));
      return 0;
    }
    case 'close': {
      const { positional, values, flags } = parseOptions(args, { values: ['planning-dir', 'superseded-by', 'reason'], flags: ['abandoned'] }, line);
      const [id] = positionals(positional, ['work-id'], line);
      if (flags.has('abandoned') && values['superseded-by']) throw new UsageError('give --superseded-by or --abandoned, not both', line);
      if (flags.has('abandoned') && !values.reason) throw new UsageError('the following arguments are required: --reason (abandoned work says why)', line);
      if (values.reason !== undefined && !flags.has('abandoned') && !values['superseded-by']) throw new UsageError('--reason goes with --abandoned or --superseded-by', line);
      // --superseded-by implies superseded; without either, the work closes as complete.
      print(out, await finishWork(await planningDir(values, id), id, { outcome: flags.has('abandoned') ? 'abandoned' : values['superseded-by'] ? 'superseded' : 'complete', supersededBy: values['superseded-by'] ?? null, reason: values.reason ?? null }));
      return 0;
    }
    case 'state': {
      const { positional, values } = parseOptions(args, { values: ['planning-dir'] }, line);
      const [id, kind, ...note] = positional;
      if (!id || !kind) throw new UsageError('the following arguments are required: ' + (id ? 'state' : 'work-id, state'), line);
      print(out, await setState(await planningDir(values, id), id, { kind: kind === 'none' ? null : kind, note: note.join(' ') || null }));
      return 0;
    }
    case 'update': {
      const { positional, values, lists, flags } = parseOptions(args, { values: ['planning-dir'], lists: ['add-tag', 'remove-tag', 'continues', 'parts'], flags: ['no-continues', 'no-parts'] }, line);
      const [id] = positionals(positional, ['work-id'], line);
      if (flags.has('no-continues') && lists.continues) throw new UsageError('give --continues or --no-continues, not both', line);
      if (flags.has('no-parts') && lists.parts) throw new UsageError('give --parts or --no-parts, not both', line);
      print(out, await updateWork(await planningDir(values, id), id, {
        addTags: lists['add-tag'], removeTags: lists['remove-tag'],
        continues: flags.has('no-continues') ? [] : lists.continues, parts: flags.has('no-parts') ? [] : lists.parts,
      }));
      return 0;
    }
    case 'create': {
      const { positional, values, lists } = parseOptions(args, { values: ['title', 'summary', 'slug', 'part-of', 'planning-dir'], lists: ['continues', 'tag'] }, line);
      positionals(positional, [], line);
      if (!values.title) throw new UsageError('the following arguments are required: --title', line);
      const root = await planningDir(values, null);
      print(out, await createWork(root, { title: values.title, slug: values.slug ?? null, summary: values.summary ?? null, continues: lists.continues ?? null, tags: lists.tag ?? null, partOf: values['part-of'] ?? null }));
      return 0;
    }
    case 'search': {
      const { positional, values, lists } = parseOptions(args, { values: ['planning-dir', 'status'], lists: ['tag'] }, line);
      if (values.status !== undefined && !['open', 'closed', 'all'].includes(values.status)) throw new UsageError('argument --status: expected open, closed or all', line);
      print(out, await searchWork(await planningDir(values, null), { query: positional.join(' '), tags: lists.tag, status: values.status as 'open' | 'closed' | 'all' | undefined }));
      return 0;
    }
    case 'start': case 'reopen': {
      const { positional, values, lists } = parseOptions(args, { values: ['planning-dir'], lists: ['step'] }, line);
      const [id] = positionals(positional, ['work-id'], line);
      // Started without steps, the work adopts its proposed steps.
      if (!lists.step && operation === 'reopen') throw new UsageError('the following arguments are required: --step', line);
      const root = await planningDir(values, id);
      print(out, operation === 'start' ? await startWork(root, id, { steps: lists.step }) : await reopenWork(root, id, { steps: lists.step! }));
      return 0;
    }
    case 'step': {
      const [action, ...rest] = args;
      if (!steps.includes(action)) throw new UsageError('unknown work step command: ' + (action ?? '(none)'), usageOf('coord work step'));
      if (wantsHelp(rest)) { out.stdout(line); return 0; }
      const { positional, values } = parseOptions(rest, { values: ['planning-dir'] }, line);
      const id = positional[0];
      if (action === 'add') {
        if (positional.length < 2) throw new UsageError('the following arguments are required: ' + (id ? 'title' : 'work-id, title'), line);
        print(out, await addSteps(await planningDir(values, id), id, positional.slice(1)));
      } else if (action === 'propose') {
        if (!id) throw new UsageError('the following arguments are required: work-id', line);
        print(out, await proposeSteps(await planningDir(values, id), id, positional.slice(1)));
      } else if (action === 'set') {
        const [, title, status] = positionals(positional, ['work-id', 'title', 'status'], line);
        if (!['todo', 'doing', 'done'].includes(status)) throw new UsageError('argument status: expected todo, doing or done', line);
        print(out, await setStepStatus(await planningDir(values, id), id, title, status as LedgerStepStatus));
      } else if (action === 'rename') {
        const [, title, to] = positionals(positional, ['work-id', 'title', 'new-title'], line);
        print(out, await renameStep(await planningDir(values, id), id, title, to));
      } else {
        const [, title] = positionals(positional, ['work-id', 'title'], line);
        print(out, await removeStep(await planningDir(values, id), id, title));
      }
      return 0;
    }
  }
  throw new UsageError('unknown work command: ' + (operation ?? '(none)'));
}

/**
 * `coord check [<path>...]`: plans, ledgers, the registry and statistics lines (and, once wired, the
 * diagram files) of the planning folders given, of the files given, or of this checkout's.
 */
export async function check(args: string[], out: Output) {
  const line = usageOf('coord check');
  if (wantsHelp(args)) { out.stdout(line); return 0; }
  const { positional } = parseOptions(args, { values: [] }, line);
  let targets = positional.map(target => path.resolve(target));
  for (const target of targets) if (!existsSync(target)) throw new UsageError(target + ' does not exist', line);
  if (!targets.length) {
    const here = planningFolderOf(process.cwd());
    targets = here ? [here] : (await findPlanning(process.cwd())).matches.map(match => match.planningFolder);
    if (!targets.length) { out.stderr('coord: no planning folder here: give the planning folder or files to check.'); return 1; }
  }
  const results = await checkPaths(targets);
  const prefix = (folder: string) => results.length > 1 ? folder + ': ' : '';
  for (const result of results) {
    for (const message of result.warnings) out.stdout('WARNING: ' + prefix(result.planningFolder) + message);
    for (const message of result.errors) out.stderr('ERROR: ' + prefix(result.planningFolder) + message);
  }
  const failed = results.some(result => result.errors.length);
  if (!failed) out.stdout(`Checked ${results.map(result => result.files.length ? result.files.join(', ') + ' in ' + result.planningFolder : result.planningFolder).join('; ')}: no problems; files were not modified.`);
  return failed ? 1 : 0;
}

/** `coord home`: where the home is and its projects (planning folders). */
export async function home(args: string[], out: Output) {
  const line = usageOf('coord home');
  if (wantsHelp(args)) { out.stdout(line); return 0; }
  const [action, ...rest] = args;
  if (action === undefined || action === 'list') {
    positionals(rest, [], line);
    const folder = coordHome();
    const folders = await homePlanningFolders(folder);
    print(out, { home: folder, projects: await Promise.all(folders.map(async planningFolder => ({ name: await planningName(planningFolder), planningFolder }))) });
    return 0;
  }
  throw new UsageError('unknown home command: ' + action, line);
}
