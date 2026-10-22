// Whether a connected agent runs Atlas, as Settings › Agents, the onboarding's Start step and the
// hub show it, from what is cheap to read: when Atlas's hooks last ran in it (the hooks' notes and the
// sessions they recorded in the home database), when a session of it last used Atlas's tools (the MCP
// server's note), and for Codex whether its config.toml trusts each of Atlas's hooks. Only what
// happened since the agent was connected counts.
import type { HookTrust } from '@envsemble/atlas/agents/trust';
import type { AgentCheck } from '../../shared/contract.ts';

export interface CheckSources {
  /** When the agent was connected (or first found connected), as an ISO time. */
  connectedAt: string;
  /** When Atlas's hooks last ran in the agent, and when its tools were last used there (ISO times, or null). */
  hooksAt: string | null;
  toolsAt: string | null;
  /** Codex's trust of the hooks; 'unknown' for Claude Code, which has no trust step. */
  trust: HookTrust;
}

/**
 * Hooks Codex does not trust do not run; otherwise a session that ran the hooks makes the agent
 * ready, and one that used the tools without any hook running means its hooks are not running.
 * A trust that cannot be read says nothing.
 */
export function agentCheck({ connectedAt, hooksAt, toolsAt, trust }: CheckSources): AgentCheck {
  if (trust === 'untrusted') return { status: 'untrusted' };
  if (hooksAt !== null && hooksAt >= connectedAt) return { status: 'ready', at: hooksAt };
  if (toolsAt !== null && toolsAt >= connectedAt) return { status: 'no-hooks' };
  return { status: 'waiting' };
}

/** The later of two ISO times, either of which may be missing. */
export const later = (left: string | null, right: string | null) => left === null ? right : right === null || left >= right ? left : right;
