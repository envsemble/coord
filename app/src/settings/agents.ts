// The agents Atlas connects on this computer, as Settings and the onboarding list them: where each
// is installed from, what its row says, and how a connect or disconnect on its way changes it.
import type { AgentChange, AgentId, AgentState } from '../types';

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
