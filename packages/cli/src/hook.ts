// `atlas hook <event>`: Atlas's part of a Claude Code or Codex session. Both harnesses send the
// event as JSON on stdin and read JSON from stdout. A hook never breaks a session: on any failure it
// prints nothing, exits 0 and notes the failure in the home's logs/hooks.log.
//
// SessionStart tells the agent its planning folder and active work. PostToolUse checks planning
// files the agent edited in the home (blocking with the problems so it fixes them) and links the
// session to the work item it edits or calls an Atlas tool on. Stop and SubagentStop record the
// work statistics of each linked work item from the session's log.
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { atlasHome, checkPaths, findPlanning, homePlanningDirectory, parseFrontmatter, recordWorkReport, resolvePlanningFolder, type Whereabouts } from '@envsemble/atlas-planning';
import type { Output } from './args.ts';

export interface HookInput {
  session_id?: string; transcript_path?: string; cwd?: string; hook_event_name?: string;
  tool_name?: string; tool_input?: unknown; tool_response?: unknown;
  agent_id?: string; agent_type?: string; agent_transcript_path?: string;
}
interface Link { planningFolder: string; workId: string; amending: boolean }
interface SessionLinks { session: string; transcriptPath: string | null; updated: string; work: Link[] }

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

// ---- Session links ------------------------------------------------------------------------------

function linksFile(home: string, session: string) { return path.join(home, 'sessions', session + '.json'); }
function readLinks(home: string, session: string, transcriptPath: string | null): SessionLinks {
  try {
    const value = JSON.parse(readFileSync(linksFile(home, session), 'utf8')) as SessionLinks;
    if (value.session === session && Array.isArray(value.work)) return { ...value, transcriptPath: transcriptPath ?? value.transcriptPath };
  } catch { /* A new session. */ }
  return { session, transcriptPath, updated: new Date().toISOString(), work: [] };
}
function writeLinks(home: string, links: SessionLinks) {
  const file = linksFile(home, links.session);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + process.pid + '.tmp';
  writeFileSync(temporary, JSON.stringify({ ...links, updated: new Date().toISOString() }, null, 2) + '\n');
  renameSync(temporary, file);
}
/** Link the session to a work item (amending, when it edits an accepted plan); whether that changed anything. */
function link(links: SessionLinks, planningFolder: string, workId: string, amending: boolean) {
  const found = links.work.find(item => item.workId === workId && key(item.planningFolder) === key(planningFolder));
  if (!found) { links.work.push({ planningFolder, workId, amending }); return true; }
  if (!amending || found.amending) return false;
  found.amending = true;
  return true;
}

// ---- SessionStart -------------------------------------------------------------------------------

