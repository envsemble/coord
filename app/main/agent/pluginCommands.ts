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
// - Both start the MCP server as a program with its arguments, without a shell: the build's Node.js
//   on the command on Windows (an .exe, which every runtime starts), bin/atlas elsewhere.
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
/** A Codex hook that runs `atlas`, as it runs from the agent folder: cmd.exe reads a path in double quotes as it is. */
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

/** An MCP configuration (`{ mcpServers: { <name>: { command, args } } }`) with each server that runs `atlas` started from the agent folder. */
export function rewriteMcp(file: unknown, paths: ReturnType<typeof commandPaths>, platform: Platform): unknown {
  const servers = (file as { mcpServers?: unknown } | null)?.mcpServers;
  if (!servers || typeof servers !== 'object') return file;
  return {
    ...file as object,
    mcpServers: Object.fromEntries(Object.entries(servers).map(([name, server]: [string, Hook]) => {
      const args = Array.isArray(server?.args) && server.args.every(item => typeof item === 'string') ? server.args as string[] : null;
      if (server?.command !== 'atlas' || !args) return [name, server];
      return [name, platform === 'win32' ? { ...server, command: paths.node, args: [paths.script, ...args] } : { ...server, command: paths.sh, args }];
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
 * and .mcp.json; Codex's are the ones its manifest names.
 */
export async function pointPluginAtCommand(plugin: string, folder: string, build: string, platform: Platform = process.platform) {
  const paths = commandPaths(folder, build, platform);
  const claude = readJson(path.join(plugin, '.claude-plugin', 'plugin.json')) ?? {}, codex = readJson(path.join(plugin, '.codex-plugin', 'plugin.json')) ?? {};
  const codexHooks = named(plugin, codex.hooks);
  const hookFiles = new Map<string, 'claude' | 'codex'>();
  hookFiles.set(named(plugin, claude.hooks) ?? path.join(plugin, 'hooks', 'hooks.json'), 'claude');
  // A file both name is Codex's: its hooks keep one command from one update to the next.
  if (codexHooks) hookFiles.set(codexHooks, 'codex');
  const mcpFiles = new Set([named(plugin, claude.mcpServers) ?? path.join(plugin, '.mcp.json'), named(plugin, codex.mcpServers)].filter((file): file is string => file !== null));
  const write = (file: string, value: unknown) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
  for (const [file, agent] of hookFiles) {
    const read = existsSync(file) ? readJson(file) : null;
    if (read) await write(file, rewriteHooks(read, (hook, words) => (agent === 'claude' ? claudeHook : codexHook)(hook, words, paths, platform)));
  }
  for (const file of mcpFiles) {
    const read = existsSync(file) ? readJson(file) : null;
    if (read) await write(file, rewriteMcp(read, paths, platform));
  }
}
