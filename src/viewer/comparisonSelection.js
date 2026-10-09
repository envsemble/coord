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
  // The change view contains the proposal and retained removals, so it is
  // preferred for any target the current mode cannot show.
  const models = {
    changes: payload.comparison.changeView || payload,
    baseline: payload.comparison.baseline,
  };
  const mode =
    !target || containsTarget(models[selection.mode], target)
      ? selection.mode
      : ["changes", "baseline"].find((key) =>
          containsTarget(models[key], target),
        ) || selection.mode;
  return { mode, focus: null, externalFocus: target };
}
