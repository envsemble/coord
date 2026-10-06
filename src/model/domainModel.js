// Semantic records only. No coordinates, DOM elements, styles, or React state.
export function indexModel(model) {
  const nodes = new Map(model.classes.map((node) => [node.id, node]));
  const names = new Map(model.classes.map((node) => [node.name, node]));
  const edges = new Map([
    ...model.relations.map((edge) => [
      edge.id,
      {
        ...edge,
        type: "association",
        source: names.get(edge.a),
        target: names.get(edge.b),
      },
    ]),
    ...model.generalizations.map((edge) => [
      edge.id,
      {
        ...edge,
        type: "generalization",
        source: names.get(edge.child),
        target: names.get(edge.parent),
      },
    ]),
  ]);
  return {
    nodes,
    names,
    edges,
    getElement: (target) =>
      target?.kind === "node" ? nodes.get(target.id) : edges.get(target?.id),
  };
}

export function viewForNode(views, currentKey, node) {
  return (
    views.find(
      (view) => view.key === currentKey && view.names.includes(node.name),
    ) || views.find((view) => view.names.includes(node.name))
  );
}
