// Work statistics. Agents report their model, tokens and the time of each ledger transition with
// `atlas work report`, which appends one JSON line to <work>/.atlas/statistics.jsonl. These values
// are self-reported and approximate. Plan revisions come from the planning folder's Git history.
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ModelUsage, Work, WorkStatistics } from './types.ts';
import { runProgram as execute } from './run.ts';


/** Where a work item's reports live, relative to its folder. Plan exports leave it out. */
export const statisticsFile = '.atlas/statistics.jsonl';
/**
 * Reports further apart than this start a new stretch of work: the gap is not counted as active
 * time. Without a session, reports of the same model this close together are treated as one run.
 */
export const sessionGap = 2 * 60 * 60 * 1000;
export const fileLimit = 4 * 1024 * 1024;
const lineLimit = 4096;
const historyLimit = 20000;
export const stepLimit = 200;

export interface StatisticsReport { version: 1; at: string; model: string; session: string | null; tokens: number | null; step: string | null }
export interface ReportInput { model: string; session?: string | null; tokens?: number | null; step?: string | null; at?: Date }

/** Model identifiers as harnesses show them, including bracketed variants such as `name[1m]`. */
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-[\]]{0,99}$/;
const sessionPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Control characters, line separators and bidirectional overrides never appear in a step. */
const unprintable = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** A report that does not follow the format; the message says which field. */
export class StatisticsReportError extends Error {
  constructor(message: string) { super(message); this.name = 'StatisticsReportError'; }
}

function checkedTokens(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1e12) throw new StatisticsReportError('Tokens must be a whole number from 0 to 1,000,000,000,000.');
  return value;
}
function checkedStep(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > stepLimit || unprintable.test(value)) throw new StatisticsReportError(`A step must be one line of at most ${stepLimit} characters.`);
  return value.trim() || null;
}

/** Fit a step title into a report: one line, at most 200 characters. Says what changed, if anything. */
export function fitStep(value: string): { step: string | null; note: string | null; shortened: boolean } {
  const line = value.replace(new RegExp(unprintable.source, 'g'), ' ').replace(/\s+/g, ' ').trim();
  // Spaces are tidied silently; removing line breaks or control characters is said.
  const note = !unprintable.test(value) ? null : /[\r\n\u2028\u2029]/.test(value) ? 'The step was recorded as one line.' : 'Control characters were removed from the step.';
  if (line.length <= stepLimit) return { step: line || null, note, shortened: false };
  // Cut between whole characters: never half of a surrogate pair.
  let cut = line.slice(0, stepLimit - 1);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return { step: cut.trimEnd() + '\u2026', note: `The step was shortened to ${stepLimit} characters.`, shortened: true };
}

/** Build a valid report line, or throw StatisticsReportError. */
export function createReport(input: ReportInput): StatisticsReport {
  if (typeof input.model !== 'string' || !modelPattern.test(input.model)) throw new StatisticsReportError('The model must be its identifier, such as the API model name: letters, digits and . _ : / @ + - [ ], at most 100 characters.');
  const session = input.session ?? null;
  if (session !== null && (typeof session !== 'string' || !sessionPattern.test(session))) throw new StatisticsReportError('The session must be an identifier: letters, digits and . _ : -, at most 128 characters.');
  return { version: 1, at: (input.at ?? new Date()).toISOString(), model: input.model, session, tokens: checkedTokens(input.tokens), step: checkedStep(input.step) };
}

/** Read one line; null when it is not a valid report (counted, never fatal). */
export function parseReport(line: string): StatisticsReport | null {
  if (line.length > lineLimit) return null;
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  // A UTC timestamp that is a real moment: 2026-02-30T… is refused, not read as 2 March.
  if (entry.version !== 1 || typeof entry.at !== 'string' || !timestamp.test(entry.at)) return null;
  const at = new Date(entry.at);
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 19) !== entry.at.slice(0, 19)) return null;
  try { return { ...createReport({ model: entry.model as string, session: entry.session as string | null, tokens: entry.tokens as number | null, step: entry.step as string | null }), at: at.toISOString() }; }
  catch { return null; }
}

