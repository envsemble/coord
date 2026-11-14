// Agent time and tokens from the agent's own session log. `coord work report` runs inside the agent's
// harness, which names its session in the environment and keeps a log of it on this computer:
// - Claude Code: <config>/projects/<project>/<session>.jsonl, its subagents' logs in
//   <project>/<session>/subagents/agent-<id>.jsonl (<config> is CLAUDE_CONFIG_DIR, else ~/.claude);
// - Codex: <home>/sessions/YYYY/MM/DD/rollout-<local time>-<thread>[_<part>].jsonl[.zst] (compressed), or
//   <home>/archived_sessions/ (<home> is CODEX_HOME, else ~/.codex); its subagents are threads of
//   their own whose first line names it.
// A hook names the log itself (its transcript path), which is read with the logs beside it.
// The agent works from each prompt until the last activity of that turn (its output, tool calls and
// their results), not while it waits for the person. Each agent, the main one and each helper, is
// measured on its own and their times add up, also while they work at once; when each one worked
// is kept too, so the time at least one of them worked can be told. Logs are only read, line by
// line; nothing but numbers, times and model and agent identifiers leaves them, and a line that is
// not understood is skipped, never fatal.
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, type Dirent } from 'node:fs';
import { pipeline } from 'node:stream';
import { createZstdDecompress } from 'node:zlib';
import { open, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mergeSpans, modelPattern, type MeasuredEffort, type MeasuredInterval, type MeasuredSubagent } from './reports.ts';
import type { TokenKinds } from '../types.ts';

export type Harness = 'claude-code' | 'codex';
/** One model's share of a measured interval: the busy time of every agent that worked with it, added up, and the tokens of its responses. */
export interface ModelMeasure extends TokenKinds { model: string; agentMs: number }
export interface SessionMeasure {
  harness: Harness; session: string;
  /** Working time in the interval, every agent added up: the main agent's own and each helper's, also while they work at once. */
  agentMs: number;
  /** Most working time first. */
  models: ModelMeasure[];
  /** The model that did most of the main agent's work in the interval, else the latest it used. */
  mainModel: string | null;
  /** Each subagent that worked or spent tokens in the interval, most working time first. */
  subagents: MeasuredSubagent[];
  /** When each agent worked in the interval (the main agent's are `agent` null), its stretches merged, in time order. */
  intervals: MeasuredInterval[];
  /** Each agent's time and tokens by model and reasoning effort, where its log names the effort. */
  efforts: MeasuredEffort[];
}
/** A session to measure; without a harness, both harnesses' logs are searched. */
export interface SessionCandidate { harness: Harness | null; session: string }
export interface LogOptions {
  /** Where the harnesses keep their logs: CLAUDE_CONFIG_DIR and CODEX_HOME. */
  environment?: NodeJS.ProcessEnv;
  /** The home folder holding ~/.claude and ~/.codex when those are not set. */
  home?: string;
}
/** A log of the session: its own (agent null) or a subagent's, named by the subagent's identifier. */
interface LogFile { file: string; modified: number; agent: string | null }
export interface SessionLogs {
  /** The session measured: for a Codex subagent's thread, the root session it belongs to. */
  harness: Harness; session: string; files: LogFile[];
  /** Codex: other threads' rollouts since this thread started, among them its subagents'. */
  others: string[];
  /** The session that was asked for. */
  requested: string;
}

/** Session identifiers as harnesses write them (UUIDs): never a path, a dot or a drive. */
const sessionName = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
/** A compaction longer than this is not believed. */
const compactionLimit = 6 * 60 * 60 * 1000;
/**
 * A turn under way at a live report runs until it only if its log was written this recently: a
 * helper silent for longer has most likely stopped (a foreground command times out within ten minutes).
 */
const runOnLimit = 15 * 60 * 1000;
/** A Codex turn that started this long before its line was copied from another thread. */
const replayed = 5000;

/** The sessions the environment names: Claude Code's, then Codex's. */
export function harnessSessions(environment: NodeJS.ProcessEnv = process.env): SessionCandidate[] {
  const found: SessionCandidate[] = [];
  const claude = environment.CLAUDE_CODE_SESSION_ID ?? '', codex = environment.CODEX_THREAD_ID ?? '';
  if (sessionName.test(claude)) found.push({ harness: 'claude-code', session: claude });
  if (sessionName.test(codex)) found.push({ harness: 'codex', session: codex });
  return found;
}

const entries = (folder: string): Promise<Dirent[]> => readdir(folder, { withFileTypes: true }).catch(() => []);
async function logFile(file: string, agent: string | null): Promise<LogFile | null> {
  const info = await stat(file).catch(() => null);
  return info?.isFile() ? { file, modified: info.mtimeMs, agent } : null;
}
const present = <T>(values: (T | null)[]) => values.filter((value): value is T => value !== null);

/** Claude Code: a project folder's log of the session and its subagents' logs. Names match exactly. */
async function claudeFiles(folder: string, session: string): Promise<LogFile[]> {
  const found: Promise<LogFile | null>[] = [];
  for (const entry of await entries(folder)) {
    if (entry.isFile() && entry.name === session + '.jsonl') found.push(logFile(path.join(folder, entry.name), null));
    else if (entry.isDirectory() && entry.name === session) {
      const subagents = path.join(folder, entry.name, 'subagents');
      for (const helper of await entries(subagents)) {
        const agent = helper.isFile() ? /^agent-([A-Za-z0-9_-]+)\.jsonl$/.exec(helper.name)?.[1].slice(0, 64) : undefined;
        if (agent) found.push(logFile(path.join(subagents, helper.name), agent));
      }
    }
  }
  return present(await Promise.all(found));
}
const claudeSession = (session: string, files: LogFile[]): SessionLogs | null => files.some(file => file.agent === null) ? { harness: 'claude-code', session, files, others: [], requested: session } : null;

