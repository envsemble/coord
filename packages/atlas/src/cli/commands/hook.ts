// `atlas hook <event>`: Atlas's part of a Claude Code or Codex session. Both harnesses send the
// event as JSON on stdin and read JSON from stdout. A hook never breaks a session: on any failure it
// prints nothing, exits 0 and notes the failure in the home's logs/hooks.log.
//
// SessionStart tells the agent the projects its checkout's repository belongs to and their active
// work. PostToolUse checks the files the agent edited in the home's planning folders (blocking with
// the problems so it fixes them), links the session to the work item it edits or calls an Atlas tool
// on (in the home database), and records the planning files it reads as document use. Stop (with
// StopFailure and Codex's Interrupt, which also end a turn) and SubagentStop record the work
// statistics of the work item the session is on from its log.
//
// A session is on one work item at a time, the one it last edited or called an Atlas tool on: its
// state, live time and reports count there. When it moves to another, the one it leaves gets a
// report up to then. The hooks that only record its state (sessionState.ts) run on every tool call.
import { statSync } from 'node:fs';
import { open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { checkPaths, findPlanning, HomeDatabase, homePlanningDirectory, insertReport, liveWindowMs, logConsultation, parseFrontmatter, prepareWorkReport, projectOf, resolvePlanningFolder, type PreparedReport, type Whereabouts } from '../../planning/index.ts';
import { atlasHome } from '../../planning/home/homePath.ts';
import type { Output } from '../args.ts';
import { logFailure, pruneStamps, recordActivity, recordSession, sessionPattern, stateEvents, stateHook, type Activity, type ActivityDetails } from './sessionState.ts';

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
/** The session's links, and the one it is on: its focus, else (for a session from before focus) the one it touched last. */
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

// ---- Session links (the home database's session and session_work) -------------------------------

/** The session's links; a new session's when it has none. */
function readLinks(database: HomeDatabase, session: string, transcriptPath: string | null): SessionLinks {
  const saved = database.db.prepare('SELECT transcript_path, focus FROM session WHERE id = ?').get(session) as { transcript_path: string | null; focus: number | null } | undefined;
  const rows = database.db.prepare('SELECT session_work.*, project.folder FROM session_work JOIN project ON project.id = session_work.project_id WHERE session_id = ? ORDER BY ifnull(touched_at, linked_at), session_work.id').all(session) as Record<string, unknown>[];
  const work = rows.map((row): Link => ({
    id: Number(row.id), projectId: Number(row.project_id), planningFolder: String(row.folder), workId: String(row.work_id), amending: Boolean(row.amending),
    linked: String(row.linked_at), came: String(row.focused_at ?? row.linked_at), amended: (row.amended_at as string | null) ?? null,
  }));
  return { session, transcriptPath: transcriptPath ?? saved?.transcript_path ?? null, work, on: work.find(item => item.id === saved?.focus) ?? work.at(-1) ?? null, focus: saved?.focus ?? null };
}
/** The harness a session runs in, as its log's place tells. */
const harnessOf = (transcriptPath: string | null) => transcriptPath === null ? 'unknown' : /[\\/]\.codex[\\/]/.test(transcriptPath) ? 'codex' : 'claude-code';
/** Record what the session's agent did at `at`, from a hook that loaded everything else too. */
const recordState = (database: HomeDatabase, home: string, links: SessionLinks, activity: Activity, at: string, details?: ActivityDetails) => recordActivity(database, home, links.session, links.transcriptPath, activity, at, liveWindowMs, details);
/** How much of a log's end is read for the turn's last message, when the hook's input does not have it. */
const tailLimit = 256 * 1024;
/**
 * The text of a turn's last response: the hook's input has it (Claude Code and Codex send it with
 * Stop); otherwise the last assistant line with text near the end of a Claude Code log. A
 * compressed Codex rollout is not read.
 */
async function lastMessage(input: HookInput, transcriptPath: string | null): Promise<string | null> {
  if (typeof input.last_assistant_message === 'string' && input.last_assistant_message.trim()) return input.last_assistant_message;
  if (!transcriptPath || !transcriptPath.endsWith('.jsonl')) return null;
  const handle = await open(transcriptPath, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, tailLimit);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    for (const line of buffer.toString('utf8').split('\n').reverse()) {
      if (!line.includes('"assistant"')) continue;
      try {
        const entry = JSON.parse(line) as { type?: unknown; message?: { content?: unknown } };
        const parts = Array.isArray(entry.message?.content) ? entry.message.content as { type?: unknown; text?: unknown }[] : [];
        const said = parts.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text as string).join('\n\n').trim();
        if (entry.type === 'assistant' && said) return said;
      } catch { /* A line cut by the start of the tail, or not JSON. */ }
    }
    return null;
  } finally { await handle.close(); }
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
    const prepared = await prepareWorkReport(item.planningFolder, item.workId, { session: links.session, at: new Date(at) }, { amending: item.amending, since: latest(item.linked, item.came), atlasHome: home, ...links.transcriptPath && { transcriptPath: links.transcriptPath } });
    if (prepared.warnings.length) logFailure(home, event, new Error(item.workId + ': ' + prepared.warnings.join(' ')));
    return prepared;
  } catch (error) { logFailure(home, event, error); return null; }
}
/**
 * Record a report in the same transaction as what changes with it: the session's time not yet
 * reported counts from the report on, so the report and the live count never both count it; and
 * amending ends for the edits it counted (one made while it was measured is counted by the next).
 */
