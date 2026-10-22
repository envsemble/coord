// The agents Atlas connects on this computer, Claude Code and Codex: whether each is on the PATH,
// whether the Atlas plugin is installed in it, and installing or removing it through the agent's
// own commands, from a marketplace folder (a checkout for `atlas setup`, the copy in the Atlas home
// for the desktop app). Connecting also grants the agent the Atlas home. HOME/USERPROFILE,
// CLAUDE_CONFIG_DIR, CODEX_HOME and PATH in the environment given choose what is touched.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { folderKey } from '../home/database.ts';
import { ProgramError, runProgram } from '../platform/run.ts';
import { grantClaudeDirectory, grantCodexRoot } from './grants.ts';

export type AgentId = 'claude' | 'codex';

/** The Atlas plugin as an agent has it installed; `source` is the marketplace folder it came from, when the agent says. */
export interface Installed { version: string | null; enabled: boolean; source: string | null }

export interface Harness {
  id: AgentId;
  name: string;
  program: string;
  /** The agent's own folder, and the file in it where the home is granted. */
  config(environment: NodeJS.ProcessEnv): string;
  file: string;
  where: string;
  grant(text: string | null, directory: string): string | null;
  /** The commands that install the plugin from the marketplace `marketplace` in `directory`. */
  install(directory: string, marketplace: string): string[][];
  /** The command that removes a marketplace added from another source, for an agent that will not replace it; null when it replaces it itself. */
  replace(marketplace: string): string[] | null;
  /** The commands that uninstall the plugin and remove its marketplace, and what they say when there is nothing to remove. */
  uninstall(marketplace: string): string[][];
  absent: RegExp;
  /** The command that lists the installed plugins as JSON, and the Atlas plugin in what it prints (null when not installed). */
  list(marketplace: string): string[];
  installed(stdout: string, plugin: string, environment: NodeJS.ProcessEnv): Installed | null;
}

export function userHome(environment: NodeJS.ProcessEnv) {
  return (process.platform === 'win32' ? environment.USERPROFILE || environment.HOME : environment.HOME) || homedir();
}
const same = (left: string, right: string) => folderKey(path.resolve(left)) === folderKey(path.resolve(right));
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === 'string' && value ? value : null;

/**
 * The Atlas plugin in `claude plugin list --json`: a list of installed plugins by `id`, read in place
 * from `readFromFolder` (the marketplace's plugin/ folder). A Claude Code without --json leaves the
 * list unreadable; its installed_plugins.json then says whether the plugin is installed.
 */
export function claudeInstalled(stdout: string, plugin: string, environment: NodeJS.ProcessEnv = {}): Installed | null {
  let listed: unknown;
  try { listed = JSON.parse(stdout); } catch { listed = undefined; }
  if (Array.isArray(listed)) {
    const entry = listed.map(record).find(item => item?.id === plugin);
    if (!entry) return null;
    const folder = text(entry.readFromFolder);
    return { version: text(entry.version), enabled: entry.enabled !== false, source: folder ? path.dirname(folder) : null };
  }
  try {
    const file = path.join(environment.CLAUDE_CONFIG_DIR || path.join(userHome(environment), '.claude'), 'plugins', 'installed_plugins.json');
    const entries = record(record(JSON.parse(readFileSync(file, 'utf8')))?.plugins)?.[plugin];
    if (!Array.isArray(entries) || !entries.length) return null;
    return { version: text(record(entries[0])?.version), enabled: true, source: null };
  } catch { return null; }
}

/** The Atlas plugin in `codex plugin list --json`: `installed` plugins by `pluginId`, with the marketplace root they were added from. */
export function codexInstalled(stdout: string, plugin: string): Installed | null {
  let listed: unknown;
  try { listed = JSON.parse(stdout); } catch { return null; }
  const items = record(listed)?.installed;
  const entry = Array.isArray(items) ? items.map(record).find(item => item?.pluginId === plugin && item.installed !== false) : undefined;
  if (!entry) return null;
  // Codex names the root as a Windows extended-length path (\\?\C:\...).
  const root = text(record(entry.marketplaceSource)?.source)?.replace(/^\\\\\?\\(?!UNC\\)/, '') ?? null;
  return { version: text(entry.version), enabled: entry.enabled !== false, source: root };
}

