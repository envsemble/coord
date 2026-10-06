import { elementClass, interactionProps, sameTarget } from "./interaction";

const typeColors = {
  kind: "#0550ae",
  role: "#953800",
  relator: "#8250df",
  phase: "#116329",
  event: "#cf222e",
  mode: "#0a3069",
};

export function UMLNode({ node, focus, selected, handlers }) {
  const target = { kind: "node", id: node.id };
  const header = node.attributes.length ? 66 : node.height;
  return (
    <g
      id={`node-${node.name}`}
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
        fill={`var(--node-${node.stereotype},#f6f8fa)`}
        stroke="var(--diagram-border,#818b98)"
        strokeWidth="1.25"
        vectorEffect="non-scaling-stroke"
      />
      {node.stereotype && (
        <text
          x={node.width / 2}
          y={header / 2 - 10}
          textAnchor="middle"
          fill={`var(--type-${node.stereotype},${typeColors[node.stereotype] || "#59636e"})`}
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
              <text key={attribute.name} x="14" y={85 + i * 20}>
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
