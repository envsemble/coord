// The app's copy of the plugin (agent/plugin, never the repository's plugin/, which checkouts use
// with `atlas` on their PATH) calls the command by its full path, so it works at once in every
// agent, one started before the PATH changed included. Its hooks and its MCP server are rewritten
// as the copy is made, in the form each agent runs them on this system:
//
// - Claude Code runs a hook's command in Git Bash on Windows, or in PowerShell when Git Bash is not
//   installed, and sh elsewhere; a hook in exec form (`command` and `args`) runs without a shell. On
//   Windows its hooks run the build's Node.js on the command directly, in exec form (which needs an
//   .exe, not atlas.cmd), so they work in either shell; elsewhere they run bin/atlas, quoted for sh.
// - Codex runs a hook's command with cmd.exe /C on Windows and $SHELL -lc elsewhere, and asks the
//   person to trust each hook again when its command changes: its hooks run the launcher, whose path
//   stays the same from one update to the next (bin/atlas.cmd on Windows, bin/atlas elsewhere).
// - Both start the MCP server as a program with its arguments, without a shell. Claude Code reads
//   the folder in place, so its server can be the build's Node.js on the command on Windows (an .exe,
//   which every runtime starts), bin/atlas elsewhere. Codex keeps a copy of the plugin, which a
//   failed refresh after an update would leave naming a build since removed, so its server is the
//   launcher too: Codex starts a .cmd as an MCP server (codex-rs/rmcp-client resolves the program
//   with its extension and starts it). Where the two share one file, Codex gets its own.
//
// Only commands that run `atlas` with plain words are rewritten; anything else is left as written.
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

type Platform = NodeJS.Platform;
interface Hook { type?: unknown; command?: unknown; args?: unknown; [key: string]: unknown }

/** The words after `atlas` in a command that runs it with plain words (`atlas hook Stop`); null for any other. */
const atlasWords = (command: unknown) => typeof command === 'string' && /^atlas(?:[ \t]+[\w.-]+)*[ \t]*$/.test(command) ? command.trim().split(/[ \t]+/).slice(1) : null;
/** A word for sh, as it is: in single quotes, each single quote in it closed, escaped and opened again. */
export const shQuoted = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

/** Where the agent folder's command, its Node.js and its launchers are, for this system. */
export function commandPaths(folder: string, build: string, platform: Platform = process.platform) {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const command = join(folder, 'command', build);
  return {
    node: join(command, 'runtime', platform === 'win32' ? 'node.exe' : 'node'), script: join(command, 'bin', 'atlas.js'),
    sh: join(folder, 'bin', 'atlas'), cmd: join(folder, 'bin', 'atlas.cmd'),
  };
}

/** A Claude Code hook, or the MCP server, that runs `atlas`, as it runs from the agent folder. */
function claudeHook(hook: Hook, words: string[], paths: ReturnType<typeof commandPaths>, platform: Platform): Hook {
  if (platform === 'win32') return { ...hook, command: paths.node, args: [paths.script, ...words] };
  return { ...hook, command: [shQuoted(paths.sh), ...words].join(' ') };
}
/**
 * A Codex hook that runs `atlas`, as it runs from the agent folder: cmd.exe reads a path in double
 * quotes as it is. Codex passes the line as `/C "<line>"` (codex-rs/hooks/src/engine/command_runner.rs,
 * `command.raw_arg(format!(r#""{command_line}""#))`), and cmd.exe takes the outer quotes off.
 */
function codexHook(hook: Hook, words: string[], paths: ReturnType<typeof commandPaths>, platform: Platform): Hook {
  return { ...hook, command: [platform === 'win32' ? '"' + paths.cmd + '"' : shQuoted(paths.sh), ...words].join(' ') };
}

/** A hooks file (`{ hooks: { <event>: [{ hooks: [...] }] } }`) with each hook that runs `atlas` rewritten. */
export function rewriteHooks(file: unknown, rewrite: (hook: Hook, words: string[]) => Hook): unknown {
  const events = (file as { hooks?: unknown } | null)?.hooks;
  if (!events || typeof events !== 'object') return file;
  const groups = (list: unknown) => Array.isArray(list) ? list.map((group: { hooks?: unknown }) => !group || !Array.isArray(group.hooks) ? group : {
    ...group, hooks: group.hooks.map((hook: Hook) => {
      const words = hook?.type === 'command' && hook.args === undefined ? atlasWords(hook.command) : null;
      return words ? rewrite(hook, words) : hook;
    }),
  }) : list;
  return { ...file as object, hooks: Object.fromEntries(Object.entries(events).map(([event, list]) => [event, groups(list)])) };
}

