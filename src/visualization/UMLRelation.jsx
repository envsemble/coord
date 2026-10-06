import { elementClass, interactionProps, sameTarget } from "./interaction";

export function relationName(edge) {
  return edge.type === "generalization"
    ? `${edge.sourceName} inherits ${edge.targetName}`
    : `${edge.name}: ${edge.sourceName} (${edge.sourceMultiplicity}), ${edge.targetName} (${edge.targetMultiplicity})`;
}

export function UMLRelation({ edge, focus, selected, handlers, markerId }) {
  const target = { kind: "edge", id: edge.id };
  const aggregationMarker = (kind) =>
    ["SHARED", "COMPOSITE"].includes(kind)
      ? `url(#${markerId}-${kind}${focus?.edges.has(edge.id) ? "-active" : ""})`
      : undefined;
  return (
    <g
      className={`${elementClass("edge", edge.id, focus, selected)} relation-route${edge.type === "generalization" ? " generalization" : ""}`}
      data-edge={edge.id}
      data-element-kind="edge"
      data-element-id={edge.id}
      data-source={edge.source}
      data-target={edge.target}
      aria-label={relationName(edge)}
      aria-pressed={handlers ? sameTarget(target, selected) : undefined}
      {...interactionProps(target, handlers)}
    >
      <title>{relationName(edge)}</title>
      {edge.paths.map((d, i) => (
        <g key={i}>
          <path
            className="edge-path"
            d={d}
            fill="none"
            stroke={
              edge.type === "generalization"
                ? "var(--diagram-inheritance,#59636e)"
                : "var(--diagram-edge,#59636e)"
            }
            strokeWidth="1.4"
            markerStart={
              edge.type === "association"
                ? aggregationMarker(edge.sourceAggregation)
                : undefined
            }
            markerEnd={
              edge.type === "generalization"
                ? `url(#${markerId}${focus?.edges.has(edge.id) ? "-active" : ""})`
                : aggregationMarker(edge.targetAggregation)
            }
          />
          {handlers && (
            <path
              className="edge-hit"
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth="10"
              vectorEffect="non-scaling-stroke"
              pointerEvents="stroke"
            />
          )}
        </g>
      ))}
    </g>
  );
}

export function MultiplicityLabel({ label }) {
  return (
    <g
      className="multiplicity"
      data-end={label.kind}
      data-node-id={label.nodeId}
    >
      <rect
        width={label.width}
        height={label.height}
        rx="4"
        fill="var(--canvas,#ffffff)"
        stroke="var(--diagram-border,#818b98)"
        strokeWidth="0.9"
      />
      <text
        x={label.width / 2}
        y={label.height / 2 + 4.5}
        textAnchor="middle"
        fill="var(--text,#1f2328)"
        fontSize="13.5"
        fontWeight="650"
      >
        {label.text}
      </text>
    </g>
  );
}

export function UMLRelationLabels({ edge, focus, selected, handlers }) {
  const target = { kind: "edge", id: edge.id };
  return (
    <g
      className={`${elementClass("edge", edge.id, focus, selected)} relation-labels`}
      data-edge={edge.id}
      data-element-kind="edge"
      data-element-id={edge.id}
      aria-hidden="true"
      {...interactionProps(target, handlers, false)}
    >
      {edge.labels.map((label) => (
        <g
          className="edge-label"
          key={label.id}
          transform={`translate(${label.x} ${label.y})`}
        >
          {label.kind !== "name" ? (
            <MultiplicityLabel label={label} />
          ) : (
            <>
              <rect
                width={label.width}
                height={label.height}
                rx="3"
                fill="var(--canvas,#ffffff)"
              />
              <text
                x={label.width / 2}
                textAnchor="middle"
                fill="var(--diagram-label,#1f2328)"
                fontSize="13"
              >
                {label.text.split("\n").map((line, i, lines) => (
                  <tspan
                    key={i}
                    x={label.width / 2}
                    y={17 + i * 17}
                    fontSize={i === 0 && lines.length > 1 ? "11.5" : undefined}
                    fill={
                      i === 0 && lines.length > 1
                        ? "var(--diagram-muted,#59636e)"
                        : undefined
                    }
                  >
                    {line}
                  </tspan>
                ))}
              </text>
            </>
          )}
        </g>
      ))}
    </g>
  );
}
