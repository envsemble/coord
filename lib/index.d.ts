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
  stereotype: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  sourceAggregation?: string;
  targetAggregation?: string;
  paths: string[];
  branchPaths?: string[];
  labels: DiagramLabel[];
}
export interface DiagramGeneralizationGroup {
  id: string;
  type: "generalizationSet" | "generalizationJoin";
  name: string;
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
