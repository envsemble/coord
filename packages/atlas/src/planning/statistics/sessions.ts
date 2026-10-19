// A work item's sessions and its time, from the home database: each agent session linked to it
// (its harness, model and reasoning effort, state, agent time there and how to resume it), the
// commits and PRs the sessions made, and the work's timeline: how long it was planned, implemented
// and waited for the person, and each session's and subagent's working and waiting stretches.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from '../check/check.ts';
import { waitingWindowMs, type HomeDatabase } from '../home/database.ts';
import { readRegistry } from '../projects/resolve.ts';
import { mergeSpans, storedReports, summarizeReports } from './statistics.ts';

type Harness = 'claude-code' | 'codex' | 'unknown';
export interface SessionEntry {
  session: string; harness: Harness; model: string | null; effort: string | null;
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

/** The sessions linked to a work item, the latest seen first, and the commits and PRs they made, the newest first. */
export function workSessions(database: HomeDatabase, projectId: number, workId: string, now = Date.now()): { sessions: SessionEntry[]; products: ProductEntry[] } {
  const rows = database.db.prepare(`SELECT session.* FROM session_work JOIN session ON session.id = session_work.session_id
    WHERE session_work.project_id = ? AND session_work.work_id = ? ORDER BY session.updated_at DESC`).all(projectId, workId) as Row[];
  const agents = summarizeReports(storedReports(database, projectId, [workId]).get(workId) ?? []).agents;
  const states = new Map((database.workActivity(now).get(projectId)?.find(item => item.workId === workId)?.sessions ?? []).map(entry => [entry.session, entry.state]));
  const sessions = rows.map((row): SessionEntry => {
    const id = String(row.id), harness = harnessOf(row.harness), state = states.get(id) ?? 'ended';
    const own = agents.filter(agent => agent.session === id), main = own.find(agent => agent.subagent === null);
    return {
      session: id, harness, model: main?.model ?? null, effort: main?.effort ?? null, state,
      startedAt: String(row.started_at), lastSeen: String(row.updated_at), agentMs: own.reduce((total, agent) => total + agent.agentMs, 0),
      folder: (row.cwd as string | null) ?? null, resume: resumeOf(harness, id), message: state === 'waiting' ? (row.message as string | null) ?? null : null,
    };
  });
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
 * most a day, as statuses count it), and one lane per session and subagent: its working stretches
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
    if (entry.state === 'working' && entry.countsFrom) lane(entry.session, null).working.push([Date.parse(entry.countsFrom), now]);
  }
  let waitedMs = 0;
  for (const row of database.db.prepare('SELECT session_id, started_at, ended_at FROM session_wait WHERE project_id = ? AND work_id = ? ORDER BY started_at').all(projectId, workId) as Row[]) {
    const start = Date.parse(String(row.started_at));
    const end = Math.min(row.ended_at === null ? now : Date.parse(String(row.ended_at)), start + waitingWindowMs);
    if (end <= start) continue;
    waitedMs += end - start;
    lane(String(row.session_id), null).waiting.push([start, end]);
  }
  return {
    plannedMs, implementingMs, waitedMs,
    lanes: [...lanes.values()].map(item => {
      const usage = agents.find(agent => agent.session === item.session && agent.subagent === item.subagent);
      const working = mergeSpans(item.working), waiting = mergeSpans(item.waiting);
      return { session: item.session, subagent: item.subagent, model: usage?.model ?? null, effort: usage?.effort ?? null, working: working.map(([start, end]): [string, string] => [iso(start), iso(end)]), waiting: waiting.map(([start, end]): [string, string] => [iso(start), iso(end)]), first: Math.min(working[0]?.[0] ?? Infinity, waiting[0]?.[0] ?? Infinity) };
    }).sort((a, b) => a.first - b.first).map(({ first: _first, ...item }) => item),
  };
}
