export const sameTarget = (a, b) =>
  a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);

export function readTarget(element) {
  const item = element?.closest?.("[data-element-kind]");
  return item
    ? { kind: item.dataset.elementKind, id: item.dataset.elementId }
    : null;
}

// Focus is calculated from graph identities, independently of SVG or the R5
// domain. A relation keeps exactly its two ends; a node reveals one hop.
export function focusedElements(diagram, target) {
  if (!target) return null;
  const nodes = new Set();
  const edges = new Set();
  if (target.kind === "node") {
    if (!diagram.nodes.some((n) => n.id === target.id)) return null;
    nodes.add(target.id);
    for (const edge of diagram.edges) {
      if (edge.source !== target.id && edge.target !== target.id) continue;
      edges.add(edge.id);
      nodes.add(edge.source);
      nodes.add(edge.target);
    }
  } else {
    const edge = diagram.edges.find((e) => e.id === target.id);
    if (!edge) return null;
    edges.add(edge.id);
    nodes.add(edge.source);
    nodes.add(edge.target);
  }
  return { nodes, edges, primary: target };
}

export function elementClass(kind, id, focus, selected) {
  const target = { kind, id };
  const classes = ["diagram-element", kind === "node" ? "node" : "edge"];
  if (focus)
    classes.push(
      focus[kind === "node" ? "nodes" : "edges"].has(id)
        ? "highlighted"
        : "dimmed",
    );
  if (sameTarget(target, focus?.primary)) classes.push("primary");
  if (sameTarget(target, selected)) classes.push("selected");
  return classes.join(" ");
}

export function interactionProps(target, handlers, focusable = true) {
  if (!handlers) return {};
  return {
    onPointerEnter: () => handlers.onHover(target),
    onPointerLeave: () => handlers.onHover(null),
    onClick: (e) => {
      e.stopPropagation();
      handlers.onActivate(target, e);
    },
    ...(focusable
      ? {
          role: "button",
          tabIndex: 0,
          onFocus: () => handlers.onFocus(target),
          onBlur: () => handlers.onFocus(null),
          onKeyDown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              handlers.onActivate(target, e);
            }
          },
        }
      : {}),
  };
}
