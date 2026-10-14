/**
 * Diagrams are files in Atlas's subset of PlantUML: class, object and entity
 * diagrams that PlantUML itself also renders. Anything outside the subset is a
 * problem with its line and column, never skipped. Atlas lays diagrams out and
 * styles them itself, so the subset has no layout or appearance syntax.
 *
 * Facts PlantUML cannot carry are `' atlas` comments, which PlantUML ignores:
 *
 * - `' atlas capture {json}`: the file is a capture, written by Atlas from
 *   code or a database. The JSON is its {@link CaptureMetadata}: `capturedAt`,
 *   `adapter` (id, version), `source` (kind, identity, scope), `coverage`
 *   (status, diagnostics) and `limitations`.
 * - `' atlas fingerprint <sha256>`: a capture's fingerprint, the SHA-256 of the
 *   file without this line (LF line endings, no trailing newlines). A capture
 *   is frozen: a capture whose text no longer matches it is reported as
 *   edited. {@link formatDiagram} writes it.
 * - `' atlas proposal <path>`: the file is a proposal starting from the
 *   diagram at `path` (relative to this file), usually a capture. Several
 *   proposals of one diagram are alternatives.
 * - `' atlas compares <path>`: a capture that compares with an earlier
 *   capture, to show a system before and after a plan's implementation.
 * - `' atlas scenario <path> expected valid|invalid`: an object diagram of
 *   example instances of the class diagram at `path`, assessed against it.
 * - `' atlas evidence {json}` and `' atlas snippet {json}` directly above an
 *   element, member or relation: where it is declared ({@link DiagramEvidence})
 *   and a short excerpt of its source ({@link DiagramSnippet}).
 *
 * Identities come from names, so a proposal copied from a capture compares
 * with it: an element is its PlantUML name (an alias for a quoted display
 * name), a member `Element.name` (an operation `Element.name(parameters)`), a
 * relation `relation:source:target[:label]` and inheritance
 * `generalization:specific:general`.
 */
export interface Diagram {
  kind: "class" | "object" | "entity";
  title: string | null;
  capture: CaptureMetadata | null;
  fingerprint: string | null;
  /** The baseline a proposal starts from, as written. */
  proposal: string | null;
  /** The earlier capture a capture compares with, as written. */
  compares: string | null;
  /** An object diagram's class diagram, as written, and its expected outcome. */
  scenario: { of: string; expected: "valid" | "invalid" } | null;
  elements: DiagramElement[];
  relations: DiagramRelation[];
}
/** Where an element, member or relation is declared. */
export interface DiagramEvidence {
  file: string;
  line?: number;
  endLine?: number;
  repo?: string;
  commit?: string;
  url?: string;
  title?: string;
  claim?: string;
}
/** A short excerpt of an element's source. */
export interface DiagramSnippet {
  language: string;
  code: string;
  startLine?: number;
  file?: string;
}
interface DiagramAnnotated {
  evidence?: DiagramEvidence;
  snippet?: DiagramSnippet;
  /** The line it was read from. */
  line?: number;
}
export interface DiagramAttribute extends DiagramAnnotated {
  name: string;
  type: string;
  /** A class attribute's `[0..1]`; null for none and for entity columns. */
  multiplicity: string | null;
  visibility: "+" | "-" | "#" | "~" | null;
  /** An entity column's `*`. */
  mandatory?: boolean;
  /** An entity column's `<<PK>>` or `<<FK>>`. */
  key?: "PK" | "FK" | null;
}
export interface DiagramOperation extends DiagramAnnotated {
  name: string;
  /** The parameters as written between the parentheses. */
  parameters: string;
  returns: string | null;
  visibility: "+" | "-" | "#" | "~" | null;
}
export interface DiagramElement extends DiagramAnnotated {
  /** Its PlantUML name: the identity relations use. */
  id: string;
  /** Its display name, with type parameters (`Repository<T>`). An object's is `name : Class`. */
  name: string;
  kind: "class" | "abstract class" | "interface" | "enum" | "entity" | "object";
  /** Its package's dotted name, or null. */
  package: string | null;
  attributes: DiagramAttribute[];
  operations: DiagramOperation[];
  /** An enum's literals. */
  literals: ({ name: string } & DiagramAnnotated)[];
  /** An object's slot values, as written. */
  slots: { name: string; value: string; line?: number }[];
  /** An object's classes, from its `name : Class` display name. */
  classes?: string[];
}
/**
 * A relation from its source to its target: the specific element to the
 * general one for inheritance, the whole to the part for aggregation and
 * composition, and as written otherwise. A crow's-foot `relationship` joins
 * entities with counts at each end.
 */
