// Agent time and tokens from the agent's own session log. `atlas work report` runs inside the agent's
// harness, which names its session in the environment and keeps a log of it on this computer:
// - Claude Code: <config>/projects/<project>/<session>.jsonl, its subagents' logs in
//   <project>/<session>/subagents/agent-*.jsonl (<config> is CLAUDE_CONFIG_DIR, else ~/.claude);
// - Codex: <home>/sessions/YYYY/MM/DD/rollout-<local time>-<thread>[_<part>].jsonl, or
//   <home>/archived_sessions/ (<home> is CODEX_HOME, else ~/.codex); its subagents are threads of
//   their own whose first line names it.
// The agent works from each prompt until the last activity of that turn (its output, tool calls and
// their results), not while it waits for the person. Helpers' busy time merges with the main agent's,
// so parallel work counts once. Logs are only read, line by line; nothing but numbers and model
// identifiers leaves them, and a line that is not understood is skipped, never fatal.
import { createReadStream, type Dirent } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { modelPattern } from './statistics.ts';
import type { TokenKinds } from './types.ts';

export type Harness = 'claude-code' | 'codex';
/** One model's share of a measured interval: its busy time and the tokens of its responses. */
export interface ModelMeasure extends TokenKinds { model: string; agentMs: number }
export interface SessionMeasure {
  harness: Harness; session: string;
  /** Working time in the interval: the main agent's and its helpers' busy time, parallel work once. */
  agentMs: number;
  /** Most working time first. A model's time overlaps another's while both work at once. */
  models: ModelMeasure[];
  /** The model that did most of the main agent's work in the interval, else the latest it used. */
  mainModel: string | null;
}
/** A session to measure; without a harness, both harnesses' logs are searched. */
export interface SessionCandidate { harness: Harness | null; session: string }
export interface LogOptions {
  /** Where the harnesses keep their logs: CLAUDE_CONFIG_DIR and CODEX_HOME. */
  environment?: NodeJS.ProcessEnv;
  /** The home folder holding ~/.claude and ~/.codex when those are not set. */
  home?: string;
}
interface LogFile { file: string; modified: number; main: boolean }
export interface SessionLogs {
  harness: Harness; session: string; files: LogFile[];
  /** Codex: other threads' rollouts since this thread started, among them its subagents'. */
  others: string[];
}

/** Session identifiers as harnesses write them (UUIDs): never a path, a dot or a drive. */
const sessionName = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
/** A compaction longer than this is not believed. */
const compactionLimit = 6 * 60 * 60 * 1000;

/** The sessions the environment names: Claude Code's, then Codex's. */
export function harnessSessions(environment: NodeJS.ProcessEnv = process.env): SessionCandidate[] {
  const found: SessionCandidate[] = [];
  const claude = environment.CLAUDE_CODE_SESSION_ID ?? '', codex = environment.CODEX_THREAD_ID ?? '';
  if (sessionName.test(claude)) found.push({ harness: 'claude-code', session: claude });
  if (sessionName.test(codex)) found.push({ harness: 'codex', session: codex });
  return found;
}

const entries = (folder: string): Promise<Dirent[]> => readdir(folder, { withFileTypes: true }).catch(() => []);
async function logFile(file: string, main: boolean): Promise<LogFile | null> {
  const info = await stat(file).catch(() => null);
  return info?.isFile() ? { file, modified: info.mtimeMs, main } : null;
}
const present = <T>(values: (T | null)[]) => values.filter((value): value is T => value !== null);

/** Claude Code: the session's log in any project folder, and its subagents' logs. Names match exactly. */
async function claudeLogs(session: string, config: string): Promise<SessionLogs | null> {
  const projects = path.join(config, 'projects');
  const found: Promise<LogFile | null>[] = [];
  for (const project of await entries(projects)) {
    if (!project.isDirectory()) continue;
    const folder = path.join(projects, project.name);
    for (const entry of await entries(folder)) {
      if (entry.isFile() && entry.name === session + '.jsonl') found.push(logFile(path.join(folder, entry.name), true));
      else if (entry.isDirectory() && entry.name === session) {
        const subagents = path.join(folder, entry.name, 'subagents');
        for (const helper of await entries(subagents)) if (helper.isFile() && /^agent-[A-Za-z0-9_-]+\.jsonl$/.test(helper.name)) found.push(logFile(path.join(subagents, helper.name), false));
      }
    }
  }
  const files = present(await Promise.all(found));
  return files.some(file => file.main) ? { harness: 'claude-code', session, files, others: [] } : null;
}