/** The context a session starts with: its planning folder, its active work, and how to plan. Null when there is none. */
export function sessionContext(where: Whereabouts): string | null {
  if (!where.matches.length) return null;
  const lines: string[] = [];
  for (const match of where.matches) {
    lines.push(`Atlas planning folder for this checkout: ${match.planningFolder}${match.repositories.length ? ' (repositories: ' + match.repositories.join(', ') + ')' : ''}.`);
    if (!match.work.length) lines.push('No active work for this checkout.');
    else lines.push('Active work:');
    for (const item of match.work.slice(0, 10)) {
      const doing = item.steps.filter(step => step.status === 'doing').map(step => step.title);
      const state = [item.designStatus, item.implementationStatus].filter(Boolean).join(', ');
      lines.push(`- ${item.workId} "${item.title}"${state ? ' (' + state + ')' : ''}: ${item.progress ?? 'no ledger yet'}${doing.length ? '; doing: ' + doing.join('; ') : ''}${item.blocked ? '; BLOCKED: ' + item.blocked : ''}. Plan: ${path.join(match.planningFolder, ...(item.plan ?? item.path).split('/'))}`);
    }
    if (match.work.length > 10) lines.push(`- …and ${match.work.length - 10} more (Atlas tool where).`);
  }
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

async function postToolUse(input: HookInput, home: string, links: SessionLinks): Promise<{ output: object | null; changed: boolean }> {
  let changed = false;
  if (/^mcp__.*atlas.*__(?:work|step)_/.test(input.tool_name ?? '')) {
    const about = toolWork(input);
    if (about) {
      const root = about.planningFolder ?? await resolvePlanningFolder({ cwd: input.cwd ?? process.cwd(), home, work: about.workId }).catch(() => null);
      if (root) changed = link(links, root, about.workId, false) || changed;
    }
  }
  const base = await realpath(homePlanningDirectory(home)).catch(() => null);
  if (!base) return { output: null, changed };
  const files: { root: string; relative: string; absolute: string }[] = [];
  for (const absolute of editedFiles(input)) {
    const resolved = await realpath(absolute).catch(() => absolute);
    if (!inside(base, resolved)) continue;
    const name = path.relative(base, resolved).split(path.sep)[0];
    const root = path.join(base, name);
    files.push({ root, relative: path.relative(root, resolved).split(path.sep).join('/'), absolute: resolved });
  }
  if (!files.length) return { output: null, changed };
  const problems: string[] = [];
  for (const result of checkPaths(files.map(file => file.absolute))) problems.push(...result.errors.map(message => path.basename(result.planningFolder) + ': ' + message));
  for (const file of files) {
    const work = await registered(file.root).catch(() => [] as Registered[]);
    const owner = work.filter(item => file.relative === item.path || file.relative.startsWith(item.path.replace(/\/+$/, '') + '/')).sort((a, b) => b.path.length - a.path.length)[0];
    if (!owner) continue;
    let amending = false;
    if (owner.current_plan === file.relative) {
      try { amending = parseFrontmatter(await readFile(file.absolute, 'utf8'))?.design_status === 'accepted'; } catch { /* An unreadable header is reported by the check. */ }
    }
    changed = link(links, file.root, owner.id, amending) || changed;
  }
  if (!problems.length) return { output: null, changed };
  const reason = 'Atlas found problems in the planning files you edited; fix them:\n' + problems.map(problem => '- ' + problem).join('\n');
  return { output: { decision: 'block', reason, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: reason } }, changed };
}

// ---- Stop and SubagentStop ----------------------------------------------------------------------

async function recordLinked(home: string, links: SessionLinks, event: string) {
  for (const item of links.work) {
    try {
      const recorded = await recordWorkReport(item.planningFolder, item.workId, { session: links.session, amending: item.amending, ...links.transcriptPath && { transcriptPath: links.transcriptPath } });
      if (recorded.warnings.length) logFailure(home, event, new Error(item.workId + ': ' + recorded.warnings.join(' ')));
      item.amending = false;
    } catch (error) { logFailure(home, event, error); }
  }
}

/** Handle one hook event; returns what to print (nothing for most events). */
export async function runHook(event: string, text: string, environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  const home = atlasHome(undefined, environment);
  try {
    const input = JSON.parse(text || '{}') as HookInput;
    const session = typeof input.session_id === 'string' && sessionPattern.test(input.session_id) ? input.session_id : null;
    const transcriptPath = typeof input.transcript_path === 'string' ? input.transcript_path : null;
    if (event === 'SessionStart') {
      const context = sessionContext(await findPlanning(input.cwd ?? process.cwd(), { home }));
      return context ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }) : '';
    }
    if (!session) return '';
    const links = readLinks(home, session, transcriptPath);
    if (event === 'PostToolUse') {
      const { output, changed } = await postToolUse(input, home, links);
      if (changed) writeLinks(home, links);
      return output ? JSON.stringify(output) : '';
    }
    if (event === 'Stop' || event === 'SubagentStop') {
      if (!links.work.length) return '';
      await recordLinked(home, links, event);
      writeLinks(home, links);
    }
    return '';
  } catch (error) {
    logFailure(home, event, error);
    return '';
  }
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