/** Claude Code: the session's log in any project folder, and its subagents' logs. */
async function claudeLogs(session: string, config: string): Promise<SessionLogs | null> {
  const projects = path.join(config, 'projects');
  const files: LogFile[] = [];
  for (const project of await entries(projects)) if (project.isDirectory()) files.push(...await claudeFiles(path.join(projects, project.name), session));
  return claudeSession(session, files);
}

/** rollout-<local time>-<thread>[_<part>].jsonl; a thread's later parts continue it. */
const rolloutName = /^rollout-((\d{4}-\d{2}-\d{2})T\d{2}-\d{2}-\d{2})-([A-Za-z0-9-]+?)(?:_[A-Za-z0-9-]+)?\.jsonl(?:\.zst)?$/;

/**
 * Codex: every rollout of the thread, in the dated folders and the archive. A subagent's thread
 * names the root session it belongs to in its first line; it is measured, and reports, as part of
 * that session, so a helper's report and its parent's never count the same work twice.
 */
async function codexLogs(thread: string, home: string, resolve = true): Promise<SessionLogs | null> {
  const sessions = path.join(home, 'sessions');
  const numbered = async (folder: string, digits: number) => (await entries(folder)).filter(entry => entry.isDirectory() && entry.name.length === digits && /^\d+$/.test(entry.name)).map(entry => entry.name);
  const folders = [path.join(home, 'archived_sessions')];
  for (const year of await numbered(sessions, 4)) for (const month of await numbered(path.join(sessions, year), 2)) for (const day of await numbered(path.join(sessions, year, month), 2)) folders.push(path.join(sessions, year, month, day));
  const main: Promise<LogFile | null>[] = [];
  const others: { file: string; day: string }[] = [];
  let first = '9999', earliest: { file: string; time: string } | null = null;
  for (const folder of folders) {
    for (const entry of await entries(folder)) {
      const match = entry.isFile() ? rolloutName.exec(entry.name) : null;
      if (!match) continue;
      const file = path.join(folder, entry.name);
      if (match[3] !== thread) { others.push({ file, day: match[2] }); continue; }
      main.push(logFile(file, null));
      if (match[2] < first) first = match[2];
      if (!earliest || match[1] < earliest.time) earliest = { file, time: match[1] };
    }
  }
  const files = present(await Promise.all(main));
  if (!files.length) return null;
  if (resolve && earliest) {
    let meta: SessionMeta | null = null;
    try { meta = JSON.parse(await firstLine(earliest.file) ?? 'null') as SessionMeta | null; } catch { /* Not a rollout Coord can read. */ }
    const root = meta?.type === 'session_meta' ? meta.payload?.session_id : null;
    if (typeof root === 'string' && root !== thread && sessionName.test(root)) {
      const logs = await codexLogs(root, home, false);
      if (logs) return { ...logs, requested: thread };
    }
  }
  // A subagent starts after its parent: older rollouts are someone else's.
  return { harness: 'codex', session: thread, files, others: others.filter(other => other.day >= first).map(other => other.file), requested: thread };
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

/**
 * The folder a session started in, where its harness resumes it, as the start of its log says (its
 * first 64 KB): the first Claude Code entry that names its `cwd`, or a Codex rollout's session meta.
 * Null when the log does not say.
 */
export async function sessionFolder(transcript: string): Promise<string | null> {
  const rollout = rolloutName.test(path.basename(transcript));
  let read = 0;
  try {
    for await (const text of lines(transcript, 64 * 1024)) {
      const entry = objectOf(text);
      const cwd = rollout ? (entry?.type === 'session_meta' ? (entry.payload as { cwd?: unknown } | undefined)?.cwd : undefined) : entry?.cwd;
      if (typeof cwd === 'string' && path.isAbsolute(cwd)) return cwd;
      // A rollout's first line is its meta; Claude Code names its folder within the first entries.
      if (rollout || ++read >= 50) break;
    }
  } catch { /* A log that cannot be read says nothing. */ }
  return null;
}

/** How much of a log's end is read for the turn's last message and the session's title. */
const tailLimit = 256 * 1024;
/**
 * From the end of a Claude Code log (its last 256 KB): the text of the last response, and the
 * session's latest title (`ai-title`, which Claude Code writes again as the conversation goes on).
 * A compressed Codex rollout is not read: both are null.
 */
export async function logTail(transcript: string): Promise<{ message: string | null; title: string | null }> {
  const found = { message: null as string | null, title: null as string | null };
  if (!transcript.endsWith('.jsonl')) return found;
  const handle = await open(transcript, 'r').catch(() => null);
  if (!handle) return found;
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, tailLimit);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    for (const line of buffer.toString('utf8').split('\n').reverse()) {
      if (found.message !== null && found.title !== null) break;
      const titled = found.title === null && line.includes('"ai-title"'), said = found.message === null && line.includes('"assistant"');
      if (!titled && !said) continue;
      const entry = objectOf(line) as { type?: unknown; aiTitle?: unknown; message?: { content?: unknown } } | null;
      if (entry?.type === 'ai-title' && typeof entry.aiTitle === 'string' && entry.aiTitle.trim()) found.title = entry.aiTitle.trim().slice(0, 200);
      if (entry?.type === 'assistant' && found.message === null) {
        const parts = Array.isArray(entry.message?.content) ? entry.message.content as { type?: unknown; text?: unknown }[] : [];
        const text = parts.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text as string).join('\n\n').trim();
        if (text) found.message = text;
      }
    }
    return found;
  } catch { return found; } finally { await handle.close(); }
}

