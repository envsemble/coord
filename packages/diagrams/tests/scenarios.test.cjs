const { test } = require("node:test"),
  assert = require("node:assert/strict");
const atlas = require("../lib/index.cjs"),
  { createEnrollmentDocument } = require("../examples/enrollment/learning.cjs");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
test("Finite OntoUML examples assess both ends and inherited complete/disjoint memberships", () => {
  const document = createEnrollmentDocument();
  assert.equal(
    atlas.checkScenario(document, "valid-enrollment").outcome,
    "valid",
  );
  for (const [id, code] of [
    ["invalid-overlap", "SET_DISJOINT"],
    ["invalid-unclassified", "SET_COMPLETE"],
    ["invalid-participation", "MULTIPLICITY"],
  ]) {
    const result = atlas.checkScenario(document, id);
    assert.equal(result.outcome, "invalid");
    assert.equal(result.expectationMet, true);
    assert(result.issues.some((i) => i.code === code));
  }
  const explanations = atlas.explainModel(atlas.documentViewerModel(document));
  assert(
    explanations.some((e) =>
      e.text.includes("For each Enrollment: exactly 1 Person"),
    ),
  );
  assert(
    explanations.some((e) =>
      e.text.includes("For each Person: at least 0 Enrollment"),
    ),
  );
});
test("Overlapping and incomplete sets permit their corresponding instance situations", () => {
  const original = createEnrollmentDocument(),
    model = structuredClone(original.model);
  for (const e of model.elements)
    if (e.type === "GeneralizationSet") {
      e.isComplete = false;
      e.isDisjoint = false;
    }
  const document = atlas.reviseDocument(original, { model });
  assert.equal(
    atlas.checkScenario(document, "invalid-overlap").outcome,
    "valid",
  );
  assert.equal(
    atlas.checkScenario(document, "invalid-unclassified").outcome,
    "valid",
  );
  assert.equal(
    atlas.checkScenario(document, "invalid-overlap").expectationMet,
    false,
  );
});
test("Scenario references, duplicate pairs, declared limits and walkthrough views are checked before publication", () => {
  for (const edit of [
    (d) => d.learning.scenarios[0].instances[0].classIds.push("absent"),
    (d) =>
      d.learning.scenarios[0].links.push({
        ...d.learning.scenarios[0].links[0],
      }),
    (d) => (d.learning.scenarios[0].links[0].relationId = "enrollment"),
    (d) => (d.learning.walkthroughs[0].steps[0].viewKey = "absent"),
    (d) => (d.learning.scenarios[0].contextIds = ["absent"]),
    (d) =>
      (d.learning.scenarios[0].instances = Array.from(
        { length: 101 },
        (_, i) => ({ id: `i-${i}`, classIds: ["enrollment"] }),
      )),
  ]) {
    const document = structuredClone(createEnrollmentDocument());
    edit(document);
    assert(!atlas.validateDocument(document).valid);
  }
});
test("Unknown counts, dependency links and text invariants leave finite examples unassessed", () => {
  const document = atlas.createDocument({
    profile: "code",
    model: {
      type: "StructuralModel",
      nodes: [
        { id: "a", name: "A", attributes: [] },
        { id: "b", name: "B", attributes: [] },
      ],
      relations: [
        {
          id: "uses",
          name: "uses",
          sourceId: "a",
          targetId: "b",
          sourceMultiplicity: "?",
          targetMultiplicity: "?",
          stereotype: "dependency",
        },
      ],
      generalizations: [],
      generalizationSets: [],
    },
    learning: {
      walkthroughs: [],
      scenarios: [
        {
          id: "unknown",
          title: "Unknown runtime",
          expected: "valid",
          instances: [
            { id: "one", classIds: ["a"] },
            { id: "two", classIds: ["b"] },
          ],
          links: [{ relationId: "uses", sourceId: "one", targetId: "two" }],
        },
      ],
    },
  });
  const result = atlas.checkScenario(document, "unknown");
  assert.equal(result.outcome, "unassessed");
  assert.equal(result.expectationMet, null);
  assert(result.unassessed.length);
});
test("Offline reports retain learning, scoped context, uncertainty and editable HTML", async () => {
  const document = createEnrollmentDocument(),
    built = await atlas.buildViewer({ document });
  assert.equal(built.payload.report.scenarios.length, 4);
  assert.equal(built.payload.report.diagrams.length, 2);
  assert(built.payload.report.diagrams.every((d) => d.svg.includes("<svg")));
  const reopened = atlas.importDocument(built.html);
  assert.deepEqual(reopened.learning, document.learning);
  assert.deepEqual(reopened.reporting, document.reporting);
  const proposal = atlas.createProposal(reopened);
  await atlas.prepareViewer({ document: proposal, includeArtifacts: false });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-scenarios-"));
  try {
    const w = atlas.createWorkspace(temp),
      saved = await w.execute("atlas_create", { input: document });
    const checked = await w.execute("atlas_scenarios", {
      handle: saved.handle,
      offset: 1,
      limit: 1,
    });
    assert.equal(checked.total, 4);
    assert.equal(checked.scenarios[0].outcome, "invalid");
    assert.equal(checked.scenarios[0].expectationMet, true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
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
test("Report text safely retains structured diagnostic metadata and navigation resolves sets/members", async () => {
  const { createElement } = require("react"),
    { renderToStaticMarkup } = require("react-dom/server");
  const { loadComponents: load } = require("./load-components.cjs");
  const doc = createEnrollmentDocument(),
    snapshot = atlas.createSnapshot({
      profile: doc.profile,
      model: doc.model,
      capture: {
        capturedAt: doc.revision.createdAt,
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
    ...doc,
    state: "snapshot",
    snapshots: [snapshot],
    baselineId: snapshot.id,
  });
  const prepared = await atlas.prepareViewer({
    document: captured,
    includeArtifacts: false,
  });
  const html = renderToStaticMarkup(
    createElement(load("src/learning/ModelReport.jsx").ModelReport, {
      report: prepared.payload.report,
      model: prepared.model,
      snippets: prepared.payload.snippets,
      onInspect: () => {},
    }),
  );
  assert(html.includes("structured diagnostic"));
  assert(html.includes("structured limitation"));
  const extended = structuredClone(prepared.model);
  extended.classes[0].rationale = { claim: "retained extension" };
  extended.classes[0].questions = {
    question: { text: "structured question" },
    why: { reason: "structured reason" },
  };
  const extendedHtml = renderToStaticMarkup(
    createElement(load("src/learning/ModelReport.jsx").ModelReport, {
      report: prepared.payload.report,
      model: extended,
      snippets: prepared.payload.snippets,
      onInspect: () => {},
    }),
  );
  assert(extendedHtml.includes("retained extension"));
  assert(extendedHtml.includes("structured question"));
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
      "inheritance",
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
