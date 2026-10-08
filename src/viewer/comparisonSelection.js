function containsTarget(payload, target) {
  const owner = payload?.model?.classes?.find((node) =>
    [...(node.attributes || []), ...(node.methods || [])].some(
      (member) => member.id === target.id,
    ),
  );
  return payload?.views?.some((view) => {
    if (target.kind === "view") return view.key === target.id;
    const diagram = view.diagram;
    return (
      diagram.nodes.some(
        (node) => node.id === target.id || node.id === owner?.id,
      ) ||
      diagram.edges.some((edge) => edge.id === target.id) ||
      diagram.generalizationGroups?.some(
        (group) =>
          group.id === target.id || group.memberIds.includes(target.id),
      )
    );
  });
}

export function reconcileComparisonFocus(
  selection,
  payload,
  target = payload.focus,
) {
  if (selection.externalFocus === target) return selection;
  const models = {
    proposed: payload,
    baseline: payload.comparison.baseline,
    changes: payload.comparison.changeView,
  };
  const mode =
    !target || containsTarget(models[selection.mode], target)
      ? selection.mode
      : ["proposed", "baseline", "changes"].find((key) =>
          containsTarget(models[key], target),
        ) || selection.mode;
  return { mode, focus: null, externalFocus: target };
}
