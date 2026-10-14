// `atlas hook <event>`: Atlas's part of a Claude Code or Codex session. Both harnesses send the
// event as JSON on stdin and read JSON from stdout. A hook never breaks a session: on any failure it
// prints nothing, exits 0 and notes the failure in the home's logs/hooks.log.
//
// SessionStart tells the agent the projects its checkout's repository belongs to and their active
// work. PostToolUse checks the files the agent edited in the home's planning folders (blocking with
// the problems so it fixes them), links the session to the work item it edits or calls an Atlas tool
// on (in the home database), and records the planning files it reads as document use. Stop and
// SubagentStop record the work statistics of each linked work item from the session's log.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { atlasHome, checkPaths, findPlanning, HomeDatabase, homePlanningDirectory, logConsultation, parseFrontmatter, projectOf, recordWorkReport, resolvePlanningFolder, type Whereabouts } from '@envsemble/atlas-planning';
import type { Output } from './args.ts';

export interface HookInput {
  session_id?: string; transcript_path?: string; cwd?: string; hook_event_name?: string;
  tool_name?: string; tool_input?: unknown; tool_response?: unknown;
  agent_id?: string; agent_type?: string; agent_transcript_path?: string;
}
/**
 * A work item the session touched (a session_work row): `linked` is when, so the session's first
 * report measures from then, and `amended` when it last edited the accepted plan, so a report
 * clears only what it counted.
 */
interface Link { projectId: number; planningFolder: string; workId: string; amending: boolean; linked: string; amended: string | null }
interface SessionLinks { session: string; transcriptPath: string | null; work: Link[] }

const sessionPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const fileTools = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const caseless = process.platform === 'win32' || process.platform === 'darwin';
const key = (value: string) => caseless ? value.toLowerCase() : value;
function inside(parent: string, child: string) {
  const relative = path.relative(key(parent), key(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Note a failure in the home's hook log, keeping it small; never throws. */
function logFailure(home: string, event: string, error: unknown) {
  try {
    const directory = path.join(home, 'logs');
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'hooks.log');
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > 512 * 1024) renameSync(file, path.join(directory, 'hooks.1.log'));
    appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), event, error: error instanceof Error ? error.stack ?? error.message : String(error) }) + '\n');
  } catch { /* Nothing more to do. */ }
}

// ---- Session links (the home database's session and session_work) -------------------------------

/** The session's links; a new session's when it has none. */
function readLinks(database: HomeDatabase, session: string, transcriptPath: string | null): SessionLinks {
  const saved = database.db.prepare('SELECT transcript_path FROM session WHERE id = ?').get(session) as { transcript_path: string | null } | undefined;
  const rows = database.db.prepare('SELECT session_work.*, project.folder FROM session_work JOIN project ON project.id = session_work.project_id WHERE session_id = ? ORDER BY session_work.id').all(session) as Record<string, unknown>[];
  return {
    session, transcriptPath: transcriptPath ?? saved?.transcript_path ?? null,
    work: rows.map(row => ({ projectId: Number(row.project_id), planningFolder: String(row.folder), workId: String(row.work_id), amending: Boolean(row.amending), linked: String(row.linked_at), amended: (row.amended_at as string | null) ?? null })),
  };
}
/** The harness a session runs in, as its log's place tells. */
const harnessOf = (transcriptPath: string | null) => transcriptPath === null ? 'unknown' : /[\\/]\.codex[\\/]/.test(transcriptPath) ? 'codex' : 'claude-code';
/** Record the session, or that it was seen again. */
function touchSession(database: HomeDatabase, session: string, transcriptPath: string | null) {
  const now = new Date().toISOString();
  database.db.prepare('INSERT INTO session (id, harness, transcript_path, started_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET transcript_path = ifnull(excluded.transcript_path, transcript_path), updated_at = excluded.updated_at')
    .run(session, harnessOf(transcriptPath), transcriptPath, now, now);
}
/**
 * Link the session to a work item (amending, when it edits an accepted plan). Hooks of one session
 * running at once (a slow Stop and a PostToolUse) each change the links in a transaction of their own,
 * so they never undo each other's changes.
 */
