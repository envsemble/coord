// Semantic records only. No coordinates, DOM elements, styles, or React state.
export function indexViewerModel(model, generalizationGroups = []) {
  const nodes = new Map(model.classes.map((node) => [node.id, node]));
  const names = new Map(model.classes.map((node) => [node.name, node]));
  const edges = new Map([
    ...model.relations.map((edge) => [
      edge.id,
      {
        ...edge,
        type: "association",
        source: nodes.get(edge.sourceId),
        target: nodes.get(edge.targetId),
      },
    ]),
    ...model.generalizations.map((edge) => [
      edge.id,
      {
        ...edge,
        type: "generalization",
        source: nodes.get(edge.specificId),
        target: nodes.get(edge.generalId),
      },
    ]),
  ]);
  const sets = new Map((model.partitions || []).map((set) => [set.id, set]));
  const groups = new Map(
    generalizationGroups.map((group) => [
      group.id,
      {
        ...group,
        ...sets.get(group.id),
        evidence: sets.get(group.id)?.evidence || [],
        sources: group.sourceIds.map((id) => nodes.get(id)),
        target: nodes.get(group.target),
      },
    ]),
  );
  return {
    nodes,
    names,
    edges,
    groups,
    getElement: (target) =>
      target?.kind === "node"
        ? nodes.get(target.id)
        : target?.kind === "group"
          ? groups.get(target.id)
          : edges.get(target?.id),
  };
}

export function viewForNode(views, currentKey, node) {
  return (
    views.find(
      (view) => view.key === currentKey && view.nodeIds.includes(node.id),
    ) || views.find((view) => view.nodeIds.includes(node.id))
  );
}
