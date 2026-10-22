// When Atlas last ran in each agent, as the agents' own processes note it, for the app's check of
// the connected agents (Settings › Agents): the hooks note it as a session starts and at each prompt
// (bin/atlas.js, before anything else loads), and the MCP server at its first tool call, by the name
// its client gave in MCP initialize. One small file each in <home>/agent/activity holds the time:
// nothing in the home database, so a hook notes it without opening the database.
//
// Only types come from agents.ts: the MCP server and the hooks load this file.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentId } from './agents.ts';

/** What noted it: the hooks, or the MCP server. */
export type ActivitySource = 'hooks' | 'mcp';

export const activityFile = (home: string, agent: AgentId, source: ActivitySource) => path.join(home, 'agent', 'activity', `${agent}-${source}`);

/**
 * The harness a session runs in, as its log's place tells (the home database's session.harness):
 * Codex keeps its logs under .codex, or CODEX_HOME, named rollout-…; Claude Code's are the others.
 * bin/atlas.js tells it the same way.
 */
export const harnessOfTranscript = (transcriptPath: string | null) => transcriptPath === null ? 'unknown'
  : /[\\/]\.codex[\\/]|[\\/]rollout-[^\\/]*\.jsonl$/.test(transcriptPath) ? 'codex' : 'claude-code';

/** The agent of a harness as the home database names it. */
export const agentOfHarness = (harness: string): AgentId | null => harness === 'codex' ? 'codex' : harness === 'claude-code' ? 'claude' : null;

/**
 * The agent an MCP client is, by the exact name it gives: Claude Code's `claude-code`, Codex's
 * `codex-mcp-client`. Any other client (Claude Desktop's `claude-ai`, another app) is neither.
 */
export function agentOfClient(name: unknown): AgentId | null {
  return name === 'claude-code' ? 'claude' : name === 'codex-mcp-client' ? 'codex' : null;
}

/**
 * Note that Atlas ran in the agent now, written whole (a temporary file renamed into place), so a
 * reader never sees half of it. Best effort: a failure only leaves the check to the next one.
 */
export function noteActivity(home: string, agent: AgentId, source: ActivitySource, at = new Date().toISOString()) {
  const file = activityFile(home, agent, source), temporary = file + '.' + process.pid + '.tmp';
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(temporary, at);
    renameSync(temporary, file);
  } catch { rmSync(temporary, { force: true }); }
}

/** When Atlas last ran in the agent, as it was noted; null when it never was (or the note cannot be read). */
export function readActivity(home: string, agent: AgentId, source: ActivitySource): string | null {
  try {
    const at = readFileSync(activityFile(home, agent, source), 'utf8').trim();
    return /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(at) ? at : null;
  } catch { return null; }
}
