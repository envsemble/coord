// The agents Atlas connects on this computer, as Settings and the onboarding list them: where each
// is installed from, what its row says (with whether a connected one runs Atlas), the commands that
// connect it by hand, and how a connect or disconnect on its way changes it.
import type { AgentChange, AgentCheck, AgentFolder, AgentId, AgentState } from '../types';
import { relativeDate } from '../ui/format';

/** Where to install each agent from: its makers' own pages. */
export const agentInstallPages: Record<AgentId, string> = {
  claude: 'https://claude.com/claude-code',
  codex: 'https://developers.openai.com/codex',
};

/** What is happening to an agent's connection: a connect or disconnect on its way, or how the last one failed. */
export interface AgentActivity {
  running: 'connect' | 'disconnect' | null;
  /** The last connect or disconnect that failed, with why; cleared by the next one. */
  failed: { action: 'connect' | 'disconnect'; error: string } | null;
}
export const idle: AgentActivity = { running: null, failed: null };

/** An agent's status line: connected (with the plugin's version), not connected, or not on this computer. */
export function agentStatus(agent: AgentState): string {
  if (agent.connected) return agent.version ? 'Connected · plugin ' + agent.version : 'Connected';
  return agent.found ? 'Not connected' : 'Not found on this computer';
}

/** A connected agent's check as its row says it, and whether it is a warning. */
export function agentCheckLine(check: AgentCheck): { text: string; warning: boolean } {
  if (check.status === 'ready') return { text: 'Ready · last session ' + relativeDate(check.at), warning: false };
  if (check.status === 'waiting') return { text: 'Waiting for a first session', warning: false };
  return { text: check.status === 'untrusted' ? 'Hooks not trusted: type /hooks in Codex' : 'Atlas’s hooks aren’t running', warning: true };
}

/** The connected agents whose check warns. */
export const agentWarnings = (agents: readonly AgentState[] | null) => (agents ?? []).filter(agent => agent.connected && agent.check && agentCheckLine(agent.check).warning);

/**
 * The commands that connect an agent by hand to the marketplace folder the app uses (a terminal's,
 * and those typed in a session), for when Connect cannot.
 */
export function byHandCommands(id: AgentId, { directory, marketplace }: AgentFolder): { terminal: string[]; session: string[] } {
  const plugin = 'atlas@' + marketplace;
  if (id === 'claude') return {
    terminal: [`claude plugin marketplace add "${directory}"`, `claude plugin install ${plugin}`],
    session: [`/plugin marketplace add ${directory}`, `/plugin install ${plugin}`],
  };
  return { terminal: [`codex plugin marketplace add "${directory}"`, `codex plugin add ${plugin}`], session: ['/plugins'] };
}

/** A connect or disconnect started. */
export const started = (action: 'connect' | 'disconnect'): AgentActivity => ({ running: action, failed: null });
/**
 * A connect or disconnect ended: the agent as it is after it, and the activity, with the error when
 * it failed. Cancelled (the person said no), it leaves nothing to try again.
 */
export function finished(action: 'connect' | 'disconnect', outcome: { change: AgentChange } | { error: string | null }): AgentActivity {
  const error = 'change' in outcome ? outcome.change.error : outcome.error;
  return { running: null, failed: error ? { action, error } : null };
}

/** The agents with one of them as it is now. */
export const withAgent = (agents: AgentState[] | null, agent: AgentState) => agents?.map(item => item.id === agent.id ? agent : item) ?? agents;
