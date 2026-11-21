// Coord's updates: the installed app checks its release channel on GitHub Releases (electron-updater,
// envsemble/coord), says when a newer build is out, downloads it when asked and restarts into it when
// asked. Nothing downloads or installs on its own. The channel is stable (the latest release) or
// nightly (a build of dev every six hours); a build starts on its own kind, and the choice is kept in the
// home database. Moving from nightly to stable never goes back to an older build: the install waits
// for a stable release newer than itself.
import { isNightlyVersion, type UpdateChanges, type UpdateChannel, type UpdateState, type UpdateStatus } from '../shared/contract.ts';

/** What Coord uses of electron-updater's AppUpdater, so the logic can be tested without Electron. */
export interface UpdaterEngine {
  channel: string | null;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<{ isUpdateAvailable?: boolean; updateInfo: { version: string } } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

interface Log { info(message: string, detail?: unknown): void; warn(message: string, detail?: unknown): void }

export interface UpdatesOptions {
  /** The running build's version. */
  version: string;
  /** The updater, or why updates are off for this run. */
  engine: UpdaterEngine | { off: string };
  /** The kept channel choice: read, and written when it changes (null: the build's own kind). */
  setting: { get(): string | null; set(value: string | null): void };
  log: Log;
  /** Every change of the state, for the windows. */
  onChange(state: UpdateState): void;
  /** What a newer build changes since this one (main/updateChanges.ts); without it, an update shows none. */
  changes?(from: string, to: string): Promise<UpdateChanges>;
  /** When the first check runs after start, and how often after that (milliseconds). */
  firstCheck?: number;
  interval?: number;
}

/** A nightly build's version carries its prerelease name: 0.9.1-nightly.20261115.42. */
export const buildChannel = (version: string): UpdateChannel => isNightlyVersion(version) ? 'nightly' : 'stable';

/** electron-updater's error as one line fit to show (its messages can carry a whole feed). */
function shortMessage(error: unknown) {
  const line = String((error as Error)?.message ?? error).split('\n')[0]!.trim();
  return line.length > 300 ? line.slice(0, 297) + '…' : line || 'The update failed.';
}

export class Updates {
  private readonly options: UpdatesOptions;
  private readonly engine: UpdaterEngine | null;
  private channel: UpdateChannel;
  private status: UpdateStatus;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The changes of the last build offered, and the build and stage of the update they were last asked for. */
  private changes: UpdateChanges | null = null;
  private changesAsked: string | null = null;

  constructor(options: UpdatesOptions) {
    this.options = options;
    const kept = options.setting.get();
    this.channel = kept === 'stable' || kept === 'nightly' ? kept : buildChannel(options.version);
    // The updater is an EventEmitter, whose off() method makes `'off' in` true: only a reason is a string.
    const off = (options.engine as { off?: unknown }).off;
    if (typeof off === 'string') {
      this.engine = null;
      this.status = { kind: 'off', reason: off };
      return;
    }
    const engine = options.engine as UpdaterEngine;
    this.engine = engine;
    // Only on request: a click downloads, another restarts into it.
    engine.autoDownload = false;
    engine.autoInstallOnAppQuit = false;
    engine.on('download-progress', progress => {
      if (this.status.kind === 'downloading') this.set({ ...this.status, percent: Math.max(0, Math.min(100, Math.round(progress.percent))) });
    });
    // An EventEmitter without an error listener throws; the failures reach the calls that started them.
    engine.on('error', error => options.log.warn('Updater error', { message: shortMessage(error) }));
    this.apply();
    this.status = { kind: 'idle', checkedAt: null };
  }

  state(): UpdateState {
    // Changes belong to the build on offer, downloading or downloaded, and to no other.
    const offered = 'version' in this.status ? this.status.version : null;
    return { version: this.options.version, channel: this.channel, status: this.status, changes: this.changes?.version === offered ? this.changes : null };
  }

  /** Check soon after start, then every few hours while Coord runs. */
  start() {
    if (!this.engine) return;
    const interval = this.options.interval ?? 4 * 60 * 60 * 1000;
    // Quitting Coord stops the timer.
    const next = (delay: number) => {
      this.timer = setTimeout(() => { void this.check().finally(() => next(interval)); }, delay);
    };
    next(this.options.firstCheck ?? 15_000);
  }