/** rollout-<local time>-<thread>[_<part>].jsonl; a thread's later parts continue it. */
const rolloutName = /^rollout-(\d{4}-\d{2}-\d{2})T\d{2}-\d{2}-\d{2}-([A-Za-z0-9-]+?)(?:_[A-Za-z0-9-]+)?\.jsonl$/;

/** Codex: every rollout of the thread, in the dated folders and the archive. */
async function codexLogs(thread: string, home: string): Promise<SessionLogs | null> {
  const sessions = path.join(home, 'sessions');
  const numbered = async (folder: string, digits: number) => (await entries(folder)).filter(entry => entry.isDirectory() && entry.name.length === digits && /^\d+$/.test(entry.name)).map(entry => entry.name);
  const folders = [path.join(home, 'archived_sessions')];
  for (const year of await numbered(sessions, 4)) for (const month of await numbered(path.join(sessions, year), 2)) for (const day of await numbered(path.join(sessions, year, month), 2)) folders.push(path.join(sessions, year, month, day));
  const main: Promise<LogFile | null>[] = [];
  const others: { file: string; day: string }[] = [];
  let first = '9999';
  for (const folder of folders) {
    for (const entry of await entries(folder)) {
      const match = entry.isFile() ? rolloutName.exec(entry.name) : null;
      if (!match) continue;
      if (match[2] === thread) { main.push(logFile(path.join(folder, entry.name), true)); if (match[1] < first) first = match[1]; }
      else others.push({ file: path.join(folder, entry.name), day: match[1] });
    }
  }
  const files = present(await Promise.all(main));
  // A subagent starts after its parent: older rollouts are someone else's.
  return files.length ? { harness: 'codex', session: thread, files, others: others.filter(other => other.day >= first).map(other => other.file) } : null;
}

/** The logs of the candidate sessions that have them; when several do, the most recently written. */
export async function sessionLogs(candidates: SessionCandidate[], options: LogOptions = {}): Promise<SessionLogs | null> {
  const environment = options.environment ?? process.env;
  const home = options.home ?? os.homedir();
  const found: SessionLogs[] = [];
  for (const candidate of candidates) {
    if (!sessionName.test(candidate.session)) continue;
    if (candidate.harness !== 'codex') { const logs = await claudeLogs(candidate.session, path.resolve(environment.CLAUDE_CONFIG_DIR || path.join(home, '.claude'))); if (logs) found.push(logs); }
    if (candidate.harness !== 'claude-code') { const logs = await codexLogs(candidate.session, path.resolve(environment.CODEX_HOME || path.join(home, '.codex'))); if (logs) found.push(logs); }
  }
  const newest = (logs: SessionLogs) => Math.max(...logs.files.map(file => file.modified));
  return found.sort((a, b) => newest(b) - newest(a))[0] ?? null;
}

/** The start of a file: its first line, up to a limit (a Codex rollout's first line is ~25 KB). */
async function firstLine(file: string, limit = 1 << 20): Promise<string | null> {
  const handle = await open(file, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const chunks: Buffer[] = [];
    for (let position = 0; position < limit;) {
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) return null;
      const end = buffer.subarray(0, bytesRead).indexOf(10);
      chunks.push(buffer.subarray(0, end === -1 ? bytesRead : end));
      if (end !== -1) return Buffer.concat(chunks).toString('utf8');
      position += bytesRead;
    }
    return null;
  } finally { await handle.close(); }
}

interface SessionMeta { type?: unknown; payload?: { id?: unknown; session_id?: unknown; parent_thread_id?: unknown; source?: { subagent?: { thread_spawn?: { parent_thread_id?: unknown } } } } }

