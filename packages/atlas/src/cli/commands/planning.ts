// The planning-state commands: where, project create, work
// status|create|accept|start|step|block|close|archive|reopen, check and home. They call the planning
// operations the MCP server calls too, print JSON on success, and exit 1 with the reason (and any
// open items) when an operation is refused.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptWork, addSteps, archiveWork, proposeSteps, searchWork, tagWork, atlasHome, checkPaths, closeWork, createProject, createWork, setContinues, setParts, findPlanning, homePlanningFolders, planningName,
  planningFolderOf, readRegistry, readTemplates, removeStep, renameStep, reopenWork, resolvePlanningFolder, setBlocked, setStepStatus, startWork, withDatabaseAsync, workStatus,
  type LedgerStepStatus,
} from '../../planning/index.ts';
import { parseOptions, positionals, UsageError, wantsHelp, type Output } from '../args.ts';

export const planningUsage = `  atlas where [--cwd <dir>]
  atlas project create --name <name> [--folder <folder>...] [--json]
  atlas work status <work-id> [--planning-dir <dir>]
  atlas work create --title <title> [--summary <text>] [--slug <slug>] [--continues <work>...] [--tag <tag>...] [--part-of <work-id>] [--planning-dir <dir>]
  atlas work tag <work-id> [--add <tag>...] [--remove <tag>...] [--planning-dir <dir>]
  atlas work search [<word>...] [--tag <tag>...] [--status open|closed|all] [--planning-dir <dir>]
  atlas work continue <work-id> [<work>...] [--planning-dir <dir>]
  atlas work parts <work-id> [<work-id>...] [--planning-dir <dir>]
  atlas work accept <work-id> [--planning-dir <dir>]
  atlas work start <work-id> [--step <title>...] [--planning-dir <dir>]
  atlas work step add <work-id> <title>... [--planning-dir <dir>]
  atlas work step propose <work-id> [<title>...] [--planning-dir <dir>]
  atlas work step set <work-id> <title> <todo|doing|done> [--planning-dir <dir>]
  atlas work step rename <work-id> <title> <new-title> [--planning-dir <dir>]
  atlas work step remove <work-id> <title> [--planning-dir <dir>]
  atlas work block <work-id> (<reason> | --clear) [--planning-dir <dir>]
  atlas work close <work-id> [--planning-dir <dir>]
  atlas work archive <work-id> [--superseded-by <work-id> | --abandoned] [--reason <why>] [--planning-dir <dir>]
  atlas work reopen <work-id> --step <title>... [--planning-dir <dir>]
  atlas check [<path>...]
  atlas home [list]`;

const usageOf = (command: string) => 'Usage: ' + planningUsage.split('\n').filter(line => line.trim().startsWith(command + ' ') || line.trim() === command).map(line => line.trim()).join('\n       ');
const print = (out: Output, value: unknown) => out.stdout(JSON.stringify(value));
const planningDir = (values: Record<string, string>, work: string | null) => resolvePlanningFolder({ planningFolder: values['planning-dir'], cwd: process.cwd(), work });

/** `atlas where`: the projects (planning folders of the home) this folder belongs to, with their names and active work, and every active project of the home in brief. */
export async function where(args: string[], out: Output) {
  const line = usageOf('atlas where');
  if (wantsHelp(args)) { out.stdout(line); return 0; }
  const { positional, values } = parseOptions(args, { values: ['cwd'] }, line);
  positionals(positional, [], line);
  print(out, await findPlanning(path.resolve(values.cwd ?? '.')));
  return 0;
}

/** A project as `project create` and the Atlas tool `project_create` describe it. */
export interface CreatedProject { name: string; planningFolder: string; folders: string[] }

/**
 * Create a project in the home as the app's host does: from the templates the atlas skill bundles in
 * this checkout (as `atlas serve` reads them), with its first commit and its row in the home database.
 */
