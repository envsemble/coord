// Views contain presentation preferences only. Model IDs, never display names,
// identify their members, so two projects may each contain a class called User.
function prepareViews(model, settings) {
  const byId = new Map(model.classes.map((c) => [c.id, c]));
  const input = settings?.length
    ? settings
    : [
        {
          key: "model",
          label: "Model",
          title: model.title,
          nodeIds: [...byId.keys()].filter(
            (id) =>
              !["datatype", "enumeration"].includes(byId.get(id).stereotype),
          ),
        },
      ];
  if (new Set(input.map((v) => v.key)).size !== input.length)
    throw new Error("View keys must be unique");
  return input.map((view) => {
    if (!/^[\w-]+$/.test(view.key))
      throw new Error(`Invalid view key: ${view.key}`);
    const names = view.nodeIds || [];
    if (
      !names.length ||
      new Set(names).size !== names.length ||
      names.some((id) => !byId.has(id))
    )
      throw new Error(`View ${view.key} needs unique, existing class IDs`);
    const visible = new Set(names);
    const edges = model.relations.filter(
      (r) =>
        visible.has(r.sourceId) &&
        visible.has(r.targetId) &&
        (!view.edgeIds || view.edgeIds.includes(r.id)),
    );
    const generalizations = model.generalizations.filter(
      (g) =>
        visible.has(g.specificId) &&
        visible.has(g.generalId) &&
        (!view.edgeIds || view.edgeIds.includes(g.id)),
    );
    if (
      view.edgeIds?.some(
        (id) => ![...edges, ...generalizations].some((e) => e.id === id),
      )
    )
      throw new Error(
        `View ${view.key} contains missing edges or hidden endpoints`,
      );
    let columns = view.columns;
    if (!columns) {
      // Deterministic greedy coloring gives connected ends distinct layout ranks.
      // ELK subsequently computes positions and orthogonal routes.
      const colors = new Map();
      const allEdges = [
        ...edges.map((e) => [e.sourceId, e.targetId]),
        ...generalizations.map((g) => [g.specificId, g.generalId]),
      ];
      const neighbors = new Map(names.map((id) => [id, new Set()]));
      for (const [a, b] of allEdges) {
        neighbors.get(a).add(b);
        neighbors.get(b).add(a);
      }
      for (const id of names) {
        const adjacent = new Set(
          [...neighbors.get(id)].map((neighbor) => colors.get(neighbor)),
        );
        let color = 0;
        while (adjacent.has(color)) color++;
        colors.set(id, color);
      }
      columns = [...new Set(colors.values())]
        .sort((a, b) => a - b)
        .map((n) => names.filter((id) => colors.get(id) === n));
    }
    const ordered = columns.flat();
    if (
      ordered.length !== names.length ||
      new Set(ordered).size !== names.length ||
      ordered.some((id) => !visible.has(id))
    )
      throw new Error(
        `View ${view.key} columns must contain each visible ID exactly once`,
      );
    const focusNames = view.focusIds || names.slice(0, 3);
    if (focusNames.some((id) => !visible.has(id)))
      throw new Error(`View ${view.key} focus refers to a hidden node`);
    return {
      key: view.key,
      label: view.label || view.key,
      title: view.title || model.title,
      names,
      nodeIds: names,
      columns,
      focusNames,
      edges,
      generalizations,
    };
  });
}
module.exports = { prepareViews };
