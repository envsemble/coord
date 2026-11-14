// Coord Dev's hooks. Coord Dev's plugin (app/scripts/dev-plugin.cjs) runs a command marked as the dev
// variant (its variant.json), installed beside the real plugin, so its hooks run in every session
// the agent starts while it is on. They act only in a dev session: one the user starts by saying
// "dev session". That prompt marks the session (a file named after it in the agent folder's
// dev-sessions/) and tells the agent to use Coord Dev's skills and tools for the rest of it; in any
// other session they do nothing, and the real plugin's hooks go on as ever. bin/coord.js asks here
// before it runs a dev variant's hook.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** What starts a dev session, anywhere in the user's prompt. */
export const devSessionPrompt = /\bdev[ -]session\b/i;
const sessionName = /^[A-Za-z0-9._:-]{1,128}$/;

/** Whether this command is Coord Dev's: its variant.json beside bin/ (app/scripts/dev-plugin.cjs). */
export const isDevVariant = () => existsSync(new URL('../../../variant.json', import.meta.url));
/** A Coord tool that changes a work item, as its hooks link the session to it (see bin/coord.js's idle too). */
const workTool = /^mcp__.*coord.*__(?:step$|state$|work_(?!(?:status|search)$))/;
/**
 * Whether a tool call changed a work item through this command's own tools: the release's command
 * answers coord's, Coord Dev's answers coord-dev's, so neither records the other's planning folders.
 */
export const changesWork = (tool: string, dev: boolean) => workTool.test(tool) && /coord-dev/.test(tool) === dev;

/** What the agent is told when a dev session starts: Coord Dev's skills and tools in place of Coord's. */
export function devSessionNote(home: string) {
  return [
    'This is a Coord Dev session: the user said "dev session". For the rest of it, use Coord Dev in place of Coord:',
    '- its dev- skills (dev-coord, dev-coord-implement, dev-coord-grill, dev-full-stop and the rest) instead of the skills of the same name without dev-, including the ones that apply on their own;',
    '- its coord-dev tools instead of the coord ones.',
    `Coord Dev keeps its data in ${home}, a copy of the user's Coord home, so its projects and plans are copies; Coord's own skills and tools stay for sessions that are not dev sessions.`,
  ].join('\n');
}

/**
 * Whether a dev variant's hook runs for this event, and what it prints first. A prompt that starts
 * a dev session marks it: the synchronous prompt hook (PageChoices) then tells the agent so, in place
 * of its own work for that one prompt, and the state hook (UserPromptSubmit) records it as usual.
 * The two run at once for the same prompt, so either may mark it first. A marked session's hooks
 * run as the release's do; any other session's do nothing.
 */
export function devGate(event: string | undefined, text: string, home: string): { run: boolean; output: string | null } {
  let input: { session_id?: unknown; prompt?: unknown };
  try { input = JSON.parse(text || '{}'); } catch { return { run: false, output: null }; }
  const session = input.session_id;
  if (typeof session !== 'string' || !sessionName.test(session)) return { run: false, output: null };
  const marker = path.join(home, 'agent', 'dev-sessions', session);
  const starts = (event === 'PageChoices' || event === 'UserPromptSubmit') && typeof input.prompt === 'string' && devSessionPrompt.test(input.prompt);
  if (!starts) return { run: existsSync(marker), output: null };
  try {
    mkdirSync(path.dirname(marker), { recursive: true });
    writeFileSync(marker, new Date().toISOString());
  } catch { return { run: false, output: null }; }
  if (event === 'PageChoices') return { run: false, output: JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: devSessionNote(home) } }) };
  return { run: true, output: null };
}
