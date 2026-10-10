const { Project } = require("ontouml-js");

// A small, authored teaching model matching the shared inheritance pattern.
function createEnrollmentModel() {
  const ids = new Map();
  const stable = (object, id) => {
    ids.set(object.id, id);
    return object;
  };
  const project = stable(new Project(), "enrollment-project");
  project.name.add("Enrollment inheritance");
  const root = stable(
    project.packageBuilder().root().name("Enrollment").build(),
    "enrollment-package",
  );
  const enrollment = stable(
    root.classBuilder().relator().name("Enrollment").build(),
    "enrollment",
  );
  const person = stable(
    root.classBuilder().kind().name("Person").build(),
    "person",
  );
  const institution = stable(
    root.classBuilder().kind().name("Institution").build(),
    "institution",
  );
  const active = stable(
    root.classBuilder().phase().name("Active").build(),
    "active",
  );
  const suspended = stable(
    root.classBuilder().phase().name("Suspended").build(),
    "suspended",
  );
  const undergraduate = stable(
    root.classBuilder().subkind().name("Undergraduate Enrollment").build(),
    "undergraduate",
  );
  const graduate = stable(
    root.classBuilder().subkind().name("Graduate Enrollment").build(),
    "graduate",
  );
  const inherits = (specific) =>
    stable(
      root
        .generalizationBuilder()
        .specific(specific)
        .general(enrollment)
        .build(),
      `inherits-${ids.get(specific.id)}`,
    );
  stable(
    root
      .generalizationSetBuilder()
      .name("Enrollment state")
      .generalizations(inherits(active), inherits(suspended))
      .complete()
      .disjoint()
      .build(),
    "enrollment-state",
  );
  stable(
    root
      .generalizationSetBuilder()
      .name("Degree level")
      .generalizations(inherits(undergraduate), inherits(graduate))
      .complete()
      .disjoint()
      .build(),
    "degree-level",
  );
  for (const participant of [person, institution]) {
    const id = `mediates-${ids.get(participant.id)}`;
    const relation = stable(
      root
        .binaryRelationBuilder()
        .mediation()
        .source(enrollment)
        .target(participant)
        .sourceCardinality("0..*")
        .targetCardinality("1")
        .name("mediates")
        .build(),
      id,
    );
    stable(relation.sourceEnd, `${id}-source`);
    stable(relation.targetEnd, `${id}-target`);
  }
  const normalize = (value, field) => {
    if (field === "created") return "2026-10-07T00:00:00.000Z";
    if (Array.isArray(value)) return value.map((item) => normalize(item));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, normalize(item, key)]),
      );
    return typeof value === "string" ? ids.get(value) || value : value;
  };
  return {
    project: normalize(JSON.parse(JSON.stringify(project))),
    views: [
      {
        key: "inheritance",
        label: "Enrollment",
        title: "Enrollment generalization sets",
        direction: "DOWN",
        nodeIds: [
          "active",
          "suspended",
          "enrollment",
          "undergraduate",
          "graduate",
        ],
        columns: [
          ["active", "suspended"],
          ["enrollment"],
          ["undergraduate", "graduate"],
        ],
        focusIds: [
          "active",
          "suspended",
          "enrollment",
          "undergraduate",
          "graduate",
        ],
      },
    ],
  };
}
module.exports = { createEnrollmentModel };
