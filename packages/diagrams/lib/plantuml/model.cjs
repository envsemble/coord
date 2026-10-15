// A diagram as the viewer's model. Identities come from names, so a capture
// and a proposal copied from it name the same element alike: an element is
// its PlantUML name, a member `Element.name` (an operation with its
// parameters), and a relation its kind, ends and label.
const { foreignKeyColumns } = require("./diagram.cjs");

const STEREOTYPES = {
  class: "class",
  "abstract class": "class",
  interface: "interface",
  enum: "enum",
  entity: "table",
  object: "object",
};
const AGGREGATIONS = { aggregation: "SHARED", composition: "COMPOSITE" };
const GENERALIZATIONS = new Set(["inheritance", "implementation"]);

const memberId = (elementId, name) => `${elementId}.${name}`;
const operationId = (elementId, operation) =>
  `${elementId}.${operation.name}(${operation.parameters.replace(/\s+/g, "")})`;

// A crow's-foot relation drawn from the table holding the foreign key: the
// table its label's <<FK>> columns belong to, or else its only "many" end, or
// else its right end.
function entityRelation(relation, elements) {
  const key = foreignKeyColumns(relation, elements);
  const many = (count) => count.endsWith("*");
  const holder = key
    ? key.table
    : many(relation.targetMultiplicity) !== many(relation.sourceMultiplicity)
      ? many(relation.targetMultiplicity)
        ? relation.target
        : relation.source
      : relation.target;
  const flipped = holder !== relation.source;
  return {
    source: holder,
    target: flipped ? relation.source : relation.target,
    sourceMultiplicity: flipped
      ? relation.targetMultiplicity
      : relation.sourceMultiplicity,
    targetMultiplicity: flipped
      ? relation.sourceMultiplicity
      : relation.targetMultiplicity,
    columns: key ? key.columns : null,
  };
}

/** Each relation's identity, in the diagram's order. */
function relationIds(diagram) {
  const elements = new Map(diagram.elements.map((e) => [e.id, e]));
  const seen = new Map();
  return diagram.relations.map((relation) => {
    const ends =
      relation.kind === "relationship"
        ? entityRelation(relation, elements)
        : relation;
    const base = [
      GENERALIZATIONS.has(relation.kind) ? "generalization" : "relation",
      ends.source,
      ends.target,
      ...(relation.label ? [encodeURIComponent(relation.label)] : []),
    ].join(":");
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count > 1 ? `${base}:${count}` : base;
  });
}

/**
 * The viewer's model of a diagram. `profile` says what kind of model it is
 * ("class", "code", "database" or "object"); evidence becomes sources, and
 * snippets `snippets` keyed by those sources. Elements and members keep their
 * descriptions.
 */
