// The planning-folder reader shared by the atlas command and the app. Model discovery
// (`@envsemble/atlas-planning/atlas`) and app sessions (`@envsemble/atlas-planning/session`) load the diagram
// package and are imported separately, so the command's planning checks stay light.
export { PlanningError, loadPlanning, readDocument, resolveDocument, gitHistory, normalizedLocation } from './planning.ts';
export { filesystemCaseSensitive, filesystemNormalizesUnicode } from './filesystem.ts';
export { atlasDataDirectory, cacheOutsidePlanning, recentRootsFile, statisticsDirectory } from './storage.ts';
export { Telemetry, recordCollectionGap, schema, type ViewEvent } from './telemetry.ts';
export { RecentPlanningRoots, inspectPlanningRoot, samePlatformPath, type PlanningRootInfo } from './planningRoots.ts';
export { parseFrontmatter, validatePlanning, FrontmatterError } from './check.ts';
export { LedgerStatusError, ledgerStatus, ledgerStepStatuses, stepCounts } from './ledger.ts';
export { StatisticsReportError, appendReport, createReport, parseReport, planRevisions, readReports, sessionGap, statisticsFile, summarizeReports, workStatistics, type ReportInput, type StatisticsReport } from './statistics.ts';
export { recordWorkReport, type RecordedReport } from './workReport.ts';
export { documentIdentity, logConsultation, reportConsultation, recordAgentCollectionGap, type ConsultationOptions } from './consultation.ts';
export type * from './types.ts';
export {
  exportPlan, readPlanExport, importPlan, planImportTarget, planningRelative, planExportPathProblem,
  PlanExportError, planExportFormat, planExportVersion, planExportWarningBytes,
  type PlanExportManifest, type PlanExportSource, type PlanExportFile, type PlanExportRepository, type PlanExportDiagram,
  type PlanExportPreview, type PlanExportResult, type PlanImportResult, type PlanImportTarget, type PlanExportErrorCode,
} from './planExport.ts';