function recordReport(database: HomeDatabase, session: string, item: Link, prepared: PreparedReport, at: string) {
  insertReport(database, item.projectId, item.workId, prepared.report);
  database.db.prepare('UPDATE session SET counts_at = ? WHERE id = ? AND (counts_at IS NULL OR counts_at < ?)').run(at, session, at);
  if (item.amending) database.db.prepare('UPDATE session_work SET amending = 0 WHERE id = ? AND (amended_at IS NULL OR amended_at < ?)').run(item.id, at);
}

// ---- SessionStart -------------------------------------------------------------------------------

/**
 * The context of a session no project registers: the home's active projects (or how to make one),
 * and that the agent asks which one the work belongs to. Short, as every such session gets it.
 */
function contextOutsideProjects(where: Whereabouts): string {
  const folder = where.checkout ?? where.cwd;
  if (!where.projects.length) return `Atlas: no project registers this folder (${folder}), and the Atlas home (${where.home}) has no projects yet; when the user wants to plan, make one with their agreement (the Atlas tool project_create, or atlas project create), or the user makes one in the app.`;
  const lines = [`Atlas: no project registers this folder (${folder}). Active projects in the Atlas home:`];
  for (const project of where.projects.slice(0, 15)) lines.push(`- "${project.project}": ${project.planningFolder} (${project.work.length} active work ${project.work.length === 1 ? 'item' : 'items'})`);
  if (where.projects.length > 15) lines.push(`- …and ${where.projects.length - 15} more.`);
  lines.push("When the work involves Atlas (planning, recording, reviewing), ask the user which project it belongs to, or work across them; the Atlas tool where lists each project's repositories and active work.");
  return lines.join('\n');
}

/** The context a session starts with: its projects, their active work, and how to plan; outside them, the home's projects. */
export function sessionContext(where: Whereabouts): string {
  if (!where.matches.length) return contextOutsideProjects(where);
  const lines: string[] = [];
  for (const match of where.matches) {
    lines.push(`Atlas project "${match.project}" for this ${match.via.includes('workspace') ? 'workspace folder' : 'checkout'}: planning folder ${match.planningFolder}${match.repositories.length ? ' (repositories: ' + match.repositories.join(', ') + ')' : ''}.`);
    if (!match.work.length) lines.push('No active work for this checkout.');
    else lines.push('Active work:');
    for (const item of match.work.slice(0, 10)) {
      const doing = item.steps.filter(step => step.status === 'doing').map(step => step.title);
      const state = [item.designStatus, item.implementationStatus].filter(Boolean).join(', ');
      lines.push(`- ${item.workId} "${item.title}"${state ? ' (' + state + ')' : ''}: ${item.progress ?? 'no ledger yet'}${doing.length ? '; doing: ' + doing.join('; ') : ''}${item.blocked ? '; BLOCKED: ' + item.blocked : ''}. Plan: ${path.join(match.planningFolder, ...(item.plan ?? item.path).split('/'))}`);
    }
    if (match.work.length > 10) lines.push(`- …and ${match.work.length - 10} more (Atlas tool where).`);
  }
  if (where.matches.length > 1) lines.push(`Several projects register this checkout's repository (${where.matches.map(match => match.project).join(', ')}): before planning, ask the user which project to plan in, and give its planning folder to the Atlas tools.`);
  lines.push('Planning: when the user designs something or asks for work big enough to plan, ask before opening a work item; small tasks stay plain coding. Change planning state (work items, steps, blocked, closing, archiving) through the Atlas tools; edit plan prose, glossaries and diagrams directly as files in the planning folder.');
  lines.push('In planning files, write PRs as repo#N and commits as repo@hash, so Atlas links them; when you stop to wait for the user, begin your message with the question or decision you need.');
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
      const root = about.planningFolder ?? await resolvePlanningFolder({ cwd: input.cwd ?? process.cwd(), home, work: about.workId }).catch(() => null);
      if (root) requests.push({ planningFolder: root, workId: about.workId, amending: false });
    }
  }
  const base = await realpath(homePlanningDirectory(home)).catch(() => null);
  if (!base) return { output: null, requests };
  if (input.tool_name === 'Read') {
    await recordRead(input, base, home, links);
    return { output: null, requests };
  }
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

