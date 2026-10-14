// The planning-folder reader shared by the atlas command and the app. The diagram catalog
// (`@envsemble/atlas-planning/diagrams`) and app sessions (`@envsemble/atlas-planning/session`) lay
// diagrams out and are imported separately; checking a diagram loads only the diagram parser.
export { PlanningError, loadPlanning, readDocument, resolveDocument, gitHistory, normalizedLocation } from './planning.ts';
export { filesystemCaseSensitive, filesystemNormalizesUnicode } from './filesystem.ts';
export { atlasHome, cacheOutsidePlanning, homePlanningDirectory, homePlanningFolders, legacyDataDirectory, migrateLegacyData, prepareHome, recentRootsFile, statisticsDirectory } from './storage.ts';
export { Telemetry, recordCollectionGap, schema, type ViewEvent } from './telemetry.ts';
export { RecentPlanningRoots, inspectPlanningRoot, samePlatformPath, type PlanningRootInfo } from './planningRoots.ts';
export { parseFrontmatter, validatePlanning, FrontmatterError } from './check.ts';
export { LedgerStatusError, ledgerStatus, ledgerStepStatuses, stepCounts } from './ledger.ts';
export { StatisticsReportError, appendReport, createReport, measuredModelLimit, measuredSubagentLimit, parseReport, planRevisions, readReports, sessionGap, statisticsFile, summarizeReports, workStages, workStatistics, type Measured, type MeasuredModel, type MeasuredSubagent, type MeasuredSubagents, type ReportInput, type StatisticsReport } from './statistics.ts';
export { harnessSessions, measureSession, sessionLogs, transcriptLogs, type Harness, type LogOptions, type SessionMeasure } from './sessionLog.ts';
export { recordWorkReport, type RecordedReport, type WorkReportInput, type WorkReportOptions } from './workReport.ts';
export { documentIdentity, logConsultation, reportConsultation, recordAgentCollectionGap, type ConsultationOptions } from './consultation.ts';
export type * from './types.ts';
export {
  exportPlan, readPlanExport, importPlan, planImportTarget, planningRelative, planExportPathProblem,
  PlanExportError, planExportFormat, planExportVersion, planExportWarningBytes,
  type PlanExportManifest, type PlanExportSource, type PlanExportFile, type PlanExportRepository, type PlanExportDiagram,
  type PlanExportPreview, type PlanExportResult, type PlanImportResult, type PlanImportTarget, type PlanExportErrorCode,
} from './planExport.ts';
export { runProgram, ProgramError, type RunOptions } from './run.ts';
export { WorkError, workStatus, createWork, acceptWork, startWork, addSteps, setStepStatus, renameStep, removeStep, setBlocked, closeWork, archiveWork, reopenWork, repairLinks, localDate, type WorkResult, type WorkStatus, type OperationOptions } from './work.ts';
export { findPlanning, resolvePlanningFolder, normalizeRemote, PlanningNotFoundError, type ActiveWork, type PlanningMatch, type Whereabouts } from './resolve.ts';
export { checkPaths, fileCheckers, planningFolderOf, type CheckResult, type FileChecker } from './checkPaths.ts';
export { adoptPlanningFolder, type Adopted } from './adopt.ts';