/** A Codex thread's name, from `<CODEX_HOME>/session_index.jsonl` (its latest entry); null without one. */
export async function codexThreadName(thread: string, options: LogOptions = {}): Promise<string | null> {
  const home = path.resolve((options.environment ?? process.env).CODEX_HOME || path.join(options.home ?? os.homedir(), '.codex'));
  let name: string | null = null;
  try {
    for await (const text of lines(path.join(home, 'session_index.jsonl'))) {
      if (!text.includes(thread)) continue;
      const entry = objectOf(text) as { id?: unknown; thread_name?: unknown } | null;
      if (entry?.id === thread && typeof entry.thread_name === 'string' && entry.thread_name.trim()) name = entry.thread_name.trim().slice(0, 200);
    }
  } catch { /* No index. */ }
  return name;
}

/**
 * The logs of the session whose log a hook names (its transcript path), with the logs beside it: a
 * Claude Code session's subagents (also when the path is a subagent's own log), or a Codex thread's
 * other parts and helpers in the folders above it. Null when the file is neither harness's log.
 */
export async function transcriptLogs(transcript: string): Promise<SessionLogs | null> {
  const file = path.resolve(transcript), name = path.basename(file);
  let folder = path.dirname(file);
  const rollout = rolloutName.exec(name);
  if (rollout) {
    // <home>/sessions/YYYY/MM/DD/ or <home>/archived_sessions/; elsewhere, the rollout alone.
    const dated = folder.split(path.sep).slice(-4).join('/');
    const home = path.basename(folder) === 'archived_sessions' ? path.dirname(folder) : /^sessions\/\d{4}\/\d{2}\/\d{2}$/.test(dated) ? path.resolve(folder, '..', '..', '..', '..') : null;
    const logs = home && await codexLogs(rollout[3], home);
    if (logs) return logs;
    const own = await logFile(file, null);
    return own && { harness: 'codex', session: rollout[3], files: [own], others: [], requested: rollout[3] };
  }
  let session = /^(.+)\.jsonl$/.exec(name)?.[1] ?? '';
  if (path.basename(folder) === 'subagents' && session.startsWith('agent-')) { session = path.basename(path.dirname(folder)); folder = path.dirname(path.dirname(folder)); }
  return sessionName.test(session) ? claudeSession(session, await claudeFiles(folder, session)) : null;
}

/** The start of a file: its first line, up to a limit (a Codex rollout's first line is ~25 KB). */
async function firstLine(file: string, limit = 1 << 20): Promise<string | null> {
  if (compressed(file)) {
    try { for await (const line of lines(file)) return line.length <= limit ? line : null; } catch { /* Not a stream Coord can read. */ }
    return null;
  }
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
  const recent = present(await Promise.all(logs.others.map(file => logFile(file, null)))).filter(file => file.modified >= since);
  const threads = await Promise.all(recent.map(async file => {
    let meta: SessionMeta['payload'];
    try { const value = JSON.parse(await firstLine(file.file) ?? 'null') as SessionMeta | null; if (value?.type === 'session_meta') meta = value.payload; } catch { /* Not a rollout Coord can read. */ }
    return { file, id: meta?.id, root: meta?.session_id, parent: meta?.parent_thread_id ?? meta?.source?.subagent?.thread_spawn?.parent_thread_id };
  }));
  const family = new Set<unknown>([logs.session]);
  const helpers: LogFile[] = [];
  for (let grown = true; grown;) {
    grown = false;
    for (const thread of threads) {
      if (typeof thread.id !== 'string' || family.has(thread.id) || !(thread.root === logs.session || family.has(thread.parent))) continue;
      family.add(thread.id);
      helpers.push({ ...thread.file, agent: thread.id });
      grown = true;
    }
  }
  return helpers;
}

/** Codex keeps its rollouts compressed with Zstandard (`.jsonl.zst`). */
const compressed = (file: string) => file.endsWith('.zst');

/**
 * A file's lines, split at line feeds only: JSON text may hold U+2028, where line readers also split.
 * A compressed rollout is read through its decompression; one still being written ends where its
 * complete data does. With `limit`, only the file's first bytes are read.
 */
async function* lines(file: string, limit = Number.POSITIVE_INFINITY): AsyncGenerator<string> {
  let pending: Buffer[] = [];
  const read = createReadStream(file, { highWaterMark: Math.min(1 << 20, limit), ...Number.isFinite(limit) && { end: limit - 1 } });
  // A pipeline passes the file's errors (a log that vanished) on to the decompression, which ends the reading.
  const source = compressed(file) ? pipeline(read, createZstdDecompress(), () => undefined) : read;
  try {
    for await (const chunk of source as AsyncIterable<Buffer>) {
      let start = 0;
      for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
        pending.push(chunk.subarray(start, end));
        yield (pending.length === 1 ? pending[0] : Buffer.concat(pending)).toString('utf8');
        pending = [];
        start = end + 1;
      }
      if (start < chunk.length) pending.push(chunk.subarray(start));
    }
  } catch (error) {
    // The end of a compressed stream still being written is not complete yet.
    if (!compressed(file)) throw error;
    pending = [];
  } finally { read.destroy(); }
  if (pending.length) yield Buffer.concat(pending).toString('utf8');
}

/**
 * An uncompressed log's lines from a byte offset, each with the offset after its line feed; a last
 * line without one (still being written) comes with -1.
 */
