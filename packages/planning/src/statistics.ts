// Work statistics. Agents report each ledger transition with `atlas work report`, which appends one
// JSON line to <work>/.atlas/statistics.jsonl: the time, the model and the step, and, when it could
// read the agent's session log, the agent time and tokens measured since the session's previous
// report. Without a measurement, agent time is estimated from the time between reports and tokens
// are self-reported. Plan revisions come from the planning folder's Git history.
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ModelUsage, TokenKinds, Work, WorkStatistics } from './types.ts';
import { runProgram as execute } from './run.ts';


/** Where a work item's reports live, relative to its folder. Plan exports leave it out. */
export const statisticsFile = '.atlas/statistics.jsonl';
/**
 * Unmeasured reports further apart than this start a new stretch of work: the gap is not counted as
 * agent time. Without a session, reports of the same model this close together are treated as one run.
 */
export const sessionGap = 2 * 60 * 60 * 1000;
export const fileLimit = 4 * 1024 * 1024;
const lineLimit = 4096;
const historyLimit = 20000;
export const stepLimit = 200;
/** A measurement names at most this many models, so a report stays one short line. */
export const measuredModelLimit = 8;

/** One model's share of a measured interval. */
export interface MeasuredModel extends TokenKinds { model: string; agentMs: number }
/** What the session log showed for (since, at]: the agent's working time and each model's share. */
export interface Measured { since: string; agentMs: number; models: MeasuredModel[] }
/** Version 1 throughout: `measured` is optional, and versions that do not know it read the rest. */
export interface StatisticsReport { version: 1; at: string; model: string; session: string | null; tokens: number | null; step: string | null; measured?: Measured }
export interface ReportInput { model: string; session?: string | null; tokens?: number | null; step?: string | null; at?: Date; measured?: Measured | null }

/** Model identifiers as harnesses show them, including bracketed variants such as `name[1m]`. */
export const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-[\]]{0,99}$/;
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

