// What a session's agent is doing, as the hooks record it for the app's statuses and live agent
// time: in a turn (working), waiting for the person, or neither. A session waits for the person
// only when it asks: a permission prompt, or the agent's `needs_you` call; a turn that ends without
// asking (an agent waiting on CI or a background task) is out of its turn without needing anyone. The hooks that only record it run
// on every tool call (and harnesses such as Codex wait for them), so they load only this file and,
// when the state is to change, the home database: a stamp file per session says what the database
// holds, so a tool use while the session works, or one of a session no work is linked to, is
// answered from the stamp alone.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { atlasHome } from '../../home/homePath.ts';
import type { HomeDatabase } from '../../home/database.ts';

/**
 * What a session's agent just did: started a turn (`prompt`); used a tool, so it is in a turn, the
 * same one after waiting for the person's permission, else a new one (`tool`); asked the person
 * (`ask`); ended its turn (`stop`); ended the session (`end`); or nothing that changes its state
 * (null, as a subagent stopping); or its process stopped without the person ending the session (`gone`:
 * a harness closing an idle agent, which it resumes on the next message), which leaves a wait for the
 * person as it is.
 */
export type Activity = 'prompt' | 'tool' | 'ask' | 'stop' | 'end' | 'gone' | null;
/**
 * The hooks that only record a session's state: ToolUse after every tool use, successful or not
 * (its own or a subagent's), and SubagentStart when a subagent begins.
 */
export const stateEvents = new Set(['UserPromptSubmit', 'ToolUse', 'Notification', 'PermissionRequest', 'SessionEnd', 'SubagentStart']);
/**
 * Notifications that wait for the person (Claude Code's); one without a type is taken as one. Its
 * idle prompt, sent a minute after any turn ends, says nothing about whether the person is needed.
 */
const asking = new Set(['permission_prompt', 'elicitation_dialog']);
/** The Atlas tool an agent calls when it stops for the person to act. */
export const needsYouTool = /^mcp__.*atlas.*__needs_you$/;
/** The harnesses' shell tools: Claude Code's Bash and PowerShell, Codex's shell and its exec scripts. */
const shellTools = new Set(['Bash', 'PowerShell', 'shell', 'exec_command', 'local_shell', 'exec']);
/** `atlas work <operation> …` that changes a work item (not `status`, `search` or `report`). bin/atlas.js asks the same. */
const atlasWork = /\batlas(?:\.js|\.cmd)?["']?\s+work\s+(?!(?:status|search|report)\b)\w+\b/;
/** Whether a tool call ran the atlas command in a shell to change a work item: then it links the session, as the tools do (hook.ts's shellWork). */
export function runsAtlasWork(input: { tool_name?: unknown; tool_input?: unknown }) {
  if (typeof input.tool_name !== 'string' || !shellTools.has(input.tool_name)) return false;
  const value = input.tool_input as Record<string, unknown> | string | undefined;
  const parts = typeof value === 'string' ? [value] : value && typeof value === 'object' ? [value.command, value.cmd, value.input].map(item => Array.isArray(item) ? item.join(' ') : item) : [];
  const text = parts.filter(item => typeof item === 'string').join('\n');
  return atlasWork.test(text);
}
export const sessionPattern = /^[A-Za-z0-9._:-]{1,128}$/;
/**
 * Whether a tool call may have made a commit (it ran `git … commit`, which prints `[branch hash]
 * subject`) or a PR (it ran `gh pr create`, which prints its URL), from the raw text of its input
 * before anything else is read.
 * bin/atlas.js asks the same before it loads any TypeScript.
 */
export const mayCommit = (text: string) => (/\bgit\b.{0,300}?\bcommit\b/.test(text) && /\[[^\]"]{1,100} [0-9a-f]{7,40}\] /.test(text)) || (/\bgh(?:\.exe)?\s+pr\s+create\b/.test(text) && /github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.test(text));
/** A tool use while the session works says it is still at work this often at most. */
const heartbeatMs = 60_000;

/** The activity a state hook records; null for a notification that does not wait for the person. */
function activityOf(event: string, input: { notification_type?: unknown; reason?: unknown }): Activity {
  // Claude Code says `other` when the process stops for a reason that is not the person's (exiting, /clear, logging out).
  if (event === 'SessionEnd' && input.reason === 'other') return 'gone';
  if (event === 'Notification') return asking.has(typeof input.notification_type === 'string' ? input.notification_type : 'permission_prompt') ? 'ask' : null;
  return ({ UserPromptSubmit: 'prompt', ToolUse: 'tool', PermissionRequest: 'ask', SessionEnd: 'end' } as Record<string, Activity>)[event] ?? null;
}

/** Note a failure in the home's hook log, keeping it small; never throws. */
export function logFailure(home: string, event: string, error: unknown) {
  try {
    const directory = path.join(home, 'logs');
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'hooks.log');
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > 512 * 1024) renameSync(file, path.join(directory, 'hooks.1.log'));
    appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), event, error: error instanceof Error ? error.stack ?? error.message : String(error) }) + '\n');
  } catch { /* Nothing more to do. */ }
}

