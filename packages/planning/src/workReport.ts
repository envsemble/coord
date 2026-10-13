// `atlas work report`: record a ledger transition of one registered work item: its time, the model
// and the step, and, when the command runs inside the agent's harness (or is given a session it
// keeps a log of), the agent time and tokens that log shows since the session's previous report on
// this work item. The registry is read directly, without indexing the whole planning folder, so
// reporting stays fast.
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ledgerStatus } from './ledger.ts';
import { normalizedLocation, readDocument } from './planning.ts';
import { harnessSessions, measureSession, sessionLogs, type Harness, type LogOptions, type SessionCandidate, type SessionMeasure } from './sessionLog.ts';
import { appendReport, createReport, fitStep, measuredModelLimit, readReports, StatisticsReportError, type Measured, type ReportInput, type StatisticsReport } from './statistics.ts';

export interface RecordedReport { file: string; report: StatisticsReport; warnings: string[] }
/** What the caller gives: the model may come from the session log instead. */
export type WorkReportInput = Omit<ReportInput, 'model' | 'measured'> & { model?: string | null };
const harnessNames: Record<Harness, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordWorkReport(inputRoot: string, workId: string, input: WorkReportInput, options: LogOptions = {}): Promise<RecordedReport> {
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
  const item = items.find(entry => entry && typeof entry === 'object' && (entry as { id?: unknown }).id === workId) as { path?: unknown } | undefined;
  if (!item) throw new StatisticsReportError(workId + ' is not a registered work item.');
  const location = normalizedLocation(item.path);
  if (!(await stat(path.join(root, location)).then(info => info.isDirectory(), () => false))) throw new StatisticsReportError('The work folder ' + location + ' does not exist.');

  // The session: the one given, else the one the harness names in the environment. Harnesses name
  // sessions with UUIDs; a session named otherwise has no log to read.
  const own = harnessSessions(options.environment ?? process.env);
  const given = input.session ? { harness: own.find(entry => entry.session === input.session)?.harness ?? null, session: input.session } : null;
  const candidates: SessionCandidate[] = given ? (given.harness || uuid.test(given.session) ? [given] : []) : own;
  let session = input.session ?? own[0]?.session ?? null;
  let measure: SessionMeasure | null = null, since: string | null = null, failure: string | null = null;
  if (candidates.length) {
    try {
      const logs = await sessionLogs(candidates, options);
      const harnesses = new Set(candidates.map(entry => entry.harness));
      if (!logs) throw new Error('no ' + (harnesses.size === 1 && !harnesses.has(null) ? harnessNames[candidates[0].harness!] : 'Claude Code or Codex') + ' log of session ' + session + ' was found on this computer');
      session = logs.session;
      // The session's previous report here starts the interval; its first report is the starting point.
      const previous = (await readReports(root, { path: location })).reports.filter(report => report.session === session && report.at <= at.toISOString()).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
      since = previous?.at ?? null;
      measure = await measureSession(logs, { since: since === null ? null : Date.parse(since), at: at.getTime(), live: own.some(entry => entry.session === logs.requested) });
    } catch (error) {
      failure = (error instanceof Error ? error.message : String(error)).replace(/\.$/, '');
      warnings.push('Agent time and tokens were not measured: ' + failure + '.');
    }
  }
  const model = measure?.mainModel ?? input.model ?? null;
  if (!model) throw new StatisticsReportError('The model is unknown' + (candidates.length ? ' (' + (failure ?? 'the session log does not name it') + ')' : '') + ': give it with --model.');
  const measured: Measured | null = measure && since !== null ? { since, agentMs: measure.agentMs, models: measure.models.slice(0, measuredModelLimit) } : null;
  let report: StatisticsReport;
  try { report = createReport({ ...input, model, session, step, at, measured }); }
  catch (error) {
    if (!measured) throw error;
    warnings.push('The measurement was left out: ' + (error as Error).message);
    report = createReport({ ...input, model, session, step, at });
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
  const file = await appendReport(root, { path: location }, report);
  return { file, report, warnings };
}
