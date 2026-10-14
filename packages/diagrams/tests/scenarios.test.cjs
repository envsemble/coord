const { test } = require("node:test"),
  assert = require("node:assert/strict");
const atlas = require("../lib/index.cjs");
const { createElement } = require("react"),
  { renderToStaticMarkup } = require("react-dom/server");
const { loadComponents: load } = require("./load-components.cjs");

// Enrollment: each needs one learner and one school, and is active or
// suspended. Scenarios are object diagrams of example instances.
const ENROLLMENT = `@startuml
title Enrollment
abstract class Enrollment
class Active
class Suspended
class Person {
  name : String
}
class School
Active --|> Enrollment
Suspended --|> Enrollment
Enrollment "0..*" -- "1" Person : learner
Enrollment "0..*" -- "1" School : school
@enduml
`;
const scenario = (expected, ...lines) =>
  [
    "@startuml",
    `' atlas scenario enrollment.puml expected ${expected}`,
    ...lines,
    "@enduml",
    "",
  ].join("\n");
const read = (reference) =>
  reference === "enrollment.puml" ? ENROLLMENT : null;
const check = (text) =>
  atlas.checkDiagram(text, { path: "example.puml", read });
const VALID = scenario(
  "valid",
  'object "e1 : Active" as e1',
  'object "ada : Person" as ada {',
  '  name = "Ada"',
  "}",
  'object "mit : School" as mit',
  "e1 -- ada : learner",
  "e1 -- mit : school",
);

test("Object diagrams are assessed against their class diagram, with inherited memberships and both ends", () => {
  assert.deepEqual(check(VALID), []);
  // Without its learner the enrollment breaks the learner end's count.
  const orphan = VALID.replace("e1 -- ada : learner\n", "");
  assert.deepEqual(
    check(orphan.replace("expected valid", "expected invalid")),
    [],
  );
  const [problem] = check(orphan);
  assert.equal(problem.code, "SCENARIO");
  assert.match(
    problem.message,
    /expected to be valid.*e1 has 0 linked instances; this end requires 1/,
  );
  // An abstract class needs a concrete subclass membership.
  const abstract = VALID.replace('"e1 : Active"', '"e1 : Enrollment"');
  assert.match(
    check(abstract)[0].message,
    /abstract membership needs a declared concrete subtype/,
  );
  // A link written from the other end means the same.
  assert.deepEqual(
    check(VALID.replace("e1 -- mit : school", "mit -- e1 : school")),
    [],
  );
  // An invalid example that holds is a finding too.
  assert.match(
    check(VALID.replace("expected valid", "expected invalid"))[0].message,
    /expected to be invalid, but enrollment.puml accepts it/,
  );
  const { diagram } = atlas.parseDiagram(ENROLLMENT);
  const explanations = atlas.explainModel(atlas.diagramViewerModel(diagram));
  assert(
    explanations.some((e) =>
      e.text.includes("For each Enrollment: exactly 1 Person"),
    ),
  );
});

test("Scenario classes, slots and links must resolve in the class diagram", () => {
  const messages = (text) => check(text).map((p) => `${p.line} ${p.code}`);
  assert.deepEqual(
    messages(VALID.replace('"mit : School"', '"mit : University"')),
    ["7 SCENARIO_CLASS"],
  );
  assert.deepEqual(messages(VALID.replace('name = "Ada"', 'age = "36"')), [
    "5 SCENARIO_SLOT",
  ]);
  assert.deepEqual(messages(VALID.replace(": school", ": campus")), [
    "9 SCENARIO_LINK",
  ]);
  assert.deepEqual(messages(VALID.replace("e1 -- mit : school", "e1 -- mit")), [
    "9 LINK",
  ]);
  assert.deepEqual(messages(VALID.replace('"e1 : Active" as e1', "e1")), [
    "3 OBJECT",
  ]);
  // The class diagram itself must exist and read.
  assert.deepEqual(
    atlas
      .checkDiagram(VALID, { path: "example.puml", read: () => null })
      .map((p) => p.code),
    ["REFERENCE"],
  );
  assert.deepEqual(
    atlas
      .checkDiagram(VALID, {
        path: "example.puml",
        read: () => "@startuml\nentity t\n@enduml\n",
      })
      .map((p) => p.code),
    ["REFERENCE"],
  );
});