// ---- Stamps: <home>/session-state/<session>, holding the state the database has --------------------

type Stamp = 'working' | 'waiting' | 'ended' | 'none';
const stampFolder = (home: string) => path.join(home, 'session-state');
/** A subagent's stamp is its session's name with the subagent's after a tilde. */
const agentStamp = (session: string, agent: string) => session + '~' + agent;
function readStamp(home: string, session: string): { state: Stamp; at: number } | null {
  try {
    const file = path.join(stampFolder(home), session);
    return { state: readFileSync(file, 'utf8') as Stamp, at: statSync(file).mtimeMs };
  } catch { return null; }
}
function writeStamp(home: string, session: string, state: Stamp) {
  try {
    mkdirSync(stampFolder(home), { recursive: true });
    writeFileSync(path.join(stampFolder(home), session), state);
  } catch (error) { logFailure(home, 'stamp', error); }
}
/**
 * Remove the stamps of sessions not seen for a week, and the cursors of session logs not measured
 * further for a week (recordReport.ts keeps them in <home>/cache/session-logs).
 */
export function pruneStamps(home: string, now = Date.now()) {
  for (const folder of [stampFolder(home), path.join(home, 'cache', 'session-logs'), path.join(home, 'cache', 'page-choices')]) {
    try {
      for (const name of readdirSync(folder)) {
        const file = path.join(folder, name);
        if (now - statSync(file).mtimeMs > 7 * 24 * 60 * 60_000) rmSync(file, { force: true });
      }
    } catch { /* None yet. */ }
  }
}

// ---- The session's row ----------------------------------------------------------------------------

interface SessionRow { working: number; turn_at: string | null; waiting_at: string | null; counts_at: string | null; state_at: string | null; updated_at: string }
const later = (a: string, b: string) => a > b ? a : b;
const moved = (moment: string, ms: number) => new Date(Date.parse(moment) + ms).toISOString();

/**
 * The session's row after an activity at `at`, or null when it changes nothing. An event older than
 * the last change (hooks run in the background can arrive late) changes nothing but when the
 * session was seen. `counts_at` is where its time not yet reported counts from: a turn's start,
 * moved on by each wait for the person within the turn, so the wait is not counted.
 */
export function nextState(row: SessionRow, activity: Activity, at: string, liveFrom: string): Partial<SessionRow> | null {
  const seen = { updated_at: later(row.updated_at, at) };
  if (!activity || (row.state_at !== null && row.state_at > at)) return row.working ? seen : null;
  const change = (values: Partial<SessionRow>) => ({ ...seen, ...values, state_at: at });
  // Waiting for the person within its turn (a permission prompt): resuming leaves the wait out, so
  // what was not yet reported when it began to wait (none, if a report came since) counts on.
  const asked = !row.working && row.waiting_at !== null && row.turn_at !== null;
  const counts = row.counts_at ?? row.turn_at;
  const resumed = !asked ? row.counts_at : counts !== null && counts < row.waiting_at! ? moved(counts, Date.parse(at) - Date.parse(row.waiting_at!)) : at;
  // A new turn after a wait whose report has not come in (an interrupted turn, a failed report) keeps
  // that turn's unreported time counting, the wait left out, until a report takes it in.
  const started = row.counts_at !== null && row.waiting_at !== null && row.counts_at < row.waiting_at ? moved(row.counts_at, Date.parse(at) - Date.parse(row.waiting_at)) : at;
  switch (activity) {
    // A prompt while the agent works (a message steering it) goes on with the same turn; one that
    // was last seen long ago was interrupted without a Stop.
    case 'prompt': return row.working && row.updated_at >= liveFrom ? change({}) : change({ working: 1, turn_at: at, waiting_at: null, counts_at: started });
    // A tool call longer than the live window is still the same turn.
    case 'tool': return row.working ? seen : asked ? change({ working: 1, waiting_at: null, counts_at: resumed }) : change({ working: 1, turn_at: at, waiting_at: null, counts_at: started });
    case 'ask': return row.working ? change({ working: 0, waiting_at: at }) : null;
    // A second end of the same turn (an interruption and its Stop) keeps when it began to wait.
    case 'stop': return !row.working && row.turn_at === null && row.waiting_at !== null ? null : change({ working: 0, turn_at: null, waiting_at: at, counts_at: resumed });
    case 'end': return change({ working: 0, turn_at: null, waiting_at: null });
    // Nobody answered: a session waiting for the person still does; one stopped in a turn does not.
    case 'gone': return row.working ? change({ working: 0, turn_at: null, waiting_at: null }) : null;
  }
}

