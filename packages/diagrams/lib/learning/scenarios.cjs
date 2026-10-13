const LIMITATIONS = [
  "Finite closed-world examples check only declared memberships, binary links, numeric multiplicities and complete/disjoint sets.",
  "Unknown counts, type-use dependencies, temporal identity/rigidity, arbitrary OCL/SQL and full ontology/domain accuracy are not established.",
];
function learningIssues(document, ids, nodeIds) {
  const issues = [],
    add = (message, elementId = null) =>
      issues.push({
        code: "LEARNING_REFERENCE",
        severity: "error",
        layer: "reference",
        message,
        elementId,
      });
  const learning = document.learning || { walkthroughs: [], scenarios: [] };
  const entries = [...learning.walkthroughs, ...learning.scenarios];
  if (new Set(entries.map((e) => e.id)).size !== entries.length)
    add("Learning entries need unique identities");
  const records = new Set(document.context.records.map((r) => r.id));
  const views = new Set(document.views.map((v) => v.key));
  for (const entry of entries) {
    if (entry.contextIds?.some((id) => !records.has(id)))
      add("Learning context must refer to retained records", entry.id);
    if (entry.elementIds?.some((id) => !ids.has(id)))
      add("Learning guidance must refer to current elements", entry.id);
  }
  for (const walkthrough of learning.walkthroughs)
    for (const step of walkthrough.steps) {
      if (
        (step.viewKey && !views.has(step.viewKey)) ||
        step.elementIds.some((id) => !ids.has(id))
      )
        add(
          "Walkthrough step needs an existing view and elements",
          walkthrough.id,
        );
    }
  for (const scenario of learning.scenarios) {
    const relationIds = new Set(
      document.profile === "ontouml"
        ? document.model.elements
            .filter((e) => e.type === "BinaryRelation")
            .map((e) => e.id)
        : document.model.relations.map((e) => e.id),
    );
    const instances = new Set(scenario.instances.map((i) => i.id));
    if (instances.size !== scenario.instances.length)
      add("Scenario instance identities must be unique", scenario.id);
    for (const instance of scenario.instances)
      if (instance.classIds.some((id) => !nodeIds.has(id)))
        add("Scenario memberships must refer to classes/tables", instance.id);
    const links = new Set();
    for (const link of scenario.links) {
      const key = JSON.stringify([
        link.relationId,
        link.sourceId,
        link.targetId,
      ]);
      if (
        !relationIds.has(link.relationId) ||
        !instances.has(link.sourceId) ||
        !instances.has(link.targetId) ||
        links.has(key)
      )
        add(
          "Scenario links need existing binary relations and instances without duplicate pairs",
          scenario.id,
        );
      links.add(key);
    }
  }
  return issues;
}
function bounds(value) {
  if (value === "*") return [0, Infinity];
  if (!/^\d+(\.\.(\d+|\*))?$/.test(value || "")) return null;
  const [a, b] = value.split("..");
  return [Number(a), b === "*" ? Infinity : Number(b ?? a)];
}
function explainModel(model) {
  const classes = new Map(model.classes.map((n) => [n.id, n.name]));
  const descriptions = [];
  for (const r of model.relations) {
    for (const [owner, count, target] of [
      [r.sourceId, r.targetMultiplicity, r.targetId],
      [r.targetId, r.sourceMultiplicity, r.sourceId],
    ]) {
      const limit = bounds(count);
      const meaning = !limit
        ? "an unestablished number of"
        : limit[1] === Infinity
          ? `at least ${limit[0]}`
          : limit[0] === limit[1]
            ? `exactly ${limit[0]}`
            : `${limit[0]} to ${limit[1]}`;
      descriptions.push({
        elementId: r.id,
        text: `For each ${classes.get(owner)}: ${meaning} ${classes.get(target)} instances via ${r.name || r.stereotype || "this relation"}.`,
        assessed: !!limit && r.stereotype !== "dependency",
      });
    }
  }
  const gens = new Map(model.generalizations.map((g) => [g.id, g]));
  for (const set of model.partitions || []) {
    const members = set.generalizations
      .map((id) => gens.get(id))
      .filter(Boolean);
    descriptions.push({
      elementId: set.id,
      text: `${set.name}: every ${classes.get(members[0]?.generalId) || "supertype"} instance ${set.complete ? "must belong to at least one" : "may belong to none"} of ${members.map((g) => classes.get(g.specificId)).join(", ")}; ${set.disjoint ? "at most one subtype in this set" : "multiple memberships are permitted"}.`,
      assessed: true,
    });
  }
  return descriptions;
}
function checkScenario(document, scenarioId) {
  const {
    assertDocument,
    documentViewerModel,
  } = require("../document/document.cjs");
  assertDocument(document);
  const scenario = document.learning?.scenarios.find(
    (s) => s.id === scenarioId,
  );
  if (!scenario)
    throw new Error("SCENARIO_NOT_FOUND: choose a retained scenario");
  return assessScenario(documentViewerModel(document), scenario);
}
function assessScenario(model, scenario) {
  const issues = [],
    unassessed = [],
    add = (code, message, elementId, instanceId) =>
      issues.push({ code, message, elementId, instanceId });
  const parents = new Map(),
    classes = new Map(model.classes.map((n) => [n.id, n]));
  for (const g of model.generalizations) {
    if (g.realization) {
      unassessed.push({
        elementId: g.id,
        message: "Implementation is not an instance membership assertion.",
      });
      continue;
    }
    if (!parents.has(g.specificId)) parents.set(g.specificId, []);
    parents.get(g.specificId).push(g.generalId);
  }
  const memberships = new Map();
  for (const instance of scenario.instances) {
    const found = new Set(),
      pending = [...instance.classIds];
    while (pending.length) {
      const id = pending.pop();
      if (found.has(id)) continue;
      found.add(id);
      pending.push(...(parents.get(id) || []));
    }
    memberships.set(instance.id, found);
    for (const abstractId of [...found].filter(
      (id) => classes.get(id)?.isAbstract || classes.get(id)?.abstract,
    )) {
      const supported = instance.classIds.some((concreteId) => {
        const type = classes.get(concreteId);
        if (type?.isAbstract || type?.abstract) return false;
        const seen = new Set(),
          pending = [concreteId];
        while (pending.length) {
          const id = pending.pop();
          if (seen.has(id)) continue;
          seen.add(id);
          pending.push(...(parents.get(id) || []));
        }
        return seen.has(abstractId);
      });
      if (!supported)
        add(
          "ABSTRACT_INSTANCE",
          "An abstract membership needs a declared concrete subtype membership.",
          abstractId,
          instance.id,
        );
    }
  }
  const relations = new Map(model.relations.map((r) => [r.id, r]));
  const outgoing = new Map(),
    incoming = new Map();
  for (const link of scenario.links) {
    const r = relations.get(link.relationId);
    if (!r || r.stereotype === "dependency") {
      unassessed.push({
        elementId: link.relationId,
        message: "This link is not a supported runtime association.",
      });
      continue;
    }
    if (
      !memberships.get(link.sourceId)?.has(r.sourceId) ||
      !memberships.get(link.targetId)?.has(r.targetId)
    )
      add(
        "LINK_TYPE",
        "Linked instances must satisfy the declared relation ends.",
        r.id,
        link.sourceId,
      );
    for (const [map, key, target] of [
      [outgoing, JSON.stringify([r.id, link.sourceId]), link.targetId],
      [incoming, JSON.stringify([r.id, link.targetId]), link.sourceId],
    ]) {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(target);
    }
  }
  for (const r of model.relations) {
    if (r.stereotype === "dependency") {
      unassessed.push({
        elementId: r.id,
        message: "Declared type use does not establish runtime participation.",
      });
      continue;
    }
    for (const [typeId, count, map] of [
      [r.sourceId, r.targetMultiplicity, outgoing],
      [r.targetId, r.sourceMultiplicity, incoming],
    ]) {
      const limit = bounds(count);
      if (!limit) {
        unassessed.push({
          elementId: r.id,
          message: `Multiplicity ${count || "?"} is unknown or unsupported.`,
        });
        continue;
      }
      for (const [id, types] of memberships)
        if (types.has(typeId)) {
          const size = map.get(JSON.stringify([r.id, id]))?.size || 0;
          if (size < limit[0] || size > limit[1])
            add(
              "MULTIPLICITY",
              `${id} has ${size} linked instances; this end requires ${count}.`,
              r.id,
              id,
            );
        }
    }
  }
  const gens = new Map(model.generalizations.map((g) => [g.id, g]));
  for (const set of model.partitions || []) {
    const members = set.generalizations
      .map((id) => gens.get(id))
      .filter(Boolean);
    if (!members.length || members.some((g) => g.realization)) {
      unassessed.push({
        elementId: set.id,
        message: "This set has no assessable classification members.",
      });
      continue;
    }
    for (const [id, types] of memberships)
      if (types.has(members[0].generalId)) {
        const count = members.filter((g) => types.has(g.specificId)).length;
        if (set.complete && !count)
          add(
            "SET_COMPLETE",
            "An instance of this supertype must belong to a subtype in the complete set.",
            set.id,
            id,
          );
        if (set.disjoint && count > 1)
          add(
            "SET_DISJOINT",
            "An instance cannot belong to several subtypes in a disjoint set.",
            set.id,
            id,
          );
      }
  }
  if (model.constraints?.length)
    unassessed.push({
      elementId: null,
      message: "Authored textual constraints need separate assessment.",
    });
  return {
    id: scenario.id,
    outcome: issues.length
      ? "invalid"
      : unassessed.length
        ? "unassessed"
        : "valid",
    expectationMet: issues.length
      ? scenario.expected === "invalid"
      : unassessed.length
        ? null
        : scenario.expected === "valid",
    issues,
    unassessed,
    limitations: LIMITATIONS,
  };
}
/**
 * A document's walkthroughs and its examples with their assessments, for the
 * viewer's guide to the model; null when the document has neither.
 */
function prepareLearning(document, model) {
  const learning = document?.learning;
  if (!learning?.walkthroughs?.length && !learning?.scenarios?.length)
    return null;
  return {
    walkthroughs: learning.walkthroughs || [],
    scenarios: (learning.scenarios || []).map((scenario) => ({
      ...scenario,
      result: assessScenario(model, scenario),
    })),
    ...(typeof document.reporting?.scope === "string" &&
    document.reporting.scope.trim()
      ? { scope: document.reporting.scope }
      : {}),
  };
}
module.exports = {
  learningIssues,
  checkScenario,
  assessScenario,
  explainModel,
  prepareLearning,
  LIMITATIONS,
};
