const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createDocument,
  reviseDocument,
  relocateDocument,
  validateDocument,
  createSnapshot,
  prepareViewer,
} = require("../lib/index.cjs");
const { createProject } = require("../examples/r5/create-project.cjs");
const clone = (v) => JSON.parse(JSON.stringify(v));
const graph = () => ({
  type: "StructuralModel",
  nodes: [
    {
      id: "account",
      name: "Account",
      attributes: [{ id: "account-id", name: "id", type: "integer" }],
    },
    { id: "order", name: "Order", attributes: [] },
  ],
  relations: [
    {
      id: "owner",
      name: "owner",
      sourceId: "order",
      targetId: "account",
      sourceMultiplicity: "0..*",
      targetMultiplicity: "1",
    },
  ],
  generalizations: [],
  generalizationSets: [],
});
test("Document creation rejects a missing source with a useful input error", () => {
  for (const input of [undefined, null, {}, { title: "Missing model" }])
    assert.throws(() => createDocument(input), /DOCUMENT_INPUT/);
});

test("all profiles retain semantic data across serialization and share generic layout", async () => {
  for (const profile of ["ontouml", "database", "code"]) {
    const document = createDocument({
      profile,
      model: profile === "ontouml" ? createProject() : graph(),
    });
    assert.equal(
      validateDocument(clone(document)).issues.filter(
        (i) => i.layer !== "ontology" && i.severity === "error",
      ).length,
      0,
    );
    assert.deepEqual(clone(document).model, document.model);
    const prepared = await prepareViewer({ document, includeArtifacts: false });
    assert.equal(prepared.artifacts.size, 0);
    assert.equal(prepared.payload.exports.bundle, "");
    assert(prepared.views.length);
    assert(prepared.views[0].diagram.edges.every((e) => e.paths.length));
  }
});
test("snapshots resist edits, proposals keep their baseline, and stale writes fail", () => {
  const model = graph(),
    snapshot = createSnapshot({
      profile: "database",
      model,
      capture: {
        capturedAt: "2026-10-08T12:00:00Z",
        adapter: { id: "fixture", version: "1" },
        source: { kind: "database", identity: "test", scope: ["public"] },
        coverage: { status: "complete", diagnostics: [] },
      },
    });
  const doc = createDocument({
    profile: "database",
    model,
    snapshots: [snapshot],
    baselineId: snapshot.id,
  });
  const changed = clone(model);
  changed.nodes[0].name = "Customer";
  const proposal = reviseDocument(doc, {
    model: changed,
    reason: "Plan a rename",
  });
  assert.equal(proposal.state, "proposal");
  assert.equal(proposal.revision.parentId, doc.revision.id);
  assert.equal(proposal.snapshots[0].model.nodes[0].name, "Account");
  assert.throws(
    () => reviseDocument(proposal, { title: "Stale" }, doc.revision.id),
    /REVISION_CONFLICT/,
  );
  assert.throws(() => reviseDocument(doc, { snapshots: [] }), /cannot change/);
  proposal.snapshots[0].model.nodes[0].name = "Tampered";
  assert(
    validateDocument(proposal).issues.some(
      (i) => i.code === "SNAPSHOT_INTEGRITY",
    ),
  );
});
test("relocating a document records a revision and keeps a captured snapshot", () => {
  const model = graph(),
    snapshot = createSnapshot({
      profile: "database",
      model,
      capture: {
        capturedAt: "2026-10-08T12:00:00Z",
        adapter: { id: "fixture", version: "1" },
        source: { kind: "database", identity: "test", scope: ["public"] },
        coverage: { status: "complete", diagnostics: [] },
      },
    });
  const records = [
    { id: "a", kind: "plan", text: "A", path: "../../active/0004-x/plan.md" },
    { id: "b", kind: "plan", text: "B", path: "../../knowledge/x.md" },
  ];
  for (const workId of ["work-0004", undefined]) {
    const doc = createDocument({
      profile: "database",
      state: "snapshot",
      model,
      snapshots: [snapshot],
      baselineId: snapshot.id,
      ...(workId ? { workId } : {}),
      context: { records, links: [{ elementId: "account", recordId: "a" }] },
    });
    const moved = relocateDocument(doc, {
      ...(workId ? { workId: "work-0009" } : {}),
      recordPaths: { a: "plan.md", b: null },
      reason: "Imported as work-0009",
    });
    assert.equal(moved.state, "snapshot");
    assert.equal(moved.workId, workId ? "work-0009" : undefined);
    assert.equal(moved.revision.parentId, doc.revision.id);
    assert.equal(moved.revision.reason, "Imported as work-0009");
    assert.deepEqual(
      moved.context.records.map((r) => r.path),
      ["plan.md", undefined],
    );
    assert.deepEqual(moved.context.links, doc.context.links);
    assert.equal(validateDocument(moved).valid, true);
    // Only work identity and record paths can move; other edits stay revisions.
    assert.equal(
      reviseDocument(doc, { context: { records, links: [] } }).state,
      "proposal",
    );
    assert.throws(
      () => reviseDocument(doc, { workId: "work-0009" }),
      /cannot change/,
    );
    assert.throws(
      () => relocateDocument(doc, { workId: "not <a> work" }),
      /RELOCATE_WORK/,
    );
    assert.throws(
      () => relocateDocument(doc, { recordPaths: { missing: "x" } }),
      /RELOCATE_RECORD/,
    );
    assert.throws(() => relocateDocument(doc, {}), /RELOCATE_EMPTY/);
    assert.throws(
      () => relocateDocument(doc, { workId: "work-0009", title: "x" }),
      /RELOCATE_INPUT/,
    );
    assert.throws(
      () => relocateDocument(doc, { recordPaths: [["a", "plan.md"]] }),
      /RELOCATE_RECORD/,
    );
    assert.throws(
      () => relocateDocument(doc, { recordPaths: new Map([["a", "x"]]) }),
      /RELOCATE_RECORD/,
    );
    assert.throws(() => relocateDocument(doc, "work-0009"), /RELOCATE_INPUT/);
    assert.throws(
      () => relocateDocument(doc, { workId: "work-0009" }, "stale"),
      /REVISION_CONFLICT/,
    );
  }
});
test("structural validation rejects unsupported versions, invalid counts, references, sets and cycles", () => {
  const doc = createDocument({ profile: "code", model: graph() });
  for (const change of [
    (d) => (d.formatVersion = 2),
    (d) => (d.model.relations[0].targetId = "missing"),
    (d) => (d.model.relations[0].targetMultiplicity = "9..2"),
    (d) => d.model.nodes.push(clone(d.model.nodes[0])),
    (d) => d.context.links.push({ elementId: "account", recordId: "missing" }),
    (d) =>
      d.model.generalizations.push({
        id: "cycle",
        specificId: "account",
        generalId: "account",
      }),
  ]) {
    const invalid = clone(doc);
    change(invalid);
    assert.equal(validateDocument(invalid).valid, false);
  }
  const unknown = clone(doc);
  unknown.model.relations[0].targetMultiplicity = "?";
  assert.equal(validateDocument(unknown).valid, true);
  const malformed = clone(doc);
  malformed.model.nodes = null;
  assert.equal(validateDocument(malformed).valid, false);
});
