// `atlas hook <event>`: Atlas's part of a Claude Code or Codex session. Both harnesses send the
// event as JSON on stdin and read JSON from stdout. A hook never breaks a session: on any failure it
// prints nothing, exits 0 and notes the failure in the home's logs/hooks.log.
//
// SessionStart tells the agent the projects its folder belongs to and their active
// work. PostToolUse checks the files the agent edited in the home's planning folders (blocking with
// the problems so it fixes them), links the session to the work item it edits or calls an Atlas tool
// on (in the home database). Stop (with
// StopFailure and Codex's Interrupt, which also end a turn) and SubagentStop record the work
// statistics of the work item the session is on from its log.
//
// A session is on one work item at a time, the one it last edited or called an Atlas tool on: its
// state, live time and reports count there. When it moves to another, the one it leaves gets a
// report up to then, measured at the session's next turn end (or its end, or its next prompt), so the
// edit that moved it is not held up; one that cannot be measured then is tried again later, for a
// day. The hooks that only record its state (sessionState.ts) run on every tool call; bin/atlas.js
// answers a PostToolUse with nothing to do (no Atlas tool, no planning file) before this file loads.
// Only what each event needs is loaded: checking, measuring and the session's context load on use.
import { statSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { HomeDatabase, liveWindowMs, projectOf } from '../../planning/home/database.ts';
import { homePlanningDirectory } from '../../planning/home/storage.ts';
import { atlasHome } from '../../planning/home/homePath.ts';
import type { Whereabouts } from '../../planning/projects/resolve.ts';
import type { insertReport } from '../../planning/statistics/statistics.ts';
import type { PreparedReport } from '../../planning/statistics/workReport.ts';
import type { Output } from '../args.ts';
import { logFailure, pruneStamps, recordActivity, recordAgent, recordSession, sessionPattern, stateEvents, stateHook, stopAgent, type Activity, type ActivityDetails } from './sessionState.ts';

export interface HookInput {
  session_id?: string; transcript_path?: string; cwd?: string; hook_event_name?: string;
  tool_name?: string; tool_input?: unknown; tool_response?: unknown;
  agent_id?: string; agent_type?: string; agent_transcript_path?: string;
  /** Stop's: the text of the turn's last response (Claude Code and Codex). */
  last_assistant_message?: string;
}
/**
 * A work item the session touched (a session_work row): `linked` is when, so the session's first
 * report measures from then; `came` when the session last came to it, so a report counts only the
 * time the session was on it; and `amended` when it last edited the accepted plan, so a report
 * clears only what it counted.
 */
interface Link { id: number; projectId: number; planningFolder: string; workId: string; amending: boolean; linked: string; came: string; amended: string | null }
/** The session's links, and the one it is on: its focus. */
interface SessionLinks { session: string; transcriptPath: string | null; work: Link[]; on: Link | null; focus: number | null }

const fileTools = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** Events that end a turn: the harness's Stop, a turn that failed (Claude Code) and an interrupted one (Codex). */
const turnEnds = new Set(['Stop', 'StopFailure', 'Interrupt']);
const caseless = process.platform === 'win32' || process.platform === 'darwin';
const key = (value: string) => caseless ? value.toLowerCase() : value;
function inside(parent: string, child: string) {
  const relative = path.relative(key(parent), key(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
const latest = (...values: string[]) => values.sort().at(-1)!;
/** How long a work item the session left waits for its report: a leave not measured within a day is let go. */
const leaveKeptMs = 24 * 60 * 60_000;

// ---- Session links (the home database's session and session_work) -------------------------------

/** The session's links; a new session's when it has none. */
function readLinks(database: HomeDatabase, session: string, transcriptPath: string | null): SessionLinks {
  const saved = database.db.prepare('SELECT transcript_path, focus FROM session WHERE id = ?').get(session) as { transcript_path: string | null; focus: number | null } | undefined;
  const rows = database.db.prepare('SELECT session_work.*, project.folder FROM session_work JOIN project ON project.id = session_work.project_id WHERE session_id = ? ORDER BY touched_at, session_work.id').all(session) as Record<string, unknown>[];
  const work = rows.map((row): Link => ({
    id: Number(row.id), projectId: Number(row.project_id), planningFolder: String(row.folder), workId: String(row.work_id), amending: Boolean(row.amending),
    linked: String(row.linked_at), came: String(row.focused_at ?? row.linked_at), amended: (row.amended_at as string | null) ?? null,
  }));
  return { session, transcriptPath: transcriptPath ?? saved?.transcript_path ?? null, work, on: work.find(item => item.id === saved?.focus) ?? null, focus: saved?.focus ?? null };
}
/** The harness a session runs in, as its log's place tells. */
const harnessOf = (transcriptPath: string | null) => transcriptPath === null ? 'unknown' : /[\\/]\.codex[\\/]/.test(transcriptPath) ? 'codex' : 'claude-code';
/** Record what the session's agent did at `at`, from a hook that loaded everything else too. */
const recordState = (database: HomeDatabase, home: string, links: SessionLinks, activity: Activity, at: string, details?: ActivityDetails) => recordActivity(database, home, links.session, links.transcriptPath, activity, at, liveWindowMs, details);
/**
 * A turn's end: the text of its last response (the hook's input has it: Claude Code and Codex send
 * it with Stop; else the end of a Claude Code log) and the session's latest title, from the log's end.
 */
async function turnEnd(input: HookInput, transcriptPath: string | null): Promise<{ message: string | null; title: string | null }> {
  const tail = transcriptPath ? await (await import('../../planning/statistics/sessionLog.ts')).logTail(transcriptPath) : { message: null, title: null };
  const given = typeof input.last_assistant_message === 'string' && input.last_assistant_message.trim() ? input.last_assistant_message : null;
  return { message: given ?? tail.message, title: tail.title };
}
/**
 * Link the session to a work item (amending, when it edits an accepted plan), noting that it
 * touched it now; returns the link's row. Hooks of one session running at once (a slow Stop and a
 * PostToolUse) each change the links in a transaction of their own, so they never undo each
 * other's changes.
 */
function link(database: HomeDatabase, session: string, projectId: number, workId: string, amending: boolean, at: string): number {
  database.db.prepare('INSERT INTO session_work (session_id, project_id, work_id, linked_at, amending, amended_at, touched_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (session_id, project_id, work_id) DO UPDATE SET amending = max(amending, excluded.amending), amended_at = ifnull(excluded.amended_at, amended_at), touched_at = excluded.touched_at')
    .run(session, projectId, workId, at, amending ? 1 : 0, amending ? at : null, at);
  return Number((database.db.prepare('SELECT id FROM session_work WHERE session_id = ? AND project_id = ? AND work_id = ?').get(session, projectId, workId) as { id: number }).id);
}
/**
 * Measure the report of a work item the session was on, up to `at` and since it came there (or its
 * previous report there); null when it cannot be (noted in the log).
 */
async function prepareReport(home: string, links: SessionLinks, item: Link, at: string, event: string): Promise<PreparedReport | null> {
  try {
    const { prepareWorkReport } = await import('../../planning/statistics/workReport.ts');
    const prepared = await prepareWorkReport(item.planningFolder, item.workId, { session: links.session, at: new Date(at) }, { amending: item.amending, since: latest(item.linked, item.came), atlasHome: home, ...links.transcriptPath && { transcriptPath: links.transcriptPath } });
    if (prepared.warnings.length) logFailure(home, event, new Error(item.workId + ': ' + prepared.warnings.join(' ')));
    return prepared;
  } catch (error) { logFailure(home, event, error); return null; }
}
/**
 * What a report's end changes besides the report: the session's time not yet reported counts from
 * then, so the report and the live count never both count it; and amending ends for the edits it
 * counted (one made while it was measured is counted by the next).
 */
function reported(database: HomeDatabase, session: string, item: Link, at: string) {
  database.db.prepare('UPDATE session SET counts_at = ? WHERE id = ? AND (counts_at IS NULL OR counts_at < ?)').run(at, session, at);
  if (item.amending) database.db.prepare('UPDATE session_work SET amending = 0 WHERE id = ? AND (amended_at IS NULL OR amended_at < ?)').run(item.id, at);
}
/**
 * Record a report up to `until`, unless another hook of the session (a Stop and a SubagentStop at
 * once) reported the work item for time this one measured too: that time counts once. A later report
 * there (the session came back to it before a leave was measured) is not this time. Returns whether
 * it was recorded; run in a transaction, which reads what the other hook wrote.
 */
function insertOnce(database: HomeDatabase, insert: typeof insertReport, session: string, item: Link, prepared: PreparedReport, until: string): boolean {
  const since = prepared.report.measured?.since ?? latest(item.linked, item.came);
  if (database.db.prepare("SELECT 1 FROM work_report WHERE project_id = ? AND work_id = ? AND session = ? AND at > ? AND ifnull(measured_since, '') < ? LIMIT 1").get(item.projectId, item.workId, session, since, until)) return false;
  insert(database, item.projectId, item.workId, prepared.report);
  return true;
}
/** Record a report in the same transaction as what changes with it. */
function recordReport(database: HomeDatabase, insert: typeof insertReport, session: string, item: Link, prepared: PreparedReport, at: string) {
  if (insertOnce(database, insert, session, item, prepared, at)) reported(database, session, item, at);
}
/**
 * The work items the session left whose reports are not measured yet (session_leave), oldest
 * first: each as the link it was then, measured from when it came there to when it left.
 */
function leftWork(database: HomeDatabase, session: string): { leave: number; item: Link; at: string }[] {
  const rows = database.db.prepare(`SELECT session_leave.id AS leave, session_leave.since, session_leave.at, session_leave.amending, session_work.id, session_work.project_id, session_work.work_id, project.folder
    FROM session_leave JOIN session_work ON session_work.id = session_leave.link JOIN project ON project.id = session_work.project_id
    WHERE session_work.session_id = ? ORDER BY session_leave.at, session_leave.id`).all(session) as Record<string, unknown>[];
  return rows.map(row => ({ leave: Number(row.leave), at: String(row.at), item: {
    id: Number(row.id), projectId: Number(row.project_id), planningFolder: String(row.folder), workId: String(row.work_id), amending: Boolean(row.amending),
    linked: String(row.since), came: String(row.since), amended: null,
  } }));
}
/** Measure the reports of the work items the session left, each up to when it left it; null for one that cannot be. */
const measureLeft = (home: string, links: SessionLinks, left: ReturnType<typeof leftWork>, event: string) => Promise.all(left.map(entry => prepareReport(home, links, entry.item, entry.at, event)));
/**
 * Record the reports of the work items the session left, in a transaction. A leave another hook of
 * the session reported meanwhile is gone; one that could not be measured stays for the session's next
 * hook that measures. A leave older than a day (its session gone, or its log never measurable) is let go.
 */
function recordLeft(database: HomeDatabase, insert: typeof insertReport, session: string, left: ReturnType<typeof leftWork>, reports: (PreparedReport | null)[], at: string) {
  left.forEach((entry, index) => {
    const prepared = reports[index];
    if (prepared && database.db.prepare('DELETE FROM session_leave WHERE id = ?').run(entry.leave).changes) insertOnce(database, insert, session, entry.item, prepared, entry.at);
  });
  database.db.prepare('DELETE FROM session_leave WHERE at < ?').run(new Date(Date.parse(at) - leaveKeptMs).toISOString());
}
/**
 * Report the work items the session left, from a hook that only records its state but can wait for
 * the measuring: its end (SessionEnd: after an interruption no turn's end comes) or its next prompt.
 */
export async function reportLeft(database: HomeDatabase, home: string, session: string, transcriptPath: string | null, event: string, at: string) {
  const left = leftWork(database, session);
  if (!left.length) return;
  const [{ insertReport }, reports] = await Promise.all([import('../../planning/statistics/statistics.ts'), measureLeft(home, readLinks(database, session, transcriptPath), left, event)]);
  database.transaction(() => recordLeft(database, insertReport, session, left, reports, at));
}

// ---- SessionStart -------------------------------------------------------------------------------

/**
 * The context of a session in no project's folders: the home's active projects (or how to make one),
 * and that the agent asks which one the work belongs to. Short, as every such session gets it.
 */
function contextOutsideProjects(where: Whereabouts): string {
  const folder = where.cwd;
  if (!where.projects.length) return `Atlas: no project covers this folder (${folder}), and the Atlas home (${where.home}) has no projects yet; when the user wants to plan, make one with their agreement (the Atlas tool project_create, or atlas project create), or the user makes one in the app.`;
  const lines = [`Atlas: no project covers this folder (${folder}). Active projects in the Atlas home:`];
  for (const project of where.projects.slice(0, 15)) lines.push(`- "${project.project}": ${project.planningFolder} (${project.work.length} active work ${project.work.length === 1 ? 'item' : 'items'})`);
  if (where.projects.length > 15) lines.push(`- …and ${where.projects.length - 15} more.`);
  lines.push("When the work involves Atlas (planning, recording, reviewing), ask the user which project it belongs to, or work across them; the Atlas tool where lists each project's folders and active work.");
  return lines.join('\n');
}

/** The context a session starts with: its projects, their active work, and how to plan; outside them, the home's projects. */
export function sessionContext(where: Whereabouts): string {
  if (!where.matches.length) return contextOutsideProjects(where);
  const lines: string[] = [];
  for (const match of where.matches) {
    lines.push(`Atlas project "${match.project}" for this folder: planning folder ${match.planningFolder}.`);
    if (!match.work.length) lines.push('No active work in this project.');
    else lines.push('Active work:');
    for (const item of match.work.slice(0, 10)) {
      const doing = item.steps.filter(step => step.status === 'doing').map(step => step.title);
      const state = [item.designStatus, item.implementationStatus].filter(Boolean).join(', ');
      lines.push(`- ${item.workId} "${item.title}"${state ? ' (' + state + ')' : ''}: ${item.progress}${doing.length ? '; doing: ' + doing.join('; ') : ''}${item.blocked ? '; BLOCKED: ' + item.blocked : ''}. Plan: ${path.join(match.planningFolder, ...(item.plan ?? item.path).split('/'))}`);
    }
    if (match.work.length > 10) lines.push(`- …and ${match.work.length - 10} more (Atlas tool where).`);
  }
  if (where.matches.length > 1) lines.push(`Several projects cover this folder (${where.matches.map(match => match.project).join(', ')}): before planning, ask the user which project to plan in, and give its planning folder to the Atlas tools.`);
  lines.push('Planning: when the user designs something or asks for work big enough to plan, ask before opening a work item; small tasks stay plain coding. Change planning state (work items, steps, blocked, closing, archiving) through the Atlas tools; edit plan prose, glossaries and diagrams directly as files in the planning folder.');
  lines.push('In planning files, write PRs and issues as owner/repo#N and commits as owner/repo@hash (or their URLs), naming the repository yourself, so Atlas links them; when you stop to wait for the user, begin your message with the question or decision you need.');
  lines.push('When you open work that continues other work (follow-ups moved off work that is closing, a next phase), record the handoff: work_create with continues, or work_continue.');
  return lines.join('\n');
}

// ---- PostToolUse --------------------------------------------------------------------------------

/** Every string in a value, however deep (patches hide in the tool input's fields). */
function strings(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') return [value];
  if (depth > 6 || !value || typeof value !== 'object') return [];
  return (Array.isArray(value) ? value : Object.values(value)).flatMap(item => strings(item, depth + 1));
}
/** The files a tool call edited: Claude's file tools name them; a patch (Codex's apply_patch) names them in its headers. */
export function editedFiles(input: HookInput): string[] {
  const files: string[] = [];
  const toolInput = input.tool_input as Record<string, unknown> | undefined;
  if (fileTools.has(input.tool_name ?? '') && toolInput) {
    for (const field of ['file_path', 'notebook_path']) if (typeof toolInput[field] === 'string') files.push(toolInput[field] as string);
  }
  for (const text of strings(input.tool_input)) {
    for (const match of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+?)\s*$|^\*\*\* Move to: (.+?)\s*$/gm)) files.push(match[1] ?? match[2]);
  }
  const base = input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd();
  return [...new Set(files.map(file => path.resolve(base, file)))];
}

/** The work item an Atlas tool call was about: from its input, else from its result. */
function toolWork(input: HookInput): { workId: string; planningFolder: string | null } | null {
  const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
  let workId = typeof toolInput.work === 'string' ? toolInput.work : null;
  let planningFolder = typeof toolInput.planningFolder === 'string' ? toolInput.planningFolder : null;
  for (const text of strings(input.tool_response)) {
    if (workId && planningFolder) break;
    try {
      const value = JSON.parse(text) as { workId?: unknown; planningFolder?: unknown };
      if (!workId && typeof value?.workId === 'string') workId = value.workId;
      if (!planningFolder && typeof value?.planningFolder === 'string') planningFolder = value.planningFolder;
    } catch { /* Not the result. */ }
  }
  const response = input.tool_response as { workId?: unknown; planningFolder?: unknown } | undefined;
  if (!workId && typeof response?.workId === 'string') workId = response.workId;
  if (!planningFolder && typeof response?.planningFolder === 'string') planningFolder = response.planningFolder;
  return workId && /^work-[0-9]{4,}$/.test(workId) ? { workId, planningFolder } : null;
}

interface Registered { id: string; path: string; current_plan: string | null }
async function registered(root: string): Promise<Registered[]> {
  const registry = JSON.parse((await readFile(path.join(root, 'planning.json'), 'utf8')).replace(/^﻿/, '')) as { work_items?: Registered[] };
  return Array.isArray(registry.work_items) ? registry.work_items.filter(item => typeof item?.id === 'string' && typeof item.path === 'string') : [];
}

interface LinkRequest { planningFolder: string; workId: string; amending: boolean }

async function postToolUse(input: HookInput, home: string, links: SessionLinks): Promise<{ output: object | null; requests: LinkRequest[] }> {
  const requests: LinkRequest[] = [];
  // Tools that change a work item link it; reading one (work_status) leaves the session where it is.
  if (/^mcp__.*atlas.*__(?:work|step)_(?!status$)/.test(input.tool_name ?? '')) {
    const about = toolWork(input);
    if (about) {
      const { resolvePlanningFolder } = await import('../../planning/projects/resolve.ts');
      const root = about.planningFolder ?? await resolvePlanningFolder({ cwd: input.cwd ?? process.cwd(), home, work: about.workId }).catch(() => null);
      if (root) requests.push({ planningFolder: root, workId: about.workId, amending: false });
    }
  }
  const base = await realpath(homePlanningDirectory(home)).catch(() => null);
  if (!base) return { output: null, requests };
  const files: { root: string; relative: string; absolute: string }[] = [];
  for (const absolute of editedFiles(input)) {
    const resolved = await realpath(absolute).catch(() => absolute);
    if (!inside(base, resolved)) continue;
    const name = path.relative(base, resolved).split(path.sep)[0];
    const root = path.join(base, name);
    // Only planning folders are checked: a folder being set up (no planning.json yet) or notes beside them are not.
    if (!statSync(path.join(root, 'planning.json'), { throwIfNoEntry: false })?.isFile()) continue;
    files.push({ root, relative: path.relative(root, resolved).split(path.sep).join('/'), absolute: resolved });
  }
  if (!files.length) return { output: null, requests };
  const problems: string[] = [], warnings: string[] = [];
  const [{ checkPaths }, { parseFrontmatter }] = await Promise.all([import('../../planning/check/checkPaths.ts'), import('../../planning/check/check.ts')]);
  for (const result of await checkPaths(files.map(file => file.absolute))) {
    problems.push(...result.errors.map(message => path.basename(result.planningFolder) + ': ' + message));
    warnings.push(...result.warnings.map(message => path.basename(result.planningFolder) + ': ' + message));
  }
  for (const file of files) {
    const work = await registered(file.root).catch(() => [] as Registered[]);
    const owner = work.filter(item => file.relative === item.path || file.relative.startsWith(item.path.replace(/\/+$/, '') + '/')).sort((a, b) => b.path.length - a.path.length)[0];
    if (!owner) continue;
    let amending = false;
    if (owner.current_plan === file.relative) {
      try { amending = parseFrontmatter(await readFile(file.absolute, 'utf8'))?.design_status === 'accepted'; } catch { /* An unreadable header is reported by the check. */ }
    }
    requests.push({ planningFolder: file.root, workId: owner.id, amending });
  }
  // Warnings (such as an active plan without a summary) are said without stopping the agent.
  if (!problems.length) return { output: warnings.length ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Atlas checked the planning files you edited; consider:\n' + warnings.map(warning => '- ' + warning).join('\n') } } : null, requests };
  const reason = 'Atlas found problems in the planning files you edited; fix them:\n' + problems.map(problem => '- ' + problem).join('\n');
  return { output: { decision: 'block', reason, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: reason } }, requests };
}

// ---- Stop and SubagentStop ----------------------------------------------------------------------

/**
 * Handle one hook event; returns what to print (nothing for most events). `at` is when the hook
 * started: state changes and reports are dated by it.
 */
export async function runHook(event: string, text: string, environment: NodeJS.ProcessEnv = process.env, at = new Date().toISOString()): Promise<string> {
  if (stateEvents.has(event)) { await stateHook(event, text, Date.parse(at), environment); return ''; }
  const home = atlasHome(undefined, environment);
  let database: HomeDatabase | null = null;
  try {
    const input = JSON.parse(text || '{}') as HookInput;
    const session = typeof input.session_id === 'string' && sessionPattern.test(input.session_id) ? input.session_id : null;
    const transcriptPath = typeof input.transcript_path === 'string' ? input.transcript_path : null;
    // A subagent's hook (Claude Code names the subagent; the session is its main agent's).
    const agent = typeof input.agent_id === 'string' && sessionPattern.test(input.agent_id) ? input.agent_id : null;
    if (event === 'SessionStart') {
      pruneStamps(home);
      const { findPlanning } = await import('../../planning/projects/resolve.ts');
      const context = sessionContext(await findPlanning(input.cwd ?? process.cwd(), { home }));
      return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } });
    }
    if (!session || !(event === 'PostToolUse' || event === 'SubagentStop' || turnEnds.has(event))) return '';
    database = HomeDatabase.open(home);
    const links = readLinks(database, session, transcriptPath);
    if (event === 'PostToolUse') {
      const { output, requests } = await postToolUse(input, home, links);
      if (!requests.length) return output ? JSON.stringify(output) : '';
      const projects = await Promise.all(requests.map(request => projectOf(database!, request.planningFolder)));
      // The session is on the last work item it touched; the one it leaves gets its report up to now, at the turn's end.
      const target = requests.at(-1)!, targetProject = projects.at(-1)!.id;
      const left = links.on && !(links.on.projectId === targetProject && links.on.workId === target.workId) ? links.on : null;
      database.transaction(() => {
        recordSession(database!, session, harnessOf(transcriptPath), transcriptPath, at, typeof input.cwd === 'string' ? input.cwd : null);
        const rows = requests.map((request, index) => link(database!, session, projects[index].id, request.workId, request.amending, at));
        const focus = (database!.db.prepare('SELECT focus FROM session WHERE id = ?').get(session) as { focus: number | null }).focus;
        if (focus !== rows.at(-1)) {
          database!.db.prepare('UPDATE session SET focus = ? WHERE id = ?').run(rows.at(-1)!, session);
          if (left || !links.on) database!.db.prepare('UPDATE session_work SET focused_at = ? WHERE id = ?').run(at, rows.at(-1)!);
        }
        // The work item it left is measured up to now by the session's next hook that measures (its
        // session_leave row keeps that time until then), and its time not yet reported counts from now
        // on, for the work item it is on now. Another hook of the session that moved it on meanwhile left it.
        if (left && focus === links.focus) {
          database!.db.prepare('INSERT INTO session_leave (link, since, at, amending) VALUES (?, ?, ?, ?)').run(left.id, latest(left.linked, left.came), at, left.amending ? 1 : 0);
          reported(database!, session, left, at);
        }
        // A subagent's edit says it is at work; the main agent's state stays as it is.
        if (agent) recordAgent(database!, home, session, agent, typeof input.agent_type === 'string' ? input.agent_type.slice(0, 100) : null, at, liveWindowMs);
        else recordState(database!, home, links, 'tool', at, { cwd: typeof input.cwd === 'string' ? input.cwd : null });
      });
      return output ? JSON.stringify(output) : '';
    }
    // A turn's end waits for the person from now, at once; its report follows, and the time not yet
    // reported stays counted (to when it began to wait) until the report counts it instead.
    if (turnEnds.has(event)) {
      const end = links.on ? await turnEnd(input, links.transcriptPath) : { message: null, title: null };
      recordState(database, home, links, 'stop', at, { cwd: typeof input.cwd === 'string' ? input.cwd : null, message: end.message });
      if (end.title) database.db.prepare('UPDATE session SET title = ? WHERE id = ?').run(end.title, session);
    }
    // The work items the session left since are reported first, each up to when it left it.
    const left = leftWork(database, session);
    if (!links.on && !left.length) return '';
    const { insertReport } = await import('../../planning/statistics/statistics.ts');
    const reports = await measureLeft(home, links, left, event);
    const report = links.on && await prepareReport(home, links, links.on, at, event);
    database.transaction(() => {
      recordLeft(database!, insertReport, session, left, reports, at);
      if (report) recordReport(database!, insertReport, session, links.on!, report, at);
      // A subagent stopping only says the session is still seen.
      if (event === 'SubagentStop') {
        recordState(database!, home, links, null, at);
        if (agent) stopAgent(database!, home, session, agent, at);
      }
    });
    return '';
  } catch (error) {
    logFailure(home, event, error);
    return '';
  } finally { database?.close(); }
}

/** Run `atlas hook <event>` on its input (read from stdin unless bin/atlas.js read it already); `at` is when it started. */
export async function hook(args: string[], out: Output, input: string | null = null, at = new Date().toISOString()) {
  try {
    const event = args[0] ?? '';
    let text = input ?? '';
    if (input === null && !process.stdin.isTTY) for await (const chunk of process.stdin) text += chunk;
    const output = await runHook(event, text, process.env, at);
    if (output) out.stdout(output);
  } catch (error) { logFailure(atlasHome(), args[0] ?? '', error); }
  return 0;
}
