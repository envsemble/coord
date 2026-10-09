import type {
  ComponentType,
  ForwardRefExoticComponent,
  RefAttributes,
  ReactNode,
} from "react";
import type {
  AtlasDocument,
  DiagramScene,
  ViewerPayload,
  ViewerModel,
  PlanningContext,
} from "../lib/index";
export type InspectionTarget = {
  kind: "node" | "edge" | "group";
  id: string;
} | null;
export const OntoUMLViewer: ComponentType<ViewerPayload>;
export const AtlasPanel: ComponentType<{
  payload: ViewerPayload;
  theme?: "dark" | "light";
  focus?: InspectionTarget | { kind: "view"; id: string };
  onReference?(record: PlanningContext["records"][number]): void;
}>;
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
  /** Primer label tone: generated "accent", proposal "done", authored "success", unknown "neutral". */
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
/** The provenance label alone (Primer-style pill). */
export const ProvenanceLabel: ComponentType<{
  document: ProvenanceSource | null | undefined;
}>;
export const ViewerErrorBoundary: ComponentType<{
  children?: ReactNode;
  resetKey?: string;
}>;
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
    /** Canvas edges covered by floating UI; fit and reveal avoid them. */
    fitInsets?:
      | Partial<Record<"top" | "right" | "bottom" | "left", number>>
      | ((
          canvas: HTMLElement,
        ) => Partial<
          Record<"top" | "right" | "bottom" | "left", number>
        > | null);
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
}>;
export const LearningLibrary: ComponentType<{
  model: ViewerModel;
  onInspect(id: string): void;
}>;