async function* linesFrom(file: string, start: number): AsyncGenerator<{ text: string; end: number }> {
  let pending: Buffer[] = [], position = start;
  const read = createReadStream(file, { start, highWaterMark: 1 << 20 });
  try {
    for await (const chunk of read as AsyncIterable<Buffer>) {
      let from = 0;
      for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, from)) {
        pending.push(chunk.subarray(from, end));
        yield { text: (pending.length === 1 ? pending[0] : Buffer.concat(pending)).toString('utf8'), end: position + end + 1 };
        pending = [];
        from = end + 1;
      }
      if (from < chunk.length) pending.push(chunk.subarray(from));
      position += chunk.length;
    }
  } finally { read.destroy(); }
  if (pending.length) yield { text: Buffer.concat(pending).toString('utf8'), end: -1 };
}

// ---- Cursors: what reading a log found so far, kept so the next measurement reads only what it gained

/**
 * How one harness's log is read: line by line into a state, which a cursor keeps (`save` makes it
 * plain JSON, `load` restores it). The state never depends on the interval measured or on which
 * agent's log it is, so any later measurement can go on from it.
 */
interface LogReader<S> { kind: string; fresh: () => S; step: (state: S, text: string) => void; save: (state: S) => unknown; load: (value: never) => S }
interface Cursor { version: number; kind: string; file: string; offset: number; size: number; modified: number; check: string; state: unknown }
/** Changes whenever a reader's state or the way it reads does, so older cursors are read afresh. */
const cursorVersion = 1;
/** The bytes before a cursor's offset that must still be there for the log to be read on from it. */
const checkBytes = 256;

const cursorFile = (cache: string, kind: string, file: string) => path.join(cache, createHash('sha256').update(kind + '\0' + file).digest('hex').slice(0, 32) + '.json');
function readCursor(file: string): Cursor | null {
  try { return JSON.parse(readFileSync(file, 'utf8')) as Cursor; } catch { return null; }
}
/** Write a cursor whole (hooks of one session may read the same log at once: the last one written stays); never throws. */
function writeCursor(file: string, cursor: Cursor) {
  const temporary = file + '.' + process.pid + '-' + Math.random().toString(36).slice(2);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(temporary, JSON.stringify(cursor));
    renameSync(temporary, file);
  } catch { rmSync(temporary, { force: true }); }
}
/** The bytes just before an offset, as a cursor checks them. */
async function bytesBefore(file: string, offset: number): Promise<string> {
  const length = Math.min(offset, checkBytes);
  if (!length) return '';
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset - length);
    return buffer.subarray(0, bytesRead).toString('base64');
  } finally { await handle.close(); }
}

/**
 * Read a log into its reader's state, going on from its cursor in `cache` (a folder) when there is
 * one: harnesses only append to a log, so only what it gained since is read. A log whose bytes before
 * the cursor changed (rewritten or shortened) is read from its start, and a compressed one (never
 * appended to) whenever it changed. A last line still being written is read, but not kept.
 */
async function readLog<S>(log: LogFile, reader: LogReader<S>, cache?: string): Promise<S> {
  const file = path.resolve(log.file);
  const target = cache ? cursorFile(cache, reader.kind, file) : null;
  const saved = target ? readCursor(target) : null;
  const usable = saved?.version === cursorVersion && saved.kind === reader.kind && saved.file === file;
  if (compressed(file)) {
    const info = await stat(file).catch(() => null);
    if (usable && info && saved.size === info.size && saved.modified === info.mtimeMs) return reader.load(saved.state as never);
    const state = reader.fresh();
    for await (const text of lines(file)) reader.step(state, text);
    if (target && info) writeCursor(target, { version: cursorVersion, kind: reader.kind, file, offset: info.size, size: info.size, modified: info.mtimeMs, check: '', state: reader.save(state) });
    return state;
  }
  let state = reader.fresh(), offset = 0;
  if (usable && await bytesBefore(file, saved.offset).catch(() => null) === saved.check) {
    state = reader.load(saved.state as never);
    offset = saved.offset;
  }
  const start = offset;
  let tail: string | null = null;
  for await (const line of linesFrom(file, offset)) {
    if (line.end === -1) tail = line.text;
    else { reader.step(state, line.text); offset = line.end; }
  }
  if (target && offset !== start) writeCursor(target, { version: cursorVersion, kind: reader.kind, file, offset, size: offset, modified: 0, check: await bytesBefore(file, offset), state: reader.save(state) });
  if (tail === null) return state;
  const read = reader.load(structuredClone(reader.save(state)) as never);
  reader.step(read, tail);
  return read;
}

/** A busy stretch, credited to the model at work (null when unknown) and its agent (null for the session's own). */
interface Segment { start: number; end: number; model: string | null; effort: string | null; agent: string | null }
/** Tokens spent at a moment: one response (Claude Code) or one increase of the running count (Codex). */
interface Spend { at: number; model: string | null; effort: string | null; agent: string | null; tokens: TokenKinds }
interface Timeline { segments: Segment[]; spends: Spend[]; latest: { at: number; model: string } | null; events: number }

