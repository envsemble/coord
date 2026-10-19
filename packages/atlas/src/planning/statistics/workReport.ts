// `atlas work report`: record a ledger transition of one registered work item: its time, the model,
// the step and the work item's stage, and, when the command runs inside the agent's harness (or is
// given a session it keeps a log of, or the log itself, as hooks are), the agent time, tokens and
// subagents that log shows since the session's previous report on this work item (or since the
// session started on it, when the caller knows), with when each agent worked. The report goes into
// the home database, under the planning folder's project. The registry is read directly, without
// indexing the whole planning folder, so reporting stays fast. Reports from before working intervals
// are measured again from their logs, where those are still on this computer (remeasureReports).
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ledgerStatus } from '../work/ledger.ts';
import { normalizedLocation, readDocument } from '../reading/planning.ts';
import { harnessSessions, measureIntervals, measureSession, sessionLogs, transcriptLogs, type Harness, type LogOptions, type SessionCandidate, type SessionMeasure } from './sessionLog.ts';
import { createReport, fitStep, insertEfforts, insertIntervals, insertReport, spansMs, storedReports, StatisticsReportError, type Measured, type ReportInput, type StatisticsReport } from './statistics.ts';
import { projectOf, withDatabaseAsync, type HomeDatabase } from '../home/database.ts';
import type { WorkStage } from '../types.ts';

/** `project`: the name of the project the report was recorded under. */
export interface RecordedReport { project: string; report: StatisticsReport; warnings: string[] }
/** A report ready to record: the planning folder (its real path), the report and what to tell the caller. */
export interface PreparedReport { root: string; report: StatisticsReport; warnings: string[] }
/** What the caller gives: the model may come from the session log instead; the stage comes from the plan. */
export type WorkReportInput = Omit<ReportInput, 'model' | 'measured' | 'stage'> & { model?: string | null };
export interface WorkReportOptions extends LogOptions {
  /** The session amends an accepted plan: its work counts as planning. */
  amending?: boolean;
  /** The session's own log, as a hook names it (transcript_path): measured instead of searching by session. */
  transcriptPath?: string;
  /** When the session started on this work item (ISO time): measured from then, or from its previous report here if that is later. */
  since?: string;
  /** The Atlas home whose database records the report; ATLAS_HOME or ~/.atlas by default. */
  atlasHome?: string;
}
const harnessNames: Record<Harness, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Implementation once the work item's plan is accepted; planning before, also without a readable plan. */
async function designStage(root: string, plan: unknown): Promise<WorkStage> {
  try { return (await readDocument(root, normalizedLocation(plan))).metadata?.design_status === 'accepted' ? 'implementation' : 'planning'; }
  catch { return 'planning'; }
}

export async function recordWorkReport(inputRoot: string, workId: string, input: WorkReportInput, options: WorkReportOptions = {}): Promise<RecordedReport> {
  const { root, report, warnings } = await prepareWorkReport(inputRoot, workId, input, options);
  const project = await withDatabaseAsync(options.atlasHome, async database => {
    const found = await projectOf(database, root);
    insertReport(database, found.id, workId, report);
    return found;
  });
  return { project: project.name, report, warnings };
}

/**
 * Measure a report without recording it, so a hook can record it in one transaction with what else
 * changes then. The database names every model and subagent, so the report keeps them all.
 */