/** The longest last message kept for a session that waits for the person. */
const messageLimit = 4000;
/**
 * What a hook knows besides the activity: the folder it runs in (the first one recorded is kept: the
 * agent may change folders later), and the message the session waits with (its turn's last, or the
 * question it asks).
 */
export interface ActivityDetails { cwd?: string | null; message?: string | null }

/**
 * Record what a session's agent did at `at` (an ISO time: when the hook started), and the stamp
 * that says so. Only sessions that linked work have a row; for others nothing is recorded. A tool
 * use while the session works only says it was seen, at most once a minute. Each wait for the
 * person is recorded with the work item the session is on, and the message it waits with is kept
 * until it stops waiting.
 */
export function recordActivity(database: HomeDatabase, home: string, session: string, transcriptPath: string | null, activity: Activity, at: string, liveWindowMs: number, details: ActivityDetails = {}) {
  // The stamp is written while the database is held, so stamps follow the changes in their order.
  database.transaction(() => writeStamp(home, session, (() => {
    const row = database.db.prepare('SELECT working, turn_at, waiting_at, counts_at, state_at, updated_at FROM session WHERE id = ?').get(session) as SessionRow | undefined;
    if (!row) return 'none';
    const quiet = activity === 'tool' && row.working === 1 && Date.parse(at) - Date.parse(row.updated_at) < heartbeatMs;
    const next = quiet ? null : nextState(row, activity, at, new Date(Date.parse(at) - liveWindowMs).toISOString());
    const now = { ...row, ...next };
    if (next) {
      const columns = Object.keys(next) as (keyof SessionRow)[];
      // A wait begins with its message, if the hook knows one, and ends without. A turn that ends
      // after the agent gave its reason (needs_you) keeps the reason.
      const given = details.message?.trim() ? details.message.trim().slice(0, messageLimit) : undefined;
      const reasoned = activity === 'stop' && asked(database, session) && (database.db.prepare('SELECT message FROM session WHERE id = ?').get(session) as { message: string | null }).message !== null;
      const message = row.waiting_at === now.waiting_at ? undefined : now.waiting_at === null ? null : reasoned ? undefined : given;
      database.db.prepare(`UPDATE session SET ${columns.map(column => column + ' = ?').join(', ')}, transcript_path = ifnull(?, transcript_path), cwd = ifnull(cwd, ?)${message === undefined ? '' : ', message = ?'} WHERE id = ?`)
        .run(...columns.map(column => next[column] ?? null), transcriptPath, details.cwd ?? null, ...message === undefined ? [] : [message], session);
      if (row.waiting_at !== now.waiting_at) {
        // A wait for the person (an open session_wait) is opened by asking; a turn's end only starts
        // the one the agent asked for during the turn (needs_you), else none.
        if (row.waiting_at !== null) database.db.prepare('UPDATE session_wait SET ended_at = ? WHERE session_id = ? AND ended_at IS NULL').run(at, session);
        if (now.waiting_at !== null && activity === 'ask') openWait(database, session, now.waiting_at);
        else if (now.waiting_at !== null) database.db.prepare('UPDATE session_wait SET started_at = ? WHERE session_id = ? AND ended_at IS NULL').run(now.waiting_at, session);
      }
    }
    return now.working ? 'working' : now.waiting_at !== null ? 'waiting' : 'ended';
  })()));
}

