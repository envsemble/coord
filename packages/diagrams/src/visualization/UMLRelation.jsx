import { elementClass, interactionProps, sameTarget } from "./interaction";
import { CHANGE_COLORS, isChanged } from "./UMLNode";
import { knownMultiplicity } from "../model/multiplicity";
import { changeGlyph, informativeName } from "../review/changes";

export function relationName(edge) {
  if (edge.type === "generalization")
    return `${edge.sourceName} ${edge.realization ? "implements" : "inherits"} ${edge.targetName}`;
  const own = informativeName(edge);
  if (!own && edge.stereotype === "dependency")
    return `${edge.sourceName} uses ${edge.targetName}`;
  const end = (name, count) =>
    knownMultiplicity(count) ? `${name} (${count})` : name;
  return `${own || edge.stereotype || "Association"}: ${end(edge.sourceName, edge.sourceMultiplicity)}, ${end(edge.targetName, edge.targetMultiplicity)}`;
}

// Where a changed relation shows its +, ~ or − (so the change does not rest
// on colour alone): the middle of its longest segment that no label covers.
const MARK_GAP = 9;
// Shorter segments leave no room beside their ends and arrowheads.
const MARK_SEGMENT = 40;
export function changeMarkPoint(paths, labels = []) {
  const segments = [];
  for (const d of paths) {
    const n = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    for (let i = 2; i + 1 < n.length; i += 2)
      segments.push({
        x: (n[i - 2] + n[i]) / 2,
        y: (n[i - 1] + n[i + 1]) / 2,
        length: Math.abs(n[i] - n[i - 2]) + Math.abs(n[i + 1] - n[i - 1]),
      });
  }
  const free = ({ x, y }) =>
    !labels.some(
      (l) =>
        x > l.x - MARK_GAP &&
        x < l.x + l.width + MARK_GAP &&
        y > l.y - MARK_GAP &&
        y < l.y + l.height + MARK_GAP,
    );
  return (
    segments
      .sort((a, b) => b.length - a.length)
      .find((s) => s.length >= MARK_SEGMENT && free(s)) || null
  );
}

function ChangeMarkGlyph({ change, at }) {
  return (
    <g
      className="edge-change-mark"
      transform={`translate(${at.x} ${at.y})`}
      aria-hidden="true"
    >
      <circle r="7.5" fill={CHANGE_COLORS[change]} />
      <text
        y="4.5"
        textAnchor="middle"
        fill="var(--canvas,#ffffff)"
        fontSize="13"
        fontWeight="700"
      >
        {changeGlyph(change)}
      </text>
    </g>
  );
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
  const routes = edge.branchPaths || edge.paths;
  const mark = change ? changeMarkPoint(routes, edge.labels) : null;
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
      {routes.map((d, i) => (
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
      {mark && <ChangeMarkGlyph change={change} at={mark} />}
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
                {label.text.split("\n").map((line, i, lines) => {
                  // The «stereotype» line, alone or above the name, is
                  // smaller and muted.
                  const stereotype =
                    i === 0 && (lines.length > 1 || /^«.*»$/.test(line));
                  return (
                    <tspan
                      key={i}
                      x={label.width / 2}
                      y={17 + i * 17}
                      fontSize={stereotype ? "11.5" : undefined}
                      fill={
                        stereotype ? "var(--diagram-muted,#59636e)" : undefined
                      }
                    >
                      {line}
                    </tspan>
                  );
                })}
              </text>
            </>
          )}
        </g>
      ))}
    </g>
  );
}
