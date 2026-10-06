import { useId, useMemo } from "react";
import { UMLNode } from "./UMLNode";
import { UMLRelation, UMLRelationLabels } from "./UMLRelation";
import { focusedElements } from "./interaction";

// A domain-independent renderer. The input is ordinary graph/geometry data;
// this component has no knowledge of R5, model evidence, or application panels.
export function UMLDiagram({
  diagram,
  active = null,
  selected = null,
  handlers,
}) {
  const markerId = `inheritance-${useId().replaceAll(":", "")}`;
  const focus = useMemo(
    () => focusedElements(diagram, active),
    [diagram, active],
  );
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={diagram.width}
      height={diagram.height}
      viewBox={`0 0 ${diagram.width} ${diagram.height}`}
      role={handlers ? "group" : "img"}
      aria-label={diagram.title}
      style={{ fontFamily: "Inter,Segoe UI,Arial,sans-serif" }}
    >
      <defs>
        <marker
          id={markerId}
          markerWidth="13"
          markerHeight="12"
          refX="11"
          refY="6"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M1 1 L11 6 L1 11 Z"
            fill="var(--canvas,#fafbfe)"
            stroke="var(--diagram-inheritance,#57667e)"
            strokeWidth="1.4"
          />
        </marker>
        <marker
          id={`${markerId}-active`}
          markerWidth="13"
          markerHeight="12"
          refX="11"
          refY="6"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M1 1 L11 6 L1 11 Z"
            fill="var(--canvas,#fafbfe)"
            stroke="var(--accent,#486bd0)"
            strokeWidth="1.4"
          />
        </marker>
      </defs>
      <g className="relation-routes">
        {diagram.edges.map((edge) => (
          <UMLRelation
            key={edge.id}
            {...{ edge, focus, selected, handlers, markerId }}
          />
        ))}
      </g>
      <g className="relation-label-layer">
        {diagram.edges.map((edge) => (
          <UMLRelationLabels
            key={edge.id}
            {...{ edge, focus, selected, handlers }}
          />
        ))}
      </g>
      <g className="node-layer">
        {diagram.nodes.map((node) => (
          <UMLNode key={node.id} {...{ node, focus, selected, handlers }} />
        ))}
      </g>
    </svg>
  );
}
