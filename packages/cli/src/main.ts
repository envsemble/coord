// The atlas command. Model tools and the MCP server delegate to the diagram package;
// planning checks and consultation logging use the shared planning reader.
import { createRequire } from 'node:module';
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PlanExportError, exportPlan, harnessSessions, importPlan, logConsultation, planImportTarget, planningRelative, readPlanExport, recordWorkReport, validatePlanning } from '@envsemble/atlas-planning';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export const usage = `Atlas ${version}

Usage:
  atlas model <operation> --root <workspace> [--input <request.json|->]
  atlas model review --input <request.json|->
  atlas model tools
  atlas model job <init|validate|build> ...
  atlas mcp --root <workspace>
  atlas planning check <planning-root>
  atlas plan export <work-id|work-folder> [--planning-dir <dir>] [--out <file>] [--force]
  atlas plan import <file> [--planning-dir <dir>] [--dry-run]
  atlas usage log <planning-root> --files <path>... [--task <id>] [--session <id>] [--data-dir <dir>]
  atlas work report <planning-root> --work <work-id> [--step <title>] [--model <model>] [--session <id>] [--tokens <n>]
  atlas serve [--folder <planning-root>]... [--address <ip>] [--port <n>] [--data-dir <dir>]
  atlas --version
  atlas help

Model commands print JSON and exit 2 for input failures, 1 for blocking findings.
planning check exits 0 when valid, 1 on errors and 2 on usage errors; it never writes.
plan export writes one self-contained HTML file of a work item (default
<slug>-<work-id>.atlas-plan.html in the current folder; an existing file needs --force).
plan import prints a preview, then adds the export as new work under the next free number
and registers it in planning.json without committing; --dry-run only previews. Both use the
planning folder given by --planning-dir, else the current folder, and exit 0 on success,
1 for an invalid export or a refused folder and 2 on usage errors.
usage log exits 0 even when it cannot record, so a logging problem never fails the task (2 only for
usage errors); it reports gaps on stderr.
work report records a ledger transition: its time, the model and the step, as one line in
<work>/.atlas/statistics.jsonl, which the app summarizes. Inside Claude Code or Codex it reads the
session, the model, and the agent's working time and tokens since the session's previous report
from the session's own log on this computer; elsewhere give --model, and --session and --tokens
(the tokens used so far in the session) when known. It always exits 0, except for usage errors
(2), so reporting never fails the task.
serve runs the Atlas host without the desktop app, so paired devices can browse this computer
and open any planning folder on it; --folder puts folders on its folder list from the start. It
listens on this computer's Tailscale address unless --address names another (default port
7346), prints a one-time pairing link with a QR code, and runs until stopped (Ctrl+C, or quit
when interactive; manage prints a link that also grants Manage access).
Usage statistics live in the Atlas data folder: ATLAS_DATA_DIR, else %APPDATA%\\Atlas on
Windows or \${XDG_CONFIG_HOME:-~/.config}/Atlas on Linux.`;

interface Output { stdout: (text: string) => void; stderr: (text: string) => void }
const console_: Output = { stdout: text => process.stdout.write(text + '\n'), stderr: text => process.stderr.write(text + '\n') };

class UsageError extends Error {
  line: string;
  constructor(message: string, line = '') { super(message); this.line = line; }
}
const checkUsage = 'Usage: atlas planning check <planning-root>';
const exportUsage = 'Usage: atlas plan export <work-id|work-folder> [--planning-dir <dir>] [--out <file>] [--force]';
const importUsage = 'Usage: atlas plan import <file> [--planning-dir <dir>] [--dry-run]';
const logUsage = 'Usage: atlas usage log <planning-root> --files <path>... [--task <id>] [--session <id>] [--data-dir <dir>]';
const reportUsage = 'Usage: atlas work report <planning-root> --work <work-id> [--step <title>] [--model <model>] [--session <id>] [--tokens <n>]';
const serveUsage = 'Usage: atlas serve [--folder <planning-root>]... [--address <ip>] [--port <n>] [--data-dir <dir>]';

/** Parse `--name value`, `--name=value` and the variadic `--files a b c`, like the former argparse helpers. */
function parseOptions(args: string[], spec: { values: string[]; lists?: string[]; flags?: string[] }, line: string) {
  const positional: string[] = [];
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  const lists: Record<string, string[]> = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith('--') || argument === '--') { positional.push(argument); continue; }
    const [name, inline] = argument.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (spec.flags?.includes(name)) {
      if (inline !== undefined) throw new UsageError(`argument --${name}: takes no value`, line);
      flags.add(name);
    } else if (spec.lists?.includes(name)) {
      const items = inline !== undefined ? [inline] : [];
      while (index + 1 < args.length && !args[index + 1].startsWith('-')) items.push(args[++index]);
      if (!items.length) throw new UsageError(`argument --${name}: expected at least one argument`, line);
      (lists[name] ??= []).push(...items);
    } else if (spec.values.includes(name)) {
      const value = inline ?? args[++index];
      if (value === undefined || (inline === undefined && value.startsWith('--'))) throw new UsageError(`argument --${name}: expected one argument`, line);
      values[name] = value;
    } else throw new UsageError('unrecognized arguments: ' + argument, line);
  }
  return { positional, values, lists, flags };
}

