// The planning-state commands: where, work status|create|accept|start|step|block|close|archive|reopen,
// check and home. They call the planning operations the MCP server calls too, print JSON on
// success, and exit 1 with the reason (and any open items) when an operation is refused.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  acceptWork, addSteps, adoptPlanningFolder, archiveWork, atlasHome, checkPaths, closeWork, createWork, findPlanning, homePlanningFolders,
  planningFolderOf, removeStep, renameStep, reopenWork, resolvePlanningFolder, setBlocked, setStepStatus, startWork, workStatus, type LedgerStepStatus,
} from '@envsemble/atlas-planning';
import { parseOptions, positionals, UsageError, wantsHelp, type Output } from './args.ts';

export const planningUsage = `  atlas where [--cwd <dir>]
  atlas work status <work-id> [--planning-dir <dir>]
  atlas work create --title <title> [--repo <id>...] [--slug <slug>] [--planning-dir <dir>]
  atlas work accept <work-id> [--planning-dir <dir>]
  atlas work start <work-id> --step <title>... [--planning-dir <dir>]
  atlas work step add <work-id> <title>... [--planning-dir <dir>]
  atlas work step set <work-id> <title> <todo|doing|done> [--planning-dir <dir>]
  atlas work step rename <work-id> <title> <new-title> [--planning-dir <dir>]
  atlas work step remove <work-id> <title> --reason <why> [--planning-dir <dir>]
  atlas work block <work-id> (<reason> | --clear) [--planning-dir <dir>]
  atlas work close <work-id> [--planning-dir <dir>]
  atlas work archive <work-id> [--superseded-by <work-id> | --abandoned] [--reason <why>] [--planning-dir <dir>]
  atlas work reopen <work-id> --step <title>... [--planning-dir <dir>]
  atlas check [<path>...]
  atlas home [list]
  atlas home adopt <folder> [--name <name>]`;

const usageOf = (command: string) => 'Usage: ' + planningUsage.split('\n').filter(line => line.trim().startsWith(command + ' ') || line.trim() === command).map(line => line.trim()).join('\n       ');
const print = (out: Output, value: unknown) => out.stdout(JSON.stringify(value));
const planningDir = (values: Record<string, string>, work: string | null) => resolvePlanningFolder({ planningFolder: values['planning-dir'], cwd: process.cwd(), work });

/** `atlas where`: the planning folders of the home this checkout belongs to, with their active work. */
export async function where(args: string[], out: Output) {
  const line = usageOf('atlas where');
  if (wantsHelp(args)) { out.stdout(line); return 0; }
  const { positional, values } = parseOptions(args, { values: ['cwd'] }, line);
  positionals(positional, [], line);
  print(out, await findPlanning(path.resolve(values.cwd ?? '.')));
  return 0;
}

const steps = ['add', 'set', 'rename', 'remove'];
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
      const { positional, values, lists } = parseOptions(args, { values: ['title', 'slug', 'planning-dir'], lists: ['repo'] }, line);
      positionals(positional, [], line);
      if (!values.title) throw new UsageError('the following arguments are required: --title', line);
      const root = await planningDir(values, null);
      let repositories = lists.repo;
      if (!repositories) {
        // The repositories this checkout is, in that planning folder.
        repositories = (await findPlanning(process.cwd())).matches.find(match => match.planningFolder === root)?.repositories ?? [];
        if (!repositories.length) throw new UsageError('give the repositories with --repo: this checkout is not a registered repository of ' + root, line);
      }
      print(out, await createWork(root, { title: values.title, repositories, slug: values.slug ?? null }));
      return 0;
    }
    case 'start': case 'reopen': {
      const { positional, values, lists } = parseOptions(args, { values: ['planning-dir'], lists: ['step'] }, line);
      const [id] = positionals(positional, ['work-id'], line);
      if (!lists.step) throw new UsageError('the following arguments are required: --step', line);
      const root = await planningDir(values, id);
      print(out, operation === 'start' ? await startWork(root, id, { steps: lists.step }) : await reopenWork(root, id, { steps: lists.step }));
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
      const { positional, values } = parseOptions(rest, { values: ['planning-dir', ...action === 'remove' ? ['reason'] : []] }, line);
      const id = positional[0];
      if (action === 'add') {
        if (positional.length < 2) throw new UsageError('the following arguments are required: ' + (id ? 'title' : 'work-id, title'), line);
        print(out, await addSteps(await planningDir(values, id), id, positional.slice(1)));
      } else if (action === 'set') {
        const [, title, status] = positionals(positional, ['work-id', 'title', 'status'], line);
        if (!['todo', 'doing', 'done'].includes(status)) throw new UsageError('argument status: expected todo, doing or done', line);
        print(out, await setStepStatus(await planningDir(values, id), id, title, status as LedgerStepStatus));
      } else if (action === 'rename') {
        const [, title, to] = positionals(positional, ['work-id', 'title', 'new-title'], line);
        print(out, await renameStep(await planningDir(values, id), id, title, to));
      } else {
        const [, title] = positionals(positional, ['work-id', 'title'], line);
        if (!values.reason) throw new UsageError('the following arguments are required: --reason (a step is never removed silently)', line);
        print(out, await removeStep(await planningDir(values, id), id, title, values.reason));
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
  const results = checkPaths(targets);
  const prefix = (folder: string) => results.length > 1 ? folder + ': ' : '';
  for (const result of results) {
    for (const message of result.warnings) out.stdout('WARNING: ' + prefix(result.planningFolder) + message);
    for (const message of result.errors) out.stderr('ERROR: ' + prefix(result.planningFolder) + message);
  }
  const failed = results.some(result => result.errors.length);
  if (!failed) out.stdout(`Checked ${results.map(result => result.files.length ? result.files.join(', ') + ' in ' + result.planningFolder : result.planningFolder).join('; ')}: no problems; files were not modified.`);
  return failed ? 1 : 0;
}

/** `atlas home`: where the home is and its planning folders, or `adopt` a planning folder into it. */
export async function home(args: string[], out: Output) {
  const line = usageOf('atlas home');
  if (wantsHelp(args)) { out.stdout(line); return 0; }
  const [action, ...rest] = args;
  if (action === undefined || action === 'list') {
    positionals(rest, [], line);
    const folder = atlasHome();
    print(out, { home: folder, planningFolders: await homePlanningFolders(folder) });
    return 0;
  }
  if (action === 'adopt') {
    const { positional, values } = parseOptions(rest, { values: ['name'] }, line);
    const [folder] = positionals(positional, ['folder'], line);
    if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new UsageError(folder + ' is not a folder', line);
    print(out, await adoptPlanningFolder(folder, { name: values.name ?? null }));
    return 0;
  }
  throw new UsageError('unknown home command: ' + action, line);
}
