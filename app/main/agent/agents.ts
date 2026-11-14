// The agents on this computer for the Settings page and the onboarding: Claude Code and Codex, each
// found or not, connected or not, through the agent's own commands (packages/atlas/src/agents, as
// `atlas setup`). An agent is found as a program, as a terminal finds it: the app repairs its PATH at
// start (userPath.ts), and an agent the PATH lacks can have its program chosen (programs.ts). At each
// launch the packaged app first brings the agent folder in the Atlas home up to date
// (agentFolder.ts), and on the user's own home puts its bin/ on the PATH the first time (userPath.ts)
// and after an update refreshes the agents connected to it. A connected agent is checked for whether
// it runs Atlas (verify.ts). In development the app carries no agent folder: agents connect to this
// checkout, as `atlas setup` does, and the user's PATH is left alone.
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AgentError, agentStatus, connectAgent, disconnectAgent, harness, harnesses, marketplaceName, onPath, refreshAgent, type AgentId } from '@envsemble/atlas/agents';
import { readActivity } from '@envsemble/atlas/agents/activity';
import { codexTrust } from '@envsemble/atlas/agents/trust';
import type { AgentChange, AgentCheck, AgentFolder, AgentState, OnboardingState } from '../../shared/contract.ts';
import type { RotatingLog } from '../log.ts';
import { installAgentFolder, markOnPath, readAgentRecords, readBundle, recordAgent, type AgentRecord } from './agentFolder.ts';
import { chosenProgram, programProblem, saveProgram } from './programs.ts';
import { addToUserPath, linkCommand, pathKey, registryPath, mergedPath, repairPath } from './userPath.ts';
import { agentCheck, later } from './verify.ts';

export interface AgentsOptions {
  /** The Atlas home; the agent folder is its agent/. */
  home: string;
  /** What the app carries (resources/agent), or null in development. */
  bundle: string | null;
  /** The marketplace folder connecting uses without a bundle: the checkout. */
  checkout: string;
  /**
   * Whether this is the installed app on the user's own home. Only then does it put the command on
   * the PATH and refresh the connected agents after an update: a home chosen with ATLAS_HOME (tests,
   * a separate instance) leaves the user's `atlas` and agents alone.
   */
  ownHome: boolean;
  /** When the last session of a harness (as the home database names it: claude-code, codex) recorded by the hooks was last seen. */
  lastSession(harness: string): string | null;
  log: RotatingLog;
}

/** The home database's name for each agent's sessions (hook.ts). */
const sessionHarness: Record<AgentId, string> = { claude: 'claude-code', codex: 'codex' };

export class Agents {
  readonly folder: string;
  private ready: Promise<void> = Promise.resolve();
  private pathRepaired: Promise<void> = Promise.resolve();
  /** Each agent's commands run one after another, so two windows never change one agent at once. */
  private queues = new Map<AgentId, Promise<unknown>>();
  private listing: Promise<AgentState[]> | null = null;
  /** The agents as last checked, for the windows that only read whether they run Atlas. */
  private last = new Map<AgentId, AgentState>();
  /** Writes of the agents' records, one after another and after the agent folder is ready. */
  private records: Promise<unknown> = Promise.resolve();
  private readonly options: AgentsOptions;

  constructor(options: AgentsOptions) {
    this.options = options;
    this.folder = path.join(options.home, 'agent');
  }

  /** The marketplace folder agents are connected to. */
  get directory() { return this.options.bundle ? this.folder : this.options.checkout; }
  /** Where the marketplace's name and the plugin's files are read, so that nothing waits for the copy. */
  private get source() { return this.options.bundle ?? this.options.checkout; }

  /**
   * Repair the PATH, then bring the agent folder up to date; listing waits for the first, connecting
   * and disconnecting for both. Failures are logged, never thrown.
   */
  start() {
    const { log } = this.options;
    this.pathRepaired = repairPath().then(added => { if (added) log.info('The PATH was repaired', { added }); },
      error => { log.warn('The PATH could not be repaired', { error: (error as Error).message }); });
    this.ready = this.pathRepaired.then(() => this.prepare()).catch(error => { log.error('The agent folder could not be prepared', error); });
    return this.ready;
  }

