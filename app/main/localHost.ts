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
  /** A restart waiting for its delay; connections wait for it rather than starting the host sooner. */
  private restarting: Promise<void> | null = null;
  /** The host stopped too often: it stays down until Atlas is started again. */
  private exhausted = false;
  private stopping = false;

  constructor(options: LocalHostOptions) { this.options = options; }

  get origin() { return 'http://127.0.0.1:' + this.port; }
  /** The owner token, once the host is up; the connection reads it on every attempt. */
  async token() {
    if (this.exhausted) throw new Error('The Atlas host keeps stopping, so Atlas stopped restarting it. Quit and start Atlas again; details are in the log (Open Logs, in the menu).');
    await (this.starting ?? this.restarting ?? this.start());
    if (!this.child) throw new Error('The Atlas host is not running.');
    return this.ownerToken;
  }

  start(): Promise<void> {
    if (this.starting) return this.starting;
    // Never start (or restart) a host while the app quits: it would hold the folders and the lock.
    if (this.stopping) return Promise.reject(new Error('Atlas is quitting.'));
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
          // End it, so it counts as a stop and is restarted within the budget.
          child.kill();
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
        if (this.restarts.length > 3) { this.exhausted = true; log.error('Host keeps stopping; not restarting it'); return; }
        this.restarting = new Promise<void>(settled => {
          setTimeout(() => {
            this.restarting = null;
            if (this.stopping) { settled(); return; }
            void this.start().then(() => this.options.onRestart(), error => log.error('Host restart failed', error)).finally(settled);
          }, 500 * this.restarts.length);
        });
      });
      const start: HostStartMessage = { type: 'start', home: this.options.dataDirectory, version: this.options.version, loopbackPort: this.port };
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
