// Runs a program (Git, for example) and collects its output once the program exits. The output
// goes through temporary files, not pipes: on Windows, a program started at the same moment from
// another thread (esbuild's long-lived service, for example) can inherit a pipe's handle and hold
// it open after this program has ended, and execFile would wait for that other program to end too.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { open, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface RunOptions {
  /** Milliseconds before the program is stopped (default one minute). */
  timeout?: number;
  /** The most output accepted, in bytes (default 1 MiB). */
  maxBuffer?: number;
  cwd?: string;
  /** Accepted for execFile compatibility; programs always run without a window. */
  windowsHide?: boolean;
}

export class ProgramError extends Error {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly killed: boolean;
  readonly stdout: string;
  readonly stderr: string;
  constructor(message: string, details: { code: number | null; signal: NodeJS.Signals | null; killed: boolean; stdout: string; stderr: string }) {
    super(message);
    this.name = 'ProgramError';
    this.code = details.code; this.signal = details.signal; this.killed = details.killed; this.stdout = details.stdout; this.stderr = details.stderr;
  }
}

let directory: string | null = null;
let sequence = 0;
/** One folder per process for output files; each run removes its own files. */
function outputFolder() {
  directory ??= mkdtempSync(path.join(tmpdir(), 'atlas-run-'));
  return directory;
}

/** Run a program, resolving with its output when it exits successfully; rejects like execFile otherwise. */
export async function runProgram(file: string, args: string[], options: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const { timeout = 60000, maxBuffer = 1024 * 1024 } = options;
  const base = path.join(outputFolder(), `${process.pid}-${++sequence}`);
  const outFile = base + '.out', errFile = base + '.err';
  const out = await open(outFile, 'w');
  const err = await open(errFile, 'w').catch(async error => { await out.close(); throw error; });
  try {
    const ended = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; killed: boolean }>((resolve, reject) => {
      let killed = false;
      const child = spawn(file, args, { cwd: options.cwd, stdio: ['ignore', out.fd, err.fd], windowsHide: true });
      const timer = setTimeout(() => { killed = true; child.kill(); }, timeout);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, killed }); });
    });
    await Promise.all([out.close(), err.close()]);
    const size = (await stat(outFile)).size;
    const stderr = (await readFile(errFile, 'utf8')).slice(0, 64 * 1024);
    if (size > maxBuffer) throw new ProgramError(`${file} wrote more than ${maxBuffer} bytes.`, { ...ended, stdout: '', stderr });
    const stdout = await readFile(outFile, 'utf8');
    if (ended.code !== 0 || ended.killed) {
      const reason = ended.killed ? `timed out after ${timeout} ms` : ended.signal ? `ended by ${ended.signal}` : `exited with ${ended.code}`;
      throw new ProgramError(`Command failed: ${file} ${args.join(' ')} (${reason})\n${stderr}`, { ...ended, stdout, stderr });
    }
    return { stdout, stderr };
  } finally {
    await Promise.all([out.close().catch(() => undefined), err.close().catch(() => undefined)]);
    await Promise.all([outFile, errFile].map(name => rm(name, { force: true, maxRetries: 3 }).catch(() => undefined)));
  }
}
