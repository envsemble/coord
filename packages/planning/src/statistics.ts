// Work statistics. Agents report each ledger transition with `atlas work report` (and hooks report
// when a session stops), which records one report in the home database, keyed by project and work
// item: the time, the model, the step and the work item's stage, and, when it could read the agent's
// session log, the agent time and tokens measured since the session's previous report, with the
// subagents that worked. Without a measurement, agent time is estimated from the time between
// reports and tokens are self-reported. Plan revisions come from the planning folder's Git history.
//
// Before the database, reports were lines of <work>/.atlas/statistics.jsonl (format version 1, every
// field added since optional); `atlas setup` and `atlas home adopt` import such files once. A report
// without a stage is from before stages were recorded: its stage is unknown.
import { lstat, readdir, readFile, realpath, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import type { ModelUsage, StageUsage, TokenKinds, Work, WorkStage, WorkStatistics } from './types.ts';
import { runProgram as execute } from './run.ts';
import { projectOf, withDatabase, type HomeDatabase } from './database.ts';
import { normalizedLocation } from './planning.ts';

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
/** And lists at most this many subagents, the busiest; it counts them all. */
export const measuredSubagentLimit = 4;
export const workStages: readonly WorkStage[] = ['planning', 'implementation'];

/** One model's share of a measured interval. */
export interface MeasuredModel extends TokenKinds { model: string; agentMs: number }
/** One subagent's share of a measured interval: the model it worked with longest, its own busy time and its tokens. */
export interface MeasuredSubagent { id: string; model: string | null; agentMs: number; tokens: number }
/** The subagents that worked in a measured interval: how many, their busy time added up (each its own), their tokens, and the busiest. */
export interface MeasuredSubagents { count: number; agentMs: number; tokens: number; agents: MeasuredSubagent[] }
/**
 * What the session log showed for (since, at]: the agent's working time (its subagents' included,
 * parallel work once) and each model's share; and, when subagents worked, each subagent's own share.
 */
export interface Measured { since: string; agentMs: number; models: MeasuredModel[]; subagents?: MeasuredSubagents }
/** Version 1 throughout: `stage` and `measured` are optional, and versions that do not know them read the rest. */
export interface StatisticsReport { version: 1; at: string; model: string; session: string | null; tokens: number | null; step: string | null; stage?: WorkStage; measured?: Measured }
export interface ReportInput { model: string; session?: string | null; tokens?: number | null; step?: string | null; stage?: WorkStage | null; at?: Date; measured?: Measured | null }

/** Model identifiers as harnesses show them, including bracketed variants such as `name[1m]`. */
export const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-[\]]{0,99}$/;
const sessionPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const subagentPattern = /^[A-Za-z0-9_-][A-Za-z0-9._:-]{0,63}$/;
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
function checkedStage(value: unknown): WorkStage | null {
  if (value === null || value === undefined) return null;
  if (!workStages.includes(value as WorkStage)) throw new StatisticsReportError('The stage must be planning or implementation.');
  return value as WorkStage;
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

/**
 * A measurement as reports record it: an interval that ends at the report, times inside it, distinct
 * models. Reports name at most eight; read, any number fits the line.
 */
function checkedMeasured(value: unknown, at: string, modelLimit: number): Measured | null {
  if (value === null || value === undefined) return null;
  const invalid = (detail: string) => new StatisticsReportError('The measurement is not valid: ' + detail + '.');
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid('it is not an object');
  const entry = value as Record<string, unknown>;
  const since = utcTime(entry.since);
  if (!since || since > at) throw invalid('since must be a UTC time no later than the report');
  if (!whole(entry.agentMs, Date.parse(at) - Date.parse(since))) throw invalid('agentMs must be whole milliseconds within the interval');
  const total = entry.agentMs;
  if (!Array.isArray(entry.models) || entry.models.length > modelLimit) throw invalid(`models must be a list of at most ${modelLimit}`);
  const models = entry.models.map((item: unknown): MeasuredModel => {
    const model = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    if (typeof model.model !== 'string' || !modelPattern.test(model.model)) throw invalid('each model needs its identifier');
    if (!whole(model.agentMs, total)) throw invalid('a model\'s agentMs must be within the interval\'s');
    for (const kind of tokenKinds) if (!whole(model[kind], 1e12)) throw invalid(kind + ' must be a whole number of tokens');
    return { model: model.model, agentMs: model.agentMs, input: model.input as number, cacheRead: model.cacheRead as number, cacheWrite: model.cacheWrite as number, output: model.output as number };
  });
  if (new Set(models.map(item => item.model)).size !== models.length) throw invalid('a model is listed twice');
  const subagents = checkedSubagents(entry.subagents, Date.parse(at) - Date.parse(since), Number.isFinite(modelLimit) ? measuredSubagentLimit : modelLimit, invalid);
  return subagents ? { since, agentMs: total, models, subagents } : { since, agentMs: total, models };
}

/** Subagents as a measurement records them: each within the interval, listed once, no more than counted. */
function checkedSubagents(value: unknown, interval: number, limit: number, invalid: (detail: string) => StatisticsReportError): MeasuredSubagents | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid('subagents is not an object');
  const entry = value as Record<string, unknown>;
  if (!whole(entry.count, 1e6)) throw invalid('subagents must be counted');
  const count = entry.count;
  if (!whole(entry.agentMs, count * interval)) throw invalid('the subagents\' agentMs must be whole milliseconds within the interval for each');
  if (!whole(entry.tokens, 1e12)) throw invalid('the subagents\' tokens must be a whole number');
  if (!Array.isArray(entry.agents) || entry.agents.length > Math.min(limit, count)) throw invalid(`subagents must list at most ${measuredSubagentLimit} of those counted`);
  const agents = entry.agents.map((item: unknown): MeasuredSubagent => {
    const agent = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    if (typeof agent.id !== 'string' || !subagentPattern.test(agent.id)) throw invalid('each subagent needs its identifier');
    if (agent.model !== null && (typeof agent.model !== 'string' || !modelPattern.test(agent.model))) throw invalid('a subagent\'s model must be its identifier or null');
    if (!whole(agent.agentMs, interval)) throw invalid('a subagent\'s agentMs must be within the interval');
    if (!whole(agent.tokens, 1e12)) throw invalid('a subagent\'s tokens must be a whole number');
    return { id: agent.id, model: agent.model, agentMs: agent.agentMs, tokens: agent.tokens };
  });
  if (new Set(agents.map(item => item.id)).size !== agents.length) throw invalid('a subagent is listed twice');
  return { count, agentMs: entry.agentMs, tokens: entry.tokens, agents };
}