const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
/** A model identifier as reports accept it; anything else counts without a model. */
const modelOf = (value: unknown) => typeof value === 'string' && value !== '<synthetic>' && modelPattern.test(value) ? value : null;
/** A reasoning effort as harnesses log it (`high`, `medium`, `xhigh`…); anything else is none. */
const effortOf = (value: unknown) => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/i.test(value) ? value.toLowerCase() : null;
const timeOf = (value: unknown) => typeof value === 'string' ? Date.parse(value) : Number.NaN;
const objectOf = (text: string): Record<string, unknown> | null => {
  try { const value: unknown = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
};

/** The parts of a Claude Code line that timing reads; anything may be missing or of another type. */
interface ClaudeLine {
  type?: unknown; timestamp?: unknown; isMeta?: unknown; isCompactSummary?: unknown; subtype?: unknown; effort?: unknown; perTurnEffort?: unknown;
  compactMetadata?: { durationMs?: unknown } | null;
  permissionDecision?: { source?: unknown } | null; origin?: { kind?: unknown } | null;
  message?: { id?: unknown; model?: unknown; content?: unknown; stop_reason?: unknown; usage?: Record<string, unknown> | null } | null;
}
/**
 * A tool result after the person's answer or decision closes a stretch that was theirs, not the
 * agent's. A response that ends its turn closes it; one that asks the person leaves it waiting.
 */
type ClaudeEvent = { at: number } & ({ kind: 'prompt' } | { kind: 'activity'; model: string | null; effort?: string | null; person?: boolean; closes?: boolean; asks?: boolean } | { kind: 'compaction'; durationMs: number });
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
    // Claude Code logs the turn's reasoning effort on each response.
    return { at, kind: 'activity', model: modelOf(line.message?.model), effort: effortOf(line.perTurnEffort) ?? effortOf(line.effort), closes: typeof stop === 'string' && stop !== 'tool_use', asks };
  }
  if (line.type === 'system') {
    const durationMs = line.subtype === 'compact_boundary' ? count(line.compactMetadata?.durationMs) : 0;
    return durationMs && durationMs <= compactionLimit ? { at, kind: 'compaction', durationMs } : null;
  }
  // Injected context and a compaction's summary are not prompts, but a hidden message that resumes
  // the agent (from its coordinator, or a finished background task) is. Tool results are the turn at
  // work, unless the person answered the tool or decided in a permission prompt that it may run.
  if (line.type !== 'user' || line.isCompactSummary === true || (line.isMeta === true && typeof line.origin?.kind !== 'string')) return null;
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
 * produced it, or that called the tool it waited for. A response that ends the turn closes it, so
 * nothing joins it across the wait that follows. A compaction is busy for its duration. Live, a turn
 * still under way (not waiting for the person, and recently written) runs until now.
 */
/**
 * What a Claude Code log says, in its order: its events, the questions to the person it asked (by
 * tool call), and its responses' tokens by message (`lines` counts its lines, which name a response
 * without an identifier).
 */
interface ClaudeRead { lines: number; events: ClaudeEvent[]; asked: Set<unknown>; responses: Map<string, Spend> }
type SavedEvent = [number, 0] | [number, 1, string | null, string | null, number] | [number, 2, number];
type SavedSpend = [number, string | null, string | null, number, number, number, number];
const saveSpend = (spend: Spend): SavedSpend => [spend.at, spend.model, spend.effort, spend.tokens.input, spend.tokens.cacheRead, spend.tokens.cacheWrite, spend.tokens.output];
const loadSpend = ([at, model, effort, input, cacheRead, cacheWrite, output]: SavedSpend, agent: string | null): Spend => ({ at, model, effort, agent, tokens: { input, cacheRead, cacheWrite, output } });

function claudeReader(log: LogFile): LogReader<ClaudeRead> {
  return {
    kind: 'claude',
    fresh: () => ({ lines: 0, events: [], asked: new Set(), responses: new Map() }),
    step: (state, text) => {
      const number = ++state.lines;
      // Titles, modes and other bookkeeping carry no time.
      if (!text.includes('"timestamp"')) return;
      const line = objectOf(text) as ClaudeLine | null;
      const event = line && claudeEvent(line, state.asked);
      if (!event) return;
      state.events.push(event);
      const usage = line.message?.usage, model = modelOf(line.message?.model);
      if (line.type !== 'assistant' || !model || !usage || typeof usage !== 'object') return;
      const id = line.message?.id, key = typeof id === 'string' ? id : log.file + '#' + number;
      state.responses.set(key, { at: Math.min(state.responses.get(key)?.at ?? event.at, event.at), model, effort: event.kind === 'activity' ? event.effort ?? null : null, agent: log.agent, tokens: { input: count(usage.input_tokens), cacheRead: count(usage.cache_read_input_tokens), cacheWrite: count(usage.cache_creation_input_tokens), output: count(usage.output_tokens) } });
    },
    save: state => ({
      lines: state.lines,
      events: state.events.map((event): SavedEvent => event.kind === 'prompt' ? [event.at, 0] : event.kind === 'compaction' ? [event.at, 2, event.durationMs]
        : [event.at, 1, event.model, event.effort ?? null, (event.person ? 1 : 0) | (event.closes ? 2 : 0) | (event.asks ? 4 : 0)]),
      // A question's tool call may lack its identifier: a result without one answers it.
      asked: [...state.asked].filter(id => id === undefined || id === null || typeof id === 'string' || typeof id === 'number').map(id => id === undefined ? { undefined: true } : id),
      responses: [...state.responses].map(([key, spend]) => [key, saveSpend(spend)]),
    }),
    load: (saved: { lines: number; events: SavedEvent[]; asked: unknown[]; responses: [string, SavedSpend][] }) => ({
      lines: saved.lines,
      events: saved.events.map((event): ClaudeEvent => event[1] === 0 ? { at: event[0], kind: 'prompt' } : event[1] === 2 ? { at: event[0], kind: 'compaction', durationMs: event[2] }
        : { at: event[0], kind: 'activity', model: event[2], effort: event[3], person: (event[4] & 1) !== 0, closes: (event[4] & 2) !== 0, asks: (event[4] & 4) !== 0 }),
      asked: new Set(saved.asked.map(id => id && typeof id === 'object' ? undefined : id)),
      responses: new Map(saved.responses.map(([key, spend]) => [key, loadSpend(spend, log.agent)])),
    }),
  };
}

