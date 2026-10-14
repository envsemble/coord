import type {
  ComponentType,
  ForwardRefExoticComponent,
  RefAttributes,
  ReactNode,
} from "react";
import type {
  AtlasDocument,
  DiagramScene,
  ModelLearning,
  ViewerPayload,
  ViewerModel,
  PlanningContext,
} from "../lib/index";
export type InspectionTarget = {
  kind: "node" | "edge" | "group";
  id: string;
} | null;
export const OntoUMLViewer: ComponentType<ViewerPayload>;
/**
 * The embeddable viewer. Its root is an envUI `Theme` driven by `theme`
 * (default "dark"); hosts load `@envsemble/envui/styles.css` and
 * `@envsemble/atlas-diagrams/embedded.css`. Giving it another payload of the
 * same `family` (a capture and its proposals, from `prepareFamily`) switches
 * in place: the camera, the view, the selection and the details stay.
 */
export const AtlasPanel: ComponentType<{
  payload: ViewerPayload;
  theme?: "dark" | "light";
  focus?: InspectionTarget | { kind: "view"; id: string };
  onReference?(record: PlanningContext["records"][number]): void;
  /** Host content rendered at the start of the floating top-left toolbar island (e.g. a model picker). */
  leading?: ReactNode;
  /**
   * The host's own navigation (such as a work item's sections), shown first
   * at the top left with the tools on the same row; the diagram's navigation
   * island moves to a row below it.
   */
  sections?: ReactNode;
  /** Whether the host currently shows the panel fullscreen. */
  fullscreen?: boolean;
  /** When provided, a fullscreen toggle button appears in the top-right island. */
  onFullscreenChange?(next: boolean): void;
  /**
   * The details' width in pixels that the reader chose, kept by the host;
   * null or absent for the default. Clamped to what the panel's width allows.
   */
  inspectorWidth?: number | null;
  /** Called with the width once the reader has resized the details (by pointer or keyboard). */
  onInspectorWidthChange?(width: number): void;
}>;
/** How many changes a proposal's payload lists, as its Changes button counts them; null for other payloads. */
export function changeCount(
  payload: ViewerPayload | null | undefined,
): number | null;
/** The Atlas mark: the connected A on its dark tile, in fixed colours. Pass `label=""` when adjacent text already names Atlas. */
export const AtlasMark: ComponentType<{ size?: number; label?: string }>;
/** Document fields that determine where a model came from. */
export type ProvenanceSource = Partial<
  Pick<AtlasDocument, "profile" | "state" | "baselineId" | "imported">
> & {
  snapshots?: {
    id: string;
    capture: AtlasDocument["snapshots"][number]["capture"];
  }[];
};
export interface Provenance {
  kind: "generated" | "proposal" | "authored" | "unknown";
  /** "Generated from code", "Generated from database", "Agent proposal" or "Agent-authored". */
  label: string;
  /** Human-readable source, capture date and coverage, e.g. "TypeScript · shop · captured Oct 8, 2026 · complete coverage". */
  detail: string;
  /** envUI Badge tone: generated "accent", proposal "done", authored "success", unknown "neutral". */
  tone: "accent" | "done" | "success" | "neutral";
}
/** Accepts an Atlas document or a viewer model's `document` metadata. */
export function describeProvenance(
  document: ProvenanceSource | null | undefined,
): Provenance;
/** Formats an ISO timestamp as "Oct 8, 2026" in UTC; returns "" when invalid. */
export function formatCaptureDate(value: string | null | undefined): string;
/** Provenance label and detail line, styled by the viewer CSS. */
export const ProvenanceBadge: ComponentType<{
  document: ProvenanceSource | null | undefined;
  className?: string;
}>;
/** The provenance label alone, as an envUI Badge. */
export const ProvenanceLabel: ComponentType<{
  document: ProvenanceSource | null | undefined;
}>;
export const ViewerErrorBoundary: ComponentType<{
  children?: ReactNode;
  resetKey?: string;
}>;
export type FitInsets = Partial<
  Record<"top" | "right" | "bottom" | "left", number>
> & {
  obstacles?: { left: number; top: number; right: number; bottom: number }[];
};
export interface CameraControls {
  fit(): void;
  reset(): void;
  zoomBy(factor: number): void;
  revealNode(id: string): void;
}
export const DiagramCanvas: ForwardRefExoticComponent<
  {
    diagram: DiagramScene;
    selected: InspectionTarget;
    hovered: InspectionTarget;
    focusRequest?: { id: string } | null;
    /** Transparent, theme-matched SVG image of this immutable scene. */
    backgroundURL?: string;
    /** Canvas edges covered by floating UI; fit avoids them. Reveal pans a
     * selected node out from under `obstacles` (canvas-relative rectangles). */
    fitInsets?: FitInsets | ((canvas: HTMLElement) => FitInsets | null);
    onSelect(target: InspectionTarget): void;
    onZoom(zoom: number): void;
    onHover(target: InspectionTarget): void;
    onClearHover(): void;
  } & RefAttributes<CameraControls>
>;
export const UMLDiagram: ComponentType<{
  diagram: DiagramScene;
  active?: InspectionTarget;
  selected?: InspectionTarget;
  handlers?: Record<string, (...args: any[]) => void>;
  backgroundURL?: string;
}>;
export const UMLNode: ComponentType<Record<string, unknown>>;
export const UMLRelation: ComponentType<Record<string, unknown>>;
export const UMLGeneralizationGroup: ComponentType<Record<string, unknown>>;
export const Lesson: ComponentType<{
  stereotype: string;
  children?: ReactNode;
}>;
export const ElementLearning: ComponentType<{
  element: Record<string, unknown>;
  model: ViewerModel;
  relation?: boolean;
  /** "issues" or "lesson" alone, everything but rationale and questions ("all-but-why"), or "all" (the default). */
  parts?: "all" | "issues" | "lesson" | "all-but-why";
}>;
/**
 * Understanding a model: its walkthroughs and examples (`learning`, from the
 * payload) and, for conceptual models, the OntoUML lessons, checks and open
 * questions.
 */
export const LearningLibrary: ComponentType<{
  model: ViewerModel;
  learning?: ModelLearning | null;
  views?: ViewerPayload["views"] | null;
  conceptual?: boolean;
  onInspect(id: string): void;
  /** Shows a walkthrough step's view. */
  onView?(key: string): void;
  tab?: string | null;
  onTabChange?(tab: string): void;
}>;