function planningCheck(args: string[], out: Output) {
  if (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) { out.stdout(checkUsage); return 0; }
  const { positional } = parseOptions(args, { values: [] }, checkUsage);
  if (positional.length !== 1) throw new UsageError(positional.length ? 'unrecognized arguments: ' + positional.slice(1).join(' ') : 'the following arguments are required: planning-root', checkUsage);
  const { errors, warnings } = validatePlanning(positional[0]);
  for (const message of warnings) out.stdout('WARNING: ' + message);
  for (const message of errors) out.stderr('ERROR: ' + message);
  if (!errors.length) out.stdout('Planning registry and selected plan metadata valid; files were not modified.');
  return errors.length ? 1 : 0;
}

async function usageLog(args: string[], out: Output) {
  if (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) { out.stdout(logUsage); return 0; }
  const { positional, values, lists } = parseOptions(args, { values: ['task', 'session', 'data-dir'], lists: ['files'] }, logUsage);
  if (positional.length > 1) throw new UsageError('unrecognized arguments: ' + positional.slice(1).join(' '), logUsage);
  const missing = [positional.length ? '' : 'planning-root', lists.files ? '' : '--files'].filter(Boolean);
  if (missing.length) throw new UsageError('the following arguments are required: ' + missing.join(', '), logUsage);
  const result = await logConsultation(positional[0], lists.files, { task: values.task, session: values.session, dataDir: values['data-dir'] });
  if (result.unavailable) out.stderr('Planning usage logging unavailable (' + result.unavailable + '); continue the task.');
  else {
    out.stdout(`{"reported_documents": ${result.recorded}, "unrecorded_documents": ${result.failed}}`);
    if (result.failed) out.stderr('Some usage reports were not recorded; continue the task.');
  }
  return 0;
}

async function workReport(args: string[], out: Output) {
  if (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) { out.stdout(reportUsage); return 0; }
  const { positional, values } = parseOptions(args, { values: ['work', 'model', 'tokens', 'session', 'step'] }, reportUsage);
  if (positional.length > 1) throw new UsageError('unrecognized arguments: ' + positional.slice(1).join(' '), reportUsage);
  // A session's log may name the model: inside a harness, or for a given session.
  const logged = harnessSessions(process.env).length > 0 || values.session !== undefined;
  const missing = [positional.length ? '' : 'planning-root', values.work ? '' : '--work', values.model || logged ? '' : '--model'].filter(Boolean);
  if (missing.length) throw new UsageError('the following arguments are required: ' + missing.join(', '), reportUsage);
  if (values.tokens !== undefined && !/^[0-9]+$/.test(values.tokens)) throw new UsageError('argument --tokens: expected a whole number of tokens', reportUsage);
  try {
    const result = await recordWorkReport(positional[0], values.work, { model: values.model ?? null, tokens: values.tokens === undefined ? null : Number(values.tokens), session: values.session ?? null, step: values.step ?? null });
    for (const warning of result.warnings) out.stderr('WARNING: ' + warning);
    const { report } = result, measured = report.measured;
    out.stdout(JSON.stringify({ recorded: true, file: result.file, at: report.at, model: report.model, ...measured && { since: measured.since, agentMs: measured.agentMs, tokens: measured.models.reduce((sum, item) => sum + item.input + item.cacheRead + item.cacheWrite + item.output, 0) } }));
  } catch (error) {
    out.stderr('Work statistics were not recorded (' + (error instanceof Error ? error.message : String(error)).replace(/\.$/, '') + '); continue the task.');
  }
  return 0;
}

