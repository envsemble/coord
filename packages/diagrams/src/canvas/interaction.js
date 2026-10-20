export const sameTarget = (a, b) =>
  a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);

export function readTarget(element) {
  const item = element?.closest?.("[data-element-kind]");
  return item
    ? { kind: item.dataset.elementKind, id: item.dataset.elementId }
    : null;
}

// Scenes are immutable React inputs. Build adjacency once per scene, and let
// the WeakMap release it when a view/model is replaced.
const indexes = new WeakMap();
export function interactionIndex(diagram) {
  if (indexes.has(diagram)) return indexes.get(diagram);
  const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
  const edges = new Map();
  const incident = new Map();
  const groups = new Map();
  const groupsByEdge = new Map();
  const append = (map, id, value) => {
    if (!map.has(id)) map.set(id, new Set());
    map.get(id).add(value);
  };
  for (const edge of diagram.edges) {
    edges.set(edge.id, edge);
    append(incident, edge.source, edge);
    append(incident, edge.target, edge);
  }
  for (const group of diagram.generalizationGroups || []) {
    groups.set(group.id, group);
    for (const id of group.memberIds) append(groupsByEdge, id, group.id);
  }
  const index = { nodes, edges, incident, groups, groupsByEdge };
  indexes.set(diagram, index);
  return index;
}

// Focus is calculated from graph identities, independently of SVG or the R5
// domain. A relation keeps exactly its two ends; a node reveals one hop.
export function focusedElements(diagram, target) {
  if (!target) return null;
  const nodes = new Set();
  const edges = new Set();
  const groups = new Set();
  const index = interactionIndex(diagram);
  if (target.kind === "node") {
    if (!index.nodes.has(target.id)) return null;
    nodes.add(target.id);
    for (const edge of index.incident.get(target.id) || []) {
      edges.add(edge.id);
      nodes.add(edge.source);
      nodes.add(edge.target);
    }
  } else if (target.kind === "group") {
    const group = index.groups.get(target.id);
    if (!group) return null;
    group.memberIds.forEach((id) => edges.add(id));
    group.sourceIds.forEach((id) => nodes.add(id));
    nodes.add(group.target);
  } else {
    const edge = index.edges.get(target.id);
    if (!edge) return null;
    edges.add(edge.id);
    nodes.add(edge.source);
    nodes.add(edge.target);
  }
  for (const id of edges)
    for (const groupId of index.groupsByEdge.get(id) || []) groups.add(groupId);
  return { nodes, edges, groups, primary: target };
}

export function elementClass(kind, id, focus, selected) {
  const target = { kind, id };
  const classes = ["diagram-element", kind === "node" ? "node" : "edge"];
  if (focus)
    classes.push(
      focus[
        kind === "node" ? "nodes" : kind === "group" ? "groups" : "edges"
      ]?.has(id)
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
    onPointerLeave: (event) =>
      handlers.onHover(readTarget(event.relatedTarget)),
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