/** Record a planning file the agent read as document use, for the work item the session is linked to there. */
async function recordRead(input: HookInput, base: string, home: string, links: SessionLinks) {
  const file = (input.tool_input as { file_path?: unknown } | undefined)?.file_path;
  if (typeof file !== 'string') return;
  const resolved = await realpath(path.resolve(input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd(), file)).catch(() => null);
  if (!resolved || !inside(base, resolved)) return;
  const root = path.join(base, path.relative(base, resolved).split(path.sep)[0]);
  const canonical = await realpath(root).catch(() => root);
  const task = links.work.find(item => key(item.planningFolder) === key(canonical))?.workId;
  const result = await logConsultation(root, [resolved], { home, session: links.session, ...task && { task } });
  if (result.unavailable) logFailure(home, 'PostToolUse', new Error('document use not recorded: ' + result.unavailable));
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
    if (event === 'SessionStart') {
      pruneStamps(home);
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
      // The session is on the last work item it touched; the one it leaves gets its report up to now.
      const target = requests.at(-1)!, targetProject = projects.at(-1)!.id;
      const left = links.on && !(links.on.projectId === targetProject && links.on.workId === target.workId) ? links.on : null;
      const report = left && await prepareReport(home, links, left, at, event);
      database.transaction(() => {
        recordSession(database!, session, harnessOf(transcriptPath), transcriptPath, at, typeof input.cwd === 'string' ? input.cwd : null);
        const rows = requests.map((request, index) => link(database!, session, projects[index].id, request.workId, request.amending, at));
        const focus = (database!.db.prepare('SELECT focus FROM session WHERE id = ?').get(session) as { focus: number | null }).focus;
        if (focus !== rows.at(-1)) {
          database!.db.prepare('UPDATE session SET focus = ? WHERE id = ?').run(rows.at(-1)!, session);
          if (left || !links.on) database!.db.prepare('UPDATE session_work SET focused_at = ? WHERE id = ?').run(at, rows.at(-1)!);
        }
        // Another hook of the session that moved it on meanwhile reported the work item it left.
        if (left && report && focus === links.focus) recordReport(database!, session, left, report, at);
        recordState(database!, home, links, 'tool', at, { cwd: typeof input.cwd === 'string' ? input.cwd : null });
      });
      return output ? JSON.stringify(output) : '';
    }
    // A turn's end waits for the person from now, at once; its report follows, and the time not yet
    // reported stays counted (to when it began to wait) until the report counts it instead.
    if (turnEnds.has(event)) recordState(database, home, links, 'stop', at, { cwd: typeof input.cwd === 'string' ? input.cwd : null, message: links.on ? await lastMessage(input, links.transcriptPath).catch(() => null) : null });
    if (!links.on) return '';
    const report = await prepareReport(home, links, links.on, at, event);
    database.transaction(() => {
      if (report) recordReport(database!, session, links.on!, report, at);
      // A subagent stopping only says the session is still seen.
      if (event === 'SubagentStop') recordState(database!, home, links, null, at);
    });
    return '';
  } catch (error) {
    logFailure(home, event, error);
    return '';
  } finally { database?.close(); }
}

export async function hook(args: string[], out: Output) {
  const at = new Date().toISOString();
  try {
    const event = args[0] ?? '';
    let text = '';
    if (!process.stdin.isTTY) for await (const chunk of process.stdin) text += chunk;
    const output = await runHook(event, text, process.env, at);
    if (output) out.stdout(output);
  } catch (error) { logFailure(atlasHome(), args[0] ?? '', error); }
  return 0;
}