/** Whether the session asked for the person and has not heard back: its wait is open. */
const asked = (database: HomeDatabase, session: string) => Boolean(database.db.prepare('SELECT 1 FROM session_wait WHERE session_id = ? AND ended_at IS NULL LIMIT 1').get(session));
/** Open a wait for the person, on the work item the session is on. */
function openWait(database: HomeDatabase, session: string, at: string) {
  const on = database.db.prepare(`SELECT session_work.project_id, session_work.work_id FROM session JOIN session_work ON session_work.session_id = session.id
    WHERE session.id = ? ORDER BY session_work.id = ifnull(session.focus, -1) DESC, session_work.touched_at DESC, session_work.id DESC LIMIT 1`).get(session) as { project_id: number; work_id: string } | undefined;
  database.db.prepare('INSERT INTO session_wait (session_id, project_id, work_id, started_at) VALUES (?, ?, ?, ?)').run(session, on?.project_id ?? null, on?.work_id ?? null, at);
}
/**
 * Record that the agent asked for the person (`needs_you`, with its reason): its wait opens now and
 * starts when the turn ends; the reason is the message it waits with. Nothing for a session that
 * has linked no work.
 */
export function recordAsk(database: HomeDatabase, session: string, reason: string | null, at: string) {
  database.transaction(() => {
    if (!database.db.prepare('SELECT 1 FROM session WHERE id = ?').get(session)) return;
    if (!asked(database, session)) openWait(database, session, at);
    if (reason?.trim()) database.db.prepare('UPDATE session SET message = ? WHERE id = ?').run(reason.trim().slice(0, messageLimit), session);
  });
}

/**
 * Record that a session's subagent is at work at `at` (it started, or used a tool), and its stamp.
 * A subagent works for its session and the work item it is on, but its tool uses leave the main
 * agent's state as it is: the session may wait for the person while its subagents work. A tool use
 * after a permission prompt (which a subagent may have asked) resumes the turn, as the main agent's
 * would. Nothing is recorded for a session that has linked no work.
 */
export function recordAgent(database: HomeDatabase, home: string, session: string, agent: string, type: string | null, at: string, liveWindowMs: number) {
  database.transaction(() => writeStamp(home, agentStamp(session, agent), (() => {
    const row = database.db.prepare('SELECT working, turn_at, waiting_at, counts_at, state_at, updated_at FROM session WHERE id = ?').get(session) as SessionRow | undefined;
    if (!row) return 'none';
    // A start or a tool use after its stop (a subagent sent on again) starts it again; a hook from
    // before its stop (run in the background, arriving late) leaves it stopped.
    database.db.prepare(`INSERT INTO session_agent (session_id, agent_id, agent_type, started_at, seen_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (session_id, agent_id) DO UPDATE SET agent_type = ifnull(excluded.agent_type, agent_type), seen_at = max(seen_at, excluded.seen_at),
        started_at = CASE WHEN stopped_at IS NOT NULL AND stopped_at < excluded.seen_at THEN excluded.started_at ELSE started_at END,
        stopped_at = CASE WHEN stopped_at IS NOT NULL AND stopped_at >= excluded.seen_at THEN stopped_at ELSE NULL END`)
      .run(session, agent, type, at, at);
    if (!row.working && row.waiting_at !== null && row.turn_at !== null) recordActivity(database, home, session, null, 'tool', at, liveWindowMs);
    return 'working';
  })()));
}
/** Record that a session's subagent stopped. */
export function stopAgent(database: HomeDatabase, home: string, session: string, agent: string, at: string) {
  database.transaction(() => {
    database.db.prepare('UPDATE session_agent SET stopped_at = ? WHERE session_id = ? AND agent_id = ? AND seen_at <= ?').run(at, session, agent, at);
    writeStamp(home, agentStamp(session, agent), 'ended');
  });
}

