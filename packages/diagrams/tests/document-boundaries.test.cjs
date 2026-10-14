const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createDocument,
  reviseDocument,
  validateDocument,
  prepareViewer,
} = require("../lib/index.cjs");
const model = () => ({
  type: "StructuralModel",
  nodes: [
    {
      id: "a",
      name: "A",
      attributes: [{ id: "a-id", name: "id", type: "integer" }],
    },
  ],
  relations: [],
  generalizations: [],
  generalizationSets: [],
});
const copy = (v) => JSON.parse(JSON.stringify(v));
test("malformed structural input becomes a finding instead of crashing", () => {
  const document = createDocument({ profile: "code", model: model() });
  for (const nodes of [[null], {}, null, ["invalid"]]) {
    const invalid = copy(document);
    invalid.model.nodes = nodes;
    assert.equal(validateDocument(invalid).valid, false);
  }
});
test("revision retains imported origin and unknown document/model/revision extensions", () => {
  const document = createDocument({
    profile: "code",
    model: model(),
    imported: true,
    extension: { retained: true },
  });
  document.revision.extension = "revision metadata";
  document.model.extension = { language: "fixture" };
  document.model.elements = "adapter-extension";
  document.project = "serialized extension";
  document.createdAt = "extension timestamp";
  const revised = reviseDocument(document, { title: "Updated" });
  assert.equal(revised.imported, true);
  assert.deepEqual(revised.extension, document.extension);
  assert.equal(revised.revision.extension, "revision metadata");
  assert.deepEqual(revised.model.extension, document.model.extension);
  assert.equal(revised.model.elements, "adapter-extension");
  assert.equal(revised.project, "serialized extension");
  assert.equal(revised.createdAt, "extension timestamp");
});
test("views and attributes validate before diagram preparation", async () => {
  const document = createDocument({ profile: "code", model: model() });
  for (const changes of [
    { key: "view", nodeIds: "a" },
    { key: "view", nodeIds: ["missing"] },
    { key: "view", nodeIds: ["a"], columns: [["missing"]] },
    { key: "view", nodeIds: ["a"], focusIds: ["missing"] },
    { key: "view", nodeIds: ["a"], edgeIds: ["missing"] },
  ]) {
    const invalid = copy(document);
    invalid.views = [changes];
    assert.equal(validateDocument(invalid).valid, false);
    await assert.rejects(
      prepareViewer({ document: invalid }),
      /DOCUMENT_SCHEMA|VIEW_/,
    );
  }
  for (const multiplicity of ["9..2", {}, 123]) {
    const invalid = copy(document);
    invalid.model.nodes[0].attributes[0].multiplicity = multiplicity;
    assert.equal(validateDocument(invalid).valid, false);
  }
  assert.throws(
    () =>
      createDocument({ profile: "code", state: "snapshot", model: model() }),
    /SNAPSHOT_STATE/,
  );
});
test("deep inheritance is checked with bounded stack use", () => {
  const graph = model();
  graph.nodes = Array.from({ length: 12000 }, (_, i) => ({
    id: `c${i}`,
    name: `C${i}`,
    attributes: [],
  }));
  graph.generalizations = graph.nodes.map((n, i) => ({
    id: `g${i}`,
    specificId: n.id,
    generalId: `c${(i + 1) % graph.nodes.length}`,
  }));
  const document = createDocument({ profile: "code", model: model() });
  document.model = graph;
  assert(
    validateDocument(document).issues.some(
      (i) => i.code === "INHERITANCE_CYCLE",
    ),
  );
});
