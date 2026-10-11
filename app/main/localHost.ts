// Starts the Atlas host (main/hostProcess.ts) in a utility process, and restarts it if it stops
// unexpectedly: at most three times a minute, keeping its loopback port where it can. Connections
// read the current address and owner token on each attempt, so they reconnect on their own.
import { utilityProcess, type UtilityProcess } from 'electron';
import type { HostProcessMessage, HostStartMessage } from './hostProcess.ts';
import type { RotatingLog } from './log.ts';

export interface LocalHostOptions { entry: string; dataDirectory: string; version: string; log: RotatingLog; onRestart(): void }

export class LocalHost {
  private readonly options: LocalHostOptions;
  private child: UtilityProcess | null = null;
  private port = 0;
  private ownerToken = '';
  hostId = '';
  private starting: Promise<void> | null = null;
  private restarts: number[] = [];
  private stopping = false;

  constructor(options: LocalHostOptions) { this.options = options; }

  get origin() { return 'http://127.0.0.1:' + this.port; }
  /** The owner token, once the host is up; the connection reads it on every attempt. */
  async token() {
    await (this.starting ?? this.start());
    return this.ownerToken;
  }

  start(): Promise<void> {
    if (this.starting) return this.starting;
    const { log } = this.options;
    this.starting = new Promise<void>((resolve, reject) => {
      const child = utilityProcess.fork(this.options.entry, [], { serviceName: 'Atlas host', stdio: 'ignore' });
      this.child = child;
      const timer = setTimeout(() => { reject(new Error('The Atlas host did not start within 30 seconds.')); child.kill(); }, 30000);
      child.on('message', (message: HostProcessMessage) => {
        if (message.type === 'ready') {
          clearTimeout(timer);
          this.port = message.port; this.ownerToken = message.ownerToken; this.hostId = message.hostId;
          log.info('Host ready', { port: message.port, pid: child.pid });
          resolve();
        } else if (message.type === 'failed') {
          clearTimeout(timer);
          reject(new Error('The Atlas host could not start: ' + message.message));
        }
      });
      child.on('exit', code => {
        clearTimeout(timer);
        if (this.child !== child) return;
        this.child = null;
        this.starting = null;
        if (this.stopping) return;
        log.error('Host stopped unexpectedly', { code });
        reject(new Error('The Atlas host stopped while starting.'));
        const now = Date.now();
        this.restarts = [...this.restarts.filter(time => now - time < 60000), now];
        if (this.restarts.length > 3) { log.error('Host keeps stopping; not restarting it'); return; }
        setTimeout(() => { void this.start().then(() => this.options.onRestart(), error => log.error('Host restart failed', error)); }, 500 * this.restarts.length);
      });
      const start: HostStartMessage = { type: 'start', dataDirectory: this.options.dataDirectory, version: this.options.version, loopbackPort: this.port };
      child.postMessage(start);
    });
    return this.starting;
  }

  /** Ask the host to stop (it releases its folders and the remote access lock), then end it. */
  async stop() {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.postMessage({ type: 'stop' });
    const timer = setTimeout(() => child.kill(), 3000);
    await exited;
    clearTimeout(timer);
  }
}