export async function createHomeProject(request: { name: string; folders: string[] }): Promise<CreatedProject> {
  const templates = await readTemplates(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../templates/planning'));
  const row = await withDatabaseAsync(atlasHome(), database => createProject(database, request, templates));
  return { name: row.name, planningFolder: row.folder, folders: (await readRegistry(row.folder)).folders };
}

/** `atlas project create`: a new project in the home, covering the folders given. */
export async function project(args: string[], out: Output) {
  const [action, ...rest] = args;
  const line = usageOf('atlas project create');
  if (action !== 'create') throw new UsageError(action === undefined ? 'the following arguments are required: create' : 'unknown project command: ' + action, line);
  if (wantsHelp(rest)) { out.stdout(line); return 0; }
  const { positional, values, lists, flags } = parseOptions(rest, { values: ['name'], lists: ['folder'], flags: ['json'] }, line);
  positionals(positional, [], line);
  if (!values.name) throw new UsageError('the following arguments are required: --name', line);
  const created = await createHomeProject({ name: values.name, folders: (lists.folder ?? []).map(folder => path.resolve(folder)) });
  if (flags.has('json')) { print(out, created); return 0; }
  out.stdout(`Created the project ${created.name} in ${created.planningFolder}` + (created.folders.length ? `, covering ${created.folders.join(', ')}.` : '; it covers no folders yet (add them on the Projects page or in its planning.json).'));
  return 0;
}

const steps = ['add', 'propose', 'set', 'rename', 'remove'];
/** `atlas work <operation>`; `work report` is handled by main.ts. */
export async function work(operation: string | undefined, args: string[], out: Output) {
  const line = usageOf(operation === 'step' ? `atlas work step ${steps.includes(args[0]) ? args[0] : ''}`.trim() : 'atlas work ' + operation);
  if (wantsHelp(args)) { out.stdout(line); return 0; }
  switch (operation) {
    case 'status': case 'accept': case 'close': {
      const { positional, values } = parseOptions(args, { values: ['planning-dir'] }, line);
      const [id] = positionals(positional, ['work-id'], line);
      const root = await planningDir(values, id);
      print(out, operation === 'status' ? await workStatus(root, id) : operation === 'accept' ? await acceptWork(root, id) : await closeWork(root, id));
      return 0;
    }
    case 'archive': {
      const { positional, values, flags } = parseOptions(args, { values: ['planning-dir', 'superseded-by', 'reason'], flags: ['abandoned'] }, line);
      const [id] = positionals(positional, ['work-id'], line);
      if (flags.has('abandoned') && values['superseded-by']) throw new UsageError('give --superseded-by or --abandoned, not both', line);
      if (flags.has('abandoned') && !values.reason) throw new UsageError('the following arguments are required: --reason (abandoned work says why)', line);
      if (values.reason !== undefined && !flags.has('abandoned') && !values['superseded-by']) throw new UsageError('--reason goes with --abandoned or --superseded-by', line);
      // --superseded-by implies superseded.
      print(out, await archiveWork(await planningDir(values, id), id, { disposition: flags.has('abandoned') ? 'abandoned' : null, supersededBy: values['superseded-by'] ?? null, reason: values.reason ?? null }));
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
    case 'tag': {
      const { positional, values, lists } = parseOptions(args, { values: ['planning-dir'], lists: ['add', 'remove'] }, line);
      const [id] = positionals(positional, ['work-id'], line);
      if (!lists.add && !lists.remove) throw new UsageError('give --add or --remove', line);
      print(out, await tagWork(await planningDir(values, id), id, { add: lists.add, remove: lists.remove }));
      return 0;
    }
    case 'search': {
      const { positional, values, lists } = parseOptions(args, { values: ['planning-dir', 'status'], lists: ['tag'] }, line);
      if (values.status !== undefined && !['open', 'closed', 'all'].includes(values.status)) throw new UsageError('argument --status: expected open, closed or all', line);
      print(out, await searchWork(await planningDir(values, null), { query: positional.join(' '), tags: lists.tag, status: values.status as 'open' | 'closed' | 'all' | undefined }));
      return 0;
    }
    case 'continue': {
      // The work it continues, here (work-0023) or in another project (project:work-0023); none clears it.
      const { positional, values } = parseOptions(args, { values: ['planning-dir'] }, line);
      const [id, ...continues] = positional;
      if (!id) throw new UsageError('the following arguments are required: work-id', line);
      print(out, await setContinues(await planningDir(values, id), id, continues));
      return 0;
    }
    case 'parts': {
      // The work it is made of, in order: work items of this project; none clears them.
      const { positional, values } = parseOptions(args, { values: ['planning-dir'] }, line);
      const [id, ...parts] = positional;
      if (!id) throw new UsageError('the following arguments are required: work-id', line);
      print(out, await setParts(await planningDir(values, id), id, parts));
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
    case 'block': {
      const { positional, values, flags } = parseOptions(args, { values: ['planning-dir'], flags: ['clear'] }, line);
      const [id, reason] = positionals(positional, flags.has('clear') ? ['work-id'] : ['work-id', 'reason'], line);
      print(out, await setBlocked(await planningDir(values, id), id, flags.has('clear') ? null : reason));
      return 0;
    }
    case 'step': {
      const [action, ...rest] = args;
      if (!steps.includes(action)) throw new UsageError('unknown work step command: ' + (action ?? '(none)'), usageOf('atlas work step'));
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
 * `atlas check [<path>...]`: plans, ledgers, the registry and statistics lines (and, once wired, the
 * diagram files) of the planning folders given, of the files given, or of this checkout's.
 */
export async function check(args: string[], out: Output) {
  const line = usageOf('atlas check');
  if (wantsHelp(args)) { out.stdout(line); return 0; }
  const { positional } = parseOptions(args, { values: [] }, line);
  let targets = positional.map(target => path.resolve(target));
  for (const target of targets) if (!existsSync(target)) throw new UsageError(target + ' does not exist', line);
  if (!targets.length) {
    const here = planningFolderOf(process.cwd());
    targets = here ? [here] : (await findPlanning(process.cwd())).matches.map(match => match.planningFolder);
    if (!targets.length) { out.stderr('atlas: no planning folder here: give the planning folder or files to check.'); return 1; }
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

/** `atlas home`: where the home is and its projects (planning folders). */
export async function home(args: string[], out: Output) {
  const line = usageOf('atlas home');
  if (wantsHelp(args)) { out.stdout(line); return 0; }
  const [action, ...rest] = args;
  if (action === undefined || action === 'list') {
    positionals(rest, [], line);
    const folder = atlasHome();
    const folders = await homePlanningFolders(folder);
    print(out, { home: folder, projects: await Promise.all(folders.map(async planningFolder => ({ name: await planningName(planningFolder), planningFolder }))) });
    return 0;
  }
  throw new UsageError('unknown home command: ' + action, line);
}
