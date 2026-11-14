// The program chosen for an agent the PATH does not have (Settings › Agents › Choose program…):
// chosen in the app's own file dialog, never named by a window, and run only once it answers
// `--version` as a program does. It is kept per agent in the agent folder's programs.json (not in the
// home database), used for the agent's status, connecting, disconnecting and refreshing in place of
// the PATH's, until it is cleared; the Windows uninstaller uses it too (build/remove-agent.ps1).
import { readFileSync, statSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { harness, lastLines, runHarness, type AgentId } from '@envsemble/coord/agents';

const file = (folder: string) => path.join(folder, 'programs.json');

/** The names an agent's program has: claude.exe, codex.exe or the npm shim codex.cmd on Windows, claude and codex elsewhere. */
export function programName(id: AgentId, platform: NodeJS.Platform = process.platform): RegExp {
  if (platform !== 'win32') return new RegExp(`^${harness(id).program}$`);
  return id === 'claude' ? /^claude\.exe$/i : /^codex\.(?:exe|cmd)$/i;
}
/** The open dialog's filter for an agent's program (Windows: by its extensions). */
export const programFilters = (id: AgentId, platform: NodeJS.Platform = process.platform) => platform === 'win32'
  ? [{ name: harness(id).name, extensions: id === 'claude' ? ['exe'] : ['exe', 'cmd'] }] : [];

const isFile = (program: string) => statSync(program, { throwIfNoEntry: false })?.isFile() === true;

/**
 * The programs chosen, each as it was checked when chosen: the agent's program by its name, at a
 * full path. An entry that is not (the file was edited) is left out, as if none was chosen.
 */
function readPrograms(folder: string): Partial<Record<AgentId, string>> {
  try {
    const saved = JSON.parse(readFileSync(file(folder), 'utf8')) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(saved).filter(([id, program]) => (id === 'claude' || id === 'codex') && typeof program === 'string'
      && path.isAbsolute(program) && programName(id).test(path.basename(program))));
  } catch { return {}; }
}

/** The program chosen for an agent, while it is there; null when none was, or it is gone. */
export function chosenProgram(folder: string, id: AgentId): string | null {
  const program = readPrograms(folder)[id];
  return program && isFile(program) ? program : null;
}
/** The program chosen for an agent, or null to forget it. */
export async function saveProgram(folder: string, id: AgentId, program: string | null) {
  const programs = readPrograms(folder);
  if (program) programs[id] = program; else delete programs[id];
  await mkdir(folder, { recursive: true });
  const temporary = file(folder) + '.' + process.pid + '.tmp';
  await writeFile(temporary, JSON.stringify(programs, null, 2) + '\n');
  await rename(temporary, file(folder));
}

/** Why a file cannot be the agent's program (another name, not a file, or no answer to --version); null when it can. */
export async function programProblem(id: AgentId, program: string, environment: NodeJS.ProcessEnv): Promise<string | null> {
  const { name } = harness(id);
  if (!path.isAbsolute(program) || !programName(id).test(path.basename(program))) return `${path.basename(program)} is not ${name}: choose its program, ${harness(id).program}${process.platform === 'win32' ? (id === 'claude' ? '.exe' : '.exe or codex.cmd') : ''}.`;
  if (!isFile(program)) return `${program} is not a file.`;
  const answer = await runHarness(program, ['--version'], environment, 20000);
  return answer.status === 0 ? null : `${program} --version failed: ${lastLines(answer.output) || 'exit ' + answer.status}`;
}