/** Record a session the first time it links work: in a turn from `at`, unless it is recorded already. */
export function recordSession(database: HomeDatabase, session: string, harness: string, transcriptPath: string | null, at: string, cwd: string | null = null) {
  database.db.prepare('INSERT INTO session (id, harness, transcript_path, started_at, updated_at, working, turn_at, counts_at, state_at, cwd) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET cwd = ifnull(cwd, excluded.cwd)')
    .run(session, harness, transcriptPath, at, at, at, at, at, cwd);
}

/**
 * Run a state hook on its input: a stamp that settles it (no work linked, or working and seen
 * within the minute) is all it reads; otherwise the database records the change. `at` is when the
 * hook started. Never throws: a failure is logged.
 */
export async function stateHook(event: string, text: string | null, at: number, environment: NodeJS.ProcessEnv = process.env) {
  const home = atlasHome(undefined, environment);
  try {
    if (text === null) { text = ''; if (!process.stdin.isTTY) for await (const chunk of process.stdin) text += chunk; }
    const input = JSON.parse(text || '{}') as { session_id?: unknown; transcript_path?: unknown; notification_type?: unknown; reason?: unknown; message?: unknown; cwd?: unknown; agent_id?: unknown; agent_type?: unknown; tool_name?: unknown; tool_input?: { reason?: unknown } };
    const session = typeof input.session_id === 'string' && sessionPattern.test(input.session_id) ? input.session_id : null;
    // A subagent's tool use (Claude Code names the subagent in its hooks), or its start.
    const agent = (event === 'ToolUse' || event === 'SubagentStart') && typeof input.agent_id === 'string' && sessionPattern.test(input.agent_id) ? input.agent_id : null;
    const activity = event === 'SubagentStart' ? null : activityOf(event, input);
    if (!session || (!activity && !agent)) return;
    // A commit or a PR the tool call made is recorded however recently the session was seen.
    const made = event === 'ToolUse' && mayCommit(text);
    // The agent asks for the person: recorded whoever made the call, the session or a subagent.
    const asks = event === 'ToolUse' && typeof input.tool_name === 'string' && needsYouTool.test(input.tool_name);
    // The atlas command run in a shell to change a work item links the session to it, as the tools
    // do: the PostToolUse hook runs for the tools and edits only, so this hook hands it over.
    const shell = event === 'ToolUse' && runsAtlasWork(input);
    const stamp = readStamp(home, agent ? agentStamp(session, agent) : session);
    const fresh = stamp !== null && at - stamp.at < heartbeatMs;
    if (!asks && !shell && (agent ? event === 'ToolUse' && !made && fresh && (stamp.state === 'working' || stamp.state === 'none') : stamp?.state === 'none' || (activity === 'tool' && !made && stamp?.state === 'working' && fresh))) return;
    const { HomeDatabase, liveWindowMs } = await import('../../home/database.ts');
    const database = HomeDatabase.open(home);
    try {
      const when = new Date(at).toISOString();
      if (agent) recordAgent(database, home, session, agent, typeof input.agent_type === 'string' ? input.agent_type.slice(0, 100) : null, when, liveWindowMs);
      else {
        const details: ActivityDetails = { cwd: typeof input.cwd === 'string' ? input.cwd : null, message: activity === 'ask' && typeof input.message === 'string' ? input.message : null };
        recordActivity(database, home, session, typeof input.transcript_path === 'string' ? input.transcript_path : null, activity, when, liveWindowMs, details);
      }
      if (asks) recordAsk(database, session, typeof input.tool_input?.reason === 'string' ? input.tool_input.reason : null, when);
      if (made) await (await import('./sessionCommits.ts')).recordCommits(database, session, input, when);
      // The session's end (after an interruption no turn's end comes) and its next prompt (which runs in
      // the background) report the work items it left whose reports are not measured yet (hook.ts).
      if ((event === 'SessionEnd' || event === 'UserPromptSubmit') && !agent && database.db.prepare('SELECT 1 FROM session_leave JOIN session_work ON session_work.id = session_leave.link WHERE session_work.session_id = ? LIMIT 1').get(session)) {
        await (await import('./hook.ts')).reportLeft(database, home, session, typeof input.transcript_path === 'string' ? input.transcript_path : null, event, when);
      }
    } finally { database.close(); }
    if (shell) await (await import('./hook.ts')).runHook('PostToolUse', text, environment, new Date(at).toISOString());
  } catch (error) { logFailure(home, event, error); }
}