async function serveCommand(args: string[], out: Output) {
  if (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) { out.stdout(serveUsage); return 0; }
  const { positional, values, lists } = parseOptions(args, { values: ['address', 'port', 'data-dir'], lists: ['folder'] }, serveUsage);
  if (positional.length) throw new UsageError('unrecognized arguments: ' + positional.join(' '), serveUsage);
  if (values.port !== undefined && (!/^[0-9]+$/.test(values.port) || Number(values.port) < 1024 || Number(values.port) > 65535)) throw new UsageError('argument --port: expected a port from 1024 to 65535', serveUsage);
  if (values.address !== undefined && !/^[0-9a-fA-F:.]+$/.test(values.address)) throw new UsageError('argument --address: expected an IP address of this computer', serveUsage);
  const { serve } = await import('@envsemble/atlas-host/serve');
  let running;
  try {
    running = await serve({ folders: (lists.folder ?? []).map(folder => path.resolve(folder)), address: values.address ?? null, port: values.port === undefined ? null : Number(values.port), dataDir: values['data-dir'] ?? null, version, interactive: Boolean(process.stdin.isTTY) }, out);
  } catch (error) { out.stderr('atlas: ' + (error as Error).message); return 1; }
  const stop = () => { void running.stop().then(() => process.exit(0)); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return 0;
}

function size(value: number) { return value < 1048576 ? Math.max(1, Math.round(value / 1024)) + ' KB' : (value / 1048576).toFixed(1) + ' MB'; }

// Text from a plan export reaches the terminal: replace control characters (including
// escape sequences) and bidirectional overrides so it cannot rewrite what is shown.
const unprintable: [number, number][] = [[0x00, 0x1f], [0x7f, 0x9f], [0x61c, 0x61c], [0x200e, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069]];
function printable(text: string) {
  return text.split('\n').map(line => [...line].map(character => {
    const code = character.codePointAt(0)!;
    return unprintable.some(([from, to]) => code >= from && code <= to) ? '?' : character;
  }).join('')).join('\n');
}
const printableOutput = (out: Output): Output => ({ stdout: text => out.stdout(printable(text)), stderr: text => out.stderr(printable(text)) });

/** A filesystem failure, said in one line instead of a stack trace. */
function systemFailure(error: unknown): string | null {
  const failure = error as NodeJS.ErrnoException;
  if (!failure || typeof failure.code !== 'string' || typeof failure.syscall !== 'string') return null;
  const reasons: Record<string, string> = {
    ENOENT: 'it does not exist', EISDIR: 'it is a folder', ENOTDIR: 'part of the path is not a folder', EACCES: 'permission denied', EPERM: 'permission denied',
    ENAMETOOLONG: 'the path is too long', ENOSPC: 'the disk is full', EROFS: 'the file system is read-only', EBUSY: 'it is in use', EEXIST: 'it already exists',
  };
  return `cannot ${failure.syscall} ${failure.path ?? ''}: ${reasons[failure.code] ?? failure.code}`.replace(/ {2,}/g, ' ');
}

async function planExport(args: string[], out: Output) {
  if (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) { out.stdout(exportUsage); return 0; }
  const { positional, values, flags } = parseOptions(args, { values: ['planning-dir', 'out'], flags: ['force'] }, exportUsage);
  if (positional.length !== 1) throw new UsageError(positional.length ? 'unrecognized arguments: ' + positional.slice(1).join(' ') : 'the following arguments are required: work-id|work-folder', exportUsage);
  const planningDir = path.resolve(values['planning-dir'] ?? '.');
  let work = positional[0];
  // A work folder may be given as a filesystem path; the export API takes it relative to the planning folder.
  if (!/^work-[0-9]{4,}$/.test(work) && existsSync(work) && statSync(work).isDirectory()) {
    const relative = planningRelative(planningDir, work);
    if (!relative) throw new PlanExportError('WORK', `${work} is not a work folder inside the planning folder ${planningDir}.`);
    work = relative;
  }
  const chosen = values.out === undefined ? null : path.resolve(values.out);
  if (chosen && existsSync(chosen) && statSync(chosen).isDirectory()) throw new PlanExportError('CONFLICT', `${chosen} is a folder; give --out a file name.`);
  const result = await exportPlan(planningDir, work);
  const { source } = result.manifest;
  const file = chosen ?? path.resolve(`${path.posix.basename(source.path).replace(/^[0-9]+-/, '') || 'plan'}-${source.workId}.atlas-plan.html`);
  if (!existsSync(path.dirname(file))) throw new PlanExportError('CONFLICT', `The folder ${path.dirname(file)} does not exist.`);
  // Every export records its own time, so an existing file always differs.
  if (existsSync(file) && !flags.has('force')) throw new PlanExportError('CONFLICT', `${file} already exists. Choose another --out file, or pass --force to replace it.`);
  for (const warning of result.warnings) out.stderr('WARNING: ' + warning);
  const temporary = file + '.' + randomUUID() + '.tmp';
  try { writeFileSync(temporary, result.html, { flag: 'wx' }); renameSync(temporary, file); }
  finally { rmSync(temporary, { force: true }); }
  const contents = result.manifest.files.reduce((sum, item) => sum + item.size, 0);
  out.stdout(`Exported ${source.workId} “${source.title}” (${result.manifest.files.length} files, ${size(contents)}) to ${file} (${size(result.bytes)}).`);
  out.stdout('Open it in any browser to read the plan offline, or import it with atlas plan import.');
  return 0;
}

async function planImport(args: string[], out: Output) {
  if (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) { out.stdout(importUsage); return 0; }
  const { positional, values, flags } = parseOptions(args, { values: ['planning-dir'], flags: ['dry-run'] }, importUsage);
  if (positional.length !== 1) throw new UsageError(positional.length ? 'unrecognized arguments: ' + positional.slice(1).join(' ') : 'the following arguments are required: file', importUsage);
  const planningDir = path.resolve(values['planning-dir'] ?? '.');
  let bytes: Buffer;
  try { bytes = readFileSync(positional[0]); }
  catch (error) { if (error && typeof error === 'object' && !('path' in error)) Object.assign(error, { path: path.resolve(positional[0]) }); throw error; }
  const preview = readPlanExport(bytes);
  const { source } = preview.manifest;
  const target = await planImportTarget(planningDir, preview.manifest);
  out.stdout(`Plan export: “${source.title}”`);
  out.stdout(`  From:       ${source.workId} in ${source.planningFolder} (${source.path}), exported ${preview.manifest.exportedAt} with Atlas ${preview.manifest.atlasVersion}`);
  out.stdout(`  Import as:  ${target.workId} in ${target.path}`);
  out.stdout(`  Files:      ${preview.files.length} (${size(preview.totalBytes)})`);
  out.stdout(`  Diagrams:   ${preview.diagrams.length}`);
  for (const diagram of preview.diagrams) out.stdout(`    - ${diagram.title}${diagram.provenance.label ? ' (' + diagram.provenance.label + ')' : ''}`);
  if (flags.has('dry-run')) { out.stdout('Dry run: nothing was written.'); return 0; }
  // The preview carries the validated contents, so the file is not read twice.
  const result = await importPlan(planningDir, preview);
  for (const note of result.notes) out.stdout(note);
  return 0;
}

async function delegate(module: '@envsemble/atlas-diagrams/cli' | '@envsemble/atlas-diagrams/job-cli', args: string[]) {
  const { run } = require(module) as { run: (args: string[]) => Promise<void> };
  await run(args);
  return typeof process.exitCode === 'number' ? process.exitCode : 0;
}

/** Run the command and return its exit code. The MCP server keeps running after this resolves. */
export async function main(args: string[], out: Output = console_): Promise<number> {
  const [command, subcommand, ...rest] = args;
  try {
    if (command === '--version' || command === '-v' || command === 'version') { out.stdout(version); return 0; }
    if (!command || ['help', '--help', '-h'].includes(command)) { out.stdout(usage); return 0; }
    if (command === 'model') {
      if (subcommand === 'job') return await delegate('@envsemble/atlas-diagrams/job-cli', rest);
      if (subcommand === 'mcp' || subcommand === '--version') throw new UsageError(subcommand === 'mcp' ? 'use atlas mcp --root <workspace>' : 'use atlas --version');
      return await delegate('@envsemble/atlas-diagrams/cli', subcommand === undefined ? [] : [subcommand, ...rest]);
    }
    if (command === 'mcp') return await delegate('@envsemble/atlas-diagrams/cli', ['mcp', ...args.slice(1)]);
    if (command === 'planning' && subcommand === 'check') return planningCheck(rest, out);
    if (command === 'plan' && subcommand === 'export') return await planExport(rest, printableOutput(out));
    if (command === 'plan' && subcommand === 'import') return await planImport(rest, printableOutput(out));
    if (command === 'usage' && subcommand === 'log') return await usageLog(rest, out);
    if (command === 'work' && subcommand === 'report') return await workReport(rest, printableOutput(out));
    // The QR code is drawn with terminal colour codes; serve prints only local, trusted text.
    if (command === 'serve') return await serveCommand(args.slice(1), out);
    throw new UsageError(command === 'planning' || command === 'plan' || command === 'usage' || command === 'work' ? `unknown ${command} command: ${subcommand ?? '(none)'}` : 'unknown command: ' + command);
  } catch (error) {
    if (error instanceof PlanExportError) { out.stderr('atlas: ' + printable(error.message)); return 1; }
    const failure = command === 'plan' ? systemFailure(error) : null;
    if (failure) { out.stderr('atlas: ' + printable(failure)); return 1; }
    if (!(error instanceof UsageError)) throw error;
    out.stderr(error.line || usage);
    out.stderr('atlas: error: ' + error.message);
    return 2;
  }
}
