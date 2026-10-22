// The agents on this computer for the Settings page and the onboarding: Claude Code and Codex, each
// found or not, connected or not, through the agent's own commands (packages/atlas/src/agents, as
// `atlas setup`). At each launch the packaged app first brings the agent folder in the Atlas home up
// to date (agentFolder.ts), and on the user's own home puts its bin/ on the PATH the first time
// (userPath.ts) and after an update refreshes the agents connected to it. In development the app
// carries no agent folder: agents connect to this checkout, as `atlas setup` does, and the PATH is
// left alone.
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AgentError, agentStatus, connectAgent, disconnectAgent, harness, harnesses, onPath, refreshAgent, type AgentId } from '@envsemble/atlas/agents';
import type { AgentChange, AgentState, OnboardingState } from '../../shared/contract.ts';
import type { RotatingLog } from '../log.ts';
import { installAgentFolder, markOnPath, readBundle } from './agentFolder.ts';
import { addToUserPath, linkCommand, registryPath } from './userPath.ts';

export interface AgentsOptions {
  /** The Atlas home; the agent folder is its agent/. */
  home: string;
  /** What the app carries (resources/agent), or null in development. */
  bundle: string | null;
  /** The marketplace folder connecting uses without a bundle: the checkout. */
  checkout: string;
  /** What the launchers run: the app's executable, or the AppImage. */
  executable: string;
  /**
   * Whether this is the installed app on the user's own home. Only then does it put the command on
   * the PATH and refresh the connected agents after an update: a home chosen with ATLAS_HOME (tests,
   * a separate instance) leaves the user's `atlas` and agents alone.
   */
  ownHome: boolean;
  log: RotatingLog;
}

export class Agents {
  readonly folder: string;
  private ready: Promise<void> = Promise.resolve();
  /** Each agent's commands run one after another, so two windows never change one agent at once. */
  private queues = new Map<AgentId, Promise<unknown>>();
  private readonly options: AgentsOptions;

  constructor(options: AgentsOptions) {
    this.options = options;
    this.folder = path.join(options.home, 'agent');
  }

  /** The marketplace folder agents are connected to. */
  get directory() { return this.options.bundle ? this.folder : this.options.checkout; }

  /** Bring the agent folder up to date; connecting waits for it. Failures are logged, never thrown. */
  start() {
    this.ready = this.prepare().catch(error => { this.options.log.error('The agent folder could not be prepared', error); });
    return this.ready;
  }

  private async prepare() {
    const { bundle: from, executable, ownHome, log } = this.options;
    if (!from) return;
    const bundle = readBundle(from);
    const started = performance.now();
    const { copied, state } = await installAgentFolder(bundle, this.folder, executable);
    if (copied) log.info('Agent folder updated', { build: bundle.build, folder: this.folder, ms: Math.round(performance.now() - started) });
    if (ownHome && !state.onPath) await this.putOnPath(state);
    if (!copied || !ownHome) return;
    // An update: the agents connected to this folder get the new plugin.
    await Promise.all(harnesses.map(item => this.serial(item.id, async () => {
      try {
        const done = await refreshAgent(item, this.folder, await this.environment(item.program));
        if (done) log.info('Agent refreshed after an update', { agent: item.id, command: done });
      } catch (error) { log.warn('An agent could not be refreshed after an update', { agent: item.id, error: (error as Error).message }); }
    })));
  }

  private async putOnPath(state: Awaited<ReturnType<typeof installAgentFolder>>['state']) {
    const bin = path.join(this.folder, 'bin');
    try {
      if (process.platform === 'win32') {
        if (await addToUserPath(bin)) this.options.log.info('The atlas command was put on the user Path', { folder: bin });
      } else if (process.platform === 'linux') {
        const linked = await linkCommand(path.join(bin, 'atlas'));
        if (linked === 'taken') {
          this.options.log.warn('~/.local/bin/atlas is another file: the atlas command was not linked there; the next launch tries again', { launcher: path.join(bin, 'atlas') });
          return;
        }
        this.options.log.info('The atlas command is linked in ~/.local/bin', { launcher: path.join(bin, 'atlas') });
      } else return;
      await markOnPath(this.folder, state);
    } catch (error) { this.options.log.warn('The atlas command could not be put on the PATH; the next launch tries again', { error: (error as Error).message }); }
  }

