// Work statistics. Agents report each ledger transition with `atlas work report` (and hooks report
// when a session stops), which records one report in the home database, keyed by project and work
// item: the time, the model, the step and the work item's stage, and, when it could read the agent's
// session log, the agent time and tokens measured since the session's previous report, with the
// subagents that worked. Without a measurement, agent time is estimated from the time between
// reports and tokens are self-reported. Plan revisions come from the planning folder's Git history.
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { AgentShare, ModelShare, StageStatistics, TokenKinds, Work, WorkStage, WorkStatistics } from '../types.ts';
import { runProgram as execute } from '../../platform/run.ts';
import { headCommit, topLevel } from '../../platform/git.ts';
import { withDatabase, type HomeDatabase } from '../../home/database.ts';

/**
 * Unmeasured reports further apart than this start a new stretch of work: the gap is not counted as
 * agent time. Without a session, reports of the same model this close together are treated as one run.
 */
export const sessionGap = 2 * 60 * 60 * 1000;
const historyLimit = 20000;
export const stepLimit = 200;
export const workStages: readonly WorkStage[] = ['planning', 'implementation'];

/** One model's share of a measured interval. */
export interface MeasuredModel extends TokenKinds { model: string; agentMs: number }
/** One subagent's share of a measured interval: the model it worked with longest, its own busy time and its tokens. */
export interface MeasuredSubagent { id: string; model: string | null; agentMs: number; tokens: number }
/** The subagents that worked in a measured interval: how many, their busy time added up (each its own), their tokens, and each one. */
export interface MeasuredSubagents { count: number; agentMs: number; tokens: number; agents: MeasuredSubagent[] }
/** A stretch one agent worked in a measured interval: the session's own agent (null) or a subagent. */
export interface MeasuredInterval { agent: string | null; start: string; end: string }
/** One agent's time and tokens with one model at one reasoning effort, in a measured interval. */
export interface MeasuredEffort { agent: string | null; model: string; effort: string; agentMs: number; tokens: number }
/**
 * What the session log showed for (since, at]: every agent's working time added up (the session's
 * own and each subagent's in full, also while they work at once) and each model's share; when
 * subagents worked, each subagent's own share; and when each agent worked (`intervals`, its
 * stretches merged).
 */
export interface Measured { since: string; agentMs: number; models: MeasuredModel[]; subagents?: MeasuredSubagents; intervals?: MeasuredInterval[]; efforts?: MeasuredEffort[] }
/** One report: the work item's stage when it was made, and `measured` when the session log could be read. */
export interface WorkReport { at: string; model: string; session: string | null; tokens: number | null; step: string | null; stage: WorkStage; measured?: Measured }
export interface ReportInput { model: string; session?: string | null; tokens?: number | null; step?: string | null; stage: WorkStage; at?: Date; measured?: Measured | null }

/** Model identifiers as harnesses show them, including bracketed variants such as `name[1m]`. */
export const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-[\]]{0,99}$/;
const sessionPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const subagentPattern = /^[A-Za-z0-9_-][A-Za-z0-9._:-]{0,63}$/;
/** Control characters, line separators and bidirectional overrides never appear in a step. */
const unprintable = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** A report that does not follow the format; the message says which field. */
export class WorkReportError extends Error {
  constructor(message: string) { super(message); this.name = 'WorkReportError'; }
}