// Claude Code reads a plugin from a folder marketplace in place, and adding a marketplace of the same
// name from another folder points it there. Codex copies a plugin when it is added, so adding it
// again refreshes the copy; and it keeps a marketplace's first source, so one added from another
// folder is removed first.
export const harnesses: readonly Harness[] = [
  {
    id: 'claude', name: 'Claude Code', program: 'claude',
    config: environment => environment.CLAUDE_CONFIG_DIR || path.join(userHome(environment), '.claude'), file: 'settings.json', where: 'permissions.additionalDirectories', grant: grantClaudeDirectory,
    install: (directory, marketplace) => [['plugin', 'marketplace', 'add', directory], ['plugin', 'install', 'atlas@' + marketplace]], replace: () => null,
    uninstall: marketplace => [['plugin', 'uninstall', 'atlas@' + marketplace], ['plugin', 'marketplace', 'remove', marketplace]], absent: /not found|not installed|not configured/i,
    list: () => ['plugin', 'list', '--json'], installed: claudeInstalled,
  },
  {
    id: 'codex', name: 'Codex', program: 'codex',
    config: environment => environment.CODEX_HOME || path.join(userHome(environment), '.codex'), file: 'config.toml', where: '[sandbox_workspace_write] writable_roots', grant: grantCodexRoot,
    install: (directory, marketplace) => [['plugin', 'marketplace', 'add', directory], ['plugin', 'add', 'atlas@' + marketplace]], replace: marketplace => ['plugin', 'marketplace', 'remove', marketplace],
    uninstall: marketplace => [['plugin', 'remove', 'atlas@' + marketplace], ['plugin', 'marketplace', 'remove', marketplace]], absent: /not configured|not installed|not found/i,
    // Only the Atlas marketplace's plugins: listing them all asks the remote ones too, which takes seconds.
    list: marketplace => ['plugin', 'list', '--json', '--marketplace', marketplace], installed: (stdout, plugin) => codexInstalled(stdout, plugin),
  },
];
export const harness = (id: AgentId) => harnesses.find(item => item.id === id)!;

/** The name of the marketplace in `directory` (its .claude-plugin/marketplace.json), which names the plugin in its plugin/ folder. */
export function marketplaceName(directory: string) {
  return (JSON.parse(readFileSync(path.join(directory, '.claude-plugin', 'marketplace.json'), 'utf8')) as { name: string }).name;
}

/**
 * A variable of an environment by its name in any case, as Windows reads them: a copy of the
 * environment (a plain object) keeps the case it came with, and Explorer starts programs with `path`.
 */
export function variable(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  if (environment[name] !== undefined || process.platform !== 'win32') return environment[name];
  const key = Object.keys(environment).find(key => key.toUpperCase() === name);
  return key === undefined ? undefined : environment[key];
}

