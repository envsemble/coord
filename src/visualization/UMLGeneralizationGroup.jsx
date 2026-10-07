import { UMLRelation, UMLRelationLabels } from "./UMLRelation";

export function generalizationGroupName(group) {
  const constraints =
    group.type === "generalizationSet"
      ? `; ${group.complete ? "complete" : "incomplete"}, ${group.disjoint ? "disjoint" : "overlapping"}`
      : "";
  return `${group.name}: ${group.sourceNames.join(", ")} inherit ${group.targetName}${constraints}`;
}
export function UMLGeneralizationGroup({ group, labels = false, ...props }) {
  const edge = { ...group, type: "generalization" };
  return labels ? (
    <UMLRelationLabels {...props} edge={edge} kind="group" />
  ) : (
    <UMLRelation
      {...props}
      edge={edge}
      kind="group"
      accessibleName={generalizationGroupName(group)}
    />
  );
}
