// The atlas command. Model tools and the MCP server delegate to the diagram package;
// planning checks and consultation logging use the shared planning reader.
import { createRequire } from 'node:module';
import { logConsultation, validatePlanning } from '@envsemble/atlas-planning';

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
  atlas usage log <planning-root> --files <path>... [--task <id>] [--session <id>] [--data-dir <dir>]
  atlas --version
  atlas help

Model commands print JSON and exit 2 for input failures, 1 for blocking findings.
planning check exits 0 when valid, 1 on errors and 2 on usage errors; it never writes.
usage log always exits 0 so a logging problem never fails the task; it reports gaps on stderr.
Usage statistics live in the Atlas data folder: ATLAS_DATA_DIR, else %APPDATA%\\Atlas on
Windows or \${XDG_CONFIG_HOME:-~/.config}/Atlas on Linux.`;

interface Output { stdout: (text: string) => void; stderr: (text: string) => void }
const console_: Output = { stdout: text => process.stdout.write(text + '\n'), stderr: text => process.stderr.write(text + '\n') };

class UsageError extends Error {
  line: string;
  constructor(message: string, line = '') { super(message); this.line = line; }
}
const checkUsage = 'Usage: atlas planning check <planning-root>';
const logUsage = 'Usage: atlas usage log <planning-root> --files <path>... [--task <id>] [--session <id>] [--data-dir <dir>]';

/** Parse `--name value`, `--name=value` and the variadic `--files a b c`, like the former argparse helpers. */
function parseOptions(args: string[], spec: { values: string[]; lists?: string[] }, line: string) {
  const positional: string[] = [];
  const values: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith('--') || argument === '--') { positional.push(argument); continue; }
    const [name, inline] = argument.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (spec.lists?.includes(name)) {
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
  return { positional, values, lists };
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
    if (command === 'usage' && subcommand === 'log') return await usageLog(rest, out);
    throw new UsageError(command === 'planning' || command === 'usage' ? `unknown ${command} command: ${subcommand ?? '(none)'}` : 'unknown command: ' + command);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    out.stderr(error.line || usage);
    out.stderr('atlas: error: ' + error.message);
    return 2;
  }
}
