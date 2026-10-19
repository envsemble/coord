// A work item's sessions and its time, from the home database: each agent session linked to it
// (its harness, model and reasoning effort, state, agent time there and how to resume it), the
// commits and PRs the sessions made, and the work's timeline: how long it was planned, implemented
// and waited for the person, and each session's and subagent's working and waiting stretches.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from '../check/check.ts';
import { waitingWindowMs, type HomeDatabase } from '../home/database.ts';
import { readRegistry } from '../projects/resolve.ts';
import { codexThreadName, logTail, sessionFolder, type LogOptions } from './sessionLog.ts';
import { mergeSpans, storedReports, summarizeReports } from './statistics.ts';

type Harness = 'claude-code' | 'codex' | 'unknown';
/** A work item's session as the host's contract describes it (WorkSession). */
export interface SessionEntry {
  session: string; harness: Harness; title: string | null; model: string | null; effort: string | null;
  state: 'working' | 'waiting' | 'ended'; startedAt: string; lastSeen: string; agentMs: number;
  folder: string | null; resume: string | null; message: string | null;
}
export interface ProductEntry { kind: 'commit' | 'pull'; session: string; at: string; repository: string | null; id: string; title: string | null; url: string | null; branch: string | null }
export interface TimelineEntry {
  plannedMs: number | null; implementingMs: number | null; waitedMs: number;
  lanes: { session: string; subagent: string | null; model: string | null; effort: string | null; working: [string, string][]; waiting: [string, string][] }[];
}

type Row = Record<string, unknown>;
const harnessOf = (value: unknown): Harness => value === 'claude-code' || value === 'codex' ? value : 'unknown';
/** How a session resumes in its harness, run in its folder. */
const resumeOf = (harness: Harness, session: string) => harness === 'claude-code' ? `claude --resume ${session}` : harness === 'codex' ? `codex resume ${session}` : null;

/** The titles found for sessions that had none recorded: each session is looked up once in a process. */
const titled = new Map<string, string | null>();
/**
 * A session's own title: the one the hooks recorded (from its log's end at each turn's end), else
 * looked up once: the end of a Claude Code log, or Codex's thread name; kept when found.
 */
async function titleOf(database: HomeDatabase, row: Row, harness: Harness, logs: LogOptions): Promise<string | null> {
  if (typeof row.title === 'string') return row.title;
  const id = String(row.id);
  if (!titled.has(id)) {
    const found = harness === 'codex' ? await codexThreadName(id, logs) : typeof row.transcript_path === 'string' ? (await logTail(row.transcript_path)).title : null;
    titled.set(id, found);
    if (found) database.db.prepare('UPDATE session SET title = ? WHERE id = ?').run(found, id);
  }
  return titled.get(id) ?? null;
}
/** The folders sessions started in, by log, as the logs said: each log is read once in a process. */
const startedIn = new Map<string, string | null>();
/** Where a session started: from the start of its log, kept as its folder, else the first folder its hooks saw. */
async function startFolder(database: HomeDatabase, row: Row): Promise<string | null> {
  const log = row.transcript_path;
  if (typeof log === 'string' && !startedIn.has(log)) {
    const found = await sessionFolder(log);
    startedIn.set(log, found);
    if (found && found !== row.cwd) database.db.prepare('UPDATE session SET cwd = ? WHERE id = ?').run(found, String(row.id));
  }
  return (typeof log === 'string' ? startedIn.get(log) : null) ?? (row.cwd as string | null) ?? null;
}

/**
 * The sessions linked to a work item, the latest seen first, and the commits and PRs they made, the
 * newest first. A session's folder is where it started, as its log says (else the first one a hook
 * saw): its harness resumes it from there. Without `local` (a paired device asks), the folder and
 * how to resume, which are of this computer, are left out.
 */
