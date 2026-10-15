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
 * - `' atlas description <text>` directly above an element or member: one
 *   short sentence of its purpose, at most 280 characters of plain text.
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
  /** An element's or member's description; relations have none. */
  description?: string;
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
  /** Its description, shown in the details and as its tooltip. */
  description?: string;
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
/** What a capture recorded about its source, from its `' atlas capture` header. */
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
/** Planning records a model links to; a diagram file has none of its own. */
export interface PlanningContext {
  records: {
    id: string;
    kind: "plan" | "glossary" | "decision" | "scenario";
    text: string;
    [field: string]: unknown;
  }[];
  links: { elementId: string; recordId: string; [field: string]: unknown }[];
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
  /** The diagram file the model comes from: `id` and `path` are its path. */
  document?: {
    id: string;
    path?: string;
    profile: ModelProfile;
    state: "authored" | "snapshot" | "proposal";
    /** `id` is a hash of the file's text, `createdAt` a capture's date. */
    revision: {
      id: string;
      parentId: string | null;
      createdAt: string;
      reason: string;
    };
    /** What it is compared with: a proposal's baseline, a comparing capture's earlier capture, or its own capture. */
    baselineId: string | null;
    /** A capture's own path. */
    captureId?: string;
    /** The captures involved: its own and the one it is compared with. */
    snapshots: {
      id: string;
      profile: ModelProfile;
      capture: CaptureMetadata;
    }[];
    context: PlanningContext;
    comparison?: { changes?: SemanticComparison } | null;
  };
}
export interface DiagramNode {
  id: string;
  name: string;
  stereotype: string;
  /** Its description, shown as its tooltip. */
  description?: string;
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
  /** The scenarios that exemplify a class diagram, assessed, when it has any. */
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
    /** Always empty: there is no merging. */
    conflicts: never[];
  } | null;
  /**
   * Set on the payloads `prepareDiagrams` lays out together. Viewers switch
   * among the payloads of one family in place, keeping the camera and the
   * selection.
   */
  family?: string;
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
export interface ValueCell {
  present: boolean;
  value?: unknown;
}
/** An object diagram as an example of its class diagram. */
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
/** The viewer's guide to a model: its assessed examples. */
export interface ModelLearning {
  walkthroughs: {
    id: string;
    title: string;
    contextIds?: string[];
    elementIds?: string[];
    steps: { text: string; viewKey?: string; elementIds: string[] }[];
  }[];
  scenarios: (Scenario & { result: ScenarioResult })[];
  scope?: string;
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
/**
 * An offline viewer in one HTML file: a viewer `prepared` with its artifacts
 * by {@link prepareDiagrams}, carrying the diagram `file` it shows.
 */
export function buildViewer(input: {
  prepared: PreparedViewer;
  file?: DiagramFile;
}): Promise<BuildResult>;
export function writeViewer(result: BuildResult, outputPath: string): void;

/**
 * What every capture takes. A capture returns a diagram file's text: a class
 * diagram of code or an entity diagram of a database, with the `' atlas
 * capture` header (source, date, adapter and version, coverage and
 * diagnostics, limitations and the fingerprints of what was read), its `'
 * atlas fingerprint`, and where each element is declared. Captured again from
 * an unchanged source, a capture differs only in its date and fingerprint. A
 * capture that fails rejects with an error whose message starts with its code
 * (`CAPTURE_CONFIG`, `CAPTURE_PREREQUISITE`, `CAPTURE_SCOPE`,
 * `CAPTURE_LIMIT`, …).
 */
export interface CaptureOptions {
  /** The source's name: letters, numbers, dots, colons and dashes. */
  identity: string;
  /** The diagram's title; by default `<identity> classes` or `<identity> schema`. */
  title?: string;
}
export interface CodeCaptureProject {
  identity: string;
  /** Its folder; its files, tsconfig and classpath are relative to it. */
  path: string;
  /** Its repository's web address, for links; by default its Git remote `origin`. */
  repositoryUrl?: string;
}
/** A class diagram of TypeScript projects, read with the TypeScript 6.0.3 compiler. */
export function captureTypeScript(
  options: CaptureOptions & {
    projects: (CodeCaptureProject & { tsconfig?: string })[];
  },
): Promise<string>;
/** A class diagram of Java source files, read with a JDK 21 or newer; `java` names its launcher. */
export function captureJava(
  options: CaptureOptions & {
    java?: string;
    projects: (CodeCaptureProject & {
      files: string[];
      classpath?: string[];
    })[];
  },
): Promise<string>;
export interface DatabaseCaptureOptions extends CaptureOptions {
  schemas?: string[];
  tables?: string[];
  /** Files (such as migrations) describing a table, cited as its evidence. */
  references?: {
    table: string;
    schema?: string;
    file: string;
    title?: string;
    url?: string;
  }[];
}
/** An entity diagram of a SQLite database file, read only. */
export function captureSQLite(
  options: DatabaseCaptureOptions & { file: string },
): Promise<string>;
/** An entity diagram of PostgreSQL 17 schemas, read in a read-only transaction. */
export function capturePostgres(
  options: Omit<DatabaseCaptureOptions, "tables"> & {
    connectionString: string;
    schemas: string[];
  },
): Promise<string>;
/** An entity diagram of a D1 database, read twice through `queryBatch`. */
export function captureD1(
  options: DatabaseCaptureOptions & {
    queryBatch(queries: string[]): Promise<Record<string, unknown>[][]>;
    execution?: string;
  },
): Promise<string>;
/**
 * A capture described by a source configuration file: JSON matching
 * `code-source-schema` or `database-source-schema`, its paths relative to the
 * file. It captures TypeScript, Java, SQLite, PostgreSQL (connecting through
 * the environment variable its `connectionEnv` names) or local D1 through
 * Wrangler.
 */
export function captureFromConfig(file: string): Promise<string>;