async function claudeTimeline(files: LogFile[], at: number, live: boolean, cache?: string): Promise<Timeline> {
  const timeline: Timeline = { segments: [], spends: [], latest: null, events: 0 };
  // One response is written as several lines (one per content block): it belongs to the moment of
  // its first line, so a report between its lines counts it once, and its latest line has its usage.
  const responses = new Map<string, Spend>();
  const reads = await Promise.all(files.map(log => readLog(log, claudeReader(log), cache)));
  for (const [index, log] of files.entries()) {
    const read = reads[index];
    for (const [key, spend] of read.responses) responses.set(key, { ...spend, at: Math.min(responses.get(key)?.at ?? spend.at, spend.at) });
    // Sorted stably, so events at one moment stay in the log's order.
    const events = [...read.events];
    timeline.events += events.length;
    events.sort((a, b) => a.at - b.at);
    let turn: { last: number; model: string | null; effort: string | null } | null = null;
    let current: string | null = null, effort: string | null = null;
    for (const event of events) {
      if (event.kind === 'prompt') { turn = { last: event.at, model: current, effort }; continue; }
      if (event.kind === 'compaction') { timeline.segments.push({ start: event.at - event.durationMs, end: event.at, model: turn?.model ?? current, effort: turn?.effort ?? effort, agent: log.agent }); continue; }
      turn ??= { last: event.at, model: current, effort };
      if (event.at > turn.last && !event.person) timeline.segments.push({ start: turn.last, end: event.at, model: event.model ?? turn.model, effort: event.model ? event.effort ?? turn.effort : turn.effort, agent: log.agent });
      turn.last = Math.max(turn.last, event.at);
      if (event.model) {
        turn.model = current = event.model;
        turn.effort = effort = event.effort ?? turn.effort;
        if (log.agent === null && event.at <= at && (!timeline.latest || event.at >= timeline.latest.at)) timeline.latest = { at: event.at, model: event.model };
      }
      if (event.closes) turn = null;
    }
    const end = events.at(-1);
    if (live && turn && end && at > turn.last && at - turn.last <= runOnLimit && !(end.kind === 'activity' && end.asks)) timeline.segments.push({ start: turn.last, end: at, model: turn.model, effort: turn.effort, agent: log.agent });
  }
  timeline.spends = [...responses.values()];
  return timeline;
}

/** The parts of a Codex line that timing reads. */
interface CodexLine {
  type?: unknown; timestamp?: unknown;
  payload?: { type?: unknown; turn_id?: unknown; model?: unknown; effort?: unknown; collaboration_mode?: { settings?: { reasoning_effort?: unknown } | null } | null; started_at?: unknown; call_id?: unknown; info?: { total_token_usage?: unknown; last_token_usage?: unknown } | null } | null;
}
/** Codex lines name their type first; only turns, their models, token counts and questions to the person are read. */
const codexWanted = /"type":"(?:turn_context"|event_msg","payload":\{"type":"(?:task_started|task_complete|turn_aborted|token_count)"|response_item","payload":\{"type":"function_call",(?:"id":"[^"]*",)?"name":"request_user_input")/;
/** A tool's output, by its call: only the start of the line is looked at, never the output. */
const codexOutput = /^\{"timestamp":"([^"]+)",(?:"ordinal":\d+,)?"type":"response_item","payload":\{"type":"function_call_output",(?:"id":"[^"]*",)?"call_id":"([^"]+)"/;
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
 * turn ends at its last event, or, live and recently written, now. Tokens are the increases of the
 * thread's running count, each spent by the turn under way. A forked subagent's rollout starts with
 * a copy of its parent's history: copied turns started long before their lines, and the running
 * count they carry is only the fork's starting point.
 */
/**
 * What a Codex rollout says so far, in its order: each turn's model and effort, the questions to
 * the person (by call), the turn under way, the running token count, the finished turns' stretches,
 * the tokens spent and each turn context's model (for the latest one before a moment).
 */
