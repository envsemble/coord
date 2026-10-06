// Standard OntoUML exchange JSON is the semantic source of truth.
const { Project } = require("ontouml-js");
const text = (value, fallback = "") =>
  typeof value === "string"
    ? value
    : value?.en || Object.values(value || {})[0] || fallback;
const providerTypes = new Set([
  "kind",
  "collective",
  "quantity",
  "relator",
  "mode",
  "quality",
]);

function indexProject(project) {
  const elements = new Map((project.elements || []).map((e) => [e.id, e]));
  const classes = [...elements.values()].filter((e) => e.type === "Class");
  const relations = [...elements.values()].filter(
    (e) => e.type === "BinaryRelation",
  );
  const generalizations = [...elements.values()].filter(
    (e) => e.type === "Generalization",
  );
  const parents = new Map(classes.map((c) => [c.id, []]));
  const ancestorCache = new Map();
  for (const g of generalizations) parents.get(g.specific)?.push(g.general);
  const ancestors = (id) => {
    if (ancestorCache.has(id)) return ancestorCache.get(id);
    const found = new Set(),
      pending = [...(parents.get(id) || [])];
    while (pending.length) {
      const next = pending.pop();
      if (found.has(next)) continue;
      found.add(next);
      pending.push(...(parents.get(next) || []));
    }
    const result = [...found].map((key) => elements.get(key)).filter(Boolean);
    ancestorCache.set(id, result);
    return result;
  };
  return { elements, classes, relations, generalizations, parents, ancestors };
}

function toViewerModel(project, evidence = {}) {
  const { elements, classes, relations, generalizations } =
    indexProject(project);
  const packages = new Map();
  for (const pkg of elements.values())
    if (pkg.type === "Package")
      for (const id of pkg.contents || []) packages.set(id, pkg.id);
  const entries = evidence.elements || {};
  const record = (e) => ({
    ...entries[e.id],
    evidence: entries[e.id]?.evidence || [],
  });
  const model = {
    id: project.id,
    title: evidence.title || text(project.name, "OntoUML"),
    version: evidence.version || "1",
    date: project.created?.slice(0, 10) || "2000-01-01",
    status: evidence.status || "Source-informed conceptual model",
    repositories: evidence.repositories || [],
    sources: evidence.sources || [],
    constraints: evidence.constraints || [],
    unknowns: evidence.unknowns || [],
    classes: classes.map((c) => ({
      id: c.id,
      name: text(c.name, c.id),
      stereotype: c.stereotype || "",
      packageId: packages.get(c.id),
      description: text(c.description),
      isAbstract: c.isAbstract,
      ...record(c),
      attributes: (c.properties || [])
        .map((id) => elements.get(id))
        .filter(Boolean)
        .map((p) => ({
          id: p.id,
          name: text(p.name, p.id),
          type: text(elements.get(p.propertyType)?.name, p.propertyType || "?"),
          multiplicity: p.cardinality,
        })),
    })),
    relations: relations.map((r) => {
      const [a, b] = r.properties.map((id) => elements.get(id));
      return {
        id: r.id,
        packageId: packages.get(r.id),
        sourceId: a.propertyType,
        targetId: b.propertyType,
        name: text(r.name, "Association"),
        stereotype: r.stereotype || "",
        sourceMultiplicity: a.cardinality,
        targetMultiplicity: b.cardinality,
        sourceAggregation: a.aggregationKind,
        targetAggregation: b.aggregationKind,
        description: text(r.description),
        ...record(r),
      };
    }),
    generalizations: generalizations.map((g) => ({
      id: g.id,
      specificId: g.specific,
      generalId: g.general,
      ...record(g),
    })),
    partitions: [...elements.values()]
      .filter((e) => e.type === "GeneralizationSet")
      .map((p) => ({
        id: p.id,
        name: text(p.name, p.id),
        complete: p.isComplete,
        disjoint: p.isDisjoint,
        generalizations: p.generalizations,
      })),
  };
  return model;
}

// Combine independent exchange projects without collapsing same-named concepts.
// Cross-project relations are authored afterwards against the returned IDs.
function mergeProjects(
  inputs,
  { id = "project-combined", name = "Combined model" } = {},
) {
  if (!inputs.length) throw new Error("At least one project is required");
  const keys = inputs.map((input) => input.key);
  if (
    new Set(keys).size !== keys.length ||
    keys.some((key) => !/^[\w-]+$/.test(key))
  )
    throw new Error(
      "Project keys must be unique letters, digits, underscores or hyphens",
    );
  const project = JSON.parse(JSON.stringify(new Project()));
  project.id = id;
  project.name = { en: name };
  project.created = inputs[0].project.created;
  project.root = `${id}-root`;
  const root = JSON.parse(
    JSON.stringify(new Project().packageBuilder().root().name(name).build()),
  );
  root.id = project.root;
  root.created = project.created;
  root.contents = [];
  project.elements = [root];
  for (const { key, project: input } of inputs) {
    const ids = new Map(input.elements.map((e) => [e.id, `${key}:${e.id}`]));
    const rewrite = (value, field) => {
      if (Array.isArray(value))
        return value.map((item) => rewrite(item, field));
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, rewrite(v, k)]),
        );
      return [
        "id",
        "root",
        "contents",
        "properties",
        "propertyType",
        "general",
        "specific",
        "generalizations",
        "subsettedProperties",
        "redefinedProperties",
      ].includes(field)
        ? ids.get(value) || value
        : value;
    };
    project.elements.push(...input.elements.map((e) => rewrite(e)));
    if (input.root) root.contents.push(ids.get(input.root));
  }
  return project;
}
module.exports = {
  text,
  providerTypes,
  indexProject,
  toViewerModel,
  mergeProjects,
};