export async function workSessions(database: HomeDatabase, projectId: number, workId: string, options: { local?: boolean; now?: number; logs?: LogOptions } = {}): Promise<{ sessions: SessionEntry[]; products: ProductEntry[] }> {
  const { local = true, now = Date.now(), logs = {} } = options;
  const rows = database.db.prepare(`SELECT session.* FROM session_work JOIN session ON session.id = session_work.session_id
    WHERE session_work.project_id = ? AND session_work.work_id = ? ORDER BY session.updated_at DESC`).all(projectId, workId) as Row[];
  const agents = summarizeReports(storedReports(database, projectId, [workId]).get(workId) ?? []).agents;
  // A session works while its main agent or any of its subagents (`<session>/<subagent>`) does.
  const states = new Map<string, 'working' | 'waiting'>();
  for (const entry of database.workActivity(now).get(projectId)?.find(item => item.workId === workId)?.sessions ?? []) {
    const session = entry.session.split('/')[0];
    if (states.get(session) !== 'working') states.set(session, entry.state);
  }
  const sessions = await Promise.all(rows.map(async (row): Promise<SessionEntry> => {
    const id = String(row.id), harness = harnessOf(row.harness), state = states.get(id) ?? 'ended';
    const folder = local ? await startFolder(database, row) : null;
    const title = await titleOf(database, row, harness, logs);
    const own = agents.filter(agent => agent.session === id), main = own.find(agent => agent.subagent === null);
    return {
      session: id, harness, title, model: main?.model ?? null, effort: main?.effort ?? null, state,
      startedAt: String(row.started_at), lastSeen: String(row.updated_at), agentMs: own.reduce((total, agent) => total + agent.agentMs, 0),
      folder, resume: local ? resumeOf(harness, id) : null, message: state === 'waiting' ? (row.message as string | null) ?? null : null,
    };
  }));
  const products = (database.db.prepare('SELECT * FROM session_product WHERE project_id = ? AND work_id = ? ORDER BY at DESC, id DESC').all(projectId, workId) as Row[]).map((row): ProductEntry => ({
    kind: row.kind as 'commit' | 'pull', session: String(row.session_id), at: String(row.at), repository: (row.repository as string | null) ?? null,
    id: String(row.ident), title: (row.title as string | null) ?? null, url: (row.url as string | null) ?? null, branch: (row.branch as string | null) ?? null,
  }));
  return { sessions, products };
}

/** A work item's dates from its plan's header: created, accepted and completed (days), null where it has none. */
export async function workDates(root: string, workId: string): Promise<{ created: string | null; accepted: string | null; completed: string | null }> {
  const none = { created: null, accepted: null, completed: null };
  const entry = (await readRegistry(root).catch(() => null))?.work_items.find(item => item.id === workId);
  if (typeof entry?.current_plan !== 'string' || entry.current_plan.split('/').includes('..')) return none;
  const header = parseFrontmatter((await readFile(path.join(root, ...entry.current_plan.split('/')), 'utf8').catch(() => '')).replace(/^﻿/, ''));
  const day = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value : null;
  return header ? { created: day(header.created), accepted: day(header.accepted_at), completed: day(header.completed_at) } : none;
}

/**
 * A work item's timeline: planned from its creation to its acceptance (or now), implemented from
 * then to its completion (or now), the time its sessions waited for the person there (each wait at
 * most a day, and over once another session works on it, as statuses count it; waits at once
 * counted once), and one lane per session and subagent: its working stretches
 * from the reports' intervals (a session working now, from where its time not yet reported counts),
 * and the session's waits. An open stretch ends now.
 */