/**
 * Summarize reports. Each session (or, without one, each model's reports less than two hours
 * apart) is followed in time order:
 * - time: each report covers the time since the previous report, unless more than two hours
 *   passed, which is a break, not work; the first report marks the start;
 * - tokens: a session's count is cumulative, so each report adds its increase over the previous
 *   one, attributed to the reporting model. The first report is the starting point (agents report
 *   when they start), so tokens a session spent before this work are not charged to it. A lower
 *   count means a new conversation under the same session and counts in full.
 */
export function summarizeReports(reports: StatisticsReport[], invalid = 0): Omit<WorkStatistics, 'planRevisions'> {
  const sorted = [...reports].sort((a, b) => a.at.localeCompare(b.at));
  const usage = new Map<string, { model: string; reports: number; activeMs: number; tokens: number; tokensReported: boolean; sessions: Set<string> }>();
  const model = (name: string) => {
    let entry = usage.get(name);
    if (!entry) usage.set(name, entry = { model: name, reports: 0, activeMs: 0, tokens: 0, tokensReported: false, sessions: new Set() });
    return entry;
  };
  const runs = new Map<string, { last: number; tokens: number | null; id: string }>();
  let anonymous = 0;
  for (const report of sorted) {
    const time = Date.parse(report.at);
    const key = report.session ? 'session:' + report.session : 'model:' + report.model;
    let run = runs.get(key);
    // Without a session, a long gap means a different run; generated ids cannot clash with sessions.
    if (run && !report.session && time - run.last > sessionGap) run = undefined;
    const entry = model(report.model);
    entry.reports++;
    if (!run) {
      run = { last: time, tokens: null, id: report.session ? 'session:' + report.session : '#run-' + ++anonymous };
      runs.set(key, run);
    } else if (time - run.last <= sessionGap) entry.activeMs += time - run.last;
    entry.sessions.add(run.id);
    if (report.tokens !== null) {
      // Tokens are known once a report has a starting point to measure from; a lone report is not a cost.
      if (run.tokens !== null) { entry.tokens += report.tokens < run.tokens ? report.tokens : report.tokens - run.tokens; entry.tokensReported = true; }
      run.tokens = report.tokens;
    }
    run.last = time;
  }
  const models: ModelUsage[] = [...usage.values()].map(entry => ({ model: entry.model, reports: entry.reports, sessions: entry.sessions.size, activeMs: entry.activeMs, tokens: entry.tokensReported ? entry.tokens : null }))
    .sort((a, b) => b.activeMs - a.activeMs || (b.tokens ?? 0) - (a.tokens ?? 0) || b.reports - a.reports || a.model.localeCompare(b.model));
  const tokens = models.some(entry => entry.tokens !== null) ? models.reduce((sum, entry) => sum + (entry.tokens ?? 0), 0) : null;
  return {
    reports: sorted.length, invalid, models, primaryModel: models[0]?.model ?? null, tokens,
    activeMs: models.reduce((sum, entry) => sum + entry.activeMs, 0),
    firstReport: sorted[0]?.at ?? null, lastReport: sorted.at(-1)?.at ?? null,
  };
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

/**
 * A work folder's `.atlas` folder, when it is a real folder inside the planning folder: never a
 * symbolic link or junction that could lead reports elsewhere.
 */
async function atlasFolder(root: string, work: Pick<Work, 'path'>, create: boolean): Promise<string | null> {
  const resolvedRoot = await realpath(root);
  const folder = await realpath(path.join(root, work.path)).catch(() => null);
  if (!folder || !inside(resolvedRoot, folder)) throw new StatisticsReportError('The work folder is outside the planning folder.');
  const directory = path.join(folder, '.atlas');
  if (create) await mkdir(directory, { recursive: true });
  const info = await lstat(directory).catch(() => null);
  if (!info) return null;
  if (info.isSymbolicLink() || !info.isDirectory()) throw new StatisticsReportError(work.path + '/.atlas is a link or not a folder; statistics are not read or written there.');
  const actual = await realpath(directory);
  if (!inside(resolvedRoot, actual)) throw new StatisticsReportError(work.path + '/.atlas leads outside the planning folder.');
  return actual;
}

/** The reports recorded for one work item; invalid lines are counted, not fatal. */
export async function readReports(root: string, work: Pick<Work, 'path'>): Promise<{ reports: StatisticsReport[]; invalid: number }> {
  const directory = await atlasFolder(root, work, false).catch(() => null);
  if (!directory) return { reports: [], invalid: 0 };
  const file = path.join(directory, 'statistics.jsonl');
  const info = await lstat(file).catch(() => null);
  if (!info || !info.isFile() || info.size > fileLimit) return { reports: [], invalid: 0 };
  const reports: StatisticsReport[] = [];
  let invalid = 0;
  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const report = parseReport(line);
    if (report) reports.push(report); else invalid++;
  }
  return { reports, invalid };
}