  private serial<T>(id: AgentId, task: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) ?? Promise.resolve()).then(task, task);
    this.queues.set(id, next.catch(() => undefined));
    return next;
  }

  /**
   * The environment the agents' commands run in. An agent installed since the app started is on
   * the user's PATH but not on this process's: on Windows the PATH is read again from the registry
   * when the program is not found.
   */
  private async environment(program: string): Promise<NodeJS.ProcessEnv> {
    const environment = { ...process.env };
    if (process.platform !== 'win32' || onPath(program, environment)) return environment;
    try {
      const key = Object.keys(environment).find(name => name.toLowerCase() === 'path') ?? 'Path';
      const current = (environment[key] ?? '').split(';').filter(Boolean);
      const known = new Set(current.map(entry => entry.toLowerCase()));
      const fresh = (await registryPath()).filter(entry => !known.has(entry.toLowerCase()));
      environment[key] = [...current, ...fresh].join(';');
    } catch (error) { this.options.log.warn('The PATH could not be read again', { error: (error as Error).message }); }
    return environment;
  }

  private async state(id: AgentId): Promise<AgentState> {
    const item = harness(id);
    try {
      // The marketplace's name, from what the app carries, so that the list does not wait for the copy.
      const { found, connected, version } = await agentStatus(item, this.options.bundle ?? this.options.checkout, await this.environment(item.program));
      return { id, found, connected, version };
    } catch (error) {
      this.options.log.warn('An agent\'s state could not be read', { agent: id, error: (error as Error).message });
      return { id, found: onPath(item.program, process.env) !== null, connected: false, version: null };
    }
  }

  /** Claude Code and Codex, checked now (about a second: each lists its plugins). */
  list(): Promise<AgentState[]> {
    return Promise.all(harnesses.map(item => this.state(item.id)));
  }

  /** Grant the agent the Atlas home and install the plugin; the error says what failed, as the agent said it. */
  connect(id: AgentId): Promise<AgentChange> {
    return this.change(id, 'connect', async environment => {
      await this.ready;
      const { grantError } = await connectAgent(harness(id), this.directory, this.options.home, environment);
      return grantError;
    });
  }

  /** Uninstall the plugin and remove its marketplace from the agent. */
  disconnect(id: AgentId): Promise<AgentChange> {
    return this.change(id, 'disconnect', async environment => { await disconnectAgent(harness(id), this.directory, environment); return null; });
  }

  private change(id: AgentId, action: string, run: (environment: NodeJS.ProcessEnv) => Promise<string | null>): Promise<AgentChange> {
    return this.serial(id, async () => {
      let error: string | null;
      try { error = await run(await this.environment(harness(id).program)); } catch (failure) {
        if (!(failure instanceof AgentError)) this.options.log.error(`Agent ${action} failed`, failure);
        error = (failure as Error).message;
      }
      if (error) this.options.log.warn(`Agent ${action}: ${error}`, { agent: id });
      else this.options.log.info(`Agent ${action}ed`, { agent: id, directory: this.directory });
      return { agent: await this.state(id), error };
    });
  }

  private get onboardingFile() { return path.join(this.folder, 'onboarding.json'); }

  /** The onboarding shows until it is finished or skipped (the uninstaller resets it with the agent folder's state). */
  onboarding(): OnboardingState {
    try { return { done: (JSON.parse(readFileSync(this.onboardingFile, 'utf8')) as { done?: unknown }).done === true }; } catch { return { done: false }; }
  }

  async finishOnboarding() {
    await mkdir(this.folder, { recursive: true });
    const temporary = this.onboardingFile + '.' + process.pid + '.tmp';
    await writeFile(temporary, JSON.stringify({ done: true }) + '\n');
    await rename(temporary, this.onboardingFile);
  }
}
