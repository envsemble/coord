// The planning-folder reader shared by the atlas command and the app. The diagram catalog
// (`@envsemble/atlas-planning/diagrams`) and app sessions (`@envsemble/atlas-planning/session`) lay
// diagrams out and are imported separately; checking a diagram loads only the diagram parser.
export { PlanningError, loadPlanning, readDocument, resolveDocument, gitHistory, normalizedLocation } from './planning.ts';
export { filesystemCaseSensitive, filesystemNormalizesUnicode } from './filesystem.ts';
export { atlasAppRunning, atlasHome, homePlanningDirectory, homePlanningFolders, legacyData, legacyDataDirectory, legacySettings, migrateLegacyData, prepareHome, statisticsDirectory, type LegacyMigration } from './storage.ts';
export { DatabaseVersionError, HomeDatabase, canonicalProjectFolder, databaseName, folderKey, planningName, projectOf, projectStates, schemaVersion, withDatabase, withDatabaseAsync, type ProjectRow, type ProjectState } from './database.ts';
export { importLegacyUsage, migrateHomeFiles, pendingHomeFiles, type HomeMigration } from './homeMigration.ts';
export { recordCollectionGap, recordView, usageSummary, type CollectionSource, type ViewEvent } from './telemetry.ts';
export { inspectPlanningRoot, samePlatformPath, type PlanningRootInfo } from './planningRoots.ts';
export { parseFrontmatter, validatePlanning, FrontmatterError } from './check.ts';
export { LedgerStatusError, ledgerStatus, ledgerStepStatuses, stepCounts } from './ledger.ts';
export { StatisticsReportError, createReport, importStatisticsFiles, insertReport, measuredModelLimit, measuredSubagentLimit, parseReport, planRevisions, sessionGap, statisticsFile, storedReports, summarizeReports, workStages, workStatistics, type StatisticsImport, type Measured, type MeasuredModel, type MeasuredSubagent, type MeasuredSubagents, type ReportInput, type StatisticsReport } from './statistics.ts';
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
export { acquireFileLock } from './importLock.ts';
export { WorkError, workStatus, createWork, acceptWork, startWork, addSteps, setStepStatus, renameStep, removeStep, setBlocked, closeWork, archiveWork, reopenWork, repairLinks, localDate, type ArchiveRequest, type WorkResult, type WorkStatus, type OperationOptions } from './work.ts';
export { findPlanning, resolvePlanningFolder, normalizeRemote, PlanningNotFoundError, type ActiveWork, type PlanningMatch, type Whereabouts } from './resolve.ts';
export { checkPaths, fileCheckers, planningFolderOf, type CheckResult, type FileChecker } from './checkPaths.ts';
export { adoptPlanningFolder, type Adopted } from './adopt.ts';
export { checkedProject, createProject, readTemplates, type ProjectRepository, type ProjectTemplates } from './project.ts';
export { setRegistryName } from './registryText.ts';