interface CodexRead {
  models: Map<string, string>; efforts: Map<string, string>; asked: Map<string, number>; open: { turn: string; start: number } | null;
  current: string | null; effort: string | null; last: number; total: CodexCount | null; start: number; own: boolean;
  segments: Segment[]; spends: Spend[]; contexts: [number, string][]; events: number;
}
interface SavedCodex extends Omit<CodexRead, 'models' | 'efforts' | 'asked' | 'last' | 'start' | 'segments' | 'spends'> {
  models: [string, string][]; efforts: [string, string][]; asked: [string, number][]; last: number | null; start: number | null;
  segments: [number, number, string | null, string | null][]; spends: SavedSpend[];
}
/** A rollout's state names no agent: the same thread is the main agent of its own session and a helper of its parent's. */
const codexReader: LogReader<CodexRead> = {
  kind: 'codex',
  fresh: () => ({ models: new Map(), efforts: new Map(), asked: new Map(), open: null, current: null, effort: null, last: Number.NaN, total: null, start: Number.NaN, own: true, segments: [], spends: [], contexts: [], events: 0 }),
  step: (state, text) => {
    const finish = (turn: { turn: string; start: number }, end: number) => {
      if (end > turn.start) state.segments.push({ start: turn.start, end, model: state.models.get(turn.turn) ?? state.current, effort: state.efforts.get(turn.turn) ?? state.effort, agent: null });
      return null;
    };
    const head = text.slice(0, 320);
    if (Number.isNaN(state.start)) {
      // The first line: when the rollout began, and whether it forked another thread.
      state.start = Date.parse(/^\{"timestamp":"([^"]+)"/.exec(head)?.[1] ?? '');
      state.own = !text.includes('"forked_from_id":"');
    }
    const answer = codexOutput.exec(head);
    if (answer) {
      // The person answered: the turn worked until it asked and resumes now.
      const asking = state.asked.get(answer[2]), moment = Date.parse(answer[1]);
      if (Number.isNaN(moment)) return;
      if (state.open && asking !== undefined && moment >= asking) { finish(state.open, asking); state.open.start = moment; }
      state.last = moment;
      return;
    }
    if (!codexWanted.test(head)) return;
    const line = objectOf(text) as CodexLine | null;
    const moment = timeOf(line?.timestamp), payload = line?.payload;
    if (!line || Number.isNaN(moment) || !payload || typeof payload !== 'object') return;
    state.events++;
    if (line.type === 'response_item') { if (typeof payload.call_id === 'string') state.asked.set(payload.call_id, moment); }
    else if (line.type === 'turn_context') {
      const model = modelOf(payload.model);
      if (!model) return;
      // The turn's reasoning effort, where the turn context names it.
      const level = effortOf(payload.effort) ?? effortOf(payload.collaboration_mode?.settings?.reasoning_effort);
      if (typeof payload.turn_id === 'string') { state.models.set(payload.turn_id, model); if (level) state.efforts.set(payload.turn_id, level); }
      state.current = model;
      state.effort = level ?? state.effort;
      state.contexts.push([moment, model]);
    } else if (payload.type === 'task_started' && typeof payload.turn_id === 'string') {
      if (typeof payload.started_at === 'number' && payload.started_at * 1000 < moment - replayed) return;
      if (state.open) state.open = finish(state.open, state.last);
      state.open = { turn: payload.turn_id, start: moment };
      state.own = true;
    } else if (payload.type === 'task_complete' || payload.type === 'turn_aborted') {
      if (state.open && state.open.turn === payload.turn_id) state.open = finish(state.open, moment);
      // A turn whose start is not in this file counts only if it began in this file's time.
      else if (!state.open && typeof payload.turn_id === 'string' && typeof payload.started_at === 'number' && payload.started_at * 1000 >= state.start - replayed) finish({ turn: payload.turn_id, start: Math.min(moment, payload.started_at * 1000) }, moment);
    } else if (payload.type === 'token_count') {
      const running = codexCount(payload.info?.total_token_usage);
      if (!running) return;
      if (!state.own) { state.total = running; return; }
      // A file's first count, or one lower than before, is taken from its last response alone:
      // a later part of a thread continues the running count.
      const total = state.total;
      const step = total === null || running.input < total.input || running.output < total.output ? codexCount(payload.info?.last_token_usage)
        : { input: running.input - total.input, cached: Math.max(0, running.cached - total.cached), written: Math.max(0, running.written - total.written), output: running.output - total.output };
      state.total = running;
      const open = state.open;
      if (step && step.input + step.output > 0) state.spends.push({ at: moment, model: (open && state.models.get(open.turn)) ?? state.current, effort: (open && state.efforts.get(open.turn)) ?? state.effort, agent: null, tokens: codexKinds(step) });
    }
    state.last = moment;
  },
  save: (state): SavedCodex => ({
    ...state, models: [...state.models], efforts: [...state.efforts], asked: [...state.asked], open: state.open && { ...state.open },
    last: Number.isNaN(state.last) ? null : state.last, start: Number.isNaN(state.start) ? null : state.start,
    segments: state.segments.map((segment): [number, number, string | null, string | null] => [segment.start, segment.end, segment.model, segment.effort]), spends: state.spends.map(saveSpend), contexts: [...state.contexts],
  }),
  load: (saved: SavedCodex) => ({
    ...saved, models: new Map(saved.models), efforts: new Map(saved.efforts), asked: new Map(saved.asked), last: saved.last ?? Number.NaN, start: saved.start ?? Number.NaN,
    segments: saved.segments.map(([start, end, model, effort]) => ({ start, end, model, effort, agent: null })), spends: saved.spends.map(spend => loadSpend(spend, null)),
  }),
};

async function codexTimeline(files: LogFile[], at: number, live: boolean, cache?: string): Promise<Timeline> {
  const timeline: Timeline = { segments: [], spends: [], latest: null, events: 0 };
  const newest = files.filter(file => file.agent === null).sort((a, b) => b.modified - a.modified)[0];
  const reads = await Promise.all(files.map(log => readLog(log, codexReader, cache)));
  for (const [index, log] of files.entries()) {
    const read = reads[index];
    timeline.events += read.events;
    for (const segment of read.segments) timeline.segments.push({ ...segment, agent: log.agent });
    for (const spend of read.spends) timeline.spends.push({ ...spend, agent: log.agent });
    if (log.agent === null) for (const [moment, model] of read.contexts) if (moment <= at && (!timeline.latest || moment >= timeline.latest.at)) timeline.latest = { at: moment, model };
    // A thread's earlier parts were left behind; a subagent's thread has one.
    const open = read.open, end = live && (log === newest || log.agent !== null) && at - read.last <= runOnLimit ? Math.max(at, read.last) : read.last;
    if (open && end > open.start) timeline.segments.push({ start: open.start, end, model: read.models.get(open.turn) ?? read.current, effort: read.efforts.get(open.turn) ?? read.effort, agent: log.agent });
  }
  return timeline;
}

/** The segments' stretches inside (from, to], merged. */
const stretches = (segments: Segment[], from: number, to: number) => mergeSpans(segments.map(segment => [Math.max(segment.start, from), Math.min(segment.end, to)]));
/** Total length of the segments' union inside (from, to]. */
const covered = (segments: Segment[], from: number, to: number) => stretches(segments, from, to).reduce((total, [start, end]) => total + end - start, 0);

