export { Project, serializationUtils } from "ontouml-js";
export type LocalizedText = Record<string, string> | null;
export interface ExchangeElement {
  id: string;
  type: string;
  [field: string]: unknown;
}
export interface ExchangeProject {
  id: string;
  type: "Project";
  root: string | null;
  elements: ExchangeElement[];
  name?: LocalizedText;
  created?: string | null;
  [field: string]: unknown;
}
export interface SourceRecord {
  id: string;
  file: string;
  title: string;
  claim: string;
  repo?: string;
  commit?: string;
  line?: number;
  url?: string;
  anchor?: string;
}
export interface ModelingQuestion {
  question: string;
  why: string;
  resolve: string;
}
export interface ElementEvidence {
  evidence?: string[];
  primarySource?: string;
  status?: "observed" | "inferred" | "unresolved";
  rationale?: string;
  questions?: ModelingQuestion[];
}
export interface ModelEvidence {
  title?: string;
  version?: string;
  status?: string;
  repositories?: { repo: string; commit: string }[];
  sources?: SourceRecord[];
  elements?: Record<string, ElementEvidence>;
  unknowns?: string[];
  constraints?: string[][];
}
export interface ValidationIssue {
  code: string;
  severity: "error" | "warning" | "info";
  layer: string;
  elementId: string | null;
  message: string;
  path?: string;
  documentation?: string;
}
export interface ValidationReport {
  valid: boolean;
  schema: string;
  engines: { name: string; version: string; layer: string }[];
  issues: ValidationIssue[];
  counts: { error: number; warning: number; info: number };
  limitations: string[];
  modelCounts?: { classes: number; relations: number; generalizations: number };
  diagrams?: Record<string, unknown>[];
}
export interface Attribute {
  id?: string;
  name: string;
  type: string;
  multiplicity?: string | null;
}
export interface ViewerClass extends ElementEvidence {
  id: string;
  name: string;
  stereotype: string;
  packageId?: string;
  description: string;
  isAbstract?: boolean;
  evidence: string[];
  attributes: Attribute[];
  methods?: Attribute[];
}
export interface ViewerAssociation extends ElementEvidence {
  id: string;
  name: string;
  stereotype: string;
  sourceId: string;
  targetId: string;
  sourceMultiplicity: string;
  targetMultiplicity: string;
  sourceAggregation?: string;
  targetAggregation?: string;
  description: string;
  evidence: string[];
}
export interface ViewerGeneralization extends ElementEvidence {
  id: string;
  specificId: string;
  generalId: string;
  evidence: string[];
}
export interface ViewerGeneralizationSet extends ElementEvidence {
  id: string;
  name: string;
  description?: string;
  complete: boolean;
  disjoint: boolean;
  generalizations: string[];
  evidence: string[];
}
export interface ViewerModel {
  id: string;
  title: string;
  version: string;
  date: string;
  status: string;
  repositories: { repo: string; commit: string }[];
  sources: SourceRecord[];
  classes: ViewerClass[];
  relations: ViewerAssociation[];
  generalizations: ViewerGeneralization[];
  partitions: ViewerGeneralizationSet[];
  constraints: string[][];
  unknowns: string[];
  validation?: ValidationReport;
  document?: {
    id: string;
    profile: ModelProfile;
    state: AtlasDocument["state"];
    revision: AtlasDocument["revision"];
    baselineId: string | null;
    snapshots: Omit<SourceSnapshot, "model">[];
    context: PlanningContext;
    imported?: boolean;
    comparison?: AtlasDocument["comparison"] & { changes?: SemanticComparison };
    mappings?: AuthoredMapping[];
  };
}
export interface ViewSettings {
  key: string;
  nodeIds: string[];
  label?: string;
  title?: string;
  edgeIds?: string[];
  focusIds?: string[];
  columns?: string[][];
  mergeGeneralizations?: boolean;
  direction?: "RIGHT" | "DOWN";
}
export interface DiagramNode {
  id: string;
  name: string;
  stereotype: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isAbstract?: boolean;
  attributes: Attribute[];
  methods?: Attribute[];
  changeStatus?: "added" | "removed" | "modified" | "unchanged";
}
export interface DiagramLabel {
  id: string;
  text: string;
  kind: "source" | "target" | "name";
  nodeId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DiagramEdge {
  id: string;
  type: "association" | "generalization";
  source: string;
  target: string;
  sourceName: string;
  targetName: string;
  name: string;
  realization?: boolean;
  stereotype: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  sourceAggregation?: string;
  targetAggregation?: string;
  paths: string[];
  branchPaths?: string[];
  labels: DiagramLabel[];
  changeStatus?: "added" | "removed" | "modified" | "unchanged";
}
export interface DiagramGeneralizationGroup {
  id: string;
  type: "generalizationSet" | "generalizationJoin";
  name: string;
  realization?: boolean;
  complete?: boolean;
  disjoint?: boolean;
  memberIds: string[];
  sourceIds: string[];
  target: string;
  sourceNames: string[];
  targetName: string;
  totalMembers: number;
  paths: string[];
  labels: DiagramLabel[];
}
export interface DiagramScene {
  key: string;
  title: string;
  fields: boolean;
  width: number;
  height: number;
  initialFocus: string[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  generalizationGroups?: DiagramGeneralizationGroup[];
}
export interface PreparedView {
  key: string;
  label: string;
  title: string;
  nodeIds: string[];
  diagram: DiagramScene;
  diagramFields: DiagramScene;
  svg?: string;
  svgFields?: string;
}
export interface SourceExcerpt {
  repo?: string;
  commit?: string;
  file: string;
  startLine: number;
  language: string;
  code: string;
}
export interface HighlightedExcerpt {
  language: string;
  startLine: number;
  endLine: number;
  code: string;
  url: string | null;
  lines: { content: string; style: Record<string, string> }[][];
}
export interface ExportData {
  slug: string;
  bundle: string;
}
export interface ViewerPayload {
  model: ViewerModel & { validation: ValidationReport };
  views: Pick<
    PreparedView,
    "key" | "label" | "title" | "nodeIds" | "diagram" | "diagramFields"
  >[];
  exports: ExportData;
  snippets: Record<string, HighlightedExcerpt>;
  comparison?: {
    baseline: Pick<ViewerPayload, "model" | "views" | "snippets" | "exports">;
    changeView?: Pick<
      ViewerPayload,
      "model" | "views" | "snippets" | "exports"
    >;
    changes: SemanticComparison;
    conflicts: MergeConflict[];
  } | null;
}
export interface PreparedViewer {
  artifacts: Map<string, string | Uint8Array>;
  report: ValidationReport;
  model: ViewerModel & { validation: ValidationReport };
  views: PreparedView[];
  payload: ViewerPayload;
}
export interface BuildResult extends PreparedViewer {
  html: string;
}
export function validateProject(project: unknown): ValidationReport;
export function validateEvidence(
  project: ExchangeProject,
  evidence?: ModelEvidence,
): ValidationIssue[];
export function validateModel(
  project: unknown,
  evidence?: ModelEvidence,
): ValidationReport;
export function toViewerModel(
  project: ExchangeProject,
  evidence?: ModelEvidence,
): ViewerModel;
export function mergeProjects(
  inputs: { key: string; project: ExchangeProject }[],
  options?: { id?: string; name?: string },
): ExchangeProject;
export interface ViewerBuildInput {
  project?: ExchangeProject;
  document?: AtlasDocument;
  includeArtifacts?: boolean;
  evidence?: ModelEvidence;
  views?: ViewSettings[];
  snippets?: Record<string, SourceExcerpt>;
  slug?: string;
}
export type ModelProfile = "ontouml" | "database" | "code";
export interface StructuralNode {
  id: string;
  name: string;
  kind?: string;
  attributes: Attribute[];
  [field: string]: unknown;
}
export interface StructuralModel {
  type: "StructuralModel";
  nodes: StructuralNode[];
  relations: (Pick<
    ViewerAssociation,
    | "id"
    | "name"
    | "sourceId"
    | "targetId"
    | "sourceMultiplicity"
    | "targetMultiplicity"
  > &
    Partial<ViewerAssociation> &
    Record<string, unknown>)[];
  generalizations: (Pick<
    ViewerGeneralization,
    "id" | "specificId" | "generalId"
  > &
    Partial<ViewerGeneralization>)[];
  generalizationSets: (Pick<
    ViewerGeneralizationSet,
    "id" | "name" | "generalizations" | "complete" | "disjoint"
  > &
    Partial<ViewerGeneralizationSet>)[];
  [field: string]: unknown;
}
export interface CaptureMetadata {
  capturedAt: string;
  adapter: { id: string; version: string; [key: string]: unknown };
  source: {
    kind: string;
    identity: string;
    scope: string[];
    [key: string]: unknown;
  };
  coverage: {
    status: "complete" | "partial";
    diagnostics: Record<string, unknown>[];
    [key: string]: unknown;
  };
  [field: string]: unknown;
}
export interface SourceSnapshot {
  id: string;
  profile: ModelProfile;
  model: ExchangeProject | StructuralModel;
  capture: CaptureMetadata;
  integrity: string;
}
export interface PlanningContext {
  records: {
    id: string;
    kind: "plan" | "glossary" | "decision" | "scenario";
    text: string;
    [field: string]: unknown;
  }[];
  links: { elementId: string; recordId: string; [field: string]: unknown }[];
}
export interface AtlasDocument {
  format: "atlas/document";
  formatVersion: 1;
  id: string;
  title: string;
  profile: ModelProfile;
  state: "authored" | "snapshot" | "proposal";
  model: ExchangeProject | StructuralModel;
  evidence: ModelEvidence;
  views: ViewSettings[];
  snippets: Record<string, SourceExcerpt>;
  context: PlanningContext;
  snapshots: SourceSnapshot[];
  baselineId: string | null;
  imported?: boolean;
  mappings?: AuthoredMapping[];
  comparison?: {
    originDocumentId?: string;
    ancestorRevision?: string;
    ancestorRevisions?: string[];
    parents?: string[];
    conflicts?: MergeConflict[];
    [key: string]: unknown;
  };
  workId?: string;
  revision: {
    id: string;
    parentId: string | null;
    createdAt: string;
    reason: string;
  };
}
export function createDocument(
  input: Partial<Omit<AtlasDocument, "revision">> & {
    project?: ExchangeProject;
    parentId?: string;
    createdAt?: string;
    reason?: string;
  },
): AtlasDocument;
export function reviseDocument(
  document: AtlasDocument,
  changes: Partial<
    Pick<
      AtlasDocument,
      "title" | "model" | "evidence" | "views" | "snippets" | "context"
    >
  > & { reason?: string },
  expectedRevision?: string,
): AtlasDocument;
export function validateDocument(document: unknown): ValidationReport;
export function createSnapshot(input: {
  profile: ModelProfile;
  model: ExchangeProject | StructuralModel;
  capture: CaptureMetadata;
  id?: string;
}): SourceSnapshot;
export function documentViewerModel(document: AtlasDocument): ViewerModel;
export function importDocument(input: string | Uint8Array): AtlasDocument;
export interface AtlasToolArguments {
  atlas_map: {
    handle: string;
    targetHandle: string;
    expectedRevision: string;
    id: string;
    elementId: string;
    targetElementId: string;
    reason: string;
  };
  atlas_proposal: { handle: string; title?: string };
  atlas_compare: {
    handle: string;
    baseHandle?: string;
    offset?: number;
    limit?: number;
  };
  atlas_merge: {
    ancestorHandle: string;
    leftHandle: string;
    rightHandle: string;
  };
  atlas_resolve_merge: {
    handle: string;
    expectedRevision: string;
    choices: { conflictId: string; choice: "left" | "right" | "base" }[];
  };
  atlas_adopt_snapshot: {
    handle: string;
    capturedHandle: string;
    expectedRevision: string;
  };
  atlas_capture_code: { file: string; workId?: string };
  atlas_capture_database: { file: string; workId?: string };
  atlas_create: { input: Parameters<typeof createDocument>[0] };
  atlas_load: { file: string };
  atlas_import: { file: string };
  atlas_list: { workId?: string; offset?: number; limit?: number };
  atlas_inspect: {
    handle: string;
    elementId?: string;
    offset?: number;
    limit?: number;
  };
  atlas_revise: {
    handle: string;
    expectedRevision: string;
    changes?: Parameters<typeof reviseDocument>[1];
    operations?: {
      action: "upsert" | "delete";
      collection:
        | "elements"
        | "nodes"
        | "relations"
        | "generalizations"
        | "generalizationSets";
      id: string;
      value?: Record<string, unknown>;
    }[];
  };
  atlas_validate: { handle: string; offset?: number; limit?: number };
  atlas_prepare: { handle: string };
  atlas_export: { handle: string; file?: string };
}
export interface AtlasWorkspace {
  readonly root: string;
  load(handle: string): AtlasDocument;
  execute<T extends keyof AtlasToolArguments>(
    name: T,
    args: AtlasToolArguments[T],
  ): Promise<AtlasToolResults[T] | AtlasResultReference>;
}
export interface AtlasModelSummary {
  handle: string;
  id: string;
  title: string;
  profile: ModelProfile;
  state: AtlasDocument["state"];
  revision: string;
  workId: string | null;
  conflicts: number;
  elements: number;
  baselineId: string | null;
  file: string;
  captures: {
    id: string;
    capturedAt: string;
    coverage: "complete" | "partial";
  }[];
}
export interface AtlasResultReference {
  handle: string | null;
  revision: string | null;
  resultFile: string;
  notice: string;
}
export interface AtlasToolResults {
  atlas_map: AtlasModelSummary;
  atlas_proposal: AtlasModelSummary;
  atlas_compare: SemanticComparison & { total: number; offset: number };
  atlas_merge: AtlasModelSummary;
  atlas_resolve_merge: AtlasModelSummary;
  atlas_adopt_snapshot: AtlasModelSummary;
  atlas_capture_code: AtlasModelSummary;
  atlas_capture_database: AtlasModelSummary;
  atlas_create: AtlasModelSummary;
  atlas_load: AtlasModelSummary;
  atlas_import: AtlasModelSummary;
  atlas_revise: AtlasModelSummary;
  atlas_list: { total: number; offset: number; models: AtlasModelSummary[] };
  atlas_inspect: AtlasModelSummary & {
    offset?: number;
    items?: { id: string; name: unknown; type: string }[];
    element?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
    context?: PlanningContext["records"];
  };
  atlas_validate: Pick<
    ValidationReport,
    "valid" | "counts" | "issues" | "limitations" | "schema"
  > & { total: number; offset: number };
  atlas_prepare: AtlasModelSummary & {
    payloadFile: string;
    views: { key: string; title: string; nodes: number }[];
    validation: ValidationReport["counts"];
  };
  atlas_export: AtlasModelSummary & {
    htmlFile: string;
    bytes: number;
    validation: ValidationReport["counts"];
  };
}
export function createWorkspace(root: string): AtlasWorkspace;
export interface ValueCell {
  present: boolean;
  value?: unknown;
}
export interface SemanticChange {
  id: string;
  elementId: string | null;
  ownerId: string | null;
  kind: "added" | "removed" | "modified";
  name: unknown;
  properties: { key: string; before: ValueCell; after: ValueCell }[];
  rationale?: PlanningContext["records"];
  evidence?: unknown;
}
export interface SemanticComparison {
  changes: SemanticChange[];
  counts: Record<"added" | "removed" | "modified", number>;
  limitations: string[];
  baseRevision?: string;
  proposedRevision?: string;
  missingRationale?: string[];
}
export interface MergeConflict {
  id: string;
  path: string[];
  base: ValueCell;
  left: ValueCell;
  right: ValueCell;
  reason: string;
}
export interface AuthoredMapping {
  id: string;
  kind: "authored";
  elementId: string;
  snapshotId: string;
  targetElementId: string;
  reason: string;
  targetProfile?: ModelProfile;
  targetTitle?: string;
  targetRevision?: string;
}
export function compareModels(
  base: unknown,
  proposed: unknown,
): SemanticComparison;
export function compareDocuments(
  base: AtlasDocument,
  proposed: AtlasDocument,
): SemanticComparison;
export function createProposal(
  base: AtlasDocument,
  options?: { id?: string; title?: string; reason?: string },
): AtlasDocument;
export function mergeDocuments(
  ancestor: AtlasDocument,
  left: AtlasDocument,
  right: AtlasDocument,
  options?: { id?: string; reason?: string },
): AtlasDocument;
export function resolveMerge(
  document: AtlasDocument,
  choices: { conflictId: string; choice: "left" | "right" | "base" }[],
  expectedRevision?: string,
): AtlasDocument;
export function adoptSnapshot(
  document: AtlasDocument,
  captured: AtlasDocument,
  expectedRevision?: string,
): AtlasDocument;
export function linkMapping(
  document: AtlasDocument,
  target: AtlasDocument,
  mapping: {
    id: string;
    elementId: string;
    targetElementId: string;
    reason: string;
  },
  expectedRevision?: string,
): AtlasDocument;
export interface CodeCaptureProject {
  identity: string;
  path: string;
  repositoryUrl?: string;
}
export function captureTypeScript(options: {
  identity: string;
  title?: string;
  workId?: string;
  projects: (CodeCaptureProject & { tsconfig?: string })[];
}): Promise<AtlasDocument>;
export function captureJava(options: {
  identity: string;
  title?: string;
  workId?: string;
  java?: string;
  projects: (CodeCaptureProject & { files: string[]; classpath?: string[] })[];
}): Promise<AtlasDocument>;
export interface DatabaseCaptureOptions {
  identity: string;
  title?: string;
  workId?: string;
  schemas?: string[];
  tables?: string[];
  references?: {
    table: string;
    schema?: string;
    file: string;
    title?: string;
    url?: string;
  }[];
}
export function captureSQLite(
  options: DatabaseCaptureOptions & { file: string },
): Promise<AtlasDocument>;
export function capturePostgres(
  options: Omit<DatabaseCaptureOptions, "tables"> & {
    connectionString: string;
    schemas: string[];
  },
): Promise<AtlasDocument>;
export function captureD1(
  options: DatabaseCaptureOptions & {
    queryBatch(queries: string[]): Promise<Record<string, unknown>[][]>;
    execution?: string;
  },
): Promise<AtlasDocument>;
export const toolDefinitions: {
  name: keyof AtlasToolArguments;
  description: string;
  inputSchema: Record<string, unknown>;
}[];
export function prepareViewer(input: ViewerBuildInput): Promise<PreparedViewer>;
export function buildViewer(input: ViewerBuildInput): Promise<BuildResult>;
export function writeViewer(result: BuildResult, outputPath: string): void;
export interface ModelingJob {
  formatVersion: 1;
  title: string;
  question: string;
  projects: { path: string; commit: string | null }[];
  model: string;
  evidence: string;
  views: string;
  snippets: string;
  slug?: string;
}
export function createModelingJob(input: {
  projects: string[];
  question: string;
  title?: string;
  outputPath: string;
}): { job: ModelingJob; path: string; prompt: string };
export function buildModelingJob(
  jobPath: string,
  outputPath: string,
): Promise<BuildResult>;
