import type {
  ComponentType,
  ForwardRefExoticComponent,
  RefAttributes,
  ReactNode,
} from "react";
import type {
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
  focus?: InspectionTarget;
  onReference?(record: PlanningContext["records"][number]): void;
}>;
export const ViewerErrorBoundary: ComponentType<{ children?: ReactNode }>;
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
