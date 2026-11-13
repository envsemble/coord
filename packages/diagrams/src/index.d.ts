import type {
  ComponentType,
  ForwardRefExoticComponent,
  RefAttributes,
  ReactNode,
} from "react";
import type {
  DiagramScene,
  DiagramScenarios,
  ViewerPayload,
  ViewerModel,
  CaptureMetadata,
} from "../lib/index";
export type InspectionTarget = {
  kind: "node" | "edge" | "group";
  id: string;
} | null;
/** The standalone viewer of one payload, as the offline HTML file shows it. */
export const DiagramViewer: ComponentType<ViewerPayload>;
/**
 * The embeddable viewer. Its root is an envUI `Theme` driven by `theme`
 * (default "dark"); the envUI components it uses bring their own
 * styles through the host's bundler, and hosts load
 * `@envsemble/atlas-diagrams/embedded.css`. Giving it another payload of the
 * same `family` (members laid out together by `prepareDiagrams`) switches
 * in place: the camera, the view and the selection stay.
 */
export const DiagramPanel: ComponentType<{
  payload: ViewerPayload;
  theme?: "dark" | "light";
  focus?: InspectionTarget | { kind: "view"; id: string };
  /** Host content rendered at the start of the floating top-left toolbar island (e.g. a family's layer marker). */
  leading?: ReactNode;
  /**
   * The host's own navigation (such as a work item's sections), shown first
   * at the top left with the tools on the same row; the diagram's navigation
   * island moves to a row below it.
   */
  sections?: ReactNode;
  /** Host content at the left under the toolbars, such as a family's layers, one above another; the camera fits the diagram beside it. */
  layers?: ReactNode;
  /**
   * How the reader arranged the diagram, kept by the host: each element's
   * top-left corner by its id; null or absent for the automatic layout. An
   * element without a place goes beside the elements it relates to.
   */
  arrangement?: Record<string, [number, number]> | null;
  /**
   * When provided, elements can be dragged, and this is called with the
   * whole arrangement as shown when one is let go, or with null when the
   * reader resets the layout; the host keeps it and gives it back as
   * `arrangement`.
   */
  onArrange?(positions: Record<string, [number, number]> | null): void;
}>;
/** How many changes a proposal's payload lists, as its Changes button counts them; null for other payloads. */
export function changeCount(
  payload: ViewerPayload | null | undefined,
): number | null;
/** The Atlas mark: the connected A on its dark tile, in fixed colours. Pass `label=""` when adjacent text already names Atlas. */
export const AtlasMark: ComponentType<{ size?: number; label?: string }>;
/** The fields of a viewer model's `document` that tell where it came from. */
export type ProvenanceSource = Partial<
  Pick<
    NonNullable<ViewerModel["document"]>,
    "profile" | "state" | "baselineId" | "captureId"
  >
> & {
  snapshots?: { id: string; capture: CaptureMetadata }[];
};
export interface Provenance {
  kind: "generated" | "proposal" | "authored" | "unknown";
  /** "Generated from code", "Generated from database", "Agent proposal" or "Agent-authored". */
  label: string;
  /** Human-readable source, capture date and coverage, e.g. "TypeScript · shop · captured Oct 8, 2026 · complete coverage". */
  detail: string;
  /** envUI Badge tone: generated "primary", proposal "accent", authored "success", unknown "neutral". */
  tone: "primary" | "accent" | "success" | "neutral";
}
/** Accepts a viewer model's `document` metadata. */
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
/**
 * The scenarios that exemplify a class diagram (`scenarios`, from the
 * payload), each assessed. Renders nothing without any.
 */
export const ScenarioPanel: ComponentType<{
  model: ViewerModel;
  scenarios?: DiagramScenarios | null;
  onInspect(id: string): void;
}>;
