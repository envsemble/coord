// The coord command: the planning-state operations (also served over MCP by `coord mcp`), checks,
// the harness hooks and setup, work statistics and the headless host.
import { createRequire } from 'node:module';
import { DatabaseVersionError, PlanningNotFoundError, WorkError, harnessSessions, recordWorkReport } from '../planning/index.ts';
import { parseOptions, UsageError, type Output } from './args.ts';
import { check, home, planningUsage, project, where, work } from './commands/planning.ts';
import { capture, CaptureError } from './commands/capture.ts';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

export const usage = `Coord ${version}

Usage:
${planningUsage}
  coord capture <source.json> (--work <work-id> | --out <file>) [--name <name>] [--compares <capture.puml>] [--force] [--planning-dir <dir>]
  coord mcp
  coord hook <SessionStart|UserPromptSubmit|PageChoices|PostToolUse|ToolUse|Stop|StopFailure|Interrupt|SubagentStop|SessionEnd>
  coord setup [--dry-run]
  coord work report <planning-root> --work <work-id> [--step <title>] [--model <model>] [--session <id>] [--tokens <n>]
  coord serve [--address <ip>] [--port <n>] [--home <dir>]
  coord --version
  coord help

where finds the projects (planning folders in the Coord home) that this folder belongs to (by being
in one of their folders, the deepest winning, or inside the planning folder), with their names and
active work; when several match, the work commands need --planning-dir. project create makes a
project in the home covering the folders given. The work
commands change a work item's planning state: each prints the work item's status as JSON and exits
0, 1 when it is refused (with the reason and any open items on stderr) and 2 on usage errors.
They use the planning folder given by --planning-dir, else the one this folder belongs to. They
never commit. check checks plans, ledgers, the registry and diagrams of the files or planning
folders given (default: this folder's), warns about diagrams no document links, and exits 0
when valid, 1 on errors. home lists the home's projects.
capture captures code or a database as the source configuration file describes (paths in it are
relative to it) and writes the diagram into the work item's diagrams/<name>.puml (default name
<identity>-<date>), or to --out; an existing file needs --force. --compares names an earlier
capture this one is compared with. It prints the capture's summary as JSON and exits 0, 1 when
the capture fails or is refused, and 2 on usage errors.
mcp serves the planning-state operations to an agent harness over stdio. hook runs one harness
hook (Claude Code or Codex) on the JSON it reads from stdin; it always exits 0. setup creates the
Coord home and its database, grants the home to
Claude Code and Codex, and installs the Coord plugin into each harness on PATH; --dry-run prints
what it would do.
work report records a step transition: its time, the model and the step, in the Coord home's
database under the planning folder's project, which the app summarizes. Inside Claude Code or Codex it reads the
session, the model, and the agent's working time and tokens since the session's previous report
from the session's own log on this computer; elsewhere give --model, and --session and --tokens
(the tokens used so far in the session) when known. It always exits 0, except for usage errors
(2), so reporting never fails the task.
serve runs the Coord host without the desktop app, so paired devices can use this computer's
projects (the planning folders in its home). It
listens on this computer's Tailscale address unless --address names another (default port
7346), prints a one-time pairing link with a QR code, and runs until stopped (Ctrl+C, or quit
when interactive; manage prints a link that also grants Manage access).
The Coord home is ~/.coord, or COORD_HOME: its planning/ folder holds the projects' planning
folders, and Coord keeps its database (coord.db) and logs beside them.`;

const console_: Output = { stdout: text => process.stdout.write(text + '\n'), stderr: text => process.stderr.write(text + '\n') };