function checkedTokens(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1e12) throw new WorkReportError('Tokens must be a whole number from 0 to 1,000,000,000,000.');
  return value;
}
function checkedStage(value: unknown): WorkStage {
  if (!workStages.includes(value as WorkStage)) throw new WorkReportError('The stage must be planning or implementation.');
  return value as WorkStage;
}
function checkedStep(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > stepLimit || unprintable.test(value)) throw new WorkReportError(`A step must be one line of at most ${stepLimit} characters.`);
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
 * A measurement as reports record it: an interval that ends at the report, times inside it (each
 * agent's at most the whole interval), distinct models.
 */
function checkedMeasured(value: unknown, at: string): Measured | null {
  if (value === null || value === undefined) return null;
  const invalid = (detail: string) => new WorkReportError('The measurement is not valid: ' + detail + '.');
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid('it is not an object');
  const entry = value as Record<string, unknown>;
  const since = utcTime(entry.since);
  if (!since || since > at) throw invalid('since must be a UTC time no later than the report');
  const interval = Date.parse(at) - Date.parse(since);
  const subagents = checkedSubagents(entry.subagents, interval, invalid);
  if (!whole(entry.agentMs, interval * (1 + (subagents?.count ?? 0)))) throw invalid('agentMs must be whole milliseconds within the interval for each agent');
  const total = entry.agentMs;
  if (!Array.isArray(entry.models)) throw invalid('models must be a list');
  const models = entry.models.map((item: unknown): MeasuredModel => {
    const model = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    if (typeof model.model !== 'string' || !modelPattern.test(model.model)) throw invalid('each model needs its identifier');
    if (!whole(model.agentMs, total)) throw invalid('a model\'s agentMs must be within the interval\'s');
    for (const kind of tokenKinds) if (!whole(model[kind], 1e12)) throw invalid(kind + ' must be a whole number of tokens');
    return { model: model.model, agentMs: model.agentMs, input: model.input as number, cacheRead: model.cacheRead as number, cacheWrite: model.cacheWrite as number, output: model.output as number };
  });
  if (new Set(models.map(item => item.model)).size !== models.length) throw invalid('a model is listed twice');
  const measured: Measured = { since, agentMs: total, models };
  if (subagents) measured.subagents = subagents;
  const intervals = checkedIntervals(entry.intervals, since, at, invalid);
  if (intervals) measured.intervals = intervals;
  const efforts = checkedEfforts(entry.efforts, total, invalid);
  if (efforts) measured.efforts = efforts;
  return measured;
}

/** Reasoning efforts as a measurement records them: each agent's time within the measurement's. */
function checkedEfforts(value: unknown, total: number, invalid: (detail: string) => WorkReportError): MeasuredEffort[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw invalid('efforts must be a list');
  return value.map((item: unknown): MeasuredEffort => {
    const entry = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    if (entry.agent !== null && (typeof entry.agent !== 'string' || !subagentPattern.test(entry.agent))) throw invalid('an effort names its agent by a subagent identifier, or null');
    if (typeof entry.model !== 'string' || !modelPattern.test(entry.model) || typeof entry.effort !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(entry.effort)) throw invalid('each effort needs its model and level');
    if (!whole(entry.agentMs, total) || !whole(entry.tokens, 1e12)) throw invalid('an effort needs whole numbers of time within the measurement and of tokens');
    return { agent: entry.agent, model: entry.model, effort: entry.effort, agentMs: entry.agentMs, tokens: entry.tokens };
  });
}

/** Working intervals as a measurement records them: each agent's, inside the measured interval. */
function checkedIntervals(value: unknown, since: string, at: string, invalid: (detail: string) => WorkReportError): MeasuredInterval[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw invalid('intervals must be a list');
  return value.map((item: unknown): MeasuredInterval => {
    const interval = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    if (interval.agent !== null && (typeof interval.agent !== 'string' || !subagentPattern.test(interval.agent))) throw invalid('an interval\'s agent must be a subagent\'s identifier or null');
    const start = utcTime(interval.start), end = utcTime(interval.end);
    if (!start || !end || start < since || end > at || start >= end) throw invalid('each interval must start before it ends, inside the measured interval');
    return { agent: interval.agent, start, end };
  });
}

/** Subagents as a measurement records them: each within the interval, every one counted listed once. */
function checkedSubagents(value: unknown, interval: number, invalid: (detail: string) => WorkReportError): MeasuredSubagents | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid('subagents is not an object');
  const entry = value as Record<string, unknown>;
  if (!whole(entry.count, 1e6)) throw invalid('subagents must be counted');
  const count = entry.count;
  if (!whole(entry.agentMs, count * interval)) throw invalid('the subagents\' agentMs must be whole milliseconds within the interval for each');
  if (!whole(entry.tokens, 1e12)) throw invalid('the subagents\' tokens must be a whole number');
  if (!Array.isArray(entry.agents) || entry.agents.length !== count) throw invalid('subagents must list each subagent counted');
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

/** Build a valid report, or throw WorkReportError. */
export function createReport(input: ReportInput): WorkReport {
  if (typeof input.model !== 'string' || !modelPattern.test(input.model)) throw new WorkReportError('The model must be its identifier, such as the API model name: letters, digits and . _ : / @ + - [ ], at most 100 characters.');
  const session = input.session ?? null;
  if (session !== null && (typeof session !== 'string' || !sessionPattern.test(session))) throw new WorkReportError('The session must be an identifier: letters, digits and . _ : -, at most 128 characters.');
  const at = (input.at ?? new Date()).toISOString();
  const report: WorkReport = { at, model: input.model, session, tokens: checkedTokens(input.tokens), step: checkedStep(input.step), stage: checkedStage(input.stage) };
  const measured = checkedMeasured(input.measured, at);
  if (measured) report.measured = measured;
  return report;
}

const sum = (kinds: TokenKinds) => kinds.input + kinds.cacheRead + kinds.cacheWrite + kinds.output;
const noTokens = (): TokenKinds => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
const noStatistics = (): StageStatistics => ({ reports: 0, agentMs: 0, tokens: null, tokenKinds: null });
const added = (into: TokenKinds | null, kinds: TokenKinds): TokenKinds => ({ input: (into?.input ?? 0) + kinds.input, cacheRead: (into?.cacheRead ?? 0) + kinds.cacheRead, cacheWrite: (into?.cacheWrite ?? 0) + kinds.cacheWrite, output: (into?.output ?? 0) + kinds.output });

/** Spans of time ([start, end] milliseconds) in time order, those that overlap or touch merged into one. */
export function mergeSpans(spans: [number, number][]): [number, number][] {
  const merged: [number, number][] = [];
  for (const [start, end] of spans.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
/** How long the spans cover together. */
export const spansMs = (spans: [number, number][]) => mergeSpans(spans).reduce((total, [start, end]) => total + end - start, 0);

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
 * What a report covers counts toward its stage. Subagents are counted once per session however many
 * reports list them; their time is each one's own, added up.
 * Agent time adds every agent up; the time at least one worked is the union of the reports' working
 * intervals (what an earlier report of the session covered left out), with the time of reports
 * without intervals added as is.
 */
export function summarizeReports(reports: WorkReport[]): Omit<WorkStatistics, 'planRevisions'> {
  const sorted = [...reports].sort((a, b) => a.at.localeCompare(b.at));
  const byModel = new Map<string, { model: string; reports: number; agentMs: number; tokens: number; tokensKnown: boolean; tokenKinds: TokenKinds | null; sessions: Set<string> }>();
  const model = (name: string) => {
    let entry = byModel.get(name);
    if (!entry) byModel.set(name, entry = { model: name, reports: 0, agentMs: 0, tokens: 0, tokensKnown: false, tokenKinds: null, sessions: new Set() });
    return entry;
  };
  const runs = new Map<string, { last: number; tokens: number | null; id: string }>();
  const stages: Record<WorkStage, StageStatistics> = { planning: noStatistics(), implementation: noStatistics() };
  const subagents = new Set<string>();
  // Each agent's own time, by session (its run) and subagent, with the time of each model it worked with.
  const agents = new Map<string, { session: string | null; subagent: string | null; agentMs: number; models: Map<string | null, number>; efforts: Map<string | null, number> }>();
  // Each model's time and tokens by reasoning effort.
  const levels = new Map<string, Map<string, { agentMs: number; tokens: number }>>();
  const credit = (run: string, session: string | null, subagent: string | null, name: string | null, agentMs: number) => {
    const key = run + '\0' + (subagent ?? '');
    let entry = agents.get(key);
    if (!entry) agents.set(key, entry = { session, subagent, agentMs: 0, models: new Map(), efforts: new Map() });
    entry.agentMs += agentMs;
    entry.models.set(name, (entry.models.get(name) ?? 0) + agentMs);
  };
  const spans: [number, number][] = [];
  let anonymous = 0, measuredMs = 0, estimatedMs = 0, measuredReports = 0, subagentMs = 0, unmergedMs = 0;
  let kinds: TokenKinds | null = null;
  for (const report of sorted) {
    const stage = stages[report.stage];
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
        for (const agent of helpers.agents) {
          subagents.add(run.id + '\0' + agent.id);
          credit(run.id, report.session, agent.id, agent.model, part(agent.agentMs));
        }
      }
      // The session's own agent worked what its subagents leave of the time.
      credit(run.id, report.session, null, report.model, Math.max(0, part(report.measured.agentMs) - (share > 0 ? part(helpers?.agentMs ?? 0) : 0)));
      if (report.measured.intervals) {
        const from = previous !== null && previous > since ? previous : since;
        for (const interval of report.measured.intervals) spans.push([Math.max(Date.parse(interval.start), from), Math.min(Date.parse(interval.end), time)]);
      } else unmergedMs += part(report.measured.agentMs);
      for (const level of report.measured.efforts ?? []) {
        let byEffort = levels.get(level.model);
        if (!byEffort) levels.set(level.model, byEffort = new Map());
        const counted = byEffort.get(level.effort) ?? { agentMs: 0, tokens: 0 };
        byEffort.set(level.effort, { agentMs: counted.agentMs + part(level.agentMs), tokens: counted.tokens + part(level.tokens) });
        const agent = agents.get(run.id + '\0' + (level.agent ?? ''));
        agent?.efforts.set(level.effort, (agent.efforts.get(level.effort) ?? 0) + part(level.agentMs));
      }
    } else if (previous !== null && time - previous <= sessionGap) {
      estimatedMs += time - previous;
      entry.agentMs += time - previous;
      stage.agentMs += time - previous;
      unmergedMs += time - previous;
      credit(run.id, report.session, null, report.model, time - previous);
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
  const models: ModelShare[] = [...byModel.values()].map(entry => ({ model: entry.model, reports: entry.reports, sessions: entry.sessions.size, agentMs: entry.agentMs, tokens: entry.tokensKnown ? entry.tokens : null, tokenKinds: entry.tokenKinds,
    efforts: [...levels.get(entry.model) ?? []].map(([effort, level]) => ({ effort, agentMs: level.agentMs, tokens: level.tokens })).sort((a, b) => b.agentMs - a.agentMs || b.tokens - a.tokens) }))
    .sort((a, b) => b.agentMs - a.agentMs || (b.tokens ?? 0) - (a.tokens ?? 0) || b.reports - a.reports || a.model.localeCompare(b.model));
  const tokens = measuredReports || models.some(entry => entry.tokens !== null) ? models.reduce((total, entry) => total + (entry.tokens ?? 0), 0) : null;
  // Each agent's model: the one it worked with longest.
  const busiest = (times: Map<string | null, number>) => [...times].filter(([name]) => name !== null).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const agentShares: AgentShare[] = [...agents.values()].filter(entry => entry.agentMs > 0).map(entry => ({ session: entry.session, subagent: entry.subagent, model: busiest(entry.models), effort: busiest(entry.efforts), agentMs: entry.agentMs }))
    .sort((a, b) => b.agentMs - a.agentMs || (a.session ?? '').localeCompare(b.session ?? '') || (a.subagent ?? '').localeCompare(b.subagent ?? ''));
  return {
    reports: sorted.length, models, primaryModel: models[0]?.model ?? null, primaryEffort: models[0]?.efforts[0]?.effort ?? null, tokens, tokenKinds: kinds,
    agentMs: measuredMs + estimatedMs, measuredMs, estimatedMs, measuredReports,
    activeMs: spansMs(spans) + unmergedMs, unmergedMs, agents: agentShares,
    stages, subagents: { count: subagents.size, agentMs: subagentMs },
    firstReport: sorted[0]?.at ?? null, lastReport: sorted.at(-1)?.at ?? null,
  };
}

type Row = Record<string, unknown>;

/** Record a report of a work item in the home database, with its measurement's models, subagents and working intervals. */
export function insertReport(database: HomeDatabase, projectId: number, workId: string, report: WorkReport) {
  database.transaction(() => {
    const measured = report.measured;
    const { lastInsertRowid } = database.db.prepare('INSERT INTO work_report (project_id, work_id, at, stage, step, model, session, tokens, measured_since, agent_ms, intervals) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(projectId, workId, report.at, report.stage, report.step, report.model, report.session, report.tokens, measured?.since ?? null, measured?.agentMs ?? null, measured?.intervals ? 1 : 0);
    if (!measured) return;
    insertIntervals(database, Number(lastInsertRowid), measured.intervals ?? []);
    insertEfforts(database, Number(lastInsertRowid), measured.efforts ?? []);
    const model = database.db.prepare('INSERT INTO report_model (report_id, model, agent_ms, input, cache_read, cache_write, output) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const item of measured.models) model.run(lastInsertRowid, item.model, item.agentMs, item.input, item.cacheRead, item.cacheWrite, item.output);
    const helpers = measured.subagents;
    if (!helpers) return;
    const subagent = database.db.prepare('INSERT INTO report_subagent (report_id, agent, model, agent_ms, tokens) VALUES (?, ?, ?, ?, ?)');
    for (const agent of helpers.agents) subagent.run(lastInsertRowid, agent.id, agent.model, agent.agentMs, agent.tokens);
  });
}
/** Record a report's time and tokens by model and reasoning effort. */
function insertEfforts(database: HomeDatabase, reportId: number, efforts: MeasuredEffort[]) {
  const insert = database.db.prepare('INSERT INTO report_effort (report_id, agent, model, effort, agent_ms, tokens) VALUES (?, ?, ?, ?, ?, ?)');
  for (const level of efforts) insert.run(reportId, level.agent, level.model, level.effort, level.agentMs, level.tokens);
}
/** Record a report's working intervals. */
function insertIntervals(database: HomeDatabase, reportId: number, intervals: MeasuredInterval[]) {
  const insert = database.db.prepare('INSERT INTO report_interval (report_id, agent, started_at, ended_at) VALUES (?, ?, ?, ?)');
  for (const interval of intervals) insert.run(reportId, interval.agent, interval.start, interval.end);
}

/** A map's list under a key, made when there is none. */
function listed<K, V>(map: Map<K, V[]>, key: K): V[] {
  let list = map.get(key);
  if (!list) map.set(key, list = []);
  return list;
}

/** The reports recorded for a project's work items (all of them, or the ones given), by work item, oldest first. */
export function storedReports(database: HomeDatabase, projectId: number, workIds?: string[]): Map<string, WorkReport[]> {
  const scope = workIds ? ' AND work_id IN (' + workIds.map(() => '?').join(',') + ')' : '';
  const rows = database.db.prepare('SELECT * FROM work_report WHERE project_id = ?' + scope + ' ORDER BY at, id').all(projectId, ...(workIds ?? [])) as Row[];
  const models = new Map<number, MeasuredModel[]>(), agents = new Map<number, MeasuredSubagent[]>(), intervals = new Map<number, MeasuredInterval[]>(), efforts = new Map<number, MeasuredEffort[]>();
  const measuredIds = rows.filter(row => row.measured_since !== null).map(row => Number(row.id));
  if (measuredIds.length) {
    const list = measuredIds.join(',');
    for (const row of database.db.prepare(`SELECT * FROM report_effort WHERE report_id IN (${list}) ORDER BY id`).all() as Row[]) {
      listed(efforts, Number(row.report_id)).push({ agent: (row.agent as string | null) ?? null, model: String(row.model), effort: String(row.effort), agentMs: Number(row.agent_ms), tokens: Number(row.tokens) });
    }
    const timed = rows.filter(row => row.measured_since !== null && row.intervals === 1).map(row => Number(row.id));
    if (timed.length) {
      for (const row of database.db.prepare(`SELECT report_id, agent, started_at, ended_at FROM report_interval WHERE report_id IN (${timed.join(',')}) ORDER BY id`).all() as Row[]) {
        listed(intervals, Number(row.report_id)).push({ agent: (row.agent as string | null) ?? null, start: String(row.started_at), end: String(row.ended_at) });
      }
    }
    for (const row of database.db.prepare(`SELECT * FROM report_model WHERE report_id IN (${list}) ORDER BY id`).all() as Row[]) {
      const entry: MeasuredModel = { model: String(row.model), agentMs: Number(row.agent_ms), input: Number(row.input), cacheRead: Number(row.cache_read), cacheWrite: Number(row.cache_write), output: Number(row.output) };
      listed(models, Number(row.report_id)).push(entry);
    }
    for (const row of database.db.prepare(`SELECT * FROM report_subagent WHERE report_id IN (${list}) ORDER BY id`).all() as Row[]) {
      const entry: MeasuredSubagent = { id: String(row.agent), model: (row.model as string | null) ?? null, agentMs: Number(row.agent_ms), tokens: Number(row.tokens) };
      listed(agents, Number(row.report_id)).push(entry);
    }
  }
  const result = new Map<string, WorkReport[]>();
  for (const row of rows) {
    const id = Number(row.id);
    const report: WorkReport = { at: String(row.at), model: String(row.model), session: (row.session as string | null) ?? null, tokens: row.tokens === null ? null : Number(row.tokens), step: (row.step as string | null) ?? null, stage: row.stage as WorkStage };
    if (row.measured_since !== null) {
      report.measured = { since: String(row.measured_since), agentMs: Number(row.agent_ms), models: models.get(id) ?? [] };
      const helpers = agents.get(id);
      if (helpers?.length) report.measured.subagents = { count: helpers.length, agentMs: helpers.reduce((total, agent) => total + agent.agentMs, 0), tokens: helpers.reduce((total, agent) => total + agent.tokens, 0), agents: helpers };
      if (row.intervals === 1) report.measured.intervals = intervals.get(id) ?? [];
      if (efforts.has(id)) report.measured.efforts = efforts.get(id);
    }
    const workId = String(row.work_id);
    listed(result, workId).push(report);
  }
  return result;
}

interface Change { status: string; path: string; from: string | null }
interface Commit { date: string; changes: Change[] }
const historyCache = new Map<string, { head: string; commits: Commit[]; results: Map<string, number | null> }>();
const failedHistory = new Map<string, string>();

/** Compare paths as the filesystem does: case-insensitively on Windows and macOS. */
const sameKey = (value: string) => process.platform === 'win32' || process.platform === 'darwin' ? value.normalize('NFC').toLowerCase() : value;

/** Commits as `git log -z --name-status` gives them, with `fields` format fields before the changes (the hash, the date and, when asked, the parents). */
function parseLog(stdout: string, fields: number): (Commit & { id: string; parents: string[] })[] {
  return stdout.split('\x1e').slice(1).map(record => {
    const values = record.split('\0');
    const changes: Change[] = [];
    for (let index = fields; index < values.length;) {
      const status = values[index].replace(/^\n/, '');
      if (!status) { index++; continue; }
      if (/^[RC]/.test(status)) { changes.push({ status, from: values[index + 1], path: values[index + 2] }); index += 3; }
      else { changes.push({ status, from: null, path: values[index + 1] }); index += 2; }
    }
    return { id: values[0], date: values[1], parents: fields > 2 ? values[2].trim().split(' ').filter(Boolean) : [], changes };
  });
}

/**
 * The commits from `from` to `to`, newest first, as the full history would list them; null unless
 * they are a line of single-parent commits on top of `from` in a repository whose top level is the
 * planning folder, where the full history lists them, in this order, before `from`'s.
 */
async function commitsSince(root: string, key: string, from: string, to: string): Promise<Commit[] | null> {
  const top = await topLevel(root);
  if (!top || sameKey(await realpath(top)) !== key) return null;
  const { stdout } = await execute('git', ['-C', root, '-c', 'core.quotePath=false', 'log', '-M30%', '-l0', '-z', '--name-status', '--format=%x1e%H%x00%aI%x00%P', from + '..' + to], { windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 120000 });
  const commits = parseLog(stdout, 3);
  if (!commits.length || commits[0].id !== to) return null;
  for (const [index, commit] of commits.entries()) {
    if (commit.parents.length !== 1 || commit.parents[0] !== (commits[index + 1]?.id ?? from)) return null;
  }
  // The full history names only the commits that change the folder.
  return commits.filter(commit => commit.changes.length).map(({ date, changes }) => ({ date, changes }));
}

/**
 * The planning folder's history, newest first, with paths relative to the planning folder (also
 * when it sits inside a larger repository) and renames detected however many files moved. Read in
 * full once; after new commits on top of the one read, only those are read.
 */
async function planHistory(root: string): Promise<{ head: string; commits: Commit[]; results: Map<string, number | null> } | null> {
  let key: string;
  try { key = sameKey(await realpath(root)); } catch { return null; }
  const head = await headCommit(root);
  if (!head) return null;
  try {
    const cached = historyCache.get(key);
    if (cached && cached.head === head) return cached;
    if (failedHistory.get(key) === head) return null;
    const newer = cached ? await commitsSince(root, key, cached.head, head).catch(() => null) : null;
    let commits: Commit[];
    if (newer && cached) commits = [...newer, ...cached.commits].slice(0, historyLimit);
    else {
      const { stdout } = await execute('git', ['-C', root, '-c', 'core.quotePath=false', 'log', '-M30%', '-l0', '-z', '--no-merges', '--relative', '--name-status', '--format=%x1e%H%x00%aI', '-n', String(historyLimit), '--', '.'], { windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 120000 });
      commits = parseLog(stdout, 2).map(({ date, changes }) => ({ date, changes }));
    }
    const entry = { head, commits, results: new Map<string, number | null>() };
    if (historyCache.size >= 100) historyCache.delete(historyCache.keys().next().value!);
    historyCache.set(key, entry);
    return entry;
  } catch {
    // Remember a failed log for this revision, so a slow or broken history is not read on every load.
    failedHistory.set(key, head);
    return null;
  }
}

/** The work folder and file a path ends in, such as `0012-export/plan.md`, to recognise a moved plan. */
const tail = (value: string) => sameKey(value.split('/').slice(-2).join('/'));
/** A work folder's registration number (`0012` of `0012-export`), or null when it has none. */
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
  let reports = new Map<string, WorkReport[]>();
  try {
    const canonical = await realpath(root);
    const read = (database: HomeDatabase) => {
      const project = database.projectByFolder(canonical);
      return project ? storedReports(database, project.id, work.map(item => item.id)) : new Map<string, WorkReport[]>();
    };
    reports = options.database ? read(options.database) : withDatabase(options.home, read);
  } catch { /* Without the database, no reports are known. */ }
  const result: Record<string, WorkStatistics> = {};
  for (const item of work) result[item.id] = { ...summarizeReports(reports.get(item.id) ?? []), planRevisions: revisions[item.id] ?? null };
  return result;
}
