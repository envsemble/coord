import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { UMLNode } from "./UMLNode";
import { UMLRelation, UMLRelationLabels } from "./UMLRelation";
import { focusedElements, interactionIndex } from "./interaction";
import { UMLGeneralizationGroup } from "./UMLGeneralizationGroup";
import { createHighlightController } from "./highlight";

const markerStates = ["", "-active", "-primary"];
const markerColor = (state, normal) =>
  state === "-primary"
    ? "var(--diagram-selection,#9a6700)"
    : state === "-active"
      ? "var(--accent,#0969da)"
      : normal;

// A domain-independent renderer. The input is ordinary graph/geometry data;
// this component has no knowledge of R5, model evidence, or application panels.
export const UMLDiagram = memo(function UMLDiagram({
  diagram,
  active = null,
  selected = null,
  handlers,
  backgroundURL,
}) {
  const markerId = `inheritance-${useId().replaceAll(":", "")}`;
  const svgRef = useRef(null);
  const highlight = useRef(null);
  const latestHandlers = useRef(handlers);
  const interactive = !!handlers;
  const [loadedBackground, setLoadedBackground] = useState(null);
  const bitmap =
    interactive && !!backgroundURL && loadedBackground === backgroundURL;
  const focus = useMemo(
    () => focusedElements(diagram, active),
    [diagram, active],
  );
  const stableHandlers = useMemo(
    () =>
      interactive
        ? {
            onHover: (...args) => latestHandlers.current.onHover(...args),
            onFocus: (...args) => latestHandlers.current.onFocus(...args),
            onActivate: (...args) => latestHandlers.current.onActivate(...args),
          }
        : undefined,
    [interactive],
  );
  useLayoutEffect(() => {
    latestHandlers.current = handlers;
  }, [handlers]);
  // Capture initial classes for server rendering and hydration. Later state
  // changes use the sparse controller; geometry is rebuilt only for a scene.
  const initial = useMemo(
    () => ({
      active: interactive ? null : active,
      selected,
      focus: interactive ? null : focusedElements(diagram, active),
    }),
    [diagram, interactive],
  );
  useLayoutEffect(() => {
    highlight.current = createHighlightController(svgRef.current, diagram);
    return () => {
      highlight.current = null;
    };
  }, [diagram, initial, bitmap]);
  useLayoutEffect(() => {
    highlight.current.update(interactive ? null : active, selected);
  }, [diagram, active, selected, initial, interactive, bitmap]);
  const geometry = useMemo(() => {
    const { focus, selected } = initial;
    const handlers = stableHandlers;
    return (
      <svg
        ref={svgRef}
        className={
          interactive
            ? bitmap
              ? "diagram-hit-layer"
              : "diagram-base"
            : focus
              ? "has-focus"
              : undefined
        }
        xmlns="http://www.w3.org/2000/svg"
        width={diagram.width}
        height={diagram.height}
        viewBox={`0 0 ${diagram.width} ${diagram.height}`}
        role={handlers ? "group" : "img"}
        aria-label={diagram.title}
        style={{
          fontFamily:
            "-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans,Helvetica,Arial,sans-serif",
        }}
      >
        <defs>
          {["SHARED", "COMPOSITE"].flatMap((aggregation) =>
            markerStates.map((state) => (
              <marker
                key={`${aggregation}${state}`}
                id={`${markerId}-${aggregation}${state}`}
                markerWidth="15"
                markerHeight="12"
                refX="1"
                refY="6"
                orient="auto-start-reverse"
                markerUnits="userSpaceOnUse"
              >
                <path
                  d="M1 6 L7 1 L13 6 L7 11 Z"
                  fill={
                    aggregation === "COMPOSITE"
                      ? markerColor(state, "var(--diagram-edge,#59636e)")
                      : "var(--canvas,#ffffff)"
                  }
                  stroke={markerColor(state, "var(--diagram-edge,#59636e)")}
                  strokeWidth="1.4"
                />
              </marker>
            )),
          )}
          {markerStates.map((state) => (
            <marker
              key={state}
              id={`${markerId}${state}`}
              markerWidth="13"
              markerHeight="12"
              refX="11"
              refY="6"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M1 1 L11 6 L1 11 Z"
                fill="var(--canvas,#ffffff)"
                stroke={markerColor(
                  state,
                  "var(--diagram-inheritance,#59636e)",
                )}
                strokeWidth="1.4"
              />
            </marker>
          ))}
        </defs>
        <g className="relation-routes">
          {(diagram.generalizationGroups || []).map((group) => (
            <UMLGeneralizationGroup
              key={group.id}
              {...{ group, focus, selected, handlers, markerId }}
            />
          ))}
          {diagram.edges.map((edge) => (
            <UMLRelation
              key={edge.id}
              {...{ edge, focus, selected, handlers, markerId }}
            />
          ))}
        </g>
        <g className="relation-label-layer">
          {(diagram.generalizationGroups || []).map((group) => (
            <UMLGeneralizationGroup
              key={group.id}
              labels
              {...{ group, focus, selected, handlers }}
            />
          ))}
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
  }, [diagram, initial, stableHandlers, markerId, interactive, bitmap]);
  const overlay = useMemo(() => {
    if (!interactive || !focus) return null;
    const index = interactionIndex(diagram);
    const groups = [...focus.groups].map((id) => index.groups.get(id));
    const edges = [...focus.edges].map((id) => index.edges.get(id));
    const nodes = [...focus.nodes]
      .map((id) => index.nodes.get(id))
      .filter(Boolean);
    return (
      <svg
        key={`${focus.primary.kind}:${focus.primary.id}`}
        className="diagram-overlay"
        width={diagram.width}
        height={diagram.height}
        viewBox={`0 0 ${diagram.width} ${diagram.height}`}
        aria-hidden="true"
        style={{
          fontFamily:
            "-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans,Helvetica,Arial,sans-serif",
        }}
      >
        <g className="relation-routes">
          {groups.map((group) => (
            <UMLGeneralizationGroup
              key={group.id}
              {...{ group, focus, selected, markerId }}
            />
          ))}
          {edges.map((edge) => (
            <UMLRelation
              key={edge.id}
              {...{ edge, focus, selected, markerId }}
            />
          ))}
        </g>
        <g className="relation-label-layer">
          {groups.map((group) => (
            <UMLGeneralizationGroup
              key={group.id}
              labels
              {...{ group, focus, selected }}
            />
          ))}
          {edges.map((edge) => (
            <UMLRelationLabels key={edge.id} {...{ edge, focus, selected }} />
          ))}
        </g>
        <g className="node-layer">
          {nodes.map((node) => (
            <UMLNode
              key={node.id}
              idPrefix={`overlay-${markerId}-`}
              {...{ node, focus, selected }}
            />
          ))}
        </g>
      </svg>
    );
  }, [diagram, focus, selected, markerId, interactive]);
  if (!interactive) return geometry;
  return (
    <div
      className={`uml-diagram${focus ? " has-focus" : ""}`}
      style={{ width: diagram.width, height: diagram.height }}
    >
      {interactive && backgroundURL && (
        <img
          className={`diagram-background${bitmap ? " ready" : ""}`}
          src={backgroundURL}
          width={diagram.width}
          height={diagram.height}
          alt=""
          draggable={false}
          onLoad={() => setLoadedBackground(backgroundURL)}
        />
      )}
      {geometry}
      {overlay}
    </div>
  );
});
