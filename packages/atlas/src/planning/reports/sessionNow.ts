// What a session is doing now, for the plan page's Now: the latest message of its agent and its last
// few actions, condensed to a line each, from the end of its log. Nothing is kept: the host reads it
// when asked. Claude Code logs list tool calls (`tool_use`, with the agent's own description of a
// command) and their results; Codex rollouts list tool calls, a command or a patch inside them.
// Reads (files read, searched, listed) are not actions; a line that is not understood is skipped.
import { open } from 'node:fs/promises';

/** One thing the agent did: edited a file, ran a command (`failed` when it did), used an Atlas tool, started a helper, or another tool. */
export interface SessionAction { kind: 'edit' | 'command' | 'atlas' | 'agent' | 'tool'; text: string; failed?: boolean }
export interface SessionNow { message: string | null; actions: SessionAction[] }

/** How much of a log's end is read first, and at most: a turn's images and long outputs can fill the first read. */
const firstRead = 256 * 1024, readLimit = 8 * 1024 * 1024;
/** The longest message and action text kept. */
const messageLimit = 2000, actionLimit = 120;
/** Tools that only read: not actions. */
const reads = new Set(['Read', 'Grep', 'Glob', 'LS', 'ToolSearch', 'TodoWrite', 'TaskOutput', 'WebSearch', 'WebFetch', 'Skill', 'ListMcpResourcesTool', 'ReadMcpResourceTool']);
const edits = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const commands = new Set(['Bash', 'PowerShell', 'shell', 'exec_command', 'local_shell']);

/** A path's last part, with either separator. */
const fileName = (file: string) => file.split(/[\\/]/).pop() || file;
const short = (text: string) => { const line = text.trim().split(/\r?\n/)[0].replace(/\s+/g, ' '); return line.length > actionLimit ? line.slice(0, actionLimit - 1) + '…' : line; };
const objectOf = (line: string): Record<string, unknown> | null => { try { const value = JSON.parse(line); return value && typeof value === 'object' ? value : null; } catch { return null; } };
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;

/** A tool call as an action; null for a read, or one that says nothing. */
export function actionOf(name: string, input: Record<string, unknown>): SessionAction | null {
  if (reads.has(name)) return null;
  if (edits.has(name)) { const file = text(input.file_path) ?? text(input.notebook_path); return file ? { kind: 'edit', text: 'Edited ' + fileName(file) } : null; }
  if (commands.has(name)) { const said = text(input.description) ?? text(input.command) ?? (Array.isArray(input.command) ? input.command.join(' ') : null) ?? text(input.cmd); return said ? { kind: 'command', text: short(said) } : null; }
  if (name === 'Agent' || name === 'Task') return { kind: 'agent', text: 'Started a helper' + (text(input.description) ? ': ' + short(String(input.description)) : '') };
  const atlas = /^mcp__.*atlas.*__(\w+)$/.exec(name);
  if (atlas) {
    const detail = [input.action, input.work, input.step, input.status].filter(value => typeof value === 'string').join(' ');
    return { kind: 'atlas', text: short('Atlas ' + atlas[1] + (detail ? ': ' + detail : '')) };
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  return { kind: 'tool', text: mcp ? mcp[1].replace(/^plugin_[^_]+_/, '') + ': ' + mcp[2].replace(/_/g, ' ') : name };
}

/** A Codex `exec` or `apply_patch` call's actions: the commands its script runs, the files its patch changes. */
function codexActions(name: string, input: string): SessionAction[] {
  const found: SessionAction[] = [];
  // The patch may sit in a script's string, its line ends and backslashes escaped.
  for (const match of input.matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+?)(?:\\n|\n|$)/gm)) found.push({ kind: 'edit', text: 'Edited ' + fileName(match[1].replace(/\\\\/g, '\\').trim()) });
  for (const match of input.matchAll(/\bcmd\s*:\s*"((?:[^"\\]|\\.)*)"/g)) found.push({ kind: 'command', text: short(match[1].replace(/\\(.)/g, '$1')) });
  return found.length ? found : name === 'exec' || name === 'apply_patch' ? [] : [{ kind: 'tool', text: name }];
}

/**
 * The latest message and the last `limit` actions (newest first, an edit of the file just edited
 * once) in the lines at the end of a session's log.
 */
export function nowOf(lines: string[], limit = 5): SessionNow {
  const found: SessionNow = { message: null, actions: [] };
  const actions: (SessionAction & { id?: string })[] = [];
  const failed = new Set<string>();
  for (const line of lines) {
    const entry = objectOf(line);
    if (!entry) continue;
    // Claude Code: an assistant's text and tool calls, the person's (tool) results.
    const message = entry.message as { role?: unknown; content?: unknown } | undefined;
    if (Array.isArray(message?.content)) {
      const parts = message.content as Record<string, unknown>[];
      if (entry.type === 'assistant') {
        const said = parts.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text as string).join('\n\n').trim();
        if (said) found.message = said;
        for (const part of parts) if (part?.type === 'tool_use' && typeof part.name === 'string') {
          const action = actionOf(part.name, (part.input ?? {}) as Record<string, unknown>);
          if (action) actions.push({ ...action, id: typeof part.id === 'string' ? part.id : undefined });
        }
      } else for (const part of parts) if (part?.type === 'tool_result' && part.is_error === true && typeof part.tool_use_id === 'string') failed.add(part.tool_use_id);
      continue;
    }
    // Codex: response items.
    const payload = entry.payload as Record<string, unknown> | undefined;
    if (entry.type !== 'response_item' || !payload) continue;
    if (payload.type === 'message' && payload.role === 'assistant' && Array.isArray(payload.content)) {
      const said = (payload.content as Record<string, unknown>[]).filter(part => typeof part?.text === 'string').map(part => part.text as string).join('\n\n').trim();
      if (said) found.message = said;
    } else if ((payload.type === 'custom_tool_call' || payload.type === 'function_call') && typeof payload.name === 'string') {
      const input = typeof payload.input === 'string' ? payload.input : typeof payload.arguments === 'string' ? payload.arguments : '';
      const parsed = payload.type === 'function_call' ? objectOf(input) : null;
      const own = parsed ? actionOf(payload.name, parsed) : null;
      actions.push(...own ? [own] : parsed ? [] : codexActions(payload.name, input));
    }
  }
  if (found.message && found.message.length > messageLimit) found.message = found.message.slice(0, messageLimit - 1) + '…';
  for (const action of actions.reverse()) {
    if (found.actions.length === limit) break;
    if (action.kind === 'edit' && found.actions.at(-1)?.text === action.text) continue;
    const { id, ...shown } = action;
    found.actions.push(id && failed.has(id) ? { ...shown, failed: true } : shown);
  }
  return found;
}

/** What a session is doing now, from the end of its log; nothing for a log that cannot be read. */
export async function sessionNow(transcript: string, limit = 5): Promise<SessionNow> {
  const none: SessionNow = { message: null, actions: [] };
  if (!transcript.endsWith('.jsonl')) return none;
  const handle = await open(transcript, 'r').catch(() => null);
  if (!handle) return none;
  try {
    const { size } = await handle.stat();
    // Read further back until the end holds a message and enough actions, or all of the log.
    for (let length = Math.min(size, firstRead); ; length = Math.min(size, readLimit, length * 4)) {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      const lines = buffer.toString('utf8').split('\n');
      // The first line may be cut off.
      if (length < size) lines.shift();
      const found = nowOf(lines, limit);
      if ((found.message && found.actions.length >= limit) || length === size || length >= readLimit) return found;
    }
  } catch { return none; } finally { await handle.close(); }
}
