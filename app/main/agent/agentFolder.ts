// The atlas command and the Atlas plugin the app carries (resources/agent, assembled by
// scripts/agent-payload.cjs), copied into the Atlas home's agent/ folder whenever the build there is
// another. There they have a stable path: the agents read the plugin in place, and the launchers in
// bin/, on the PATH, run the command on the app's own executable in Node mode, as VS Code's `code`
// does. Nothing may point into the app itself: an AppImage is mounted at a new path on every run.
//
//   agent/
//     .claude-plugin/, .agents/   the marketplace manifests, naming plugin/ (atlas setup finds them too)
//     plugin/                     the plugin, replaced as a whole
//     command/<build>/            the @envsemble/atlas package and its dependencies, one folder per build
//     bin/atlas, bin/atlas.cmd    the launchers (atlas.cmd on Windows only)
//     state.json                  the build copied, the executable the launchers run, and whether bin/ was put on the PATH
//
// A hook or MCP server starting meanwhile never reads a half-copied tree: each folder is copied
// under a temporary name and renamed into place, the launchers then switch to the new command, and
// the command a running MCP server still loads from is kept until the next update.
import { existsSync, readFileSync } from 'node:fs';
import { chmod, cp, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/** What resources/agent/build.json says: the app's version, and the build (the version and a hash of the files). */
export interface Bundle { directory: string; version: string; build: string }
export interface FolderState { build: string; executable: string; onPath: boolean }

export function readBundle(directory: string): Bundle {
  const { version, build } = JSON.parse(readFileSync(path.join(directory, 'build.json'), 'utf8')) as { version: string; build: string };
  if (!/^[\w.+-]{1,80}$/.test(build)) throw new Error('resources/agent/build.json names no build');
  return { directory, version, build };
}

export function readState(folder: string): FolderState | null {
  try {
    const state = JSON.parse(readFileSync(path.join(folder, 'state.json'), 'utf8')) as Partial<FolderState>;
    return typeof state.build === 'string' && typeof state.executable === 'string' ? { build: state.build, executable: state.executable, onPath: state.onPath === true } : null;
  } catch { return null; }
}

/** The launchers that run `script` with the app's `executable` in Node mode, passing arguments, input, output and exit status through. */
export function launchers(executable: string, script: string, platform: NodeJS.Platform = process.platform) {
  // POSIX shells, and on Windows Git Bash (which Claude Code runs hooks in), read forward slashes.
  const posix = (value: string) => "'" + (platform === 'win32' ? value.replace(/\\/g, '/') : value).replace(/'/g, "'\\''") + "'";
  const sh = [
    '#!/bin/sh',
    '# The atlas command, run on the Atlas app\'s own executable in Node mode. The app rewrites this file.',
    'export ELECTRON_RUN_AS_NODE=1',
    `exec ${posix(executable)} ${posix(script)} "$@"`,
    '',
  ].join('\n');
  if (platform !== 'win32') return [{ name: 'atlas', text: sh, mode: 0o755 }];
  // cmd.exe reads a batch file a line at a time, so a launcher rewritten while it runs must hold
  // everything on the line it is running: setlocal keeps the variable out of the caller's console,
  // and `call exit /b` returns the command's status without reading on.
  const batch = (value: string) => '"' + value.replace(/%/g, '%%') + '"';
  const cmd = [
    '@rem The atlas command, run on the Atlas app\'s own executable in Node mode. The app rewrites this file.',
    `@setlocal & set "ELECTRON_RUN_AS_NODE=1" & ${batch(executable)} ${batch(script)} %* & call exit /b %%errorlevel%%`,
    '',
  ].join('\r\n');
  return [{ name: 'atlas', text: sh, mode: 0o755 }, { name: 'atlas.cmd', text: cmd, mode: 0o644 }];
}

/** Whether the folder needs this build copied in: another build, or one whose files are gone. */
export function needsCopy(state: FolderState | null, folder: string, build: string) {
  return state?.build !== build || !existsSync(path.join(folder, 'command', build, 'bin', 'atlas.js')) || !existsSync(path.join(folder, 'plugin'));
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
/** Copy a folder in under a temporary name beside `to`, then rename it into place. */
async function placeFolder(from: string, to: string) {
  const temporary = path.join(path.dirname(to), temporaryName('.copy-'));
  await cp(from, temporary, { recursive: true });
  await moveInto(temporary, to);
}
/** Remove what an earlier, interrupted copy left (best effort: a file still open on Windows stays until next time). */
async function sweep(folder: string, keep: (name: string) => boolean) {
  for (const name of await readdir(folder).catch(() => [] as string[])) {
    if (!keep(name)) await rm(path.join(folder, name), { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
  }
}

/**
 * Bring the agent folder to this build and executable: copy the bundle in when its build is another
 * (`copied`), and rewrite the launchers when they would run another executable. The state says
 * whether bin/ is on the PATH already (see userPath.ts).
 */
export async function installAgentFolder(bundle: Bundle, folder: string, executable: string, platform: NodeJS.Platform = process.platform): Promise<{ copied: boolean; state: FolderState }> {
  const previous = readState(folder);
  const copied = needsCopy(previous, folder, bundle.build);
  const command = path.join(folder, 'command', bundle.build);
  if (copied) {
    await mkdir(path.join(folder, 'command'), { recursive: true });
    await sweep(folder, name => !name.startsWith('.copy-') && !name.startsWith('.old-'));
    await sweep(path.join(folder, 'command'), name => !name.startsWith('.copy-'));
    // A complete folder of this build is already there when only the plugin was missing.
    if (!existsSync(path.join(command, 'bin', 'atlas.js'))) {
      await rm(command, { recursive: true, force: true });
      await placeFolder(path.join(bundle.directory, 'command'), command);
    }
    // The plugin's folder keeps its path (Claude Code reads it there): the new one replaces it whole.
    const plugin = path.join(folder, 'plugin'), old = path.join(folder, temporaryName('.old-'));
    const fresh = path.join(folder, temporaryName('.copy-'));
    await cp(path.join(bundle.directory, 'plugin'), fresh, { recursive: true });
    // The old one stays until the new one is in place, and comes back when it cannot be.
    const replacing = existsSync(plugin);
    if (replacing) await moveInto(plugin, old);
    try { await moveInto(fresh, plugin); } catch (error) {
      if (replacing) await moveInto(old, plugin);
      throw error;
    }
    await rm(old, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
    for (const manifest of [path.join('.claude-plugin', 'marketplace.json'), path.join('.agents', 'plugins', 'marketplace.json')]) {
      await writeAtomically(path.join(folder, manifest), readFileSync(path.join(bundle.directory, manifest)));
    }
  }
  const state: FolderState = { build: bundle.build, executable, onPath: previous?.onPath ?? false };
  if (copied || previous?.executable !== executable) {
    for (const launcher of launchers(executable, path.join(command, 'bin', 'atlas.js'), platform)) await writeAtomically(path.join(folder, 'bin', launcher.name), launcher.text, launcher.mode);
    await writeAtomically(path.join(folder, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  }
  // The previous build's command stays for an MCP server that started on it; older ones go.
  if (copied) await sweep(path.join(folder, 'command'), name => name === bundle.build || name === previous?.build);
  return { copied, state };
}

/** Record that bin/ is on the PATH, so it is not put there again (the person may take it off). */
export async function markOnPath(folder: string, state: FolderState) {
  await writeAtomically(path.join(folder, 'state.json'), JSON.stringify({ ...state, onPath: true }, null, 2) + '\n');
}
