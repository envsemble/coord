const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const schema = require("../../schemas/ontouml-schema.json");
const reference = require("../../src/learning/reference.json");
const { indexProject, providerTypes, text } = require("../model/project.cjs");
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const schemaValidator = ajv.compile(schema);
const doc = (key) =>
  `https://ontouml.readthedocs.io/en/latest/${reference[key]?.path || ""}`;
const minimum = (cardinality) =>
  cardinality === "*" ? 0 : Number(String(cardinality).split("..")[0]);
function validMultiplicity(value) {
  if (typeof value !== "string" || !/^(\d+|\*)(\.\.(\d+|\*))?$/.test(value))
    return false;
  const [lower, upper] = value.split("..");
  return (
    upper === undefined ||
    (lower !== "*" && (upper === "*" || Number(lower) <= Number(upper)))
  );
}

function validateProject(project) {
  const issues = [];
  const add = (
    code,
    severity,
    elementId,
    message,
    stereotype,
    layer = "ontology",
    path,
  ) =>
    issues.push({
      code,
      severity,
      elementId,
      message,
      layer,
      ...(path ? { path } : {}),
      ...(stereotype ? { documentation: doc(stereotype) } : {}),
    });
  const structural = schemaValidator(project);
  if (!structural || project?.type !== "Project") {
    for (const error of schemaValidator.errors || [])
      add(
        "SCHEMA",
        "error",
        null,
        `${error.instancePath || "/"} ${error.message}`,
        null,
        "schema",
        error.instancePath,
      );
    if (project?.type !== "Project")
      add(
        "PROJECT_REQUIRED",
        "error",
        null,
        "Expected a standard OntoUML Project exchange object.",
        null,
        "schema",
      );
    return report(issues);
  }
  const { elements, classes, relations, generalizations, ancestors } =
    indexProject(project);
  const ids = new Set([project.id]);
  for (const e of project.elements) {
    if (ids.has(e.id))
      add(
        "DUPLICATE_ID",
        "error",
        e.id,
        `Duplicate identity ${e.id}.`,
        null,
        "references",
      );
    ids.add(e.id);
  }
  const checkRef = (e, field, target, types) => {
    if (
      !elements.has(target) ||
      (types && !types.includes(elements.get(target)?.type))
    )
      add(
        "INVALID_REFERENCE",
        "error",
        e.id,
        `${field} points to missing or incompatible element ${target}.`,
        null,
        "references",
      );
  };
  if (project.root) checkRef(project, "root", project.root, ["Package"]);
  const owners = new Map();
  for (const e of elements.values()) {
    for (const [field, types] of Object.entries({
      contents: null,
      properties: ["Property"],
      generalizations: ["Generalization"],
      subsettedProperties: ["Property"],
      redefinedProperties: ["Property"],
    }))
      for (const target of e[field] || []) {
        checkRef(e, field, target, types);
        if (["contents", "properties"].includes(field)) {
          if (owners.has(target))
            add(
              "MULTIPLE_OWNERS",
              "error",
              target,
              `${target} is contained more than once.`,
              null,
              "references",
            );
          owners.set(target, e.id);
        }
      }
    if (e.type === "Property") {
      if (e.propertyType)
        checkRef(e, "propertyType", e.propertyType, [
          "Class",
          "BinaryRelation",
          "NaryRelation",
        ]);
      if (e.cardinality !== null && !validMultiplicity(e.cardinality))
        add(
          "MULTIPLICITY",
          "error",
          e.id,
          `Invalid count ${e.cardinality}. Use 1, 0..1, *, or a range such as 1..* with lower ≤ upper.`,
          "association",
          "references",
        );
    }
    if (e.type === "Generalization") {
      checkRef(e, "general", e.general, [
        "Class",
        "BinaryRelation",
        "NaryRelation",
      ]);
      checkRef(e, "specific", e.specific, [
        "Class",
        "BinaryRelation",
        "NaryRelation",
      ]);
    }
    if (e.type === "GeneralizationSet") {
      const members = e.generalizations
        .map((id) => elements.get(id))
        .filter(Boolean);
      if (members.length && new Set(members.map((g) => g.general)).size !== 1)
        add(
          "GENERALIZATION_SET",
          "error",
          e.id,
          "Members of a generalization set must have the same general type.",
          "generalization",
          "references",
        );
    }
    if (e.type === "BinaryRelation") {
      if (e.properties.length !== 2)
        add(
          "BINARY_ENDS",
          "error",
          e.id,
          "A binary relation needs exactly two ends.",
          null,
          "references",
        );
      for (const id of e.properties) {
        const end = elements.get(id);
        if (end && (!end.propertyType || !end.cardinality))
          add(
            "MISSING_END",
            "error",
            e.id,
            "Every visible association end needs a type and an explicit multiplicity.",
            "association",
            "references",
          );
      }
    }
  }
  // Detect cycles iteratively: malformed inputs must not cause recursion overflow.
  for (const c of classes)
    if (ancestors(c.id).some((a) => a.id === c.id))
      add(
        "GENERALIZATION_CYCLE",
        "error",
        c.id,
        "Generalization is cyclic; a type cannot specialize itself.",
        "generalization",
        "references",
      );
  for (const e of elements.values()) {
    let owner = e.id;
    const seen = new Set();
    while (owners.has(owner)) {
      if (seen.has(owner)) {
        add(
          "CONTAINMENT_CYCLE",
          "error",
          e.id,
          "Containment is cyclic.",
          null,
          "references",
        );
        break;
      }
      seen.add(owner);
      owner = owners.get(owner);
    }
  }
  if (issues.some((i) => i.layer === "references")) return report(issues);
  const ancestry = (c) => [c, ...ancestors(c.id)];
  const connected = (c, stereotypes) => {
    const family = new Set(ancestry(c).map((a) => a.id));
    return relations
      .filter((r) => stereotypes.includes(r.stereotype))
      .flatMap((r) => {
        const [a, b] = r.properties.map((id) => elements.get(id));
        return family.has(a.propertyType)
          ? [{ r, own: a, other: b }]
          : family.has(b.propertyType)
            ? [{ r, own: b, other: a }]
            : [];
      });
  };
  for (const c of classes) {
    const parents = ancestors(c.id);
    if (["role", "phase", "subkind"].includes(c.stereotype)) {
      const providers = parents.filter((a) => providerTypes.has(a.stereotype));
      if (providers.length !== 1)
        add(
          "IDENTITY_PROVIDER",
          "error",
          c.id,
          `${text(c.name, c.id)} inherits ${providers.length} identity providers; exactly one is required.`,
          c.stereotype,
        );
    }
    if (
      providerTypes.has(c.stereotype) &&
      parents.some(
        (a) =>
          providerTypes.has(a.stereotype) ||
          ["role", "phase", "subkind"].includes(a.stereotype),
      )
    )
      add(
        "IDENTITY_CONFLICT",
        "error",
        c.id,
        "An identity provider cannot inherit another identity principle.",
        c.stereotype,
      );
    if (
      [...providerTypes, "subkind", "category"].includes(c.stereotype) &&
      parents.some((a) =>
        ["role", "phase", "roleMixin", "phaseMixin"].includes(a.stereotype),
      )
    )
      add(
        "RIGIDITY",
        "error",
        c.id,
        "A rigid type specializes an anti-rigid type.",
        c.stereotype,
      );
    if (
      c.stereotype === "role" &&
      !connected(c, [
        "mediation",
        "material",
        "componentOf",
        "memberOf",
        "subCollectionOf",
      ]).some(({ other }) => minimum(other.cardinality) >= 1)
    )
      add(
        "ROLE_DEPENDENCE",
        "error",
        c.id,
        "This role needs a mandatory relational dependency, directly or inherited. An opposite-end lower bound of zero allows the role to exist without it.",
        "role",
      );
    if (c.stereotype === "phase") {
      const gs = [...elements.values()].filter(
        (e) => e.type === "GeneralizationSet" && e.isComplete && e.isDisjoint,
      );
      if (
        !gs.some((set) =>
          set.generalizations.some((id) => elements.get(id).specific === c.id),
        )
      )
        add(
          "PHASE_PARTITION",
          "error",
          c.id,
          "This phase is outside a complete, disjoint phase partition. Identify the missing alternatives or reconsider its stereotype.",
          "phase",
        );
    }
    if (
      ["category", "mixin", "roleMixin", "phaseMixin"].includes(c.stereotype) &&
      !c.isAbstract
    )
      add(
        "NON_SORTAL_ABSTRACT",
        "error",
        c.id,
        "A non-sortal type must be abstract; its instances receive identity from its specializations.",
        c.stereotype,
      );
    if (c.stereotype === "relator") {
      const total = connected(c, ["mediation"]).reduce(
        (n, { other }) => n + minimum(other.cardinality),
        0,
      );
      if (total < 2)
        add(
          "RELATOR_PARTICIPANTS",
          "error",
          c.id,
          `Its mediations require ${total} participants in total; at least two are needed. One mediation with lower bound 2 is sufficient.`,
          "relator",
        );
    }
    if (["mode", "quality"].includes(c.stereotype)) {
      const links = connected(c, ["characterization"]);
      if (!links.length || links.some(({ other }) => other.cardinality !== "1"))
        add(
          "ASPECT_BEARER",
          "error",
          c.id,
          "An intrinsic aspect must characterize exactly one bearer, directly or through inheritance.",
          c.stereotype,
        );
    }
    if (
      ![
        ...providerTypes,
        "subkind",
        "role",
        "phase",
        "category",
        "mixin",
        "roleMixin",
        "phaseMixin",
        "datatype",
        "enumeration",
      ].includes(c.stereotype)
    )
      add(
        "RULE_COVERAGE",
        "info",
        c.id,
        `Ontology rules for «${c.stereotype || "unspecified"}» are not implemented by this local rule set. Schema and reference checks still apply.`,
        null,
      );
  }
  for (const r of relations) {
    const [a, b] = r.properties.map((id) =>
      elements.get(elements.get(id).propertyType),
    );
    if (
      r.stereotype === "mediation" &&
      !ancestry(a).some((e) => e.stereotype === "relator")
    )
      add(
        "MEDIATION_SOURCE",
        "error",
        r.id,
        "The source of mediation must be a relator or its specialization.",
        "mediation",
      );
    if (
      r.stereotype === "characterization" &&
      !ancestry(a).some((e) => ["mode", "quality"].includes(e.stereotype))
    )
      add(
        "CHARACTERIZATION_SOURCE",
        "error",
        r.id,
        "The source of characterization must be an intrinsic aspect or its specialization.",
        "characterization",
      );
    if (![null, "mediation", "characterization"].includes(r.stereotype))
      add(
        "RELATION_COVERAGE",
        "info",
        r.id,
        `Full constraints for «${r.stereotype}» are outside this local rule set.`,
        null,
      );
  }
  return report(issues);
}
function report(issues) {
  return {
    valid: !issues.some((i) => i.severity === "error"),
    schema: schema.$id,
    engines: [
      {
        name: "Ajv + official OntoUML schema",
        version: "1.0.2",
        layer: "schema",
      },
      {
        name: "OntoUML Atlas documented rule subset",
        version: "1",
        layer: "ontology",
      },
    ],
    issues,
    counts: Object.fromEntries(
      ["error", "warning", "info"].map((s) => [
        s,
        issues.filter((i) => i.severity === s).length,
      ]),
    ),
    limitations: [
      "This is a documented subset of OntoUML rules, not full semantic or Alloy validation.",
      "Passing checks cannot establish correct domain identities, empirical claims, or multiplicities.",
      "N-ary relations, relation-to-relation edges, and diagram annotations are not rendered by this class viewer.",
    ],
  };
}
module.exports = { validateProject, validMultiplicity, minimum };
