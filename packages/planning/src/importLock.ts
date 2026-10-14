// Lock files that processes take turns holding: the planning folder's import lock
// (imports into one folder take turns), and the hooks' lock on a session's links.
//
// A lock records who holds it. A holder known to be dead (same computer, same
// operating system instance, process gone) is taken over at once; a holder Atlas
// cannot judge (another system sharing the folder or the host name, such as WSL and
// Windows, or a damaged lock) only once the lock is older than its stale age.
// Takeover happens under a second exclusive file and deletes the lock only if it
// still has the bytes that were judged stale, so two waiters cannot both take it.
import { randomUUID } from 'node:crypto';
import { hostname, release } from 'node:os';
import path from 'node:path';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';

export const importLockName = '.atlas-import.lock';
/** An import lock whose holder cannot be judged is taken over only after this long. */
export const staleAfterMs = 10 * 60 * 1000;
/** A takeover guard is held for milliseconds; one this old was left by a crash. */
const guardStaleMs = 60 * 1000;
const processToken = randomUUID();

interface Holder { pid?: unknown; hostname?: unknown; platform?: unknown; release?: unknown; token?: unknown; createdAt?: unknown }

export class ImportLockBusyError extends Error {
  readonly lockFile: string;
  readonly holder: Holder | null;
  constructor(lockFile: string, holder: Holder | null) {
    const who = holder ? ` (process ${String(holder.pid)} on ${String(holder.hostname)} since ${String(holder.createdAt)})` : '';
    super(`Another import into this planning folder is in progress${who}. If none is running, delete ${lockFile} and try again.`);
    this.name = 'ImportLockBusyError';
    this.lockFile = lockFile;
    this.holder = holder;
  }
}

const busyCodes = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code ?? '';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return code(error) === 'EPERM'; }
}
/** Whether the lock's holder is certainly gone, or the lock is old enough to be abandoned. */
function stale(holder: Holder | null, ageMs: number, staleMs: number) {
  const here = holder && holder.hostname === hostname() && holder.platform === process.platform && holder.release === release();
  if (here && holder.token !== processToken && Number.isSafeInteger(holder.pid) && (holder.pid as number) > 0 && !alive(holder.pid as number)) return true;
  if (here && holder.token === processToken) return false;
  return ageMs >= staleMs;
}

async function readBytes(file: string) {
  try { return await readFile(file); } catch { return null; }
}

/** Delete the lock only if it still has `judged` bytes, under the takeover guard. False while another waiter holds the guard. */
async function takeOver(lockFile: string, judged: Buffer): Promise<boolean> {
  const guard = lockFile + '.takeover';
  try { await writeFile(guard, processToken, { flag: 'wx' }); }
  catch (error) {
    if (!busyCodes.has(code(error))) throw error;
    try { if (Date.now() - (await stat(guard)).mtimeMs > guardStaleMs) await rm(guard, { force: true }); } catch { /* Gone already. */ }
    return false;
  }
  try {
    const current = await readBytes(lockFile);
    if (current && current.equals(judged)) await rm(lockFile, { force: true });
  } finally { await rm(guard, { force: true, maxRetries: 5, retryDelay: 20 }); }
  return true;
}

/** Hold the import lock of `root` until the returned release function is called. */
export function acquireImportLock(root: string, waitMs: number): Promise<() => Promise<void>> {
  const lockFile = path.join(root, importLockName);
  return acquireFileLock(lockFile, { waitMs, staleAfterMs, busy: holder => new ImportLockBusyError(lockFile, holder) });
}

/**
 * Hold `lockFile` until the returned release function is called, waiting up to `waitMs` for its
 * holder (then throwing `busy`'s error) and taking it over from a dead holder at once, or from one
 * that cannot be judged once it is `staleAfterMs` old.
 */
export async function acquireFileLock(lockFile: string, options: { waitMs: number; staleAfterMs: number; busy?: (holder: Holder | null) => Error }): Promise<() => Promise<void>> {
  const deadline = Date.now() + options.waitMs;
  const content = JSON.stringify({ pid: process.pid, hostname: hostname(), platform: process.platform, release: release(), token: processToken, id: randomUUID(), createdAt: new Date().toISOString() });
  for (;;) {
    try {
      await writeFile(lockFile, content, { flag: 'wx' });
      return async () => {
        // Release only our own lock.
        const current = await readBytes(lockFile);
        if (current && current.toString('utf8') === content) await rm(lockFile, { force: true, maxRetries: 5, retryDelay: 20 });
      };
    } catch (error) {
      // Windows refuses to create a file that is being deleted; that is a busy lock too.
      if (!busyCodes.has(code(error))) throw error;
    }
    const bytes = await readBytes(lockFile);
    let holder: Holder | null = null;
    let ageMs = 0;
    if (bytes) {
      try { holder = JSON.parse(bytes.toString('utf8')); } catch { /* Being written, or damaged. */ }
      try { ageMs = Date.now() - (await stat(lockFile)).mtimeMs; } catch { /* Released meanwhile. */ }
      // Retry at once after a takeover, but never past the deadline or in a busy loop on a held guard.
      if (stale(holder, ageMs, options.staleAfterMs) && await takeOver(lockFile, bytes) && Date.now() < deadline) continue;
    }
    if (Date.now() >= deadline) throw options.busy?.(holder) ?? new Error(`${lockFile} stayed locked.`);
    await sleep(10 + Math.random() * 40);
  }
}