export async function prepareWorkReport(inputRoot: string, workId: string, input: WorkReportInput, options: WorkReportOptions = {}): Promise<PreparedReport> {
  const warnings: string[] = [];
  // A long or multi-line step is recorded shortened rather than losing the whole report.
  let step = input.step ?? null;
  let shortened = false;
  if (typeof step === 'string') {
    const fitted = fitStep(step);
    step = fitted.step;
    shortened = fitted.shortened;
    if (fitted.note) warnings.push(fitted.note);
  }
  const at = input.at ?? new Date();
  // What was given is checked before anything is read.
  createReport({ ...input, model: input.model ?? 'unknown', step, at });
  const root = await realpath(inputRoot).catch(() => { throw new StatisticsReportError('The planning folder does not exist: ' + inputRoot); });
  let registry: unknown;
  try { registry = JSON.parse((await readFile(path.join(root, 'planning.json'), 'utf8')).replace(/^\uFEFF/, '')); }
  catch { throw new StatisticsReportError('The planning folder needs a readable planning.json registry.'); }
  const items = (registry as { work_items?: unknown })?.work_items;
  if (!Array.isArray(items)) throw new StatisticsReportError('The planning registry has no work_items list.');
  const item = items.find(entry => entry && typeof entry === 'object' && (entry as { id?: unknown }).id === workId) as { path?: unknown; current_plan?: unknown } | undefined;
  if (!item) throw new StatisticsReportError(workId + ' is not a registered work item.');
  const location = normalizedLocation(item.path);
  if (!(await stat(path.join(root, location)).then(info => info.isDirectory(), () => false))) throw new StatisticsReportError('The work folder ' + location + ' does not exist.');
  const stage = options.amending ? 'planning' : await designStage(root, item.current_plan);
  // The work item's reports so far, to measure from the session's previous one.
  const earlier = await withDatabaseAsync(options.atlasHome, async database => storedReports(database, (await projectOf(database, root)).id, [workId]).get(workId) ?? []);

  // The session: the log a hook names, else the session given, else the one the harness names in the
  // environment. Harnesses name sessions with UUIDs; a session named otherwise has no log to read.
  const own = harnessSessions(options.environment ?? process.env);
  const given = input.session ? { harness: own.find(entry => entry.session === input.session)?.harness ?? null, session: input.session } : null;
  const candidates: SessionCandidate[] = given ? (given.harness || uuid.test(given.session) ? [given] : []) : own;
  const transcript = options.transcriptPath || null;
  let session = input.session ?? own[0]?.session ?? null;
  let measure: SessionMeasure | null = null, since: string | null = null, failure: string | null = null;
  if (transcript || candidates.length) {
    try {
      const logs = transcript ? await transcriptLogs(transcript) : await sessionLogs(candidates, options);
      const harnesses = new Set(candidates.map(entry => entry.harness));
      if (!logs && transcript) throw new Error(transcript + ' is not a Claude Code or Codex session log');
      if (!logs) throw new Error('no ' + (harnesses.size === 1 && !harnesses.has(null) ? harnessNames[candidates[0].harness!] : 'Claude Code or Codex') + ' log of session ' + session + ' was found on this computer');
      session = logs.session;
      // The session's previous report here starts the interval, or when the session started on the
      // work, if known and later; without either, this first report is the starting point.
      const previous = earlier.filter(report => report.session === session && report.at <= at.toISOString()).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
      const startedAt = options.since ? Date.parse(options.since) : NaN;
      const started = startedAt <= at.getTime() ? new Date(startedAt).toISOString() : null;
      since = [previous?.at ?? null, started].filter((value): value is string => value !== null).sort().at(-1) ?? null;
      // A hook runs inside the session; so does a report naming the session the environment names.
      measure = await measureSession(logs, { since: since === null ? null : Date.parse(since), at: at.getTime(), live: transcript !== null || own.some(entry => entry.session === logs.requested) });
    } catch (error) {
      failure = (error instanceof Error ? error.message : String(error)).replace(/\.$/, '');
      warnings.push('Agent time and tokens were not measured: ' + failure + '.');
    }
  }
  const model = measure?.mainModel ?? input.model ?? null;
  if (!model) throw new StatisticsReportError('The model is unknown' + (transcript || candidates.length ? ' (' + (failure ?? 'the session log does not name it') + ')' : '') + ': give it with --model.');
  let measured: Measured | null = null;
  if (measure && since !== null) {
    measured = { since, agentMs: measure.agentMs, models: measure.models };
    const helpers = measure.subagents;
    if (helpers.length) measured.subagents = { count: helpers.length, agentMs: helpers.reduce((total, agent) => total + agent.agentMs, 0), tokens: helpers.reduce((total, agent) => total + agent.tokens, 0), agents: helpers };
    measured.intervals = measure.intervals;
    if (measure.efforts.length) measured.efforts = measure.efforts;
  }
  let report: StatisticsReport;
  try { report = createReport({ ...input, model, session, step, stage, at, measured }, Number.POSITIVE_INFINITY); }
  catch (error) {
    if (!measured) throw error;
    warnings.push('The measurement was left out: ' + (error as Error).message);
    report = createReport({ ...input, model, session, step, stage, at });
  }
  if (report.step) {
    // A step that the ledger does not list is still recorded; the agent is told so.
    try {
      const { metadata } = await readDocument(root, location + '/ledger.md');
      const status = metadata ? ledgerStatus(metadata, workId) : null;
      // Compare as the report records titles: one line, shortened the same way.
      if (status?.steps && !status.steps.some(entry => fitStep(entry.title).step === report.step || (shortened && entry.title.startsWith(report.step!.slice(0, -1))))) warnings.push('The step "' + report.step + '" is not one of the ledger\'s steps.');
    } catch { /* No readable ledger: the step stays as reported. */ }
  }
  return { root, report, warnings };
}

