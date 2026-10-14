const LIMITATIONS = [
  "Finite closed-world examples check only declared memberships, binary links, numeric multiplicities and complete/disjoint sets.",
  "Unknown counts, type-use dependencies, arbitrary OCL/SQL and domain accuracy are not established.",
];
function bounds(value) {
  if (value === "*") return [0, Infinity];
  if (!/^\d+(\.\.(\d+|\*))?$/.test(value || "")) return null;
  const [a, b] = value.split("..");
  return [Number(a), b === "*" ? Infinity : Number(b ?? a)];
}
function assessScenario(model, scenario) {
  const issues = [],
    unassessed = [],
    add = (code, message, elementId, instanceId) =>
      issues.push({ code, message, elementId, instanceId });
  // An instance of a class is an instance of what it inherits and of the
  // interfaces it implements; an interface, like an abstract class, has no
  // instances of its own.
  const parents = new Map(),
    classes = new Map(model.classes.map((n) => [n.id, n]));
  const isAbstract = (type) =>
    type?.isAbstract || type?.abstract || type?.stereotype === "interface";
  for (const g of model.generalizations) {
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
    for (const abstractId of [...found].filter((id) =>
      isAbstract(classes.get(id)),
    )) {
      const supported = instance.classIds.some((concreteId) => {
        if (isAbstract(classes.get(concreteId))) return false;
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
module.exports = {
  assessScenario,
};