export interface DiagramRelation extends DiagramAnnotated {
  kind:
    | "association"
    | "aggregation"
    | "composition"
    | "dependency"
    | "inheritance"
    | "implementation"
    | "link"
    | "relationship";
  source: string;
  target: string;
  sourceMultiplicity: string | null;
  targetMultiplicity: string | null;
  label: string | null;
  /** An association or link drawn with an arrowhead at its target. */
  navigable?: boolean;
}
/** A problem in a diagram file, at a line and column (1-based). */
export interface DiagramProblem {
  line: number;
  column: number;
  code: string;
  message: string;
  severity: "error" | "warning";
  path?: string;
}
export interface DiagramFile {
  /** Its path in the work folder, which references resolve against. */
  path: string;
  text: string;
}
/** A diagram file of a work folder, described without laying it out. */
export interface DiagramSummary {
  path: string;
  title: string;
  kind: Diagram["kind"] | null;
  role: "diagram" | "capture" | "proposal" | "scenario";
  profile: ModelProfile;
  /** The diagram a proposal starts from, or the earlier capture a capture compares with, as a path in the folder. */
  baseline: string | null;
  /** The path of the diagram its family is laid out around (its first baseline); null for a diagram laid out alone. */
  family: string | null;
  capture: CaptureMetadata | null;
  /** A scenario's class diagram, as a path in the folder. */
  scenario: { of: string; expected: "valid" | "invalid" } | null;
  problems: DiagramProblem[];
  /** It has no errors, so it can be drawn. */
  valid: boolean;
}
/**
 * Reads a diagram. `problems` are the lines outside the subset and the
 * `' atlas` comments it cannot read; `diagram` is null only when the file
 * cannot be read at all.
 */
export function parseDiagram(
  text: string,
  options?: { path?: string },
): { diagram: Diagram | null; problems: DiagramProblem[] };
/**
 * Every problem of a diagram: its syntax, its model rules (names resolve, no
 * duplicates, valid multiplicities, no inheritance cycles, foreign keys name
 * their tables) and its headers (a proposal's baseline exists and reads, a
 * capture is not edited, a scenario holds against its class diagram).
 * `read(reference)` returns the text of a file a header names, as the header
 * writes it (relative to this file), or null when there is none.
 */
export function checkDiagram(
  text: string,
  options?: { path?: string; read?(reference: string): string | null },
): DiagramProblem[];
/** Writes a diagram in Atlas's canonical form; a capture gets its fingerprint. */
export function formatDiagram(diagram: Diagram): string;
/** A capture's fingerprint over its text. */
export function diagramFingerprint(text: string): string;
/** The viewer's model of a diagram, without layout. */
export function diagramViewerModel(
  diagram: Diagram,
  options?: { id?: string; title?: string },
): ViewerModel;
/** Describes a work folder's diagrams: each file's role, problems, baseline and family. */
export function describeDiagrams(files: DiagramFile[]): DiagramSummary[];
/**
 * Prepares a work folder's diagrams for the viewer: `paths` (by default every
 * diagram without errors), each laid out with the rest of its family. A
 * family is a diagram and everything compared with it, directly or through
 * another member: its proposals, and a later capture with its own proposals.
 * Members' payloads share `family` (the root's path) and switch in place in
 * `AtlasPanel`. A proposal's or a comparing capture's payload carries
 * `comparison`; a class diagram's carries the scenarios that exemplify it as
 * `learning`. Families lay out together, so ask for every path that is shown.
 */
