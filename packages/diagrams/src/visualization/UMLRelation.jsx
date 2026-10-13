import { elementClass, interactionProps, sameTarget } from "./interaction";
import { CHANGE_COLORS, isChanged } from "./UMLNode";

const knownCount = (value) =>
  typeof value === "string" && value.trim() !== "" && value.trim() !== "?";

export function relationName(edge) {
  if (edge.type === "generalization")
    return `${edge.sourceName} ${edge.realization ? "implements" : "inherits"} ${edge.targetName}`;
  if (edge.stereotype === "dependency" && edge.name === "declared type use")
    return `${edge.sourceName} uses ${edge.targetName}`;
  const end = (name, count) =>
    knownCount(count) ? `${name} (${count})` : name;
  return `${edge.name}: ${end(edge.sourceName, edge.sourceMultiplicity)}, ${end(edge.targetName, edge.targetMultiplicity)}`;
}

export function UMLRelation({
  edge,
  focus,
  selected,
  handlers,
  markerId,
  kind = "edge",
  accessibleName,
}) {
  const target = { kind, id: edge.id };
  const highlighted = focus?.[kind === "group" ? "groups" : "edges"]?.has(
    edge.id,
  );
  const change = isChanged(edge.changeStatus) ? edge.changeStatus : null;
  // A changed relation keeps its change colour, arrowheads included, whatever
  // its highlight; its selection shows as a halo instead.
  const markerState = change
    ? `-${change}`
    : sameTarget(target, focus?.primary)
      ? "-primary"
      : highlighted
        ? "-active"
        : "";
  const aggregationMarker = (kind) =>
    ["SHARED", "COMPOSITE"].includes(kind)
      ? `url(#${markerId}-${kind}${markerState})`
      : undefined;
  const name =
    accessibleName ||
    `${relationName(edge)}${change ? `, ${change === "added" ? "new" : change === "removed" ? "removed" : "changed"}` : ""}`;
  return (
    <g
      className={`${elementClass(kind, edge.id, focus, selected)} relation-route${edge.type === "generalization" ? " generalization" : ""}${change ? " changed" : ""}`}
      data-edge={edge.id}
      data-element-kind={kind}
      data-element-id={edge.id}
      data-source={edge.source}
      data-target={edge.target}
      data-change={edge.changeStatus}
      aria-label={name}
      aria-pressed={handlers ? sameTarget(target, selected) : undefined}
      {...interactionProps(target, handlers)}
    >
      <title>{name}</title>
      {(edge.branchPaths || edge.paths).map((d, i) => (
        <g key={i}>
          {change && (
            <path
              className="edge-halo"
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          <path
            className="edge-path"
            d={d}
            fill="none"
            stroke={
              change
                ? CHANGE_COLORS[change]
                : edge.type === "generalization"
                  ? "var(--diagram-inheritance,#59636e)"
                  : "var(--diagram-edge,#59636e)"
            }
            strokeWidth={change ? "2" : "1.4"}
            strokeDasharray={
              change === "removed"
                ? "2 4"
                : edge.realization || edge.stereotype === "dependency"
                  ? "6 4"
                  : undefined
            }
            markerStart={
              edge.type === "association"
                ? aggregationMarker(edge.sourceAggregation)
                : undefined
            }
            markerEnd={
              edge.type === "generalization" && !edge.branchPaths
                ? `url(#${markerId}${markerState})`
                : edge.stereotype === "dependency"
                  ? `url(#${markerId}-DEPENDENCY${markerState})`
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

export function UMLRelationLabels({
  edge,
  focus,
  selected,
  handlers,
  kind = "edge",
}) {
  const target = { kind, id: edge.id };
  if (!edge.labels.length) return null;
  return (
    <g
      className={`${elementClass(kind, edge.id, focus, selected)} relation-labels`}
      data-edge={edge.id}
      data-element-kind={kind}
      data-element-id={edge.id}
      data-change={edge.changeStatus}
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
