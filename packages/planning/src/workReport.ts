// `atlas work report`: record what an agent reports at a ledger transition (its model, tokens so
// far in its session, and the step) for one registered work item. The registry is read directly,
// without indexing the whole planning folder, so reporting stays fast.
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ledgerStatus } from './ledger.ts';
import { normalizedLocation, readDocument } from './planning.ts';
import { appendReport, createReport, fitStep, StatisticsReportError, type ReportInput, type StatisticsReport } from './statistics.ts';

export interface RecordedReport { file: string; report: StatisticsReport; warnings: string[] }

export async function recordWorkReport(inputRoot: string, workId: string, input: ReportInput): Promise<RecordedReport> {
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
  const report = createReport({ ...input, step });
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