/** Codex subagents written to since `since`: threads whose first line names this one as their root or parent, at any depth. */
async function codexHelpers(logs: SessionLogs, since: number): Promise<LogFile[]> {
  const recent = present(await Promise.all(logs.others.map(file => logFile(file, false)))).filter(file => file.modified >= since);
  const threads = await Promise.all(recent.map(async file => {
    let meta: SessionMeta['payload'];
    try { const value = JSON.parse(await firstLine(file.file) ?? 'null') as SessionMeta | null; if (value?.type === 'session_meta') meta = value.payload; } catch { /* Not a rollout Atlas can read. */ }
    return { file, id: meta?.id, root: meta?.session_id, parent: meta?.parent_thread_id ?? meta?.source?.subagent?.thread_spawn?.parent_thread_id };
  }));
  const family = new Set<unknown>([logs.session]);
  const helpers: LogFile[] = [];
  for (let grown = true; grown;) {
    grown = false;
    for (const thread of threads) {
      if (typeof thread.id !== 'string' || family.has(thread.id) || !(thread.root === logs.session || family.has(thread.parent))) continue;
      family.add(thread.id);
      helpers.push(thread.file);
      grown = true;
    }
  }
  return helpers;
}

/** A file's lines, split at line feeds only: JSON text may hold U+2028, where line readers also split. */
async function* lines(file: string): AsyncGenerator<string> {
  let pending: Buffer[] = [];
  for await (const chunk of createReadStream(file, { highWaterMark: 1 << 20 }) as AsyncIterable<Buffer>) {
    let start = 0;
    for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
      pending.push(chunk.subarray(start, end));
      yield (pending.length === 1 ? pending[0] : Buffer.concat(pending)).toString('utf8');
      pending = [];
      start = end + 1;
    }
    if (start < chunk.length) pending.push(chunk.subarray(start));
  }
  if (pending.length) yield Buffer.concat(pending).toString('utf8');
}

/** A busy stretch, credited to the model at work (null when unknown). */
interface Segment { start: number; end: number; model: string | null; main: boolean }
/** Tokens spent at a moment: one response (Claude Code) or one increase of the running count (Codex). */
interface Spend { at: number; model: string | null; tokens: TokenKinds }
interface Timeline { segments: Segment[]; spends: Spend[]; latest: { at: number; model: string } | null; events: number }

