import { viewForNode } from "./viewerModelIndex";
/**
 * Where an element can be inspected: its view and canvas target. Members
 * resolve to their owner. A relation also names its two ends, so the camera
 * can bring both into view.
 */
export function inspectionTarget(model, index, views, viewKey, id) {
  const node =
    index.nodes.get(id) ||
    model.classes.find((c) =>
      [...c.attributes, ...(c.methods || [])].some((m) => m.id === id),
    );
  if (node) {
    const view = viewForNode(views, viewKey, node);
    return view
      ? {
          viewKey: view.key,
          target: { kind: "node", id: node.id },
          nodeId: node.id,
          ...(node.id !== id ? { memberId: id } : {}),
        }
      : null;
  }
  const holds = (v) =>
    v.diagram.edges.some((e) => e.id === id) ||
    v.diagram.generalizationGroups?.some(
      (g) => g.id === id || g.memberIds.includes(id),
    );
  const view =
    views.find((v) => v.key === viewKey && holds(v)) || views.find(holds);
  if (!view) return null;
  const edge = view.diagram.edges.find((e) => e.id === id);
  return {
    viewKey: view.key,
    target: { kind: index.edges.has(id) ? "edge" : "group", id },
    ...(edge ? { nodeIds: [edge.source, edge.target] } : {}),
  };
}
