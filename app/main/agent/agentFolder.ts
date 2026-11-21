// The coord command, the Node.js it runs on and the Coord plugin the app carries (resources/agent,
// assembled by scripts/agent-payload.cjs; one packed file on Windows, agentPack.ts), copied into the Coord home's agent/ folder whenever the
// build there is another. There they have a stable path: the agents read the plugin in place, and
// the launchers in bin/, on the PATH, run the command on its own Node.js. Nothing runs from or
// points into the app itself: an AppImage is mounted at a new path on every run, and an MCP server
// running from the install folder would hold it while the installer replaces or removes it.
//
//   agent/
//     .claude-plugin/, .agents/   the marketplace manifests, naming plugin/ (coord setup finds them too)
//     plugin/                     the plugin, replaced as a whole, its hooks and MCP server calling the
//                                 command by its full path (pluginCommands.ts)
//     command/<build>/            the @envsemble/coord package and its dependencies, one folder per build,
//                                 with the Node.js it runs on in runtime/
//     bin/coord, bin/coord.cmd    the launchers (coord.cmd on Windows only), with paths relative to themselves
//     state.json                  the build copied, whether bin/ was put on the PATH, and when each
//                                 agent was connected
//     programs.json               the program chosen for an agent not found on the PATH (agents.ts)
//     activity/                   when Coord last ran in each agent (@envsemble/coord/agents/activity)
//     onboarding.json             whether the onboarding was finished
//
// A hook or MCP server starting meanwhile never reads a half-copied tree: each folder is copied
// under a temporary name and renamed into place, the launchers then switch to the new command, and
// the command (and Node.js) a running MCP server still runs on is kept until the next update.
import { existsSync, readFileSync } from 'node:fs';
import { chmod, cp, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { AgentId } from '@envsemble/coord/agents';
import { pointPluginAtCommand } from './pluginCommands.ts';
import { packName, unpack } from './agentPack.ts';

/** What resources/agent/build.json says: the app's version, and the build (the version and a hash of the files). */
export interface Bundle { directory: string; version: string; build: string }
/** What the app knows of a connected agent: when it was connected (or found connected), as an ISO time. */
export interface AgentRecord { connectedAt: string }
export type AgentRecords = Partial<Record<AgentId, AgentRecord>>;
export interface FolderState { build: string; onPath: boolean; agents?: AgentRecords }

export function readBundle(directory: string): Bundle {
  const { version, build } = JSON.parse(readFileSync(path.join(directory, 'build.json'), 'utf8')) as { version: string; build: string };
  if (!/^[\w.+-]{1,80}$/.test(build)) throw new Error('resources/agent/build.json names no build');
  return { directory, version, build };
}

function readStateFile(folder: string): Partial<FolderState> | null {
  try { return JSON.parse(readFileSync(path.join(folder, 'state.json'), 'utf8')) as Partial<FolderState>; } catch { return null; }
}
export function readState(folder: string): FolderState | null {
  const state = readStateFile(folder);
  if (typeof state?.build !== 'string') return null;
  const agents = readAgentRecords(folder);
  return { build: state.build, onPath: state.onPath === true, ...Object.keys(agents).length ? { agents } : {} };
}
/** The connected agents' records (in development too, where the folder has no build). */
export function readAgentRecords(folder: string): AgentRecords {
  const agents = readStateFile(folder)?.agents;
  if (!agents || typeof agents !== 'object') return {};
  return Object.fromEntries(Object.entries(agents).filter(([id, record]) => (id === 'claude' || id === 'codex') && typeof record?.connectedAt === 'string'));
}
/** Record an agent as connected now, or (null) forget it, keeping the rest of the state. */
export async function recordAgent(folder: string, id: AgentId, record: AgentRecord | null) {
  const state = readStateFile(folder) ?? {};
  const agents = { ...readAgentRecords(folder) };
  if (record) agents[id] = record; else delete agents[id];
  await writeAtomically(path.join(folder, 'state.json'), JSON.stringify({ ...state, agents }, null, 2) + '\n');
}

/** The Node.js executable in a command's folder. */
const runtimeName = (platform: NodeJS.Platform) => platform === 'win32' ? 'node.exe' : 'node';

/**
 * The launchers that run the build's command on its Node.js, passing arguments, input, output and
 * exit status through. Their paths are relative to the launcher, so nothing in them depends on where
 * the home is: cmd.exe would read a path with letters such as "á" in the console's code page.
 */
export function launchers(build: string, platform: NodeJS.Platform = process.platform) {
  const command = `command/${build}`, node = `${command}/runtime/${runtimeName(platform)}`;
  // POSIX shells, and on Windows Git Bash (which Claude Code runs hooks in). The launcher is found
  // through its link in ~/.local/bin on Linux, so the link is followed to bin/ first.
  const sh = [
    '#!/bin/sh',
    '# The coord command, run on the Node.js the Coord app ships, from the agent folder. The app rewrites this file.',
    'agent=$(dirname "$(dirname "$(readlink -f "$0" 2>/dev/null || printf %s "$0")")")',
    `exec "$agent/${node}" "$agent/${command}/bin/coord.js" "$@"`,
    '',
  ].join('\n');
  if (platform !== 'win32') return [{ name: 'coord', text: sh, mode: 0o755 }];
  // cmd.exe reads a batch file a line at a time, so a launcher rewritten while it runs must hold
  // everything on the line it is running: `call exit /b` returns the command's status without
  // reading on. %~dp0 is the launcher's folder, with its trailing backslash.
  const windows = (value: string) => '"%~dp0..\\' + value.replace(/\//g, '\\') + '"';
  const cmd = [
    '@rem The coord command, run on the Node.js the Coord app ships, from the agent folder. The app rewrites this file.',
    `@${windows(node)} ${windows(command + '/bin/coord.js')} %* & call exit /b %%errorlevel%%`,
    '',
  ].join('\r\n');
  return [{ name: 'coord', text: sh, mode: 0o755 }, { name: 'coord.cmd', text: cmd, mode: 0o644 }];
}

/** Whether a command's folder has its command and its Node.js. */
const complete = (command: string, platform: NodeJS.Platform) => existsSync(path.join(command, 'bin', 'coord.js')) && existsSync(path.join(command, 'runtime', runtimeName(platform)));

/** Whether the folder needs this build copied in: another build, or one whose files are gone. */
export function needsCopy(state: FolderState | null, folder: string, build: string, platform: NodeJS.Platform = process.platform) {
  return state?.build !== build || !complete(path.join(folder, 'command', build), platform) || !existsSync(path.join(folder, 'plugin'));
}

const temporaryName = (prefix: string) => prefix + randomBytes(6).toString('hex');
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
/** Rename, waiting out Windows's brief locks (an indexer or a virus scanner reading a new file). */
async function moveInto(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; } catch (error) {
      if (attempt >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await pause(100 + attempt * 50);
    }
  }
}
async function writeAtomically(file: string, text: string | Buffer, mode = 0o644) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + process.pid + '.tmp';
  await writeFile(temporary, text, { mode });
  await moveInto(temporary, file);
  // A file renamed over another keeps the mode it was written with, where modes apply.
  if (process.platform !== 'win32') await chmod(file, mode);
}
/** The bundle's parts, put under `to` to be renamed into place: a packed bundle (the Windows app's) unpacked, a folder copied. */
async function stage(bundle: Bundle, to: string) {
  const packed = path.join(bundle.directory, packName);
  if (existsSync(packed)) { await unpack(packed, to); return; }
  for (const part of ['command', 'plugin', '.claude-plugin', '.agents']) await cp(path.join(bundle.directory, part), path.join(to, part), { recursive: true });
}
/** Remove what an earlier, interrupted copy left (best effort: a file still open on Windows stays until next time). */
async function sweep(folder: string, keep: (name: string) => boolean) {
  for (const name of await readdir(folder).catch(() => [] as string[])) {
    if (!keep(name)) await rm(path.join(folder, name), { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
  }
}

/**
 * Bring the agent folder to this build: copy the bundle in when its build is another (`copied`),
 * and write the launchers when they are not this build's. The state says whether bin/ is on the
 * PATH already (see userPath.ts).
 */
export async function installAgentFolder(bundle: Bundle, folder: string, platform: NodeJS.Platform = process.platform): Promise<{ copied: boolean; state: FolderState }> {
  const previous = readState(folder);
  const copied = needsCopy(previous, folder, bundle.build, platform);
  const command = path.join(folder, 'command', bundle.build);
  if (copied) {
    await mkdir(path.join(folder, 'command'), { recursive: true });
    await sweep(folder, name => !name.startsWith('.copy-') && !name.startsWith('.old-'));
    await sweep(path.join(folder, 'command'), name => !name.startsWith('.copy-'));
    // The bundle is staged beside the folders it goes to, under a temporary name, and each part renamed into place.
    const staged = path.join(folder, temporaryName('.copy-'));
    try {
      await stage(bundle, staged);
      // A complete folder of this build is already there when only the plugin was missing.
      if (!complete(command, platform)) {
        await rm(command, { recursive: true, force: true });
        await moveInto(path.join(staged, 'command'), command);
      }
      // The plugin's folder keeps its path (Claude Code reads it there): the new one replaces it whole.
      const plugin = path.join(folder, 'plugin'), old = path.join(folder, temporaryName('.old-'));
      const fresh = path.join(staged, 'plugin');
      await pointPluginAtCommand(fresh, folder, bundle.build, platform);
      // The old one stays until the new one is in place, and comes back when it cannot be.
      const replacing = existsSync(plugin);
      if (replacing) await moveInto(plugin, old);
      try { await moveInto(fresh, plugin); } catch (error) {
        if (replacing) await moveInto(old, plugin);
        throw error;
      }
      await rm(old, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
      for (const manifest of [path.join('.claude-plugin', 'marketplace.json'), path.join('.agents', 'plugins', 'marketplace.json')]) {
        await writeAtomically(path.join(folder, manifest), readFileSync(path.join(staged, manifest)));
      }
    } finally {
      await rm(staged, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
    }
  }
  const agents = readAgentRecords(folder);
  const state: FolderState = { build: bundle.build, onPath: previous?.onPath ?? false, ...Object.keys(agents).length ? { agents } : {} };
  for (const launcher of launchers(bundle.build, platform)) {
    const file = path.join(folder, 'bin', launcher.name);
    if (copied || (existsSync(file) ? readFileSync(file, 'utf8') : null) !== launcher.text) await writeAtomically(file, launcher.text, launcher.mode);
  }
  if (copied) await writeAtomically(path.join(folder, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  // The previous build's command and Node.js stay for an MCP server that started on them; older ones go.
  if (copied) await sweep(path.join(folder, 'command'), name => name === bundle.build || name === previous?.build);
  return { copied, state };
}

/** Record that bin/ is on the PATH, so it is not put there again (the person may take it off). */
export async function markOnPath(folder: string, state: FolderState) {
  await writeAtomically(path.join(folder, 'state.json'), JSON.stringify({ ...state, ...readStateFile(folder), onPath: true }, null, 2) + '\n');
}
