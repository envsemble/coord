import { viewForNode } from "./domainModel";
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
        }
      : null;
  }
  const view = views.find(
    (v) =>
      v.diagram.edges.some((e) => e.id === id) ||
      v.diagram.generalizationGroups?.some(
        (g) => g.id === id || g.memberIds.includes(id),
      ),
  );
  return view
    ? {
        viewKey: view.key,
        target: { kind: index.edges.has(id) ? "edge" : "group", id },
      }
    : null;
}