/** A UTC timestamp that is a real moment, normalized; 2026-02-30T… is refused, not read as 2 March. */
function utcTime(value: unknown): string | null {
  if (typeof value !== 'string' || !timestamp.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19) ? null : date.toISOString();
}
const whole = (value: unknown, limit: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= limit;
const tokenKinds = ['input', 'cacheRead', 'cacheWrite', 'output'] as const;

/** A measurement as reports record it: an interval that ends at the report, times inside it, distinct models. */
function checkedMeasured(value: unknown, at: string): Measured | null {
  if (value === null || value === undefined) return null;
  const invalid = (detail: string) => new StatisticsReportError('The measurement is not valid: ' + detail + '.');
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid('it is not an object');
  const entry = value as Record<string, unknown>;
  const since = utcTime(entry.since);
  if (!since || since > at) throw invalid('since must be a UTC time no later than the report');
  if (!whole(entry.agentMs, Date.parse(at) - Date.parse(since))) throw invalid('agentMs must be whole milliseconds within the interval');
  const total = entry.agentMs;
  if (!Array.isArray(entry.models) || entry.models.length > measuredModelLimit) throw invalid(`models must be a list of at most ${measuredModelLimit}`);
  const models = entry.models.map((item: unknown): MeasuredModel => {
    const model = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    if (typeof model.model !== 'string' || !modelPattern.test(model.model)) throw invalid('each model needs its identifier');
    if (!whole(model.agentMs, total)) throw invalid('a model\'s agentMs must be within the interval\'s');
    for (const kind of tokenKinds) if (!whole(model[kind], 1e12)) throw invalid(kind + ' must be a whole number of tokens');
    return { model: model.model, agentMs: model.agentMs, input: model.input as number, cacheRead: model.cacheRead as number, cacheWrite: model.cacheWrite as number, output: model.output as number };
  });
  if (new Set(models.map(item => item.model)).size !== models.length) throw invalid('a model is listed twice');
  return { since, agentMs: total, models };
}

/** Build a valid report line, or throw StatisticsReportError. */
export function createReport(input: ReportInput): StatisticsReport {
  if (typeof input.model !== 'string' || !modelPattern.test(input.model)) throw new StatisticsReportError('The model must be its identifier, such as the API model name: letters, digits and . _ : / @ + - [ ], at most 100 characters.');
  const session = input.session ?? null;
  if (session !== null && (typeof session !== 'string' || !sessionPattern.test(session))) throw new StatisticsReportError('The session must be an identifier: letters, digits and . _ : -, at most 128 characters.');
  const at = (input.at ?? new Date()).toISOString();
  const report: StatisticsReport = { version: 1, at, model: input.model, session, tokens: checkedTokens(input.tokens), step: checkedStep(input.step) };
  const measured = checkedMeasured(input.measured, at);
  if (measured) report.measured = measured;
  return report;
}

/** Read one line; null when it is not a valid report (counted, never fatal). */
export function parseReport(line: string): StatisticsReport | null {
  if (line.length > lineLimit) return null;
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const at = utcTime(entry.at);
  if (entry.version !== 1 || !at) return null;
  try { return createReport({ model: entry.model as string, session: entry.session as string | null, tokens: entry.tokens as number | null, step: entry.step as string | null, at: new Date(at), measured: entry.measured as Measured | undefined }); }
  catch { return null; }
}

const sum = (kinds: TokenKinds) => kinds.input + kinds.cacheRead + kinds.cacheWrite + kinds.output;
const added = (into: TokenKinds | null, kinds: TokenKinds): TokenKinds => ({ input: (into?.input ?? 0) + kinds.input, cacheRead: (into?.cacheRead ?? 0) + kinds.cacheRead, cacheWrite: (into?.cacheWrite ?? 0) + kinds.cacheWrite, output: (into?.output ?? 0) + kinds.output });

/**
 * Summarize reports. Each session (or, without one, each model's reports less than two hours
 * apart) is followed in time order. Its first report is the starting point: agents report when
 * they start, so what a session did before this work is not charged to it. Then each report covers
 * the time since the previous one:
 * - measured, when the report carries what the session log showed for that interval: the agent's
 *   working time, and each model's time and tokens;
 * - estimated otherwise: the whole interval is agent time of the reporting model, unless more than
 *   two hours passed, which is a break; and a session's self-reported token count is cumulative, so
 *   a report adds its increase over the previous one (a lower count means a new conversation under
 *   the same session and counts in full).
 */
export function summarizeReports(reports: StatisticsReport[], invalid = 0): Omit<WorkStatistics, 'planRevisions'> {
  const sorted = [...reports].sort((a, b) => a.at.localeCompare(b.at));
  const usage = new Map<string, { model: string; reports: number; agentMs: number; tokens: number; tokensKnown: boolean; tokenKinds: TokenKinds | null; sessions: Set<string> }>();
  const model = (name: string) => {
    let entry = usage.get(name);
    if (!entry) usage.set(name, entry = { model: name, reports: 0, agentMs: 0, tokens: 0, tokensKnown: false, tokenKinds: null, sessions: new Set() });
    return entry;
  };
  const runs = new Map<string, { last: number; tokens: number | null; id: string }>();
  let anonymous = 0, measuredMs = 0, estimatedMs = 0, measuredReports = 0;
  let kinds: TokenKinds | null = null;
  for (const report of sorted) {
    const time = Date.parse(report.at);
    const key = report.session ? 'session:' + report.session : 'model:' + report.model;
    let run = runs.get(key);
    // Without a session, a long gap means a different run; generated ids cannot clash with sessions.
    if (run && !report.session && time - run.last > sessionGap) run = undefined;
    const entry = model(report.model);
    entry.reports++;
    const previous = run?.last ?? null;
    if (!run) {
      run = { last: time, tokens: null, id: report.session ? 'session:' + report.session : '#run-' + ++anonymous };
      runs.set(key, run);
    }
    entry.sessions.add(run.id);
    if (report.measured) {
      measuredReports++;
      measuredMs += report.measured.agentMs;
      // A measurement of no tokens is a known zero.
      kinds ??= { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
      for (const item of report.measured.models) {
        const used = model(item.model);
        used.agentMs += item.agentMs;
        used.tokens += sum(item);
        used.tokensKnown = true;
        used.tokenKinds = added(used.tokenKinds, item);
        used.sessions.add(run.id);
        kinds = added(kinds, item);
      }
    } else if (previous !== null && time - previous <= sessionGap) {
      estimatedMs += time - previous;
      entry.agentMs += time - previous;
    }
    if (report.tokens !== null) {
      // Self-reported tokens are known once a report has a starting point to measure from; a lone
      // report is not a cost. A measured report's own measurement counts instead.
      if (run.tokens !== null && !report.measured) { entry.tokens += report.tokens < run.tokens ? report.tokens : report.tokens - run.tokens; entry.tokensKnown = true; }
      run.tokens = report.tokens;
    }
    run.last = time;
  }
  const models: ModelUsage[] = [...usage.values()].map(entry => ({ model: entry.model, reports: entry.reports, sessions: entry.sessions.size, agentMs: entry.agentMs, tokens: entry.tokensKnown ? entry.tokens : null, tokenKinds: entry.tokenKinds }))
    .sort((a, b) => b.agentMs - a.agentMs || (b.tokens ?? 0) - (a.tokens ?? 0) || b.reports - a.reports || a.model.localeCompare(b.model));
  const tokens = measuredReports || models.some(entry => entry.tokens !== null) ? models.reduce((total, entry) => total + (entry.tokens ?? 0), 0) : null;
  return {
    reports: sorted.length, invalid, models, primaryModel: models[0]?.model ?? null, tokens, tokenKinds: kinds,
    agentMs: measuredMs + estimatedMs, measuredMs, estimatedMs, measuredReports,
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
