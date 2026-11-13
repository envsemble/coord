import { elementClass, interactionProps, sameTarget } from "./interaction";

// A proposal's marks are drawn with presentation attributes, so they survive
// static exports and the bitmap backdrop; the theme supplies the colours.
export const CHANGE_COLORS = {
  added: "var(--change-added,#1a7f37)",
  modified: "var(--change-modified,#9a6700)",
  removed: "var(--change-removed,#cf222e)",
};
const CHANGE_TAGS = { added: "New", modified: "Changed", removed: "Removed" };
const MEMBER_GLYPHS = { added: "+", modified: "~", removed: "−" };
export const isChanged = (status) => !!CHANGE_COLORS[status];

// A described element or member shows its description as its tooltip.
const Tooltip = ({ text }) => (text ? <title>{text}</title> : null);

/** A member row's text, marked when a proposal adds, changes or removes it. */
function MemberText({ member, x, y, method }) {
  const status = isChanged(member.changeStatus) ? member.changeStatus : null;
  // An operation's signature, an object's slot value, an enum's literal, or
  // an attribute with its type and count.
  const text = method
    ? member.type
    : member.slot
      ? `${member.name} = ${member.type}`
      : !member.type
        ? member.name
        : `${member.name} : ${member.type}${member.multiplicity ? ` [${member.multiplicity}]` : ""}`;
  if (!status)
    return (
      <text x={x} y={y}>
        <Tooltip text={member.description} />
        {text}
      </text>
    );
  return (
    <g className="member-change" data-change={status}>
      <text
        x={x - 9}
        y={y}
        textAnchor="middle"
        fill={CHANGE_COLORS[status]}
        fontWeight="700"
      >
        {MEMBER_GLYPHS[status]}
      </text>
      <text
        x={x}
        y={y}
        fill={CHANGE_COLORS[status]}
        textDecoration={status === "removed" ? "line-through" : undefined}
      >
        <Tooltip text={member.description} />
        {text}
      </text>
    </g>
  );
}

export function UMLNode({ node, focus, selected, handlers, idPrefix = "" }) {
  const target = { kind: "node", id: node.id };
  const methods = node.methods || [];
  // The header holds the name, below a proposal's change tag.
  const header = node.attributes.length || methods.length ? 56 : node.height;
  const change = isChanged(node.changeStatus) ? node.changeStatus : null;
  const tag = change && CHANGE_TAGS[change];
  const tagWidth = tag ? tag.length * 6.4 + 12 : 0;
  return (
    <g
      id={`${idPrefix}node-${node.id}`}
      className={`${elementClass("node", node.id, focus, selected)}${change ? " changed" : ""}`}
      data-name={node.name}
      data-node-id={node.id}
      data-element-kind="node"
      data-element-id={node.id}
      data-change={node.changeStatus}
      aria-label={tag ? `${node.name}, ${tag.toLowerCase()}` : node.name}
      aria-pressed={handlers ? sameTarget(target, selected) : undefined}
      transform={`translate(${node.x} ${node.y})`}
      {...interactionProps(target, handlers)}
    >
      <Tooltip text={node.description} />
      {change && (
        <rect
          className="node-ring"
          x="-5"
          y="-5"
          width={node.width + 10}
          height={node.height + 10}
          rx="6"
          fill="none"
          stroke="transparent"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <rect
        className="node-box"
        width={node.width}
        height={node.height}
        rx="3"
        fill="var(--surface,#f6f8fa)"
        stroke={
          change ? CHANGE_COLORS[change] : "var(--diagram-border,#818b98)"
        }
        strokeWidth={change ? "2.25" : "1.25"}
        strokeDasharray={change === "removed" ? "6 4" : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {tag && (
        <g className="change-tag" transform="translate(7 7)">
          <rect
            width={tagWidth}
            height="17"
            rx="8.5"
            fill={CHANGE_COLORS[change]}
            fillOpacity="0.16"
          />
          <text
            x={tagWidth / 2}
            y="12.5"
            textAnchor="middle"
            fill={CHANGE_COLORS[change]}
            fontSize="10.5"
            fontWeight="600"
          >
            {tag}
          </text>
        </g>
      )}
      <text
        x={node.width / 2}
        y={header / 2 + 8}
        textAnchor="middle"
        fill="var(--text,#1f2328)"
        fontSize="15"
        fontWeight="600"
        fontStyle={node.isAbstract ? "italic" : undefined}
        textDecoration={change === "removed" ? "line-through" : undefined}
      >
        {node.name}
      </text>
      {(node.attributes.length > 0 || methods.length > 0) && (
        <>
          <path
            d={`M0 56 H${node.width}`}
            stroke="var(--diagram-divider,#d1d9e0)"
          />
          <g
            className="attributes"
            fill="var(--diagram-attribute,#59636e)"
            fontSize="12"
          >
            {node.attributes.map((attribute, i) => (
              <MemberText
                key={attribute.id || i}
                member={attribute}
                x={14}
                y={75 + i * 20}
              />
            ))}
          </g>
          {methods.length > 0 && (
            <>
              <path
                d={`M0 ${node.attributes.length ? 66 + node.attributes.length * 20 : 56} H${node.width}`}
                stroke="var(--diagram-divider,#d1d9e0)"
              />
              <g
                className="methods"
                fill="var(--diagram-attribute,#59636e)"
                fontSize="12"
              >
                {methods.map((method, i) => (
                  <MemberText
                    key={method.id || i}
                    member={method}
                    method
                    x={14}
                    y={
                      (node.attributes.length
                        ? 87 + node.attributes.length * 20
                        : 75) +
                      i * 20
                    }
                  />
                ))}
              </g>
            </>
          )}
        </>
      )}
    </g>
  );
}