export function workTimeline(database: HomeDatabase, projectId: number, workId: string, dates: { created: string | null; accepted: string | null; completed: string | null }, now = Date.now()): TimelineEntry {
  const moment = (day: string | null) => day === null ? null : Date.parse(day.length === 10 ? day + 'T00:00:00Z' : day);
  const created = moment(dates.created), accepted = moment(dates.accepted), completed = moment(dates.completed);
  const plannedMs = created === null ? null : Math.max(0, (accepted ?? completed ?? now) - created);
  const implementingMs = accepted === null ? null : Math.max(0, (completed ?? now) - accepted);
  const iso = (time: number) => new Date(time).toISOString();
  const reports = storedReports(database, projectId, [workId]).get(workId) ?? [];
  const agents = summarizeReports(reports).agents;
  const lanes = new Map<string, { session: string; subagent: string | null; working: [number, number][]; waiting: [number, number][] }>();
  const lane = (session: string, subagent: string | null) => {
    const key = session + '\0' + (subagent ?? '');
    let found = lanes.get(key);
    if (!found) lanes.set(key, found = { session, subagent, working: [], waiting: [] });
    return found;
  };
  for (const report of reports) {
    if (!report.session) continue;
    for (const interval of report.measured?.intervals ?? []) lane(report.session, interval.agent).working.push([Date.parse(interval.start), Date.parse(interval.end)]);
  }
  for (const entry of database.workActivity(now).get(projectId)?.find(item => item.workId === workId)?.sessions ?? []) {
    // A subagent at work is listed as `<session>/<subagent>`: its own lane.
    const [session, subagent = null] = entry.session.split('/');
    if (entry.state === 'working' && entry.countsFrom) lane(session, subagent).working.push([Date.parse(entry.countsFrom), now]);
  }
  // When each session worked on the work item, as its reports and its turn now show: another
  // session's work ends a wait for the person there, as it ends Needs you.
  const worked = new Map<string, { spans: [number, number][]; reported: number[] }>();
  const work = (session: string) => {
    let entry = worked.get(session);
    if (!entry) worked.set(session, entry = { spans: [], reported: [] });
    return entry;
  };
  for (const report of reports) if (report.session) work(report.session).reported.push(Date.parse(report.at));
  for (const item of lanes.values()) work(item.session).spans.push(...item.working);
  const waits: [number, number][] = [];
  for (const row of database.db.prepare('SELECT session_id, started_at, ended_at FROM session_wait WHERE project_id = ? AND work_id = ? ORDER BY started_at').all(projectId, workId) as Row[]) {
    const session = String(row.session_id), start = Date.parse(String(row.started_at));
    let end = Math.min(row.ended_at === null ? now : Date.parse(String(row.ended_at)), start + waitingWindowMs);
    for (const [other, entry] of worked) {
      if (other === session) continue;
      for (const [from, to] of entry.spans) if (to > start) end = Math.min(end, Math.max(from, start));
      for (const at of entry.reported) if (at > start) end = Math.min(end, at);
    }
    // While the session's own subagents work, it does not wait for the person yet.
    const helping = mergeSpans([...lanes.values()].filter(item => item.session === session && item.subagent !== null).flatMap(item => item.working));
    let from = start;
    for (const [busy, until] of [...helping, [Infinity, Infinity] as [number, number]]) {
      const to = Math.min(end, busy);
      if (to > from) { waits.push([from, to]); lane(session, null).waiting.push([from, to]); }
      from = Math.max(from, until);
      if (from >= end) break;
    }
  }
  // Sessions waiting at once wait for one person: their waits count once.
  const waitedMs = mergeSpans(waits).reduce((total, [start, end]) => total + end - start, 0);
  return {
    plannedMs, implementingMs, waitedMs,
    lanes: [...lanes.values()].map(item => {
      const usage = agents.find(agent => agent.session === item.session && agent.subagent === item.subagent);
      const working = mergeSpans(item.working), waiting = mergeSpans(item.waiting);
      return { session: item.session, subagent: item.subagent, model: usage?.model ?? null, effort: usage?.effort ?? null, working: working.map(([start, end]): [string, string] => [iso(start), iso(end)]), waiting: waiting.map(([start, end]): [string, string] => [iso(start), iso(end)]), first: Math.min(working[0]?.[0] ?? Infinity, waiting[0]?.[0] ?? Infinity) };
    }).sort((a, b) => a.first - b.first).map(({ first: _first, ...item }) => item),
  };
}
