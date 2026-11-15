// Whether a connected agent runs Coord, as Settings › Agents, the onboarding's Start step and the
// hub show it, from what is cheap to read: when Coord's hooks last ran in it (the hooks' notes and the
// sessions they recorded in the home database), when a session of it last used Coord's tools (the MCP
// server's note), and for Codex whether its config.toml trusts each of Coord's hooks. Only what
// happened since the agent was connected counts.
import type { HookTrust } from '@envsemble/coord/agents/trust';
import type { AgentCheck } from '../../shared/contract.ts';

export interface CheckSources {
  /** When the agent was connected (or first found connected), as an ISO time. */
  connectedAt: string;
  /** When Coord's hooks last ran in the agent, and when its tools were last used there (ISO times, or null). */
  hooksAt: string | null;
  toolsAt: string | null;
  /** Codex's trust of the hooks; 'unknown' for Claude Code, which has no trust step. */
  trust: HookTrust;
}

/**
 * A session that ran the hooks since the agent was connected makes it ready, whatever its
 * configuration says (the configuration is read cautiously; the hooks running is what counts).
 * Otherwise hooks Codex does not trust will not run, and a session that used the tools without
 * any hook running means its hooks are not running. A trust that cannot be read says nothing.
 */
export function agentCheck({ connectedAt, hooksAt, toolsAt, trust }: CheckSources): AgentCheck {
  if (hooksAt !== null && hooksAt >= connectedAt) return { status: 'ready', at: hooksAt };
  if (trust === 'untrusted') return { status: 'untrusted' };
  if (toolsAt !== null && toolsAt >= connectedAt) return { status: 'no-hooks' };
  return { status: 'waiting' };
}

/** The later of two ISO times, either of which may be missing. */
export const later = (left: string | null, right: string | null) => left === null ? right : right === null || left >= right ? left : right;