/**
 * Read a session's logs as far as an interval starting at `since` needs them: logs last written
 * before it add nothing to it, but the main log still names the model.
 */
async function sessionTimeline(logs: SessionLogs, since: number | null, at: number, live: boolean, cache?: string): Promise<Timeline> {
  const files = logs.files.filter(file => file.agent === null || (since !== null && file.modified >= since));
  if (logs.harness === 'codex' && since !== null) files.push(...await codexHelpers(logs, since));
  const timeline = logs.harness === 'claude-code' ? await claudeTimeline(files, at, live, cache) : await codexTimeline(files, at, live, cache);
  if (!timeline.events) throw new Error('its log has nothing Coord can read');
  return timeline;
}

/** The working time, tokens and intervals of each agent in (from, at] of a session's timeline. */
function measureTimeline(logs: SessionLogs, timeline: Timeline, from: number, at: number): SessionMeasure {
  const byModel = new Map<string, ModelMeasure>();
  const entry = (model: string) => { let found = byModel.get(model); if (!found) byModel.set(model, found = { model, agentMs: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }); return found; };
  // Each agent's segments in the interval (null: the session's own agent).
  const own = new Map<string | null, Segment[]>();
  for (const segment of timeline.segments) {
    if (segment.end <= from || segment.start >= at) continue;
    let list = own.get(segment.agent);
    if (!list) own.set(segment.agent, list = []);
    list.push(segment);
  }
  const named = [...new Set([...own.values()].flat().map(segment => segment.model))].filter((model): model is string => model !== null);
  const working = [...own.keys()];
  /** An agent's busy time in the interval, with one model only when given. */
  const time = (agent: string | null, model?: string) => covered((own.get(agent) ?? []).filter(segment => model === undefined || segment.model === model), from, at);
  for (const model of named) { const agentMs = working.reduce((total, agent) => total + time(agent, model), 0); if (agentMs) entry(model).agentMs = agentMs; }
  const tokens = (item: TokenKinds) => item.input + item.cacheRead + item.cacheWrite + item.output;
  const spent = timeline.spends.filter(spend => spend.at > from && spend.at <= at);
  for (const spend of spent) {
    if (!spend.model) continue;
    const used = entry(spend.model);
    used.input += spend.tokens.input; used.cacheRead += spend.tokens.cacheRead; used.cacheWrite += spend.tokens.cacheWrite; used.output += spend.tokens.output;
  }
  const models = [...byModel.values()].sort((a, b) => b.agentMs - a.agentMs || tokens(b) - tokens(a) || a.model.localeCompare(b.model));
  /** An agent's model: the one it worked with longest, else the one that spent its tokens. */
  const busiest = (agent: string | null) => named.map(model => ({ model, agentMs: time(agent, model) })).filter(item => item.agentMs > 0).sort((a, b) => b.agentMs - a.agentMs)[0]?.model;
  const agents = new Set([...working, ...spent.map(spend => spend.agent)].filter((agent): agent is string => agent !== null));
  const subagents = [...agents].map((id): MeasuredSubagent => {
    const spending = spent.filter(spend => spend.agent === id);
    return { id, model: busiest(id) ?? spending.find(spend => spend.model)?.model ?? null, agentMs: time(id), tokens: spending.reduce((total, spend) => total + tokens(spend.tokens), 0) };
  }).filter(agent => agent.agentMs > 0 || agent.tokens > 0).sort((a, b) => b.agentMs - a.agentMs || b.tokens - a.tokens || a.id.localeCompare(b.id));
  const intervals = working.flatMap(agent => stretches(own.get(agent)!, from, at).map(([start, end]): MeasuredInterval => ({ agent, start: new Date(start).toISOString(), end: new Date(end).toISOString() })))
    .sort((a, b) => a.start.localeCompare(b.start) || (a.agent ?? '').localeCompare(b.agent ?? ''));
  const efforts = new Map<string, MeasuredEffort>();
  const level = (agent: string | null, model: string, effort: string) => {
    const key = (agent ?? '') + '\0' + model + '\0' + effort;
    let found = efforts.get(key);
    if (!found) efforts.set(key, found = { agent, model, effort, agentMs: 0, tokens: 0 });
    return found;
  };
  for (const agent of working) {
    for (const segment of own.get(agent)!) if (segment.model && segment.effort) level(agent, segment.model, segment.effort);
  }
  for (const entry of efforts.values()) entry.agentMs = covered(own.get(entry.agent)!.filter(segment => segment.model === entry.model && segment.effort === entry.effort), from, at);
  for (const spend of spent) if (spend.model && spend.effort) level(spend.agent, spend.model, spend.effort).tokens += tokens(spend.tokens);
  return { harness: logs.harness, session: logs.session, agentMs: working.reduce((total, agent) => total + time(agent), 0), models, mainModel: busiest(null) ?? timeline.latest?.model ?? null, subagents, intervals,
    efforts: [...efforts.values()].filter(entry => entry.agentMs > 0 || entry.tokens > 0).sort((a, b) => b.agentMs - a.agentMs || b.tokens - a.tokens) };
}

/**
 * Measure a session's working time and tokens in (since, at]. Without `since` (the session's first
 * report on a work item, its starting point) only the main model is read. `live` means the report
 * comes from inside the session, so a turn still under way runs until now. With `cache` (a folder),
 * each log is read on from where the last measurement left it, and that is kept there.
 */
export async function measureSession(logs: SessionLogs, interval: { since: number | null; at: number; live?: boolean; cache?: string }): Promise<SessionMeasure> {
  const timeline = await sessionTimeline(logs, interval.since, interval.at, interval.live ?? false, interval.cache);
  return measureTimeline(logs, timeline, interval.since ?? interval.at, interval.at);
}
