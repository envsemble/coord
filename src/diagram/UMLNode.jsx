import { elementClass, interactionProps, sameTarget } from "./interaction";

const fills = {
  kind: "#edf4ff",
  role: "#fff3da",
  relator: "#f3eaff",
  phase: "#eaf8f0",
  event: "#fff0ed",
  mode: "#eaf7fa",
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
        fill={`var(--node-${node.stereotype},${fills[node.stereotype] || "#edf4ff"})`}
        stroke="var(--diagram-border,#72839d)"
        strokeWidth="1.25"
      />
      {node.stereotype && (
        <text
          x={node.width / 2}
          y={header / 2 - 10}
          textAnchor="middle"
          fill="var(--diagram-muted,#5b687f)"
          fontSize="11.5"
        >
          «{node.stereotype}»
        </text>
      )}
      <text
        x={node.width / 2}
        y={header / 2 + (node.stereotype ? 13 : 5)}
        textAnchor="middle"
        fill="var(--text,#26354c)"
        fontSize="15"
        fontWeight="600"
      >
        {node.name}
      </text>
      {node.attributes.length > 0 && (
        <>
          <path
            d={`M0 66 H${node.width}`}
            stroke="var(--diagram-divider,#b7c2d2)"
          />
          <g
            className="attributes"
            fill="var(--diagram-attribute,#44546c)"
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