const reportUsage = 'Usage: coord work report <planning-root> --work <work-id> [--step <title>] [--model <model>] [--session <id>] [--tokens <n>]';
const serveUsage = 'Usage: coord serve [--address <ip>] [--port <n>] [--home <dir>]';

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
    out.stdout(JSON.stringify({ recorded: true, project: result.project, at: report.at, model: report.model, ...measured && { since: measured.since, agentMs: measured.agentMs, tokens: measured.models.reduce((sum, item) => sum + item.input + item.cacheRead + item.cacheWrite + item.output, 0) } }));
  } catch (error) {
    out.stderr('Work statistics were not recorded (' + (error instanceof Error ? error.message : String(error)).replace(/\.$/, '') + '); continue the task.');
  }
  return 0;
}

async function serveCommand(args: string[], out: Output) {
  if (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) { out.stdout(serveUsage); return 0; }
  const { positional, values } = parseOptions(args, { values: ['address', 'port', 'home'] }, serveUsage);
  if (positional.length) throw new UsageError('unrecognized arguments: ' + positional.join(' '), serveUsage);
  if (values.port !== undefined && (!/^[0-9]+$/.test(values.port) || Number(values.port) < 1024 || Number(values.port) > 65535)) throw new UsageError('argument --port: expected a port from 1024 to 65535', serveUsage);
  if (values.address !== undefined && !/^[0-9a-fA-F:.]+$/.test(values.address)) throw new UsageError('argument --address: expected an IP address of this computer', serveUsage);
  const { serve } = await import('../host/serve.ts');
  let running;
  try {
    running = await serve({ address: values.address ?? null, port: values.port === undefined ? null : Number(values.port), home: values.home ?? null, version, interactive: Boolean(process.stdin.isTTY) }, out);
  } catch (error) { out.stderr('coord: ' + (error as Error).message); return 1; }
  const stop = () => { void running.stop().then(() => process.exit(0)); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return 0;
}

// Text from planning files reaches the terminal: replace control characters (including
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

/** Run the command and return its exit code. The MCP server and the host keep running after this resolves. */
export async function main(args: string[], out: Output = console_): Promise<number> {
  const [command, subcommand, ...rest] = args;
  try {
    if (command === '--version' || command === '-v' || command === 'version') { out.stdout(version); return 0; }
    if (!command || ['help', '--help', '-h'].includes(command)) { out.stdout(usage); return 0; }
    // A hook never fails the session, whatever happens.
    if (command === 'hook') { const { hook } = await import('./commands/hook.ts'); return await hook(args.slice(1), out); }
    if (command === 'mcp') { const { serveMcp } = await import('./commands/mcp.ts'); return await serveMcp(args.slice(1), out); }
    if (command === 'setup') { const { setup } = await import('./commands/setup.ts'); return await setup(args.slice(1), out); }
    if (command === 'where') return await where(args.slice(1), out);
    if (command === 'check') return await check(args.slice(1), out);
    if (command === 'capture') return await capture(args.slice(1), out);
    if (command === 'home') return await home(args.slice(1), out);
    if (command === 'project') return await project(args.slice(1), out);
    if (command === 'work' && subcommand === 'report') return await workReport(rest, printableOutput(out));
    if (command === 'work') return await work(subcommand, rest, out);
    // The QR code is drawn with terminal colour codes; serve prints only local, trusted text.
    if (command === 'serve') return await serveCommand(args.slice(1), out);
    throw new UsageError(command === 'work' ? `unknown ${command} command: ${subcommand ?? '(none)'}` : 'unknown command: ' + command);
  } catch (error) {
    if (error instanceof PlanningNotFoundError || error instanceof CaptureError || error instanceof DatabaseVersionError) { out.stderr('coord: ' + printable(error.message)); return 1; }
    if (error instanceof WorkError) {
      out.stderr('coord: ' + printable(error.message));
      for (const problem of error.problems) out.stderr('  - ' + printable(problem));
      return 1;
    }
    const failure = ['work', 'home', 'project', 'capture'].includes(command) ? systemFailure(error) : null;
    if (failure) { out.stderr('coord: ' + printable(failure)); return 1; }
    if (!(error instanceof UsageError)) throw error;
    out.stderr(error.line || usage);
    out.stderr('coord: error: ' + error.message);
    return 2;
  }
}