  /** Look for a newer build on the channel; a found one is offered, not downloaded. */
  async check(): Promise<UpdateState> {
    const engine = this.engine;
    // An offer stands until it is taken; a download under way or done is not checked over.
    if (!engine || ['checking', 'available', 'downloading', 'ready'].includes(this.status.kind)) return this.state();
    const channel = this.channel;
    this.set({ kind: 'checking' });
    try {
      const result = await engine.checkForUpdates();
      // The channel changed while this check ran: its answer is the other channel's.
      if (this.channel !== channel) { this.status = { kind: 'idle', checkedAt: null }; return this.check(); }
      const version = result?.updateInfo.version;
      this.set(result?.isUpdateAvailable && version ? { kind: 'available', version } : { kind: 'idle', checkedAt: new Date().toISOString() });
    } catch (error) {
      this.options.log.warn('Update check failed', { channel: this.channel, message: shortMessage(error) });
      this.set({ kind: 'failed', message: shortMessage(error) });
    }
    return this.state();
  }

  /** Download the build on offer. */
  async download(): Promise<UpdateState> {
    if (!this.engine || this.status.kind !== 'available') return this.state();
    const { version } = this.status;
    this.set({ kind: 'downloading', version, percent: 0 });
    try {
      await this.engine.downloadUpdate();
      this.options.log.info('Update downloaded', { version });
      this.set({ kind: 'ready', version });
    } catch (error) {
      this.options.log.warn('Update download failed', { version, message: shortMessage(error) });
      this.set({ kind: 'failed', message: shortMessage(error) });
    }
    return this.state();
  }

  /** Quit, install the downloaded build without its installer's pages, and start it again. */
  install() {
    if (!this.engine || this.status.kind !== 'ready') return;
    this.options.log.info('Installing the update', { version: this.status.version });
    this.engine.quitAndInstall(true, true);
  }

  /** Follow another channel from now on, and look on it at once. */
  async setChannel(channel: UpdateChannel): Promise<UpdateState> {
    if (channel === this.channel) return this.state();
    this.channel = channel;
    this.options.setting.set(channel === buildChannel(this.options.version) ? null : channel);
    this.options.log.info('Update channel changed', { channel });
    if (!this.engine) { this.options.onChange(this.state()); return this.state(); }
    this.apply();
    // What was offered or downloaded belongs to the other channel.
    if (this.status.kind !== 'checking' && this.status.kind !== 'downloading') this.status = { kind: 'idle', checkedAt: null };
    return this.check();
  }

  private apply() {
    const engine = this.engine!;
    // Setting the channel turns on downgrades in electron-updater, so it goes first: an install never
    // moves to an older build, whose code may not read the home this one wrote.
    engine.channel = this.channel === 'nightly' ? 'nightly' : 'latest';
    engine.allowPrerelease = this.channel === 'nightly';
    engine.allowDowngrade = false;
  }

  private set(status: UpdateStatus) {
    this.status = status;
    this.options.onChange(this.state());
    this.askForChanges();
  }

  /**
   * Ask what the build on offer changes, once for each stage of its update (offered, downloading,
   * downloaded): a failed answer is asked for again at the next stage, not at each step of a download.
   */
  private askForChanges() {
    const ask = this.options.changes;
    const to = 'version' in this.status ? this.status.version : null;
    // With nothing on offer, the next offer is asked about afresh, even when it is the same build.
    if (!to) { this.changesAsked = null; return; }
    const asked = `${to} ${this.status.kind}`;
    if (!ask || this.changes?.version === to || this.changesAsked === asked) return;
    this.changesAsked = asked;
    ask(this.options.version, to).then(changes => {
      // An answer for a build no longer on offer is dropped.
      if (!('version' in this.status) || this.status.version !== to) return;
      this.changes = changes;
      this.options.onChange(this.state());
    }, error => {
      this.options.log.warn('Could not read what the update changes', { version: to, message: shortMessage(error) });
    });
  }
}