/** How an agent's MCP server runs `atlas <args>` from the agent folder. */
type McpForm = (args: string[]) => { command: string; args: string[] };
/** Claude Code's: the build's Node.js on the command on Windows, the launcher elsewhere. */
const claudeMcp = (paths: ReturnType<typeof commandPaths>, platform: Platform): McpForm => args => platform === 'win32' ? { command: paths.node, args: [paths.script, ...args] } : { command: paths.sh, args };
/** Codex's: the launcher, whose path stays the same from one update to the next. */
const codexMcp = (paths: ReturnType<typeof commandPaths>, platform: Platform): McpForm => args => ({ command: platform === 'win32' ? paths.cmd : paths.sh, args });

/** An MCP configuration (`{ mcpServers: { <name>: { command, args } } }`) with each server that runs `atlas` in the form given. */
export function rewriteMcp(file: unknown, form: McpForm): unknown {
  const servers = (file as { mcpServers?: unknown } | null)?.mcpServers;
  if (!servers || typeof servers !== 'object') return file;
  return {
    ...file as object,
    mcpServers: Object.fromEntries(Object.entries(servers).map(([name, server]: [string, Hook]) => {
      const args = Array.isArray(server?.args) && server.args.every(item => typeof item === 'string') ? server.args as string[] : null;
      if (server?.command !== 'atlas' || !args) return [name, server];
      return [name, { ...server, ...form(args) }];
    })),
  };
}

/** A path a manifest names (`./hooks/codex.json`), inside the plugin; null when it names none, or one outside. */
function named(plugin: string, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const file = path.resolve(plugin, value);
  const inside = path.relative(plugin, file);
  return inside && !inside.startsWith('..') && !path.isAbsolute(inside) ? file : null;
}
const readJson = (file: string): Record<string, unknown> | null => { try { return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { return null; } };

/**
 * Point the hooks and the MCP server of the plugin copied to `plugin` at the agent folder's command
 * (`folder`, build `build`). Claude Code's are the files its manifest names, else hooks/hooks.json
 * and .mcp.json; Codex's are the ones its manifest names. An MCP file both use stays Claude Code's,
 * and Codex's manifest names a copy of it in Codex's form, .codex-mcp.json.
 */
export async function pointPluginAtCommand(plugin: string, folder: string, build: string, platform: Platform = process.platform) {
  const paths = commandPaths(folder, build, platform);
  const codexManifest = path.join(plugin, '.codex-plugin', 'plugin.json');
  const claude = readJson(path.join(plugin, '.claude-plugin', 'plugin.json')) ?? {}, codex = readJson(codexManifest) ?? {};
  const codexHooks = named(plugin, codex.hooks);
  const hookFiles = new Map<string, 'claude' | 'codex'>();
  hookFiles.set(named(plugin, claude.hooks) ?? path.join(plugin, 'hooks', 'hooks.json'), 'claude');
  // A file both name is Codex's: its hooks keep one command from one update to the next.
  if (codexHooks) hookFiles.set(codexHooks, 'codex');
  const write = (file: string, value: unknown) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
  const read = (file: string) => existsSync(file) ? readJson(file) : null;
  for (const [file, agent] of hookFiles) {
    const hooks = read(file);
    if (hooks) await write(file, rewriteHooks(hooks, (hook, words) => (agent === 'claude' ? claudeHook : codexHook)(hook, words, paths, platform)));
  }
  const claudeFile = named(plugin, claude.mcpServers) ?? path.join(plugin, '.mcp.json');
  let codexFile = named(plugin, codex.mcpServers);
  const claudeServers = read(claudeFile), codexServers = codexFile ? read(codexFile) : null;
  if (codexFile === claudeFile && codexServers) {
    codexFile = path.join(plugin, '.codex-mcp.json');
    await write(codexManifest, { ...codex, mcpServers: './.codex-mcp.json' });
  }
  if (claudeServers) await write(claudeFile, rewriteMcp(claudeServers, claudeMcp(paths, platform)));
  if (codexFile && codexServers) await write(codexFile, rewriteMcp(codexServers, codexMcp(paths, platform)));
}
