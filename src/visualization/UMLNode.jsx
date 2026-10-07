import { elementClass, interactionProps, sameTarget } from "./interaction";

const typeColors = {
  kind: "#0550ae",
  role: "#953800",
  relator: "#8250df",
  phase: "#116329",
  event: "#cf222e",
  mode: "#0a3069",
};
const typeBackgrounds = {
  kind: "#ddedff",
  role: "#fff0df",
  relator: "#f0e5ff",
  phase: "#e1f2e4",
  event: "#ffe5e2",
  mode: "#e0f3f5",
};
const colorFamilies = {
  subkind: "kind",
  collective: "kind",
  quantity: "kind",
  category: "kind",
  mixin: "kind",
  roleMixin: "role",
  phaseMixin: "phase",
  quality: "mode",
};

export function UMLNode({ node, focus, selected, handlers, idPrefix = "" }) {
  const target = { kind: "node", id: node.id };
  const header = node.attributes.length ? 66 : node.height;
  const color = colorFamilies[node.stereotype] || node.stereotype;
  return (
    <g
      id={`${idPrefix}node-${node.id}`}
      className={elementClass("node", node.id, focus, selected)}
      data-name={node.name}
      data-node-id={node.id}
      data-element-kind="node"
      data-element-id={node.id}
      aria-label={node.name}
      aria-pressed={handlers ? sameTarget(target, selected) : undefined}
      transform={`translate(${node.x} ${node.y})`}
      {...interactionProps(target, handlers)}
    >
      <rect
        className="node-box"
        width={node.width}
        height={node.height}
        rx="3"
        fill={`var(--node-${color},${typeBackgrounds[color] || "var(--surface,#f6f8fa)"})`}
        stroke="var(--diagram-border,#818b98)"
        strokeWidth="1.25"
        vectorEffect="non-scaling-stroke"
      />
      {node.stereotype && (
        <text
          x={node.width / 2}
          y={header / 2 - 10}
          textAnchor="middle"
          fill={`var(--type-${color},${typeColors[color] || "var(--diagram-muted,#59636e)"})`}
          fontSize="11.5"
        >
          «{node.stereotype}»
        </text>
      )}
      <text
        x={node.width / 2}
        y={header / 2 + (node.stereotype ? 13 : 5)}
        textAnchor="middle"
        fill="var(--text,#1f2328)"
        fontSize="15"
        fontWeight="600"
        fontStyle={node.isAbstract ? "italic" : undefined}
      >
        {node.name}
      </text>
      {node.attributes.length > 0 && (
        <>
          <path
            d={`M0 66 H${node.width}`}
            stroke="var(--diagram-divider,#d1d9e0)"
          />
          <g
            className="attributes"
            fill="var(--diagram-attribute,#59636e)"
            fontSize="12"
          >
            {node.attributes.map((attribute, i) => (
              <text key={attribute.id || i} x="14" y={85 + i * 20}>
                {attribute.name} : {attribute.type}
                {attribute.multiplicity ? ` [${attribute.multiplicity}]` : ""}
              </text>
            ))}
          </g>
        </>
      )}
    </g>
  );
}