/** Append a report to a work item's statistics file, creating `.atlas/` when needed. */
export async function appendReport(root: string, work: Pick<Work, 'path'>, report: StatisticsReport) {
  const directory = (await atlasFolder(root, work, true))!;
  const file = path.join(directory, 'statistics.jsonl');
  const existing = await lstat(file).catch(() => null);
  if (existing && !existing.isFile()) throw new StatisticsReportError(statisticsFile + ' is a link or not a regular file; reports are not added to it.');
  const line = JSON.stringify(report) + '\n';
  const handle = await open(file, 'a+', 0o644);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new StatisticsReportError(statisticsFile + ' is not a regular file.');
    if (info.size + Buffer.byteLength(line) + 1 > fileLimit) throw new StatisticsReportError(statisticsFile + ' would grow past 4 MB; reports are no longer added.');
    // A file that does not end in a newline (an interrupted write, a hand edit) gets one first,
    // so this report does not merge into the previous line.
    let separator = '';
    if (info.size > 0) {
      const last = Buffer.alloc(1);
      await handle.read(last, 0, 1, info.size - 1);
      if (last[0] !== 0x0a) separator = '\n';
    }
    // One short write in append mode: concurrent reports never interleave.
    await handle.appendFile(separator + line, 'utf8');
  } finally { await handle.close(); }
  return path.relative(await realpath(root), file).split(path.sep).join('/');
}

interface Change { status: string; path: string; from: string | null }
interface Commit { date: string; changes: Change[] }
const historyCache = new Map<string, { head: string; commits: Commit[]; results: Map<string, number | null> }>();
const failedHistory = new Map<string, string>();

/** Compare paths as the filesystem does: case-insensitively on Windows and macOS. */
const sameKey = (value: string) => process.platform === 'win32' || process.platform === 'darwin' ? value.normalize('NFC').toLowerCase() : value;

/**
 * The planning folder's history, newest first, with paths relative to the planning folder (also
 * when it sits inside a larger repository) and renames detected however many files moved.
 */
async function planHistory(root: string): Promise<{ head: string; commits: Commit[]; results: Map<string, number | null> } | null> {
  try {
    const { stdout: head } = await execute('git', ['-C', root, 'rev-parse', 'HEAD'], { windowsHide: true, timeout: 20000 });
    const cached = historyCache.get(root);
    if (cached && cached.head === head.trim()) return cached;
    if (failedHistory.get(root) === head.trim()) return null;
    const { stdout } = await execute('git', ['-C', root, '-c', 'core.quotePath=false', 'log', '-M30%', '-l0', '-z', '--no-merges', '--relative', '--name-status', '--format=%x1e%H%x00%aI', '-n', String(historyLimit), '--', '.'], { windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 120000 });
    const commits: Commit[] = [];
    for (const record of stdout.split('\x1e').slice(1)) {
      const fields = record.split('\0');
      const changes: Change[] = [];
      for (let index = 2; index < fields.length;) {
        const status = fields[index].replace(/^\n/, '');
        if (!status) { index++; continue; }
        if (/^[RC]/.test(status)) { changes.push({ status, from: fields[index + 1], path: fields[index + 2] }); index += 3; }
        else { changes.push({ status, from: null, path: fields[index + 1] }); index += 2; }
      }
      commits.push({ date: fields[1], changes });
    }
    const entry = { head: head.trim(), commits, results: new Map<string, number | null>() };
    historyCache.set(root, entry);
    return entry;
  } catch {
    // Remember a failed log for this revision, so a slow or broken history is not read on every load.
    const head = await execute('git', ['-C', root, 'rev-parse', 'HEAD'], { windowsHide: true, timeout: 20000 }).then(result => result.stdout.trim(), () => null);
    if (head) failedHistory.set(root, head);
    return null;
  }
}