/** A program on PATH, as Windows finds it too (atlas.cmd, claude.exe). */
export function onPath(name: string, environment: NodeJS.ProcessEnv): string | null {
  const extensions = process.platform === 'win32' ? (variable(environment, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const folder of (variable(environment, 'PATH') ?? '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(folder, name + extension.toLowerCase());
      if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
    }
  }
  return null;
}

// cmd.exe's special characters. Escaped with ^ outside any quotes, as cross-spawn does, they reach the
// program as written: cmd.exe then sees no quoted text of its own, so it expands no %VARIABLE% and
// runs nothing after an & in a folder's name.
const cmdSpecial = /([()\][%!^"`<>&|;, *?])/g;
/** The command line cmd.exe /d /s /c runs for a .cmd or .bat program, every argument quoted as the C runtime reads it. */
export function cmdLine(program: string, args: string[]) {
  const quoted = (value: string) => ('"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"').replace(cmdSpecial, '^$1');
  return '"' + [program.replace(cmdSpecial, '^$1'), ...args.map(quoted)].join(' ') + '"';
}

/**
 * Run an agent's command, never through a shell's parsing of its arguments: a .cmd or .bat program
 * (an npm shim, on Windows) runs through cmd.exe with every argument escaped. Its output, and the
 * exit status (1 when it could not start or did not finish within `timeout` milliseconds).
 */
export async function runHarness(program: string, args: string[], environment: NodeJS.ProcessEnv, timeout = 120000): Promise<{ status: number; stdout: string; output: string }> {
  const shim = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(program);
  const shell = environment.ComSpec || process.env.ComSpec || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  try {
    const { stdout, stderr } = shim
      ? await runProgram(shell, ['/d', '/s', '/c', cmdLine(program, args)], { env: environment, timeout, windowsVerbatimArguments: true })
      : await runProgram(program, args, { env: environment, timeout });
    return { status: 0, stdout, output: (stdout + stderr).trim() };
  } catch (error) {
    if (!(error instanceof ProgramError)) return { status: 1, stdout: '', output: (error as Error).message };
    const late = error.killed ? `\n${path.basename(program)} did not finish within ${Math.round(timeout / 1000)} s.` : '';
    return { status: error.code ?? 1, stdout: error.stdout, output: (error.stdout + error.stderr + late).trim() };
  }
}
/** The last lines of a command's output, enough to say why it failed. */
export const lastLines = (output: string) => output.split(/\r?\n/).filter(line => line.trim() && !/^WARNING:/.test(line)).slice(-3).join(' ');

export interface Step { shown: string; ok: boolean; already: boolean; replaced: string | null; status: number; output: string }
/**
 * Run one of the commands that install the plugin. Adding the marketplace, an agent that keeps a
 * marketplace's first source has the one added from elsewhere removed first (`replaced` says how).
 * One that says it is done already counts as done.
 */
export async function installStep(harness: Harness, program: string, command: string[], marketplace: string, environment: NodeJS.ProcessEnv): Promise<Step> {
  const shown = [harness.program, ...command].join(' ');
  const replace = harness.replace(marketplace);
  let result = await runHarness(program, command, environment);
  let replaced: string | null = null;
  if (result.status !== 0 && replace && command[1] === 'marketplace' && command[2] === 'add' && /different source/i.test(result.output)) {
    replaced = [harness.program, ...replace].join(' ');
    const removed = await runHarness(program, replace, environment);
    if (removed.status === 0) result = await runHarness(program, command, environment);
  }
  const already = result.status !== 0 && /already/i.test(result.output) && !/different source/i.test(result.output);
  return { shown, ok: result.status === 0 || already, already, replaced, status: result.status, output: result.output };
}

/** Grant the home in the agent's own file (creating it); false when it was granted already. Throws, saying why, when the file cannot be edited safely. */
export async function grantHome(harness: Harness, home: string, environment: NodeJS.ProcessEnv, dryRun = false) {
  const file = path.join(harness.config(environment), harness.file);
  const next = harness.grant(existsSync(file) ? await readFile(file, 'utf8') : null, home);
  if (next === null) return false;
  if (!dryRun) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.' + process.pid + '.tmp';
    await writeFile(temporary, next);
    await rename(temporary, file);
  }
  return true;
}

export interface AgentStatus { id: AgentId; found: boolean; connected: boolean; version: string | null; source: string | null }

/**
 * Whether the agent is found (`program`: the one chosen for it, else the one on the PATH) and has
 * the Atlas plugin of the marketplace in `directory` installed and turned on.
 */
export async function agentStatus(harness: Harness, directory: string, environment: NodeJS.ProcessEnv, program = onPath(harness.program, environment)): Promise<AgentStatus> {
  if (!program) return { id: harness.id, found: false, connected: false, version: null, source: null };
  const marketplace = marketplaceName(directory);
  const listed = await runHarness(program, harness.list(marketplace), environment, 30000);
  const plugin = harness.installed(listed.stdout, 'atlas@' + marketplace, environment);
  return { id: harness.id, found: true, connected: Boolean(plugin?.enabled), version: plugin?.version ?? null, source: plugin?.source ?? null };
}

/** A failure to show as it is: what was tried and what the agent said. */
export class AgentError extends Error {}

/**
 * Connect an agent (its `program`, as agentStatus finds it): grant it the Atlas home and install the
 * plugin from `directory`. Stops at the first command that fails (AgentError). A home that cannot
 * be granted does not stop the plugin's install; the error is returned after it.
 */
export async function connectAgent(harness: Harness, directory: string, home: string, environment: NodeJS.ProcessEnv, program = onPath(harness.program, environment)): Promise<{ grantError: string | null }> {
  if (!program) throw new AgentError(`${harness.program} is not on the PATH.`);
  let grantError: string | null = null;
  try { await grantHome(harness, home, environment); } catch (error) {
    grantError = `${path.join(harness.config(environment), harness.file)} was left as it is: ${(error as Error).message}.`;
  }
  const marketplace = marketplaceName(directory);
  for (const command of harness.install(directory, marketplace)) {
    const step = await installStep(harness, program, command, marketplace, environment);
    if (!step.ok) throw new AgentError(`${step.shown} failed: ${lastLines(step.output) || 'exit ' + step.status}`);
  }
  // Claude Code installs a plugin it had turned off without turning it on.
  if (harness.id === 'claude' && (await agentStatus(harness, directory, environment, program)).connected === false) {
    const enabled = await runHarness(program, ['plugin', 'enable', 'atlas@' + marketplace], environment);
    if (enabled.status !== 0 && !/already/i.test(enabled.output)) throw new AgentError(`claude plugin enable atlas@${marketplace} failed: ${lastLines(enabled.output)}`);
  }
  return { grantError };
}

/** Disconnect an agent: uninstall the plugin and remove its marketplace. Nothing there to remove counts as removed. */
export async function disconnectAgent(harness: Harness, directory: string, environment: NodeJS.ProcessEnv, program = onPath(harness.program, environment)) {
  if (!program) throw new AgentError(`${harness.program} is not on the PATH.`);
  for (const command of harness.uninstall(marketplaceName(directory))) {
    const result = await runHarness(program, command, environment);
    if (result.status !== 0 && !harness.absent.test(result.output)) throw new AgentError(`${[harness.program, ...command].join(' ')} failed: ${lastLines(result.output) || 'exit ' + result.status}`);
  }
}

/**
 * After the files in `directory` changed (an update), bring a connected agent up to date: Codex
 * installs its copy again. Claude Code reads them in place, unless its marketplace's folder is gone
 * (the home moved), when it is pointed at `directory`. An agent connected from another folder (a
 * checkout) is left as it is. Says what it did, or null.
 */
export async function refreshAgent(harness: Harness, directory: string, environment: NodeJS.ProcessEnv, program = onPath(harness.program, environment)): Promise<string | null> {
  const status = await agentStatus(harness, directory, environment, program);
  if (!status.connected || !status.source || !program) return null;
  const marketplace = marketplaceName(directory);
  const [add, install] = harness.install(directory, marketplace);
  const command = harness.id === 'codex' ? same(status.source, directory) ? install : null : !existsSync(status.source) ? add : null;
  if (!command) return null;
  const step = await installStep(harness, program, command, marketplace, environment);
  if (!step.ok) throw new AgentError(`${step.shown} failed: ${lastLines(step.output) || 'exit ' + step.status}`);
  return step.shown;
}