test("Unknown counts and dependencies leave an example unassessed, a warning rather than an error", () => {
  const classes = `@startuml
class A
class B
A ..> B
@enduml
`;
  const problems = atlas.checkDiagram(
    '@startuml\n\' atlas scenario classes.puml expected valid\nobject "one : A" as one\nobject "two : B" as two\none -- two : uses\n@enduml\n',
    { read: () => classes },
  );
  assert.deepEqual(
    problems.map((p) => p.code),
    ["SCENARIO_LINK"],
    "a dependency has no name to link by",
  );
  const unlinked = atlas.checkDiagram(
    '@startuml\n\' atlas scenario classes.puml expected valid\nobject "one : A" as one\n@enduml\n',
    { read: () => classes },
  );
  assert.deepEqual(
    unlinked.map((p) => [p.code, p.severity]),
    [["SCENARIO_UNASSESSED", "warning"]],
  );
});

test("A class diagram's payload carries the scenarios that exemplify it, assessed, for the guide", async () => {
  const { diagrams, prepared } = await atlas.prepareDiagrams({
    files: [
      { path: "enrollment.puml", text: ENROLLMENT },
      {
        path: "examples/valid.puml",
        text: VALID.replace("enrollment.puml", "../enrollment.puml"),
      },
    ],
  });
  assert.deepEqual(
    diagrams.map((d) => [d.path, d.role, d.profile, d.scenario?.of ?? null]),
    [
      ["enrollment.puml", "diagram", "class", null],
      ["examples/valid.puml", "scenario", "object", "enrollment.puml"],
    ],
  );
  const payload = prepared.get("enrollment.puml").payload;
  const [example] = payload.learning.scenarios;
  assert.equal(example.id, "examples/valid.puml");
  assert.equal(example.result.outcome, "valid");
  assert.equal(example.result.expectationMet, true);
  const guide = renderToStaticMarkup(
    createElement(load("src/learning/LearningContent.jsx").LearningLibrary, {
      model: payload.model,
      learning: payload.learning,
      onInspect() {},
    }),
  );
  assert(guide.includes(">Examples<"));
  assert(guide.includes("Valid · as expected"));
  assert(guide.includes("ada : Person"));
  assert(!guide.includes('role="tablist"'));
  // The object diagram is drawn too: its objects with their slot values.
  const objects = prepared.get("examples/valid.puml");
  const ada = objects.model.classes.find((c) => c.id === "ada");
  assert.equal(ada.stereotype, "object");
  assert.deepEqual(
    ada.attributes.map((a) => [a.name, a.type, a.slot]),
    [["name", '"Ada"', true]],
  );
  const { UMLNode } = load();
  const node = objects.views[0].diagramFields.nodes.find((n) => n.id === "ada");
  assert(
    renderToStaticMarkup(
      createElement("svg", null, createElement(UMLNode, { node })),
    ).includes("name = &quot;Ada&quot;"),
  );
});

