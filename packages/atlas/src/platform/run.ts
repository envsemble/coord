// Runs a program (Git, for example) and collects its output once the program exits. The output
// goes through temporary files, not pipes: on Windows, a program started at the same moment from
// another thread (esbuild's long-lived service, for example) can inherit a pipe's handle and hold
// it open after this program has ended, and execFile would wait for that other program to end too.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isMainThread } from 'node:worker_threads';

export interface RunOptions {
  /** Milliseconds before the program is stopped (default one minute). */
  timeout?: number;
  /** The most output accepted, in bytes (default 1 MiB). */
  maxBuffer?: number;
  cwd?: string;
  /** Where the output files go (the temporary folder by default). */
  outputDirectory?: string;
  /** Accepted for execFile compatibility; programs always run without a window. */
  windowsHide?: boolean;
  /** What the program reads as its input, through a temporary file like its output; none by default. */
  input?: string;
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

/** Output file names carry the process ID, so the main thread can remove what its workers left. */
const prefix = `atlas-run-${process.pid}-`;
/** Output files of this thread's runs in progress, removed if the process exits before they finish. */
const inProgress = new Set<string>();
let cleanupRegistered = false;
function registerCleanup() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.once('exit', () => {
    for (const file of inProgress) rmSync(file, { force: true });
    // A worker stopped mid-run cannot clean up after itself: the main thread removes its files too.
    if (isMainThread) {
      try { for (const name of readdirSync(tmpdir())) if (name.startsWith(prefix)) rmSync(path.join(tmpdir(), name), { force: true }); } catch { /* Best effort. */ }
    }
  });
}
// The main thread cleans up at exit even if only its workers ran programs.
if (isMainThread) registerCleanup();
function track(files: string[]) {
  registerCleanup();
  for (const file of files) inProgress.add(file);
}

/** Run a program, resolving with its output when it exits successfully; rejects like execFile otherwise. */
export async function runProgram(file: string, args: string[], options: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await runProgramBytes(file, args, options);
  return { stdout: stdout.toString('utf8'), stderr };
}

/** Run a program as runProgram does, with its output as bytes. */
export async function runProgramBytes(file: string, args: string[], options: RunOptions = {}): Promise<{ stdout: Buffer; stderr: string }> {
  const { timeout = 60000, maxBuffer = 1024 * 1024 } = options;
  // Output files go straight into the temporary folder under random names, readable only by this
  // user, and are removed after each run (or when the process exits during one).
  const base = path.join(options.outputDirectory ?? tmpdir(), prefix + randomBytes(12).toString('hex'));
  const outFile = base + '.out', errFile = base + '.err', inFile = base + '.in';
  const files = options.input === undefined ? [outFile, errFile] : [outFile, errFile, inFile];
  const out = await open(outFile, 'wx', 0o600);
  const err = await open(errFile, 'wx', 0o600).catch(async error => {
    await out.close();
    await rm(outFile, { force: true }).catch(() => undefined);
    throw error;
  });
  track(files);
  let input: Awaited<ReturnType<typeof open>> | null = null;
  try {
    if (options.input !== undefined) {
      await writeFile(inFile, options.input, { flag: 'wx', mode: 0o600 });
      input = await open(inFile, 'r');
    }
    let overflow = false;
    const ended = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; killed: boolean }>((resolve, reject) => {
      let killed = false;
      const child = spawn(file, args, { cwd: options.cwd, stdio: [input ? input.fd : 'ignore', out.fd, err.fd], windowsHide: true });
      const timer = setTimeout(() => { killed = true; child.kill(); }, timeout);
      // Stop a program whose output outgrows the limit, as execFile does, rather than filling the disk.
      const watch = setInterval(() => { void out.stat().then(info => { if (info.size > maxBuffer && !overflow) { overflow = true; child.kill(); } }, () => undefined); }, 250);
      const done = () => { clearTimeout(timer); clearInterval(watch); };
      child.once('error', error => { done(); reject(error); });
      child.once('exit', (code, signal) => { done(); resolve({ code, signal, killed }); });
    });
    await Promise.all([out.close(), err.close(), input?.close()]);
    const size = (await stat(outFile)).size;
    const stderr = (await readFile(errFile, 'utf8')).slice(0, 64 * 1024);
    if (overflow || size > maxBuffer) throw new ProgramError(`${file} wrote more than ${maxBuffer} bytes.`, { ...ended, stdout: '', stderr });
    const stdout = await readFile(outFile);
    if (ended.code !== 0 || ended.killed) {
      const reason = ended.killed ? `timed out after ${timeout} ms` : ended.signal ? `ended by ${ended.signal}` : `exited with ${ended.code}`;
      throw new ProgramError(`Command failed: ${file} ${args.join(' ')} (${reason})\n${stderr}`, { ...ended, stdout: stdout.toString('utf8'), stderr });
    }
    return { stdout, stderr };
  } finally {
    await Promise.all([out.close().catch(() => undefined), err.close().catch(() => undefined), input?.close().catch(() => undefined)]);
    await Promise.all(files.map(name => rm(name, { force: true, maxRetries: 3 }).catch(() => undefined)));
    for (const name of files) inProgress.delete(name);
  }
}
