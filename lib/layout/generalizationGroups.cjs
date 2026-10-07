// Shared inheritance trees are presentation geometry. Set membership and
// completeness/disjointness always come from the standard semantic model.
function generalizationGroups(view, generalizations) {
  if (view.mergeGeneralizations === false) return [];
  const visible = new Map(generalizations.map((g) => [g.id, g]));
  const assigned = new Set();
  const groups = [];
  const usedIds = new Set([
    ...view.names,
    ...visible.keys(),
    ...(view.edges || []).map((e) => e.id),
    ...(view.generalizationSets || []).map((s) => s.id),
  ]);
  const unique = (prefix) => {
    let id = prefix;
    while (usedIds.has(id)) id += "_";
    usedIds.add(id);
    return id;
  };
  const add = (data, members) => {
    const parent = members[0].generalId;
    if (members.some((g) => g.generalId !== parent))
      throw new Error(`Generalization set ${data.id} has different supertypes`);
    const junctionId = unique(`atlas-junction-${data.id}`);
    groups.push({
      ...data,
      target: parent,
      memberIds: members.map((g) => g.id),
      sourceIds: members.map((g) => g.specificId),
      junctionId,
      trunkId: unique(`atlas-trunk-${data.id}`),
      branchIds: members.map((_, i) => unique(`${junctionId}-branch-${i}`)),
    });
    members.forEach((g) => assigned.add(g.id));
  };
  for (const set of view.generalizationSets || []) {
    const members = set.generalizations
      .map((id) => visible.get(id))
      .filter(Boolean);
    if (members.length)
      add(
        {
          id: set.id,
          type: "generalizationSet",
          name: set.name,
          complete: set.complete,
          disjoint: set.disjoint,
          totalMembers: set.generalizations.length,
        },
        members,
      );
  }
  const byParent = new Map();
  for (const g of generalizations) {
    if (assigned.has(g.id)) continue;
    if (!byParent.has(g.generalId)) byParent.set(g.generalId, []);
    byParent.get(g.generalId).push(g);
  }
  for (const [parent, members] of byParent) {
    if (members.length > 1)
      add(
        {
          id: unique(`atlas-inheritance-${parent}`),
          type: "generalizationJoin",
          name: "Inheritance",
          totalMembers: members.length,
        },
        members,
      );
  }
  return groups;
}
function groupLabel(group) {
  const lines =
    group.type === "generalizationSet"
      ? [
          group.name,
          `{${group.complete ? "complete" : "incomplete"}, ${group.disjoint ? "disjoint" : "overlapping"}}`,
        ]
      : [];
  if (group.memberIds.length < group.totalMembers)
    lines.push(`(${group.memberIds.length}/${group.totalMembers} shown)`);
  return lines.join("\n");
}
module.exports = { generalizationGroups, groupLabel };