test("Abstract captured types require a concrete subtype, not an unrelated concrete membership", () => {
  for (const flag of ["abstract", "isAbstract"]) {
    const document = atlas.createDocument({
      profile: "code",
      model: {
        type: "StructuralModel",
        nodes: [
          { id: "a", name: "Abstract", [flag]: true, attributes: [] },
          { id: "b", name: "Unrelated", attributes: [] },
          { id: "c", name: "Concrete", attributes: [] },
        ],
        relations: [],
        generalizations: [{ id: "inherits", specificId: "c", generalId: "a" }],
        generalizationSets: [],
      },
      learning: {
        walkthroughs: [],
        scenarios: [
          {
            id: "only",
            title: "Only abstract",
            expected: "invalid",
            instances: [{ id: "i", classIds: ["a"] }],
            links: [],
          },
          {
            id: "unrelated",
            title: "Unrelated concrete",
            expected: "invalid",
            instances: [{ id: "i", classIds: ["a", "b"] }],
            links: [],
          },
          {
            id: "concrete",
            title: "Concrete subtype",
            expected: "valid",
            instances: [{ id: "i", classIds: ["c"] }],
            links: [],
          },
        ],
      },
    });
    assert.equal(atlas.checkScenario(document, "only").outcome, "invalid");
    assert.equal(atlas.checkScenario(document, "unrelated").outcome, "invalid");
    assert.equal(atlas.checkScenario(document, "concrete").outcome, "valid");
  }
});
test("Details show structured rationale safely, leave capture diagnostics out, and navigation resolves sets/members", async () => {
  const model = {
    type: "StructuralModel",
    nodes: ["enrollment", "active", "suspended"].map((id) => ({
      id,
      name: id[0].toUpperCase() + id.slice(1),
      attributes: [],
    })),
    relations: [],
    generalizations: ["active", "suspended"].map((id) => ({
      id: `inherits-${id}`,
      specificId: id,
      generalId: "enrollment",
    })),
    generalizationSets: [
      {
        id: "enrollment-state",
        name: "Enrollment state",
        generalizations: ["inherits-active", "inherits-suspended"],
        complete: true,
        disjoint: true,
      },
    ],
  };
  const snapshot = atlas.createSnapshot({
    profile: "code",
    model,
    capture: {
      capturedAt: "2026-10-08T00:00:00.000Z",
      adapter: { id: "fixture", version: "1" },
      source: {
        identity: "Structured fixture",
        kind: "authored",
        scope: ["model"],
        revision: { hash: "structured revision" },
      },
      coverage: {
        status: "partial",
        diagnostics: [{ message: { details: "structured diagnostic" } }],
      },
      limitations: [{ message: "structured limitation" }],
      consistency: { kind: { note: "structured" } },
    },
  });
  const captured = atlas.createDocument({
    profile: "code",
    model,
    state: "snapshot",
    snapshots: [snapshot],
    baselineId: snapshot.id,
  });
  const prepared = await atlas.prepareViewer({
    document: captured,
    includeArtifacts: false,
  });
  const extended = structuredClone(prepared.model);
  extended.classes[0].rationale = { claim: "retained extension" };
  extended.classes[0].questions = {
    question: { text: "structured question" },
    why: { reason: "structured reason" },
  };
  const details = renderToStaticMarkup(
    createElement(load("src/viewer/DetailsContent.jsx").ConceptDetails, {
      concept: extended.classes[0],
      model: extended,
      snippets: prepared.payload.snippets,
    }),
  );
  assert(details.includes("retained extension"));
  assert(details.includes("structured question"));
  assert(details.includes("structured reason"));
  // Capture metadata is provenance, not something to review per element.
  assert(!details.includes("structured diagnostic"));
  assert(!details.includes("structured limitation"));
  const { inspectionTarget } = load("src/model/inspectionTarget.js"),
    { indexViewerModel } = load("src/model/domainModel.js");
  const index = indexViewerModel(
    prepared.model,
    prepared.views[0].diagram.generalizationGroups,
  );
  assert.equal(
    inspectionTarget(
      prepared.model,
      index,
      prepared.views,
      prepared.views[0].key,
      "enrollment-state",
    ).target.kind,
    "group",
  );
  const codeModel = {
    ...prepared.model,
    classes: [
      {
        id: "owner",
        name: "Owner",
        attributes: [{ id: "field" }],
        methods: [{ id: "method" }],
      },
    ],
    relations: [],
    generalizations: [],
    partitions: [],
  };
  const views = [{ key: "code", nodeIds: ["owner"], diagram: { edges: [] } }];
  for (const id of ["field", "method"])
    assert.equal(
      inspectionTarget(
        codeModel,
        indexViewerModel(codeModel),
        views,
        "code",
        id,
      ).target.id,
      "owner",
    );
});
