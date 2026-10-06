const { Project } = require("ontouml-js");
const cfg = require("./model.cjs");
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
function createProject() {
  const sources = cfg.sources;
  const stableIds = new Map();
  const stable = (element, id) => {
    stableIds.set(element.id, id);
    return element;
  };
  const project = stable(new Project(), "project-r5-season-3");
  project.name.add(
    `R5Reloaded / Apex Season 3 — source-informed OntoUML v${cfg.version}`,
  );
  project.description.add(
    `Static inspection of public R5 SDK and Flowstate source targeting ${cfg.build}. Source structures and script behavior inform this ontology; identities, stereotypes, and multiplicities remain interpretations. Native binary implementations and EA production matchmaking were not inspected.`,
  );
  const root = stable(
    project
      .packageBuilder()
      .root()
      .name("R5Reloaded Season 3 service domain")
      .build(),
    "package-root",
  );
  const packages = {};
  for (const [key, name] of Object.entries({
    shared: "Shared identities",
    backend: "R5 server discovery backend",
    runtime: "R5 game-server runtime",
    types: "Value types",
  })) {
    packages[key] = stable(
      root.packageBuilder().name(name).build(),
      `package-${key}`,
    );
  }
  const types = new Map();
  for (const name of ["Text", "Integer", "Decimal", "Vector3", "Boolean"])
    types.set(
      name,
      stable(
        packages.types.classBuilder().datatype().name(name).build(),
        `datatype-${name}`,
      ),
    );
  const classes = new Map(),
    relations = [],
    gens = [];
  for (const [
    name,
    stereo,
    pkg,
    description,
    evidence,
    attrs = [],
  ] of cfg.classes) {
    const builder = packages[pkg]
      .classBuilder()
      .stereotype(stereo)
      .name(name)
      .description(description)
      .editorialNote(
        "OntoUML classification and multiplicities are modeling interpretations, not declarations recovered verbatim from C++ or scripts.",
      );
    for (const id of evidence) {
      const source = sources.find((s) => s.id === id);
      if (!source) throw new Error(`Missing evidence ${id} for ${name}`);
      builder.editorialNote(`${id}: ${source.url}`);
    }
    const obj = stable(builder.build(), `class-${name}`);
    for (const [field, type, cardinality = "1"] of attrs)
      stable(
        obj
          .propertyBuilder()
          .name(field)
          .type(types.get(type))
          .cardinality(cardinality)
          .build(),
        `attribute-${name}-${field}`,
      );
    classes.set(name, {
      name,
      stereo,
      pkg,
      description,
      evidence,
      attrs,
      id: stableIds.get(obj.id),
      obj,
    });
  }
  for (const [child, parent] of cfg.generalizations) {
    const obj = stable(
      packages[classes.get(child).pkg]
        .generalizationBuilder()
        .general(classes.get(parent).obj)
        .specific(classes.get(child).obj)
        .build(),
      `generalization-${child}-${parent}`,
    );
    gens.push({ child, parent, id: stableIds.get(obj.id), obj });
  }
  for (const partition of cfg.partitions) {
    const builder = packages[classes.get(partition.parent).pkg]
      .generalizationSetBuilder()
      .name(partition.name)
      .generalizations(
        ...gens
          .filter(
            (g) =>
              g.parent === partition.parent &&
              partition.children.includes(g.child),
          )
          .map((g) => g.obj),
      );
    if (partition.disjoint) builder.disjoint();
    if (partition.complete) builder.complete();
    stable(builder.build(), `generalization-set-${slug(partition.name)}`);
  }
  for (const [pkg, a, b, name, stereo, ac, bc] of cfg.relations) {
    const builder = packages[pkg]
      .binaryRelationBuilder()
      .source(classes.get(a).obj)
      .target(classes.get(b).obj)
      .name(name);
    if (stereo) builder.stereotype(stereo);
    const id = `relation-${pkg}-${a}-${b}-${slug(name)}`;
    const obj = stable(
      builder
        .sourceCardinality(ac)
        .targetCardinality(bc)
        .description(
          "Conceptual relation and proposed multiplicities. Evidence for its connected concepts is recorded in their editorial notes.",
        )
        .build(),
      id,
    );
    stable(obj.sourceEnd, `${id}-source`);
    stable(obj.targetEnd, `${id}-target`);
    relations.push({ pkg, a, b, name, stereo, ac, bc, id, obj });
  }
  // Library-generated IDs and timestamps are normalized so rebuilding does
  // not change committed artifacts when the model sources are unchanged.
  const normalize = (value, key) => {
    if (key === "created") return `${cfg.date}T00:00:00.000Z`;
    if (Array.isArray(value)) return value.map((item) => normalize(item));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, normalize(v, k)]),
      );
    return typeof value === "string" ? stableIds.get(value) || value : value;
  };
  const raw = JSON.parse(JSON.stringify(project));
  for (const element of raw.elements)
    if (!stableIds.has(element.id))
      throw new Error(`Unstable element ID: ${element.type}`);
  const json = JSON.stringify(normalize(raw), null, 2);
  return JSON.parse(json);
}
module.exports = { createProject };