/** Build a valid report line, or throw StatisticsReportError. */
export function createReport(input: ReportInput, modelLimit = measuredModelLimit): StatisticsReport {
  if (typeof input.model !== 'string' || !modelPattern.test(input.model)) throw new StatisticsReportError('The model must be its identifier, such as the API model name: letters, digits and . _ : / @ + - [ ], at most 100 characters.');
  const session = input.session ?? null;
  if (session !== null && (typeof session !== 'string' || !sessionPattern.test(session))) throw new StatisticsReportError('The session must be an identifier: letters, digits and . _ : -, at most 128 characters.');
  const at = (input.at ?? new Date()).toISOString();
  const report: StatisticsReport = { version: 1, at, model: input.model, session, tokens: checkedTokens(input.tokens), step: checkedStep(input.step) };
  const stage = checkedStage(input.stage);
  if (stage) report.stage = stage;
  const measured = checkedMeasured(input.measured, at, modelLimit);
  if (measured) report.measured = measured;
  return report;
}

/**
 * Read one line; null when it is not a valid report (counted, never fatal). A stage, subagents or
 * measurement this version cannot read is left out, and the rest of the report stays, as older
 * versions read it.
 */
export function parseReport(line: string): StatisticsReport | null {
  if (line.length > lineLimit) return null;
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const at = utcTime(entry.at);
  if (entry.version !== 1 || !at) return null;
  const stage = workStages.includes(entry.stage as WorkStage) ? entry.stage as WorkStage : null;
  const fields: ReportInput = { model: entry.model as string, session: entry.session as string | null, tokens: entry.tokens as number | null, step: entry.step as string | null, stage, at: new Date(at) };
  const measured = entry.measured as Measured | undefined;
  const attempts = measured === undefined ? [undefined] : [measured, typeof measured === 'object' && measured?.subagents !== undefined ? { ...measured, subagents: undefined } : null, undefined];
  for (const attempt of attempts) {
    if (attempt === null) continue;
    try { return createReport({ ...fields, measured: attempt }, Number.POSITIVE_INFINITY); } catch { /* Read with less. */ }
  }
  return null;
}