export function prepareDiagrams(input: {
  files: DiagramFile[];
  paths?: string[];
  slug?: string;
  includeArtifacts?: boolean;
}): Promise<{
  diagrams: DiagramSummary[];
  prepared: Map<string, PreparedViewer>;
}>;
/** The folder path a reference written in the diagram at `from` names. */
export function resolveReference(from: string, reference: string): string;
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
export type ChangeStatus = "added" | "removed" | "modified" | "unchanged";
export interface Attribute {
  id?: string;
  name: string;
  type: string;
  multiplicity?: string | null;
  /** Where a captured member is declared. */
  location?: { file: string; startLine: number; endLine: number };
  /** In a proposal's change view, each member of a changed class. */
  changeStatus?: ChangeStatus;
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
  /** Where a captured declaration is. */
  location?: { file: string; startLine: number; endLine: number };
  /** In a proposal's change view. */
  changeStatus?: ChangeStatus;
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
  /** Drawn with an open arrowhead at its target. */
  navigable?: boolean;
  description: string;
  evidence: string[];
  /** In a proposal's change view; a retained route of a removed or rerouted relation keeps its identity in `originalId`. */
  changeStatus?: ChangeStatus;
  originalId?: string;
}
export interface ViewerGeneralization extends ElementEvidence {
  id: string;
  specificId: string;
  generalId: string;
  evidence: string[];
  changeStatus?: ChangeStatus;
  originalId?: string;
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
  /** Where the model comes from: a diagram file (`id` and `path` its path) or a legacy document. */
  document?: {
    id: string;
    path?: string;
    profile: ModelProfile;
    state: "authored" | "snapshot" | "proposal";
    revision: AtlasDocument["revision"];
    /** What it is compared with: a proposal's baseline, a comparing capture's earlier capture, or its own capture. */
    baselineId: string | null;
    /** A capture's own snapshot. */
    captureId?: string;
    snapshots: Omit<SourceSnapshot, "model" | "integrity" | "profile">[];
    context: PlanningContext;
    imported?: boolean;
    comparison?:
      | (AtlasDocument["comparison"] & { changes?: SemanticComparison })
      | null;
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
  changeStatus?: ChangeStatus;
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
  navigable?: boolean;
  paths: string[];
  branchPaths?: string[];
  labels: DiagramLabel[];
  changeStatus?: ChangeStatus;
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
  /** A document's walkthroughs and assessed examples, when it has any. */
  learning?: ModelLearning | null;
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
    /** Always empty: merging went with the model tools. */
    conflicts: never[];
  } | null;
  /**
   * Set on the payloads laid out together (`prepareDiagrams`, or
   * `prepareFamily` for legacy documents). Viewers switch among the payloads
   * of one family in place, keeping the camera and the selection.
   */
  family?: string;
}
/** A legacy capture and its proposals, laid out once: each document's prepared viewer, in the order given. */
export interface PreparedFamily {
  /** The baseline snapshot the members share; each payload's `family`. */
  key: string;
  members: PreparedViewer[];
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
/** What a model is: a class diagram, a capture of code (and its proposals), an entity diagram or an object diagram. */
export type ModelProfile = "class" | "code" | "database" | "object";
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
  profile: AtlasDocument["profile"];
  model: StructuralModel;
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
  learning?: LearningContent;
  reporting?: { scope: string; author?: string };
  format: "atlas/document";
  formatVersion: 1;
  id: string;
  title: string;
  profile: "database" | "code";
  state: "authored" | "snapshot" | "proposal";
  model: StructuralModel;
  evidence: ModelEvidence;
  views: ViewSettings[];
  snippets: Record<string, SourceExcerpt>;
  context: PlanningContext;
  snapshots: SourceSnapshot[];
  baselineId: string | null;
  imported?: boolean;
  comparison?: {
    originDocumentId?: string;
    ancestorRevision?: string;
    ancestorRevisions?: string[];
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
export type CreateDocumentInput = Partial<
  Omit<AtlasDocument, "revision" | "model">
> & {
  parentId?: string;
  createdAt?: string;
  reason?: string;
  model: StructuralModel;
  profile: AtlasDocument["profile"];
};
export function createDocument(input: CreateDocumentInput): AtlasDocument;
export function reviseDocument(
  document: AtlasDocument,
  changes: Partial<
    Pick<
      AtlasDocument,
      | "title"
      | "model"
      | "evidence"
      | "views"
      | "snippets"
      | "context"
      | "learning"
      | "reporting"
    >
  > & { reason?: string },
  expectedRevision?: string,
): AtlasDocument;
/**
 * Record a revision that moves a document to another work item: it changes only
 * `workId` and the `path` of the named context records (null removes a path),
 * and keeps the document's state, including a captured snapshot.
 */
export function relocateDocument(
  document: AtlasDocument,
  changes: {
    workId?: string;
    recordPaths?: Record<string, string | null>;
    reason?: string;
  },
  expectedRevision?: string,
): AtlasDocument;
export function validateDocument(document: unknown): ValidationReport;
export function createSnapshot(input: {
  profile: AtlasDocument["profile"];
  model: StructuralModel;
  capture: CaptureMetadata;
  id?: string;
}): SourceSnapshot;
export function documentViewerModel(document: AtlasDocument): ViewerModel;
export function importDocument(input: string | Uint8Array): AtlasDocument;
export interface AtlasToolArguments {
  atlas_scenarios: { handle: string; offset?: number; limit?: number };
  atlas_proposal: { handle: string; title?: string };
  atlas_compare: {
    handle: string;
    baseHandle?: string;
    offset?: number;
    limit?: number;
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
  /** Store a document and its revision history; `expectedRevision` must name the stored revision it replaces. */
  save(
    document: AtlasDocument,
    expectedRevision?: string | null,
  ): AtlasModelSummary;
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
  atlas_scenarios: {
    total: number;
    offset: number;
    scenarios: (ScenarioResult & {
      title: string;
      expected: Scenario["expected"];
    })[];
  };
  atlas_proposal: AtlasModelSummary;
  atlas_compare: SemanticComparison & { total: number; offset: number };
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
export interface Scenario {
  id: string;
  title: string;
  description?: string;
  expected: "valid" | "invalid";
  elementIds?: string[];
  contextIds?: string[];
  instances: { id: string; label?: string; classIds: string[] }[];
  links: { relationId: string; sourceId: string; targetId: string }[];
}
export interface LearningContent {
  walkthroughs: {
    id: string;
    title: string;
    contextIds?: string[];
    elementIds?: string[];
    steps: { text: string; viewKey?: string; elementIds: string[] }[];
  }[];
  scenarios: Scenario[];
}
export interface ScenarioResult {
  id: string;
  outcome: "valid" | "invalid" | "unassessed";
  expectationMet: boolean | null;
  issues: {
    code: string;
    message: string;
    elementId: string;
    instanceId: string;
  }[];
  unassessed: { elementId: string | null; message: string }[];
  limitations: string[];
}
/** The viewer's guide to a model: its walkthroughs and assessed examples. */
export interface ModelLearning {
  walkthroughs: LearningContent["walkthroughs"];
  scenarios: (Scenario & { result: ScenarioResult })[];
  /** The document's stated scope (`reporting.scope`), when it has one. */
  scope?: string;
}
export interface ModelExplanation {
  elementId: string;
  text: string;
  assessed: boolean;
}
export function checkScenario(
  document: AtlasDocument,
  scenarioId: string,
): ScenarioResult;
export function explainModel(model: ViewerModel): ModelExplanation[];
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
/** A legacy document's viewer. Diagram files are prepared by {@link prepareDiagrams}. */
export function prepareViewer(input: {
  document: AtlasDocument;
  includeArtifacts?: boolean;
  slug?: string;
}): Promise<PreparedViewer>;
/**
 * Lays out a capture and the proposals over its snapshot (`familyKey`) once,
 * so each member's classes and routes keep their places from one member to
 * the next. At least one document must be a proposal; all must share the
 * baseline snapshot and profile.
 */
export function prepareFamily(input: {
  documents: AtlasDocument[];
  slug?: string;
  includeArtifacts?: boolean;
}): Promise<PreparedFamily>;
/** The baseline snapshot a capture or a proposal shares with its family; null for other documents. */
export function familyKey(document: AtlasDocument): string | null;
/**
 * An offline viewer in one HTML file: a viewer `prepared` with its artifacts
 * by {@link prepareDiagrams}, carrying the diagram `file` it shows; or a
 * legacy document.
 */
export function buildViewer(
  input:
    | { prepared: PreparedViewer; file?: DiagramFile }
    | { document: AtlasDocument; slug?: string },
): Promise<BuildResult>;
export function writeViewer(result: BuildResult, outputPath: string): void;
export type ReviewRevision =
  | { file: string }
  | { repository: string; ref: string; path: string };
export interface EvidenceRepository {
  identity: string;
  repository: string;
  baseRef: string;
  headRef: string;
}
export interface ModelReview {
  format: "atlas/review";
  formatVersion: 1;
  base: {
    documentId: string;
    revision: string;
    commit?: string;
    path?: string;
    contentHash?: string;
  };
  head: {
    documentId: string;
    revision: string;
    commit?: string;
    path?: string;
    contentHash?: string;
  };
  outcome: "pass" | "findings";
  exitCode: 0 | 1;
  changes: SemanticComparison;
  validation: ValidationReport;
  scenarios: ScenarioResult[];
  unresolvedConflicts: number;
  evidence: {
    checks: {
      id: string;
      repo: string | null;
      file: string;
      status: "unchanged" | "changed" | "missing" | "stale" | "unassessed";
      reason: string;
      baseCommit?: string;
      headCommit?: string;
      baseHash?: string | null;
      headHash?: string | null;
      capturedHash?: string | null;
    }[];
    counts: Record<string, number>;
    sources: { identity: string; baseCommit: string; headCommit: string }[];
    limitations: string[];
  };
  limitations: string[];
}
export interface ReviewBuildInput {
  base: ReviewRevision;
  head: ReviewRevision;
  sources?: EvidenceRepository[];
}
export function reviewDocuments(
  base: AtlasDocument,
  head: AtlasDocument,
  options?: { sources?: EvidenceRepository[] },
): ModelReview;
export function buildReview(
  input: ReviewBuildInput,
): Promise<{ report: ModelReview; files: Map<string, string | Uint8Array> }>;
export function writeReview(
  input: ReviewBuildInput & { outputDirectory: string },
): Promise<{
  exitCode: 0 | 1;
  outcome: "pass" | "findings";
  base: ModelReview["base"];
  head: ModelReview["head"];
  outputDirectory: string;
  files: string[];
}>;