function convert(diagram, options = {}) {
  const sources = [];
  const snippets = {};
  // An element, member or relation with evidence cites a source of its own.
  const cite = (item, id) => {
    if (!item.evidence) return {};
    const e = item.evidence;
    const sourceId = `source:${id}`;
    sources.push({
      id: sourceId,
      file: e.file,
      title: e.title || e.file,
      claim: e.claim || "",
      ...(e.repo ? { repo: e.repo } : {}),
      ...(e.commit ? { commit: e.commit } : {}),
      ...(Number.isInteger(e.line) ? { line: e.line } : {}),
      ...(e.url ? { url: e.url } : {}),
    });
    if (item.snippet)
      snippets[sourceId] = {
        ...(e.repo ? { repo: e.repo } : {}),
        ...(e.commit ? { commit: e.commit } : {}),
        file: item.snippet.file || e.file,
        startLine: item.snippet.startLine ?? e.line ?? 1,
        language: item.snippet.language,
        code: item.snippet.code,
      };
    return {
      evidence: [sourceId],
      primarySource: sourceId,
      ...(Number.isInteger(e.line)
        ? {
            location: {
              file: e.file,
              startLine: e.line,
              endLine: Number.isInteger(e.endLine) ? e.endLine : e.line,
            },
          }
        : {}),
    };
  };
  // A member's description, which the details and its tooltip show.
  const described = (item) =>
    item.description ? { description: item.description } : {};
  const elements = new Map(diagram.elements.map((e) => [e.id, e]));
  const classes = diagram.elements.map((element) => {
    const id = element.id;
    const cited = cite(element, id);
    const pk = element.attributes.filter((a) => a.key === "PK");
    const attributes =
      element.kind === "enum"
        ? element.literals.map((l) => ({
            id: memberId(id, l.name),
            name: l.name,
            type: "",
            ...described(l),
            ...cite(l, memberId(id, l.name)),
          }))
        : element.kind === "object"
          ? element.slots.map((s) => ({
              id: memberId(id, s.name),
              name: s.name,
              type: s.value,
              slot: true,
            }))
          : element.attributes.map((a) => {
              const column = element.kind === "entity";
              const mandatory = column && (a.mandatory || a.key === "PK");
              return {
                id: memberId(id, a.name),
                name: a.name,
                type: a.type,
                multiplicity: column
                  ? mandatory
                    ? "1"
                    : "0..1"
                  : a.multiplicity,
                ...(a.visibility ? { visibility: a.visibility } : {}),
                ...(column
                  ? {
                      nullable: !mandatory,
                      primaryKeyOrder:
                        a.key === "PK" ? pk.indexOf(a) + 1 : null,
                      ...(a.key === "FK" ? { foreignKey: true } : {}),
                    }
                  : {}),
                ...described(a),
                ...cite(a, memberId(id, a.name)),
              };
            });
    const methods = element.operations.map((o) => ({
      id: operationId(id, o),
      name: o.name,
      type: `${o.name}(${o.parameters})${o.returns ? `: ${o.returns}` : ""}`,
      ...(o.visibility ? { visibility: o.visibility } : {}),
      ...described(o),
      ...cite(o, operationId(id, o)),
    }));
    return {
      id,
      name: element.name,
      stereotype: STEREOTYPES[element.kind],
      description: element.description || "",
      evidence: [],
      ...(element.kind === "abstract class" ? { isAbstract: true } : {}),
      ...(element.package ? { namespace: element.package } : {}),
      attributes,
      ...(methods.length ? { methods } : {}),
      ...(element.kind === "entity"
        ? {
            keys: pk.length
              ? [
                  {
                    name: "PRIMARY KEY",
                    columns: pk.map((a) => a.name),
                    primary: true,
                  },
                ]
              : [],
            foreignKeys: [],
          }
        : {}),
      ...(element.kind === "object" ? { classifiers: element.classes } : {}),
      ...cited,
    };
  });
  const byId = new Map(classes.map((c) => [c.id, c]));
  const ids = relationIds(diagram);
  const relations = [],
    generalizations = [];
  diagram.relations.forEach((relation, index) => {
    const id = ids[index];
    const cited = cite(relation, id);
    if (GENERALIZATIONS.has(relation.kind)) {
      generalizations.push({
        id,
        specificId: relation.source,
        generalId: relation.target,
        ...(relation.kind === "implementation" ? { realization: true } : {}),
        evidence: [],
        ...cited,
      });
      return;
    }
    const ends =
      relation.kind === "relationship"
        ? entityRelation(relation, elements)
        : relation;
    const entry = {
      id,
      name: relation.label || "",
      stereotype:
        relation.kind === "dependency"
          ? "dependency"
          : relation.kind === "relationship"
            ? "foreign key"
            : "",
      sourceId: ends.source,
      targetId: ends.target,
      sourceMultiplicity: ends.sourceMultiplicity || "",
      targetMultiplicity: ends.targetMultiplicity || "",
      ...(AGGREGATIONS[relation.kind]
        ? { sourceAggregation: AGGREGATIONS[relation.kind] }
        : {}),
      ...(relation.navigable ? { navigable: true } : {}),
      description: "",
      evidence: [],
      ...cited,
    };
    if (relation.kind === "relationship" && ends.columns) {
      const target = byId.get(ends.target);
      const key = {
        columns: ends.columns,
        target: target?.name ?? ends.target,
        targetColumns: target?.keys?.[0]?.columns ?? null,
      };
      Object.assign(entry, key);
      byId.get(ends.source)?.foreignKeys.push(key);
    }
    relations.push(entry);
  });
  const capture = diagram.capture;
  const model = {
    id: options.id || "diagram",
    title: diagram.title || options.title || "Diagram",
    version: "",
    date: capture?.capturedAt?.slice(0, 10) || "",
    status: "",
    repositories: [],
    sources,
    classes,
    relations,
    generalizations,
    partitions: [],
    constraints: [],
    unknowns: [
      ...(Array.isArray(capture?.limitations) ? capture.limitations : []),
      ...(Array.isArray(capture?.coverage?.diagnostics)
        ? capture.coverage.diagnostics
            .map((d) => d?.message)
            .filter((m) => typeof m === "string")
        : []),
    ],
  };
  return { model, snippets };
}
const diagramViewerModel = (diagram, options) =>
  convert(diagram, options).model;