/** What measuring older reports again did: the reports measured, those whose logs are gone, and those still waiting. */
export interface Remeasured { measured: number; missing: number; left: number }

/**
 * Measure reports from before working intervals again from their sessions' logs, where those are
 * still on this computer, one session at a time until `budgetMs` has passed or `stopped` says
 * so: their intervals, and their agent time as every agent's time added up, each model's too. A
 * report whose logs are gone, or whose log now shows less than it recorded (cut short since), keeps
 * its total. Each report is tried once; other processes may do the same at once without counting
 * one twice.
 */
export async function remeasureReports(database: HomeDatabase, options: LogOptions & { budgetMs?: number; stopped?: () => boolean } = {}): Promise<Remeasured> {
  const started = Date.now();
  const rows = database.db.prepare('SELECT id, session, at, measured_since, agent_ms FROM work_report WHERE intervals IS NULL AND measured_since IS NOT NULL ORDER BY session, at').all() as Record<string, unknown>[];
  const sessions = new Map<string | null, Record<string, unknown>[]>();
  for (const row of rows) {
    const session = (row.session as string | null) ?? null;
    sessions.set(session, [...sessions.get(session) ?? [], row]);
  }
  const result: Remeasured = { measured: 0, missing: 0, left: rows.length };
  for (const [session, reports] of sessions) {
    if (Date.now() - started > (options.budgetMs ?? 20_000) || options.stopped?.()) break;
    let measures: SessionMeasure[] = [];
    try {
      const saved = session === null ? null : (database.db.prepare('SELECT transcript_path FROM session WHERE id = ?').get(session) as { transcript_path: string | null } | undefined)?.transcript_path;
      const logs = session === null ? null : (saved ? await transcriptLogs(saved) : null) ?? await sessionLogs([{ harness: null, session }], options);
      if (logs) measures = await measureIntervals(logs, reports.map(report => ({ since: Date.parse(String(report.measured_since)), at: Date.parse(String(report.at)) })));
    } catch { /* Its logs cannot be read: its reports keep their totals. */ }
    if (options.stopped?.()) break;
    database.transaction(() => {
      const settle = database.db.prepare('UPDATE work_report SET intervals = ?, agent_ms = ? WHERE id = ? AND intervals IS NULL');
      const model = database.db.prepare('UPDATE report_model SET agent_ms = ? WHERE report_id = ? AND model = ?');
      reports.forEach((report, index) => {
        const measure = measures[index];
        const recorded = Number(report.agent_ms);
        const kept = measure && spansMs(measure.intervals.map((interval): [number, number] => [Date.parse(interval.start), Date.parse(interval.end)])) + 60_000 >= recorded * 0.9;
        // Another process may have measured it meanwhile.
        if (!settle.run(kept ? 1 : 0, kept ? measure.agentMs : recorded, Number(report.id)).changes) return;
        result.left--;
        if (!kept) { result.missing++; return; }
        insertIntervals(database, Number(report.id), measure.intervals);
        insertEfforts(database, Number(report.id), measure.efforts);
        for (const item of measure.models) model.run(item.agentMs, Number(report.id), item.model);
        result.measured++;
      });
    });
  }
  return result;
}
