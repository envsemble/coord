// Puts the agent folder's bin/ on the PATH, so that `atlas` runs in new terminals, and repairs the
// app's own PATH at start, so that it finds the agents as a terminal would. On Windows it goes into the user's Path (HKCU\Environment), read and written
// whole with its own value type through PowerShell (setx cuts a value at 1024 characters, and
// .NET's SetEnvironmentVariable would store a REG_EXPAND_SZ Path as REG_SZ, leaving %USERPROFILE%
// unexpanded); the uninstaller takes it off again (build/remove-agent.ps1). On Linux it is a link in
// ~/.local/bin, which most distributions put on the PATH at login.
import { lstat, mkdir, readlink, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { runProgram } from '@envsemble/atlas/platform/run';

/** A PATH entry as Windows compares it: variables expanded, any case, either slash, no trailing one. */
function entryKey(entry: string, environment: NodeJS.ProcessEnv) {
  const variables = new Map(Object.entries(environment).map(([name, value]) => [name.toLowerCase(), value]));
  const expanded = entry.trim().replace(/%([^%;]+)%/g, (whole, name: string) => variables.get(name.toLowerCase()) ?? whole);
  return expanded.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/** The user Path with `entry` added at its end, keeping every other entry as written; null when it is there already. */
export function withPathEntry(current: string | null, entry: string, environment: NodeJS.ProcessEnv = process.env): string | null {
  const entries = (current ?? '').split(';');
  if (entries.some(item => item.trim() && entryKey(item, environment) === entryKey(entry, environment))) return null;
  const kept = (current ?? '').replace(/;+$/, '');
  return kept ? kept + ';' + entry : entry;
}

/** The user Path without `entry`, keeping every other entry as written; null when it is not there. */
export function withoutPathEntry(current: string | null, entry: string, environment: NodeJS.ProcessEnv = process.env): string | null {
  if (current === null) return null;
  const entries = current.split(';');
  const kept = entries.filter(item => !item.trim() || entryKey(item, environment) !== entryKey(entry, environment));
  return kept.length === entries.length ? null : kept.join(';');
}

const powershell = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
/** Run a PowerShell script, passed encoded so nothing in it is quoted for the command line; its values come in the environment. */
async function runPowerShell(script: string, values: Record<string, string> = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await runProgram(powershell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { env: { ...process.env, ...values }, timeout: 60000 });
  return stdout;
}
const readScript = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
$value = $null; $kind = $null
if ($key) { $value = $key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames'); if ($null -ne $value) { $kind = $key.GetValueKind('Path').ToString() } }
ConvertTo-Json -Compress @{ value = $value; kind = $kind }`;
// Only when the Path is still what was read (else the next launch tries again), then tells running
// programs, Explorer above all, that the environment changed, so new terminals see it.
const writeScript = `$ErrorActionPreference = 'Stop'
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
if ("$($key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames'))" -cne "$env:ATLAS_PATH_BEFORE") { exit 3 }
$key.SetValue('Path', $env:ATLAS_PATH_VALUE, [Microsoft.Win32.RegistryValueKind]$env:ATLAS_PATH_KIND)
$key.Close()
try {
  Add-Type -Namespace Atlas -Name Native -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);'
  $result = [UIntPtr]::Zero
  [void][Atlas.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
} catch { }`;

/** Windows: add `folder` to the user's Path, unless it is there; whether it was added. */
export async function addToUserPath(folder: string): Promise<boolean> {
  const read = JSON.parse(await runPowerShell(readScript)) as { value: string | null; kind: string | null };
  const next = withPathEntry(read.value, folder);
  if (next === null) return false;
  // A Path of another type (REG_SZ) keeps it, unless the new entry needs expanding.
  const kind = read.kind === 'String' && !next.includes('%') ? 'String' : 'ExpandString';
  await runPowerShell(writeScript, { ATLAS_PATH_BEFORE: read.value ?? '', ATLAS_PATH_VALUE: next, ATLAS_PATH_KIND: kind });
  return true;
}

/** Fresh PATH entries of the machine and the user, for programs installed since the app started (Windows). */
export async function registryPath(): Promise<string[]> {
  const script = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
ConvertTo-Json -Compress @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'))`;
  const values = JSON.parse(await runPowerShell(script)) as (string | null)[];
  return values.flatMap(value => (value ?? '').split(';')).filter(entry => entry.trim());
}

/** The PATH variable's name in an environment: on Windows whatever its case (Explorer starts programs with `path`). */
export function pathKey(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform) {
  if (platform !== 'win32') return 'PATH';
  return Object.keys(environment).find(name => name.toUpperCase() === 'PATH') ?? 'Path';
}

/** A PATH with the entries of `more` it lacks added at its end, compared as the system compares them. */
export function mergedPath(current: string, more: string[], platform: NodeJS.Platform = process.platform) {
  const delimiter = platform === 'win32' ? ';' : ':';
  const key = (entry: string) => platform === 'win32' ? entry.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase() : entry.replace(/(?<=.)\/+$/, '');
  const entries = current.split(delimiter).filter(Boolean);
  const known = new Set(entries.map(key));
  for (const entry of more) {
    if (!entry.trim() || known.has(key(entry))) continue;
    known.add(key(entry));
    entries.push(entry);
  }
  return entries.join(delimiter);
}

/**
 * The PATH a login shell sets (macOS and Linux), where an app started from the desktop may have a
 * shorter one: the user's shell, interactive, so that what its startup files add (nvm, say) is there
 * too. Between markers, so that whatever the startup files print is left out.
 */
async function loginShellPath(environment: NodeJS.ProcessEnv): Promise<string[]> {
  const shell = environment.SHELL && path.isAbsolute(environment.SHELL) ? environment.SHELL : '/bin/sh';
  const { stdout } = await runProgram(shell, ['-ilc', 'printf "\\n__ATLAS_PATH__%s__ATLAS_PATH__\\n" "$PATH"'], { env: environment, timeout: 5000 });
  return (/__ATLAS_PATH__(.*?)__ATLAS_PATH__/.exec(stdout)?.[1] ?? '').split(':').filter(Boolean);
}

/**
 * Repair this process's PATH at start, as the user's terminals have it, so the agents are found
 * however the app was started: on Windows the machine's and the user's Path from the registry
 * (Explorer's copy may predate an agent's install), elsewhere a login shell's PATH. The entries it
 * lacks are added at its end, in the variable whatever its case. Says how many were added.
 */
export async function repairPath(environment: NodeJS.ProcessEnv = process.env): Promise<number> {
  const more = process.platform === 'win32' ? await registryPath() : await loginShellPath(environment);
  const key = pathKey(environment);
  const before = environment[key] ?? '';
  const after = mergedPath(before, more);
  if (after !== before) environment[key] = after;
  const delimiter = process.platform === 'win32' ? ';' : ':';
  return after.split(delimiter).filter(Boolean).length - before.split(delimiter).filter(Boolean).length;
}

/**
 * Linux: link ~/.local/bin/atlas to the launcher, creating the folder. A file of that name that is
 * not this link is left alone. Says whether the link is there now ('linked' or 'present') or not ('taken').
 */
export async function linkCommand(launcher: string, user = homedir()): Promise<'linked' | 'present' | 'taken'> {
  const folder = path.join(user, '.local', 'bin'), link = path.join(folder, 'atlas');
  const existing = await lstat(link).catch(() => null);
  if (existing) return existing.isSymbolicLink() && path.resolve(folder, await readlink(link)) === launcher ? 'present' : 'taken';
  await mkdir(folder, { recursive: true });
  await symlink(launcher, link);
  return 'linked';
}