  private async prepare() {
    const { bundle: from, ownHome, log } = this.options;
    if (!from) return;
    const bundle = readBundle(from);
    const started = performance.now();
    const { copied, state } = await installAgentFolder(bundle, this.folder);
    if (copied) log.info('Agent folder updated', { build: bundle.build, folder: this.folder, ms: Math.round(performance.now() - started) });
    if (ownHome && !state.onPath) await this.putOnPath(state);
    if (!copied || !ownHome) return;
    // An update: the agents connected to this folder get the new plugin.
    await Promise.all(harnesses.map(item => this.serial(item.id, async () => {
      try {
        const environment = await this.environment(item.program);
        const done = await refreshAgent(item, this.folder, environment, this.program(item.id, environment));
        if (!done) return;
        log.info('Agent refreshed after an update', { agent: item.id, command: done });
        // Codex installed its copy again, and may ask to trust the hooks again: it is checked anew.
        // (Written here, not through record(), which waits for this preparation to end.)
        if (item.id === 'codex') await recordAgent(this.folder, item.id, { connectedAt: new Date().toISOString() });
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
   * The environment the agents' commands run in: this process's, its PATH repaired at start. An
   * agent installed since is on the user's PATH but not on this process's: on Windows the PATH is
   * read again from the registry when the program is not found.
   */
  private async environment(program: string): Promise<NodeJS.ProcessEnv> {
    await this.pathRepaired;
    const environment = { ...process.env };
    if (process.platform !== 'win32' || onPath(program, environment)) return environment;
    try {
      const key = pathKey(environment);
      environment[key] = mergedPath(environment[key] ?? '', await registryPath());
    } catch (error) { this.options.log.warn('The PATH could not be read again', { error: (error as Error).message }); }
    return environment;
  }

  /** The agent's program: the one chosen for it, else the one on the PATH. */
  private program(id: AgentId, environment: NodeJS.ProcessEnv) {
    return chosenProgram(this.folder, id) ?? onPath(harness(id).program, environment);
  }

  /** Record an agent as connected (or forget it) once the agent folder is ready, one write after another. */
  private record(id: AgentId, record: AgentRecord | null): Promise<void> {
    const write = this.records.then(() => this.ready).then(() => recordAgent(this.folder, id, record))
      .catch(error => { this.options.log.warn('An agent\'s record could not be written', { agent: id, error: (error as Error).message }); });
    this.records = write;
    return write;
  }

  /**
   * Whether a connected agent runs Atlas, from what is cheap to read (no agent's command runs). An
   * agent found connected without a record (connected by hand, or before this app) counts as
   * connected from now. Its record is forgotten only when the agent said (`listed`) that the plugin
   * is not there: a list that failed or ran out of time leaves it.
   */
  private check(id: AgentId, connected: boolean, listed = false): AgentCheck | null {
    const recorded = readAgentRecords(this.folder)[id];
    if (!connected) {
      if (recorded && listed) void this.record(id, null);
      return null;
    }
    let connectedAt = recorded?.connectedAt;
    if (!connectedAt) {
      connectedAt = new Date().toISOString();
      void this.record(id, { connectedAt });
    }
    const { home, lastSession } = this.options;
    let session: string | null = null;
    try { session = lastSession(sessionHarness[id]); } catch { /* The database may be busy: the notes still say. */ }
    return agentCheck({
      connectedAt,
      hooksAt: later(readActivity(home, id, 'hooks'), session),
      toolsAt: readActivity(home, id, 'mcp'),
      trust: id === 'codex' ? codexTrust(this.source, harness(id).config(process.env)) : 'unknown',
    });
  }

  private async state(id: AgentId): Promise<AgentState> {
    const item = harness(id);
    const chosen = chosenProgram(this.folder, id);
    let state: AgentState;
    try {
      const environment = await this.environment(item.program);
      // The marketplace's name, from what the app carries, so that the list does not wait for the copy.
      const { found, connected, version, listed } = await agentStatus(item, this.source, environment, chosen ?? onPath(item.program, environment));
      state = { id, found, program: chosen, connected, version, check: this.check(id, connected, listed) };
    } catch (error) {
      this.options.log.warn('An agent\'s state could not be read', { agent: id, error: (error as Error).message });
      state = { id, found: chosen !== null || onPath(item.program, process.env) !== null, program: chosen, connected: false, version: null, check: null };
    }
    this.last.set(id, state);
    return state;
  }

  /**
   * Claude Code and Codex, checked now (about a second: each lists its plugins). Windows asking
   * meanwhile (each checks as it comes forward) share the check on its way.
   */
  list(): Promise<AgentState[]> {
    this.listing ??= Promise.all(harnesses.map(item => this.state(item.id))).finally(() => { this.listing = null; });
    return this.listing;
  }

  /** The agents as last checked (checked now the first time), with whether each connected one runs Atlas read again. */
  async checks(): Promise<AgentState[]> {
    if (this.last.size < harnesses.length) return this.list();
    return harnesses.map(item => {
      const agent = this.last.get(item.id)!;
      return { ...agent, check: agent.connected ? this.check(item.id, true) : null };
    });
  }

  /** Grant the agent the Atlas home and install the plugin; the error says what failed, as the agent said it. */
  connect(id: AgentId): Promise<AgentChange> {
    return this.change(id, 'connect', async (environment, program) => {
      const { grantError } = await connectAgent(harness(id), this.directory, this.options.home, environment, program);
      await this.record(id, { connectedAt: new Date().toISOString() });
      return grantError;
    });
  }

  /** Uninstall the plugin and remove its marketplace from the agent. */
  disconnect(id: AgentId): Promise<AgentChange> {
    return this.change(id, 'disconnect', async (environment, program) => {
      await disconnectAgent(harness(id), this.directory, environment, program);
      await this.record(id, null);
      return null;
    });
  }

  /**
   * Connecting and disconnecting wait for the agent folder (its first copy, and the refresh after an
   * update), outside the agent's queue, which that refresh takes its turn in.
   */
  private async change(id: AgentId, action: string, run: (environment: NodeJS.ProcessEnv, program: string | null) => Promise<string | null>): Promise<AgentChange> {
    await this.ready;
    return this.serial(id, async () => {
      let error: string | null;
      try {
        const environment = await this.environment(harness(id).program);
        error = await run(environment, this.program(id, environment));
      } catch (failure) {
        if (!(failure instanceof AgentError)) this.options.log.error(`Agent ${action} failed`, failure);
        error = (failure as Error).message;
      }
      if (error) this.options.log.warn(`Agent ${action}: ${error}`, { agent: id });
      else this.options.log.info(`Agent ${action}ed`, { agent: id, directory: this.directory });
      return { agent: await this.state(id), error };
    });
  }

  /**
   * Use `program` (chosen in main's own file dialog) as the agent's program, once it answers
   * --version; the error says why it cannot be.
   */
  setProgram(id: AgentId, program: string): Promise<AgentChange> {
    return this.serial(id, async () => {
      const error = await programProblem(id, program, await this.environment(harness(id).program));
      if (error) this.options.log.info('A program chosen for an agent was refused', { agent: id, error });
      else {
        await saveProgram(this.folder, id, program);
        this.options.log.info('A program was chosen for an agent', { agent: id, program });
      }
      return { agent: await this.state(id), error };
    });
  }

  /** Forget the program chosen for the agent: the PATH's is used again. */
  clearProgram(id: AgentId): Promise<AgentState> {
    return this.serial(id, async () => {
      await saveProgram(this.folder, id, null);
      return this.state(id);
    });
  }

  /** What connecting an agent by hand takes: the folder agents are connected to, and the marketplace's name. */
  byHand(): AgentFolder {
    return { directory: this.directory, marketplace: marketplaceName(this.source) };
  }

  private get onboardingFile() { return path.join(this.folder, 'onboarding.json'); }

  /** The onboarding shows until it is finished (the uninstaller resets it with the agent folder's state). */
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