const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
/** A model identifier as reports accept it; anything else counts without a model. */
const modelOf = (value: unknown) => typeof value === 'string' && value !== '<synthetic>' && modelPattern.test(value) ? value : null;
const timeOf = (value: unknown) => typeof value === 'string' ? Date.parse(value) : Number.NaN;
const objectOf = (text: string): Record<string, unknown> | null => {
  try { const value: unknown = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
};

/** The parts of a Claude Code line that timing reads; anything may be missing or of another type. */
interface ClaudeLine {
  type?: unknown; timestamp?: unknown; isMeta?: unknown; isCompactSummary?: unknown; subtype?: unknown;
  compactMetadata?: { durationMs?: unknown } | null;
  permissionDecision?: { source?: unknown } | null;
  message?: { id?: unknown; model?: unknown; content?: unknown; stop_reason?: unknown; usage?: Record<string, unknown> | null } | null;
}
/**
 * A tool result after the person's answer or decision closes a stretch that was theirs, not the
 * agent's. A response that ends its turn closes it; one that asks the person leaves it waiting.
 */
type ClaudeEvent = { at: number } & ({ kind: 'prompt' } | { kind: 'activity'; model: string | null; person?: boolean; closes?: boolean; asks?: boolean } | { kind: 'compaction'; durationMs: number });
/** Tools that wait for the person: a question, and approval of a plan. */
const personTools = new Set(['AskUserQuestion', 'ExitPlanMode']);

function claudeEvent(line: ClaudeLine, asked: Set<unknown>): ClaudeEvent | null {
  const at = timeOf(line.timestamp);
  if (Number.isNaN(at)) return null;
  const content = line.message?.content;
  if (line.type === 'assistant') {
    let asks = false;
    if (Array.isArray(content)) for (const part of content) if (part?.type === 'tool_use' && personTools.has(part.name)) { asked.add(part.id); asks = true; }
    const stop = line.message?.stop_reason;
    return { at, kind: 'activity', model: modelOf(line.message?.model), closes: typeof stop === 'string' && stop !== 'tool_use', asks };
  }
  if (line.type === 'system') {
    const durationMs = line.subtype === 'compact_boundary' ? count(line.compactMetadata?.durationMs) : 0;
    return durationMs && durationMs <= compactionLimit ? { at, kind: 'compaction', durationMs } : null;
  }
  // Injected context and a compaction's summary are not prompts; tool results are the turn at work,
  // unless the person answered the tool or decided in a permission prompt that it may run.
  if (line.type !== 'user' || line.isMeta === true || line.isCompactSummary === true) return null;
  if (Array.isArray(content)) {
    const results = content.filter(part => part?.type === 'tool_result');
    if (!results.length) return { at, kind: 'prompt' };
    const decided = line.permissionDecision?.source;
    return { at, kind: 'activity', model: null, person: (typeof decided === 'string' && decided.startsWith('user')) || results.some(part => asked.has(part.tool_use_id)) };
  }
  return typeof content === 'string' ? { at, kind: 'prompt' } : null;
}

/**
 * Claude Code: each log's lines in time order. A prompt (from the person or a finished background
 * task) starts a turn, which runs until its last activity; each stretch goes to the model that
 * produced it, or that called the tool it waited for. A compaction is busy for its duration. Live,
 * a turn still under way (not ended by a response, nor waiting for the person) runs until now.
 */
async function claudeTimeline(files: LogFile[], at: number, live: boolean): Promise<Timeline> {
  const timeline: Timeline = { segments: [], spends: [], latest: null, events: 0 };
  // One response is written as several lines (one per content block): its last line counts.
  const responses = new Map<string, Spend>();
  for (const log of files) {
    const events: ClaudeEvent[] = [];
    const asked = new Set<unknown>();
    let number = 0;
    for await (const text of lines(log.file)) {
      number++;
      // Titles, modes and other bookkeeping carry no time.
      if (!text.includes('"timestamp"')) continue;
      const line = objectOf(text) as ClaudeLine | null;
      const event = line && claudeEvent(line, asked);
      if (!event) continue;
      events.push(event);
      const usage = line.message?.usage, model = modelOf(line.message?.model);
      if (line.type !== 'assistant' || !model || !usage || typeof usage !== 'object') continue;
      const id = line.message?.id;
      responses.set(typeof id === 'string' ? id : log.file + '#' + number, { at: event.at, model, tokens: { input: count(usage.input_tokens), cacheRead: count(usage.cache_read_input_tokens), cacheWrite: count(usage.cache_creation_input_tokens), output: count(usage.output_tokens) } });
    }
    timeline.events += events.length;
    events.sort((a, b) => a.at - b.at);
    let turn: { last: number; model: string | null } | null = null;
    let current: string | null = null;
    for (const event of events) {
      if (event.kind === 'prompt') { turn = { last: event.at, model: current }; continue; }
      if (event.kind === 'compaction') { timeline.segments.push({ start: event.at - event.durationMs, end: event.at, model: turn?.model ?? current, main: log.main }); continue; }
      turn ??= { last: event.at, model: current };
      if (event.at > turn.last && !event.person) timeline.segments.push({ start: turn.last, end: event.at, model: event.model ?? turn.model, main: log.main });
      turn.last = Math.max(turn.last, event.at);
      if (!event.model) continue;
      turn.model = current = event.model;
      if (log.main && event.at <= at && (!timeline.latest || event.at >= timeline.latest.at)) timeline.latest = { at: event.at, model: event.model };
    }
    const end = events.at(-1);
    if (live && turn && end && at > turn.last && !(end.kind === 'activity' && (end.closes || end.asks))) timeline.segments.push({ start: turn.last, end: at, model: turn.model, main: log.main });
  }
  timeline.spends = [...responses.values()];
  return timeline;
}

/** The parts of a Codex line that timing reads. */
interface CodexLine {
  type?: unknown; timestamp?: unknown;
  payload?: { type?: unknown; turn_id?: unknown; model?: unknown; started_at?: unknown; call_id?: unknown; info?: { total_token_usage?: unknown; last_token_usage?: unknown } | null } | null;
}
/** Codex lines name their type first; only turns, their models, token counts and questions to the person are read. */
const codexWanted = /"type":"(?:turn_context"|event_msg","payload":\{"type":"(?:task_started|task_complete|turn_aborted|token_count)"|response_item","payload":\{"type":"function_call","name":"request_user_input")/;
/** A tool's output, by its call: only the start of the line is looked at, never the output. */
const codexOutput = /^\{"timestamp":"([^"]+)",(?:"ordinal":\d+,)?"type":"response_item","payload":\{"type":"function_call_output","call_id":"([^"]+)"/;
interface CodexCount { input: number; cached: number; written: number; output: number }
function codexCount(value: unknown): CodexCount | null {
  if (!value || typeof value !== 'object') return null;
  const usage = value as Record<string, unknown>;
  return { input: count(usage.input_tokens), cached: count(usage.cached_input_tokens), written: count(usage.cache_write_input_tokens), output: count(usage.output_tokens) };
}
/** Codex counts cached and cache-written input inside input_tokens. */
const codexKinds = (step: CodexCount): TokenKinds => ({ input: Math.max(0, step.input - step.cached - step.written), cacheRead: step.cached, cacheWrite: step.written, output: step.output });

/**
 * Codex: a turn runs from task_started to task_complete or turn_aborted, with the model its
 * turn_context names, except while it waits for the person to answer a question; an unfinished
 * turn ends at its last event, or, live, now. Tokens are the increases of the thread's running
 * count, each spent by the turn under way.
 */
async function codexTimeline(files: LogFile[], at: number, live: boolean): Promise<Timeline> {
  const timeline: Timeline = { segments: [], spends: [], latest: null, events: 0 };
  const newest = files.filter(file => file.main).sort((a, b) => b.modified - a.modified)[0];
  for (const log of files) {
    const models = new Map<string, string>();
    const asked = new Map<string, number>();
    let open: { turn: string; start: number } | null = null;
    let current: string | null = null, last = Number.NaN, total: CodexCount | null = null;
    const finish = (turn: { turn: string; start: number }, end: number) => {
      if (end > turn.start) timeline.segments.push({ start: turn.start, end, model: models.get(turn.turn) ?? current, main: log.main });
      return null;
    };
    for await (const text of lines(log.file)) {
      const head = text.slice(0, 320);
      const answer = codexOutput.exec(head);
      if (answer) {
        // The person answered: the turn worked until it asked and resumes now.
        const asking = asked.get(answer[2]), moment = Date.parse(answer[1]);
        if (Number.isNaN(moment)) continue;
        if (open && asking !== undefined && moment >= asking) { finish(open, asking); open.start = moment; }
        last = moment;
        continue;
      }
      if (!codexWanted.test(head)) continue;
      const line = objectOf(text) as CodexLine | null;
      const moment = timeOf(line?.timestamp), payload = line?.payload;
      if (!line || Number.isNaN(moment) || !payload || typeof payload !== 'object') continue;
      timeline.events++;
      if (line.type === 'response_item') { if (typeof payload.call_id === 'string') asked.set(payload.call_id, moment); }
      else if (line.type === 'turn_context') {
        const model = modelOf(payload.model);
        if (!model) continue;
        if (typeof payload.turn_id === 'string') models.set(payload.turn_id, model);
        current = model;
        if (log.main && moment <= at && (!timeline.latest || moment >= timeline.latest.at)) timeline.latest = { at: moment, model };
      } else if (payload.type === 'task_started' && typeof payload.turn_id === 'string') {
        if (open) open = finish(open, last);
        open = { turn: payload.turn_id, start: moment };
      } else if (payload.type === 'task_complete' || payload.type === 'turn_aborted') {
        if (open && open.turn === payload.turn_id) open = finish(open, moment);
        else if (!open && typeof payload.turn_id === 'string' && typeof payload.started_at === 'number') finish({ turn: payload.turn_id, start: Math.min(moment, payload.started_at * 1000) }, moment);
      } else if (payload.type === 'token_count') {
        const running = codexCount(payload.info?.total_token_usage);
        if (!running) continue;
        // A file's first count, or one lower than before, is taken from its last response alone:
        // a later part of a thread continues the running count.
        const step = total === null || running.input < total.input || running.output < total.output ? codexCount(payload.info?.last_token_usage)
          : { input: running.input - total.input, cached: Math.max(0, running.cached - total.cached), written: Math.max(0, running.written - total.written), output: running.output - total.output };
        total = running;
        if (step && step.input + step.output > 0) timeline.spends.push({ at: moment, model: (open && models.get(open.turn)) ?? current, tokens: codexKinds(step) });
      }
      last = moment;
    }
    // A thread's earlier parts were left behind; a subagent's thread has one.
    if (open) finish(open, live && (log === newest || !log.main) ? Math.max(at, last) : last);
  }
  return timeline;
}

/** Total length of the segments' union inside (from, to]. */
function covered(segments: Segment[], from: number, to: number) {
  const parts = segments.map(segment => [Math.max(segment.start, from), Math.min(segment.end, to)]).filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  let total = 0, start = 0, end = Number.NEGATIVE_INFINITY;
  for (const [partStart, partEnd] of parts) {
    if (partStart > end) { if (end > start) total += end - start; start = partStart; end = partEnd; }
    else end = Math.max(end, partEnd);
  }
  return end > start ? total + end - start : total;
}

/**
 * Measure a session's working time and tokens in (since, at]. Without `since` (the session's first
 * report on a work item, its starting point) only the main model is read. `live` means the report
 * comes from inside the session, so a turn still under way runs until now.
 */
export async function measureSession(logs: SessionLogs, interval: { since: number | null; at: number; live?: boolean }): Promise<SessionMeasure> {
  const { since, at } = interval;
  // Logs last written before the interval add nothing to it; the main log still names the model.
  const files = logs.files.filter(file => file.main || (since !== null && file.modified >= since));
  if (logs.harness === 'codex' && since !== null) files.push(...await codexHelpers(logs, since));
  const live = interval.live ?? false;
  const timeline = logs.harness === 'claude-code' ? await claudeTimeline(files, at, live) : await codexTimeline(files, at, live);
  if (!timeline.events) throw new Error('its log has nothing Atlas can read');
  const from = since ?? at;
  const usage = new Map<string, ModelMeasure>();
  const entry = (model: string) => { let found = usage.get(model); if (!found) usage.set(model, found = { model, agentMs: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }); return found; };
  const named = [...new Set(timeline.segments.map(segment => segment.model))].filter((model): model is string => model !== null);
  const time = (model: string, main: boolean) => covered(timeline.segments.filter(segment => segment.model === model && (!main || segment.main)), from, at);
  for (const model of named) { const agentMs = time(model, false); if (agentMs) entry(model).agentMs = agentMs; }
  for (const spend of timeline.spends) {
    if (spend.at <= from || spend.at > at || !spend.model) continue;
    const used = entry(spend.model);
    used.input += spend.tokens.input; used.cacheRead += spend.tokens.cacheRead; used.cacheWrite += spend.tokens.cacheWrite; used.output += spend.tokens.output;
  }
  const tokens = (item: TokenKinds) => item.input + item.cacheRead + item.cacheWrite + item.output;
  const models = [...usage.values()].sort((a, b) => b.agentMs - a.agentMs || tokens(b) - tokens(a) || a.model.localeCompare(b.model));
  const main = named.map(model => ({ model, agentMs: time(model, true) })).filter(item => item.agentMs > 0).sort((a, b) => b.agentMs - a.agentMs)[0];
  return { harness: logs.harness, session: logs.session, agentMs: covered(timeline.segments, from, at), models, mainModel: main?.model ?? timeline.latest?.model ?? null };
}