/**
 * An object diagram as a scenario of a class diagram: its objects become
 * instances of the classes they name, its links instances of the relations
 * their labels name. Problems are what cannot be resolved.
 */
function scenarioOf(objects, classDiagram, options = {}) {
  const model = diagramViewerModel(classDiagram);
  const problems = [];
  const fail = (line, code, message) =>
    problems.push({
      line: line || 1,
      column: 1,
      code,
      message,
      severity: "error",
      ...(options.path ? { path: options.path } : {}),
    });
  const classes = new Map();
  for (const c of model.classes) {
    classes.set(c.id, c.id);
    if (!classes.has(c.name)) classes.set(c.name, c.id);
  }
  const parents = new Map();
  for (const g of model.generalizations)
    parents.set(g.specificId, [
      ...(parents.get(g.specificId) || []),
      g.generalId,
    ]);
  const ancestry = (ids) => {
    const found = new Set(),
      pending = [...ids];
    while (pending.length) {
      const id = pending.pop();
      if (found.has(id)) continue;
      found.add(id);
      pending.push(...(parents.get(id) || []));
    }
    return found;
  };
  const memberships = new Map();
  const instances = objects.elements.map((element) => {
    const classIds = [];
    for (const name of element.classes || []) {
      const id = classes.get(name);
      if (id) classIds.push(id);
      else
        fail(
          element.line,
          "SCENARIO_CLASS",
          `${name} is not a class of ${options.of || "the class diagram"}.`,
        );
    }
    const types = ancestry(classIds);
    memberships.set(element.id, types);
    const names = new Set(
      model.classes
        .filter((c) => types.has(c.id))
        .flatMap((c) => c.attributes.map((a) => a.name)),
    );
    for (const slot of element.slots)
      if (classIds.length && !names.has(slot.name))
        fail(
          slot.line,
          "SCENARIO_SLOT",
          `${element.id} has no attribute ${slot.name} in its class${classIds.length > 1 ? "es" : ""}.`,
        );
    return { id: element.id, label: element.name, classIds };
  });
  const links = [];
  for (const link of objects.relations) {
    const [a, b] = [memberships.get(link.source), memberships.get(link.target)];
    if (!a || !b) continue;
    const fits = (r) =>
      (a.has(r.sourceId) && b.has(r.targetId)) ||
      (a.has(r.targetId) && b.has(r.sourceId));
    const named = link.label
      ? model.relations.filter((r) => r.name === link.label)
      : model.relations;
    const candidates =
      named.length > 1 || !link.label ? named.filter(fits) : named;
    if (candidates.length !== 1) {
      fail(
        link.line,
        "SCENARIO_LINK",
        candidates.length
          ? `The link ${link.source} — ${link.target} could be several relations; label it with the relation's name.`
          : link.label
            ? `${options.of || "The class diagram"} has no relation ${link.label}${named.length ? ` between the classes of ${link.source} and ${link.target}` : ""}.`
            : `${options.of || "The class diagram"} relates no classes of ${link.source} and ${link.target}; label the link with the relation it instantiates.`,
      );
      continue;
    }
    const [relation] = candidates;
    const reversed =
      !(a.has(relation.sourceId) && b.has(relation.targetId)) &&
      a.has(relation.targetId) &&
      b.has(relation.sourceId);
    links.push({
      relationId: relation.id,
      sourceId: reversed ? link.target : link.source,
      targetId: reversed ? link.source : link.target,
    });
  }
  const scenario = {
    id: options.path || "scenario",
    title: objects.title || options.path || "Scenario",
    expected: objects.scenario?.expected || "valid",
    instances,
    links,
  };
  return { scenario, problems };
}

module.exports = { convert, diagramViewerModel, scenarioOf, relationIds };