function link(database: HomeDatabase, session: string, projectId: number, workId: string, amending: boolean) {
  const now = new Date().toISOString();
  database.db.prepare('INSERT INTO session_work (session_id, project_id, work_id, linked_at, amending, amended_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (session_id, project_id, work_id) DO UPDATE SET amending = max(amending, excluded.amending), amended_at = ifnull(excluded.amended_at, amended_at)')
    .run(session, projectId, workId, now, amending ? 1 : 0, amending ? now : null);
}

// ---- SessionStart -------------------------------------------------------------------------------

/** The context a session starts with: its projects, their active work, and how to plan. Null when there is none. */
export function sessionContext(where: Whereabouts): string | null {
  if (!where.matches.length) return null;
  const lines: string[] = [];
  for (const match of where.matches) {
    lines.push(`Atlas project "${match.project}" for this checkout: planning folder ${match.planningFolder}${match.repositories.length ? ' (repositories: ' + match.repositories.join(', ') + ')' : ''}.`);
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
  if (/^mcp__.*atlas.*__(?:work|step)_/.test(input.tool_name ?? '')) {
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
  const problems: string[] = [];
  for (const result of await checkPaths(files.map(file => file.absolute))) problems.push(...result.errors.map(message => path.basename(result.planningFolder) + ': ' + message));
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
  if (!problems.length) return { output: null, requests };
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

/** Record a report for each linked work item; returns the amending ones recorded, which are planning no more. */
async function recordLinked(home: string, links: SessionLinks, event: string) {
  const amended: Link[] = [];
  for (const item of links.work) {
    try {
      const recorded = await recordWorkReport(item.planningFolder, item.workId, { session: links.session }, { amending: item.amending, since: item.linked, atlasHome: home, ...links.transcriptPath && { transcriptPath: links.transcriptPath } });
      if (recorded.warnings.length) logFailure(home, event, new Error(item.workId + ': ' + recorded.warnings.join(' ')));
      if (item.amending) amended.push(item);
    } catch (error) { logFailure(home, event, error); }
  }
  return amended;
}

/** Handle one hook event; returns what to print (nothing for most events). */
export async function runHook(event: string, text: string, environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  const home = atlasHome(undefined, environment);
  let database: HomeDatabase | null = null;
  try {
    const input = JSON.parse(text || '{}') as HookInput;
    const session = typeof input.session_id === 'string' && sessionPattern.test(input.session_id) ? input.session_id : null;
    const transcriptPath = typeof input.transcript_path === 'string' ? input.transcript_path : null;
    if (event === 'SessionStart') {
      const context = sessionContext(await findPlanning(input.cwd ?? process.cwd(), { home }));
      return context ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }) : '';
    }
    if (!session || !['PostToolUse', 'Stop', 'SubagentStop'].includes(event)) return '';
    database = HomeDatabase.open(home);
    const links = readLinks(database, session, transcriptPath);
    if (event === 'PostToolUse') {
      const { output, requests } = await postToolUse(input, home, links);
      if (requests.length) {
        const projects = await Promise.all(requests.map(request => projectOf(database!, request.planningFolder)));
        database.transaction(() => {
          touchSession(database!, session, transcriptPath);
          requests.forEach((request, index) => link(database!, session, projects[index].id, request.workId, request.amending));
        });
      }
      return output ? JSON.stringify(output) : '';
    }
    if (!links.work.length) return '';
    const began = new Date().toISOString();
    const amended = await recordLinked(home, links, event);
    // An amending edit made while the report was being recorded is counted by the next one.
    database.transaction(() => {
      touchSession(database!, session, transcriptPath);
      const clear = database!.db.prepare('UPDATE session_work SET amending = 0 WHERE session_id = ? AND project_id = ? AND work_id = ? AND (amended_at IS NULL OR amended_at < ?)');
      for (const item of amended) clear.run(session, item.projectId, item.workId, began);
    });
    return '';
  } catch (error) {
    logFailure(home, event, error);
    return '';
  } finally { database?.close(); }
}

export async function hook(args: string[], out: Output) {
  try {
    const event = args[0] ?? '';
    let text = '';
    if (!process.stdin.isTTY) for await (const chunk of process.stdin) text += chunk;
    const output = await runHook(event, text);
    if (output) out.stdout(output);
  } catch (error) { logFailure(atlasHome(), args[0] ?? '', error); }
  return 0;
}