const sum = (kinds: TokenKinds) => kinds.input + kinds.cacheRead + kinds.cacheWrite + kinds.output;
const noTokens = (): TokenKinds => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
const noUsage = (): StageUsage => ({ reports: 0, agentMs: 0, tokens: null, tokenKinds: null });
const added = (into: TokenKinds | null, kinds: TokenKinds): TokenKinds => ({ input: (into?.input ?? 0) + kinds.input, cacheRead: (into?.cacheRead ?? 0) + kinds.cacheRead, cacheWrite: (into?.cacheWrite ?? 0) + kinds.cacheWrite, output: (into?.output ?? 0) + kinds.output });

/**
 * Summarize reports. Each session (or, without one, each model's reports less than two hours
 * apart) is followed in time order. Its first report is the starting point: agents report when
 * they start, so what a session did before this work is not charged to it. Then each report covers
 * the time since the previous one:
 * - measured, when the report carries what the session log showed for that interval: the agent's
 *   working time, and each model's time and tokens. Two agents of a session reporting at the same
 *   moment measure from the same report; the part an earlier report covered counts once;
 * - estimated otherwise: the whole interval is agent time of the reporting model, unless more than
 *   two hours passed, which is a break; and a session's self-reported token count is cumulative, so
 *   a report adds its increase over the previous one (a lower count means a new conversation under
 *   the same session and counts in full).
 * What a report covers counts toward its stage (unknown for reports from before stages). Subagents
 * are counted once per session however many reports list them; those a report counts without
 * listing them (beyond the busiest four) are counted as new. Their time is each one's own, added up.
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
  const stages: Record<WorkStage | 'unknown', StageUsage> = { planning: noUsage(), implementation: noUsage(), unknown: noUsage() };
  const subagents = new Set<string>();
  let anonymous = 0, measuredMs = 0, estimatedMs = 0, measuredReports = 0, unlisted = 0, subagentMs = 0;
  let kinds: TokenKinds | null = null;
  for (const report of sorted) {
    const stage = stages[report.stage ?? 'unknown'];
    stage.reports++;
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
      const since = Date.parse(report.measured.since);
      const share = previous === null || since >= previous ? 1 : time > since ? Math.max(0, time - previous) / (time - since) : 0;
      const part = (value: number) => Math.round(value * share);
      measuredReports++;
      measuredMs += part(report.measured.agentMs);
      stage.agentMs += part(report.measured.agentMs);
      // A measurement of no tokens is a known zero.
      kinds ??= noTokens();
      stage.tokens ??= 0;
      stage.tokenKinds ??= noTokens();
      for (const item of report.measured.models) {
        const counted = { input: part(item.input), cacheRead: part(item.cacheRead), cacheWrite: part(item.cacheWrite), output: part(item.output) };
        const used = model(item.model);
        used.agentMs += part(item.agentMs);
        used.tokens += sum(counted);
        used.tokensKnown = true;
        used.tokenKinds = added(used.tokenKinds, counted);
        used.sessions.add(run.id);
        kinds = added(kinds, counted);
        stage.tokens += sum(counted);
        stage.tokenKinds = added(stage.tokenKinds, counted);
      }
      const helpers = report.measured.subagents;
      if (helpers && share > 0) {
        subagentMs += part(helpers.agentMs);
        for (const agent of helpers.agents) subagents.add(run.id + '\0' + agent.id);
        unlisted += helpers.count - helpers.agents.length;
      }
    } else if (previous !== null && time - previous <= sessionGap) {
      estimatedMs += time - previous;
      entry.agentMs += time - previous;
      stage.agentMs += time - previous;
    }
    if (report.tokens !== null) {
      // Self-reported tokens are known once a report has a starting point to measure from; a lone
      // report is not a cost. A measured report's own measurement counts instead.
      if (run.tokens !== null && !report.measured) {
        const increase = report.tokens < run.tokens ? report.tokens : report.tokens - run.tokens;
        entry.tokens += increase; entry.tokensKnown = true;
        stage.tokens = (stage.tokens ?? 0) + increase;
      }
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
    stages, subagents: { count: subagents.size + unlisted, agentMs: subagentMs },
    firstReport: sorted[0]?.at ?? null, lastReport: sorted.at(-1)?.at ?? null,
  };
}

type Row = Record<string, unknown>;

/** Record a report of a work item in the home database, with its measurement's models and subagents. */
export function insertReport(database: HomeDatabase, projectId: number, workId: string, report: StatisticsReport) {
  database.transaction(() => {
    const measured = report.measured;
    const { lastInsertRowid } = database.db.prepare('INSERT INTO work_report (project_id, work_id, at, stage, step, model, session, tokens, measured_since, agent_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(projectId, workId, report.at, report.stage ?? null, report.step, report.model, report.session, report.tokens, measured?.since ?? null, measured?.agentMs ?? null);
    if (!measured) return;
    const model = database.db.prepare('INSERT INTO report_model (report_id, model, agent_ms, input, cache_read, cache_write, output) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const item of measured.models) model.run(lastInsertRowid, item.model, item.agentMs, item.input, item.cacheRead, item.cacheWrite, item.output);
    const helpers = measured.subagents;
    if (!helpers) return;
    const subagent = database.db.prepare('INSERT INTO report_subagent (report_id, agent, model, agent_ms, tokens) VALUES (?, ?, ?, ?, ?)');
    for (const agent of helpers.agents) subagent.run(lastInsertRowid, agent.id, agent.model, agent.agentMs, agent.tokens);
    // A report line lists only the busiest subagents: the others it counted get rows of their own, with the rest of the time and tokens.
    const unlisted = helpers.count - helpers.agents.length;
    const restMs = Math.max(0, helpers.agentMs - helpers.agents.reduce((total, agent) => total + agent.agentMs, 0));
    const restTokens = Math.max(0, helpers.tokens - helpers.agents.reduce((total, agent) => total + agent.tokens, 0));
    for (let index = 0; index < unlisted; index++) subagent.run(lastInsertRowid, `unlisted-${lastInsertRowid}-${index + 1}`, null, index ? 0 : restMs, index ? 0 : restTokens);
  });
}

/** The reports recorded for a project's work items (all of them, or the ones given), by work item, oldest first. */
export function storedReports(database: HomeDatabase, projectId: number, workIds?: string[]): Map<string, StatisticsReport[]> {
  const scope = workIds ? ' AND work_id IN (' + workIds.map(() => '?').join(',') + ')' : '';
  const rows = database.db.prepare('SELECT * FROM work_report WHERE project_id = ?' + scope + ' ORDER BY at, id').all(projectId, ...(workIds ?? [])) as Row[];
  const models = new Map<number, MeasuredModel[]>(), agents = new Map<number, MeasuredSubagent[]>();
  const measuredIds = rows.filter(row => row.measured_since !== null).map(row => Number(row.id));
  if (measuredIds.length) {
    const list = measuredIds.join(',');
    for (const row of database.db.prepare(`SELECT * FROM report_model WHERE report_id IN (${list}) ORDER BY id`).all() as Row[]) {
      const entry: MeasuredModel = { model: String(row.model), agentMs: Number(row.agent_ms), input: Number(row.input), cacheRead: Number(row.cache_read), cacheWrite: Number(row.cache_write), output: Number(row.output) };
      models.set(Number(row.report_id), [...models.get(Number(row.report_id)) ?? [], entry]);
    }
    for (const row of database.db.prepare(`SELECT * FROM report_subagent WHERE report_id IN (${list}) ORDER BY id`).all() as Row[]) {
      const entry: MeasuredSubagent = { id: String(row.agent), model: (row.model as string | null) ?? null, agentMs: Number(row.agent_ms), tokens: Number(row.tokens) };
      agents.set(Number(row.report_id), [...agents.get(Number(row.report_id)) ?? [], entry]);
    }
  }
  const result = new Map<string, StatisticsReport[]>();
  for (const row of rows) {
    const id = Number(row.id);
    const report: StatisticsReport = { version: 1, at: String(row.at), model: String(row.model ?? 'unknown'), session: (row.session as string | null) ?? null, tokens: row.tokens === null ? null : Number(row.tokens), step: (row.step as string | null) ?? null };
    if (row.stage) report.stage = row.stage as WorkStage;
    if (row.measured_since !== null) {
      report.measured = { since: String(row.measured_since), agentMs: Number(row.agent_ms), models: models.get(id) ?? [] };
      const helpers = agents.get(id);
      if (helpers?.length) report.measured.subagents = { count: helpers.length, agentMs: helpers.reduce((total, agent) => total + agent.agentMs, 0), tokens: helpers.reduce((total, agent) => total + agent.tokens, 0), agents: helpers };
    }
    const workId = String(row.work_id);
    result.set(workId, [...result.get(workId) ?? [], report]);
  }
  return result;
}

/** Whether the database has this report already: the same moment, model, session and step of the same work item. */
function recorded(database: HomeDatabase, projectId: number, workId: string, report: StatisticsReport) {
  return Boolean(database.db.prepare('SELECT 1 FROM work_report WHERE project_id = ? AND work_id = ? AND at = ? AND model IS ? AND session IS ? AND step IS ? LIMIT 1')
    .get(projectId, workId, report.at, report.model, report.session, report.step));
}

/** What importing a planning folder's statistics files did; `files` relative to the planning folder. */
export interface StatisticsImport { files: string[]; reports: number; invalid: number; problems: string[] }

/**
 * Import the work statistics files of a planning folder (<work>/.atlas/statistics.jsonl, as Atlas
 * wrote them before the home database) into the database, then delete them. Each report is added
 * once, so an import that stopped half way can run again. Lines that are not valid reports are
 * counted and dropped. A file that is a link, or too large, is left alone and named in `problems`.
 * Nothing is committed: the planning folder's Git history keeps the files.
 */
export async function importStatisticsFiles(database: HomeDatabase, root: string): Promise<StatisticsImport> {
  const result: StatisticsImport = { files: [], reports: 0, invalid: 0, problems: [] };
  const canonical = await realpath(root);
  let items: unknown[];
  try { items = (JSON.parse((await readFile(path.join(canonical, 'planning.json'), 'utf8')).replace(/^﻿/, '')) as { work_items?: unknown[] }).work_items ?? []; }
  catch { return result; }
  if (!Array.isArray(items)) return result;
  const project = await projectOf(database, canonical);
  for (const item of items) {
    const entry = item && typeof item === 'object' ? item as { id?: unknown; path?: unknown } : {};
    if (typeof entry.id !== 'string' || typeof entry.path !== 'string') continue;
    const location = normalizedLocation(entry.path);
    if (location.split('/').includes('..') || path.isAbsolute(location)) continue;
    const folder = path.join(canonical, location, '.atlas');
    const file = path.join(folder, 'statistics.jsonl');
    const relative = location + '/' + statisticsFile;
    const info = await lstat(file).catch(() => null);
    if (!info) continue;
    if (!info.isFile() || (await lstat(folder)).isSymbolicLink()) { result.problems.push(relative + ' is a link or not a regular file; it was left as it is.'); continue; }
    if (info.size > fileLimit) { result.problems.push(relative + ' is larger than 4 MB; it was left as it is.'); continue; }
    const reports: StatisticsReport[] = [];
    for (const line of (await readFile(file, 'utf8')).replace(/^﻿/, '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const report = parseReport(line);
      if (report) reports.push(report); else result.invalid++;
    }
    const workId = entry.id;
    database.transaction(() => {
      for (const report of reports) {
        if (recorded(database, project.id, workId, report)) continue;
        insertReport(database, project.id, workId, report);
        result.reports++;
      }
    });
    await rm(file, { force: true });
    // The .atlas folder goes too when nothing else is in it.
    if (!(await readdir(folder).catch(() => ['?'])).length) await rmdir(folder).catch(() => undefined);
    result.files.push(relative);
  }
  return result;
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

/** Statistics for every work item: its reports in the home database and its plan revisions from Git. */
export async function workStatistics(root: string, work: Pick<Work, 'id' | 'path' | 'currentPlan' | 'completed'>[], options: { home?: string; database?: HomeDatabase | null } = {}): Promise<Record<string, WorkStatistics>> {
  const revisions = await planRevisions(root, work);
  let reports = new Map<string, StatisticsReport[]>();
  try {
    const canonical = await realpath(root);
    const read = (database: HomeDatabase) => {
      const project = database.projectByFolder(canonical);
      return project ? storedReports(database, project.id, work.map(item => item.id)) : new Map<string, StatisticsReport[]>();
    };
    reports = options.database ? read(options.database) : withDatabase(options.home, read);
  } catch { /* Without the database, no reports are known. */ }
  const result: Record<string, WorkStatistics> = {};
  for (const item of work) result[item.id] = { ...summarizeReports(reports.get(item.id) ?? []), planRevisions: revisions[item.id] ?? null };
  return result;
}
