// The planning-folder reader shared by the atlas command and the app. The diagram catalog
// (`@envsemble/atlas-planning/diagrams`) and app sessions (`@envsemble/atlas-planning/session`) lay
// diagrams out and are imported separately; checking a diagram loads only the diagram parser.
export { PlanningError, loadPlanning, readDocument, resolveDocument, gitHistory, normalizedLocation } from './reading/planning.ts';
export { filesystemCaseSensitive, filesystemNormalizesUnicode } from './system/filesystem.ts';
export { atlasAppRunning, atlasHome, homePlanningDirectory, homePlanningFolders, legacyData, legacyDataDirectory, legacySettings, migrateLegacyData, prepareHome, statisticsDirectory, type LegacyMigration } from './home/storage.ts';
export { DatabaseVersionError, HomeDatabase, NotPlanningFolderError, canonicalProjectFolder, canonicalProjectFolderSync, databaseName, folderKey, isPlanningFolder, liveWindowMs, planningName, projectOf, schemaVersion, waitingWindowMs, withDatabase, withDatabaseAsync, type ProjectRow, type ProjectState, type SessionActivityRow, type WorkActivityRow } from './home/database.ts';
export { importLegacyUsage, migrateHomeFiles, pendingHomeFiles, type HomeMigration } from './home/homeMigration.ts';
export { recordCollectionGap, recordView, usageSummary, type CollectionSource, type ViewEvent } from './statistics/telemetry.ts';
export { samePlatformPath } from './system/planningRoots.ts';
export { parseFrontmatter, validatePlanning, FrontmatterError } from './check/check.ts';
export { LedgerStatusError, ledgerStatus, ledgerStepStatuses, stepCounts } from './work/ledger.ts';
export { StatisticsReportError, createReport, importStatisticsFiles, insertReport, measuredModelLimit, measuredSubagentLimit, parseReport, planRevisions, sessionGap, statisticsFile, storedReports, summarizeReports, workStages, workStatistics, type StatisticsImport, type Measured, type MeasuredInterval, type MeasuredModel, type MeasuredSubagent, type MeasuredSubagents, type ReportInput, type StatisticsReport } from './statistics/statistics.ts';
export { harnessSessions, measureSession, sessionLogs, transcriptLogs, type Harness, type LogOptions, type SessionMeasure } from './statistics/sessionLog.ts';
export { prepareWorkReport, recordWorkReport, remeasureReports, type PreparedReport, type RecordedReport, type Remeasured, type WorkReportInput, type WorkReportOptions } from './statistics/workReport.ts';
export { documentIdentity, logConsultation, reportConsultation, recordAgentCollectionGap, type ConsultationOptions } from './statistics/consultation.ts';
export type * from './types.ts';
export {
  exportPlan, readPlanExport, importPlan, planImportTarget, planningRelative, planExportPathProblem,
  PlanExportError, planExportFormat, planExportVersion, planExportWarningBytes,
  type PlanExportManifest, type PlanExportSource, type PlanExportFile, type PlanExportRepository, type PlanExportDiagram,
  type PlanExportPreview, type PlanExportResult, type PlanImportResult, type PlanImportTarget, type PlanExportErrorCode,
} from './export/planExport.ts';
export { runProgram, ProgramError, type RunOptions } from './system/run.ts';
export { acquireFileLock } from './home/importLock.ts';
export { WorkError, summaryLimit, workStatus, createWork, acceptWork, startWork, addSteps, setStepStatus, renameStep, removeStep, setBlocked, closeWork, archiveWork, reopenWork, repairLinks, localDate, type ArchiveRequest, type WorkResult, type WorkStatus, type OperationOptions } from './work/work.ts';
export { findPlanning, insideFolder, readRegistry, resolvePlanningFolder, normalizeRemote, remoteWithoutCredentials, PlanningNotFoundError, type ActiveWork, type PlanningMatch, type ProjectBrief, type Whereabouts, type WorkBrief } from './projects/resolve.ts';
export { checkPaths, fileCheckers, planningFolderOf, type CheckResult, type FileChecker } from './check/checkPaths.ts';
export { adoptPlanningFolder, type Adopted } from './projects/adopt.ts';
export { projectSummary, workStatisticsBrief, type ProjectSummary, type ProjectWork, type ProjectWorkState, type ProjectWorkStatistics } from './projects/projectSummary.ts';
export { createProject, readTemplates, setProjectWorkspaces, type ProjectTemplates } from './projects/project.ts';
export { checkedWorkspaces, scanWorkspace, scanWorkspaces, workspaceLimit, type ProjectRepository, type SkippedCheckout, type WorkspaceScan } from './projects/workspaces.ts';
export { setRegistryMember, setRegistryName } from './work/registryText.ts';
