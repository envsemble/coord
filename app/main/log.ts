// A small rotating log in the Coord data folder (<data>/logs/coord.log, then coord.1.log …; the host
// writes host.log beside it).
// It records lifecycle events and failures for diagnosis; nothing leaves the machine.
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

export type Level = 'info' | 'warn' | 'error';

export class RotatingLog {
  readonly directory: string;
  readonly file: string;
  private readonly maxBytes: number;
  private readonly keep: number;
  private size = -1;

  private readonly name: string;

  /** `name` is the file's base name: coord.log for the app, host.log for its host. */
  constructor(directory: string, { maxBytes = 1024 * 1024, keep = 3, name = 'coord' } = {}) {
    this.directory = directory;
    this.name = name;
    this.file = path.join(directory, name + '.log');
    this.maxBytes = maxBytes;
    this.keep = keep;
  }

  write(level: Level, message: string, detail?: unknown) {
    const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...(detail === undefined ? {} : { detail: describe(detail) }) }) + '\n';
    try {
      if (this.size < 0) {
        mkdirSync(this.directory, { recursive: true });
        try { this.size = statSync(this.file).size; } catch { this.size = 0; }
      }
      if (this.size + line.length > this.maxBytes) this.rotate();
      appendFileSync(this.file, line);
      this.size += Buffer.byteLength(line);
    } catch { /* Logging never stops the app. */ }
    if (process.env.COORD_LOG_STDOUT === '1') process.stdout.write(line);
  }
  info(message: string, detail?: unknown) { this.write('info', message, detail); }
  warn(message: string, detail?: unknown) { this.write('warn', message, detail); }
  error(message: string, detail?: unknown) { this.write('error', message, detail); }

  private rotate() {
    const name = (index: number) => path.join(this.directory, index === 0 ? this.name + '.log' : `${this.name}.${index}.log`);
    rmSync(name(this.keep), { force: true });
    for (let index = this.keep - 1; index >= 0; index--) {
      try { renameSync(name(index), name(index + 1)); } catch { /* Missing generations are fine. */ }
    }
    this.size = 0;
  }
}

function describe(detail: unknown): unknown {
  if (detail instanceof Error) return { name: detail.name, message: detail.message, stack: detail.stack?.split('\n').slice(0, 8).join('\n') };
  return detail;
}