/** The work folder and file a path ends in, such as `0012-export/plan.md`, to recognise a moved plan. */
const tail = (value: string) => sameKey(value.split('/').slice(-2).join('/'));
/** A work folder's registration number (`0012` of `0012-export`), or null for a legacy name. */
const workNumber = (value: string) => /^(\d{4,})-/.exec(value.split('/').at(-2) ?? '')?.[1] ?? null;
/** Git paired two different work items' plans (similar templates) as a rename. */
const crossWork = (from: string, to: string) => { const a = workNumber(from), b = workNumber(to); return a !== null && b !== null && a !== b; };

/** Follow one plan back through its history and count the commits that changed it. */
function countRevisions(commits: Commit[], plan: string, completed: string | null): number | null {
  let tracked = plan;
  let revisions = 0;
  for (const commit of commits) {
    const key = sameKey(tracked);
    const change = commit.changes.find(entry => sameKey(entry.path) === key);
    if (!change) continue;
    const counted = !completed || commit.date.slice(0, 10) <= completed;
    const added = change.status === 'A' || change.status.startsWith('C') || (change.status.startsWith('R') && crossWork(change.from!, change.path));
    if (added) {
      // A move that rewrote most of the plan shows as a delete and an add (or Git pairs it with
      // another work's new plan): follow the earlier plan of the same work folder, as a revision.
      const moved = commit.changes.find(entry => entry.status === 'D' && sameKey(entry.path) !== key && tail(entry.path) === tail(tracked))
        ?? commit.changes.find(entry => entry.status.startsWith('R') && entry.from !== null && sameKey(entry.from) !== key && tail(entry.from) === tail(tracked) && crossWork(entry.from, entry.path));
      if (!moved) return revisions;
      if (counted) revisions++;
      tracked = moved.status === 'D' ? moved.path : moved.from!;
      continue;
    }
    if (change.status.startsWith('R')) {
      if (counted && change.status !== 'R100') revisions++;
      tracked = change.from!;
    } else if (change.status === 'M' && counted) revisions++;
  }
  return null;
}

/**
 * How often each work item's main plan was revised after it was added, up to its completion date
 * (or today). Follows renames, so moving the folder to the archive is not a revision; a move that
 * also edits the plan is. Null for a work item whose plan is not in the history, or without Git.
 */
export async function planRevisions(root: string, work: Pick<Work, 'id' | 'currentPlan' | 'completed'>[]): Promise<Record<string, number | null>> {
  const result: Record<string, number | null> = {};
  const history = await planHistory(root);
  for (const item of work) {
    result[item.id] = null;
    if (!history || !item.currentPlan) continue;
    const key = item.currentPlan + '\0' + (item.completed ?? '');
    if (!history.results.has(key)) history.results.set(key, countRevisions(history.commits, item.currentPlan, item.completed));
    result[item.id] = history.results.get(key)!;
  }
  return result;
}

/** Statistics for every work item: reports from each work folder and plan revisions from Git. */
export async function workStatistics(root: string, work: Pick<Work, 'id' | 'path' | 'currentPlan' | 'completed'>[]): Promise<Record<string, WorkStatistics>> {
  const revisions = await planRevisions(root, work);
  const result: Record<string, WorkStatistics> = {};
  await Promise.all(work.map(async item => {
    const { reports, invalid } = await readReports(root, item).catch(() => ({ reports: [], invalid: 0 }));
    result[item.id] = { ...summarizeReports(reports, invalid), planRevisions: revisions[item.id] ?? null };
  }));
  return result;
}
