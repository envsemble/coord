const { test } = require("node:test"),
  assert = require("node:assert/strict");
const atlas = require("../lib/index.cjs");
const { baselineDocument } = require("../lib/document/comparison.cjs");
const clone = (v) => JSON.parse(JSON.stringify(v));
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
function example() {
  return atlas.createDocument({
    id: "example",
    title: "Enrollment",
    profile: "code",
    model: {
      type: "StructuralModel",
      nodes: [
        {
          id: "student",
          name: "Student",
          attributes: [{ id: "student-name", name: "name", type: "string" }],
        },
        { id: "enrollment", name: "Enrollment", attributes: [] },
      ],
      relations: [
        {
          id: "enrolled",
          name: "enrolled",
          sourceId: "student",
          targetId: "enrollment",
          sourceMultiplicity: "1",
          targetMultiplicity: "0..*",
        },
      ],
      generalizations: [],
      generalizationSets: [],
      constraints: [],
    },
    context: {
      records: [
        {
          id: "plan",
          kind: "plan",
          title: "Decision",
          text: "One student can enroll several times.",
        },
      ],
      links: [{ elementId: "student", recordId: "plan" }],
    },
  });
}
function revise(d, change) {
  const model = clone(d.model);
  change(model);
  return atlas.reviseDocument(d, { model });
}
test("Retained baseline and proposal exports stay reproducible across wall-clock changes", async (t) => {
  const proposal = atlas.createProposal(example());
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-10-10T00:00:00Z"),
  });
  const baseline = baselineDocument(proposal);
  const first = await atlas.buildViewer({ document: proposal });
  t.mock.timers.tick(3000);
  assert.deepEqual(baselineDocument(proposal), baseline);
  const second = await atlas.buildViewer({ document: proposal });
  assert.equal(second.html, first.html);
  assert.equal(
    baseline.revision.createdAt,
    proposal.snapshots.find((s) => s.id === proposal.baselineId).capture
      .capturedAt,
  );
});
test("Semantic comparison separates identified renames, fields, counts and constraints from presentation", () => {
  const a = example();
  const b = revise(a, (m) => {
    m.nodes[0].name = "Learner";
    m.nodes[0].x = 100;
    m.nodes[0].location = { file: "moved.ts", startLine: 99 };
    m.nodes[0].attributes[0].type = "number";
    m.relations[0].targetMultiplicity = "1..*";
    m.constraints.push(["rule", "Required enrollment"]);
  });
  const diff = atlas.compareDocuments(a, b);
  assert(
    diff.changes.some(
      (c) => c.elementId === "student" && c.kind === "modified",
    ),
  );
  assert(
    diff.changes.some(
      (c) =>
        c.elementId === "student-name" &&
        c.properties.some((p) => p.key === "type"),
    ),
  );
  assert(
    diff.changes.some(
      (c) =>
        c.elementId === "enrolled" &&
        c.properties.some((p) => p.key === "targetMultiplicity"),
    ),
  );
  assert(
    diff.changes.find((c) => c.elementId === "student").rationale.length === 1,
  );
  assert(
    !diff.changes
      .flatMap((c) => c.properties)
      .some((p) => ["x", "location"].includes(p.key)),
  );
  assert.equal(
    atlas.compareDocuments(
      a,
      revise(a, (m) => {
        m.nodes[0].x = 900;
        m.nodes.reverse();
      }),
    ).changes.length,
    0,
  );
});
test("Comparison shares orthogonal geometry and retains removed entities and routes", async () => {
  const ancestor = example(),
    proposal = atlas.createProposal(ancestor);
  const changed = revise(proposal, (m) => {
    m.nodes[0].name = "Learner";
    m.nodes = m.nodes.filter((n) => n.id !== "enrollment");
    m.relations = [];
    m.nodes.push({ id: "course", name: "Course", attributes: [] });
    m.relations.push({
      id: "courses",
      name: "attends",
      sourceId: "student",
      targetId: "course",
      sourceMultiplicity: "1",
      targetMultiplicity: "0..*",
    });
  });
  const p = (
    await atlas.prepareViewer({ document: changed, includeArtifacts: false })
  ).payload;
  const a = p.comparison.baseline.views[0].diagram,
    b = p.views[0].diagram,
    c = p.comparison.changeView.views[0].diagram;
  for (const node of a.nodes.filter((n) =>
    b.nodes.some((m) => m.id === n.id),
  )) {
    const same = b.nodes.find((n) => n.id === node.id);
    assert.equal(node.x, same.x);
    assert.equal(node.y, same.y);
    assert.equal(node.width, same.width);
    assert.equal(node.height, same.height);
  }
  assert.equal(
    c.nodes.find((n) => n.id === "enrollment").changeStatus,
    "removed",
  );
  assert.equal(c.nodes.find((n) => n.id === "course").changeStatus, "added");
  assert(
    c.edges.some((e) => e.id === "enrolled" && e.changeStatus === "removed"),
  );
  assert(c.edges.some((e) => e.id === "courses" && e.changeStatus === "added"));
  for (const scene of [a, b, c])
    require("../lib/layout/validateDiagram.cjs").validateDiagram(scene);
});
test("Changes retains old and new endpoint routes with unique selectable identities", async () => {
  const model = clone(example().model);
  model.nodes.push({ id: "course", name: "Course", attributes: [] });
  model.generalizations.push({
    id: "category",
    specificId: "student",
    generalId: "enrollment",
  });
  const base = atlas.createDocument({
    id: "changed-routes",
    profile: "code",
    model,
  });
  const changed = revise(atlas.createProposal(base), (m) => {
    m.relations[0].targetId = "course";
    m.generalizations[0].generalId = "course";
  });
  const payload = (
    await atlas.prepareViewer({ document: changed, includeArtifacts: false })
  ).payload;
  const before = payload.comparison.baseline.views[0].diagram;
  const after = payload.views[0].diagram;
  const scene = payload.comparison.changeView.views[0].diagram;
  assert.equal(scene.edges.length, 4);
  assert.equal(new Set(scene.edges.map((e) => e.id)).size, 4);
  for (const id of ["enrolled", "category"]) {
    const oldRoute = scene.edges.find(
      (e) => e.originalId === id && e.changeStatus === "removed",
    );
    const newRoute = scene.edges.find(
      (e) => e.id === id && e.changeStatus === "modified",
    );
    assert(oldRoute && newRoute);
    assert.notEqual(oldRoute.id, newRoute.id);
    assert.deepEqual(
      oldRoute.points,
      before.edges.find((e) => e.id === id).points,
    );
    assert.deepEqual(
      newRoute.points,
      after.edges.find((e) => e.id === id).points,
    );
    assert.equal(oldRoute.target, "enrollment");
    assert.equal(newRoute.target, "course");
    assert(
      [
        ...payload.comparison.changeView.model.relations,
        ...payload.comparison.changeView.model.generalizations,
      ].some((e) => e.id === oldRoute.id),
    );
  }
  require("../lib/layout/validateDiagram.cjs").validateDiagram(scene);
  assert.deepEqual(baselineDocument(changed).model, base.model);
});

test("Changes preserves both route kinds when an association becomes a generalization", async () => {
  const base = example();
  const changed = revise(atlas.createProposal(base), (model) => {
    const relation = model.relations.pop();
    model.generalizations.push({
      id: relation.id,
      specificId: relation.sourceId,
      generalId: relation.targetId,
    });
  });
  const { payload } = await atlas.prepareViewer({
    document: changed,
    includeArtifacts: false,
  });
  const scene = payload.comparison.changeView.views[0].diagram;
  assert.equal(scene.edges.length, 2);
  assert.equal(new Set(scene.edges.map((edge) => edge.id)).size, 2);
  const previous = scene.edges.find((edge) => edge.changeStatus === "removed");
  assert.equal(previous.originalId, "enrolled");
  assert.notEqual(previous.id, "enrolled");
  assert(scene.edges.some((edge) => edge.id === "enrolled"));
  require("../lib/layout/validateDiagram.cjs").validateDiagram(scene);
  assert.deepEqual(baselineDocument(changed).model, base.model);
});

test("Generalization-set constraints remain semantic", () => {
  const before = {
    generalizationSets: [
      {
        id: "set",
        name: "Enrollment types",
        generalizations: ["x", "y"],
        complete: true,
        disjoint: true,
      },
    ],
  };
  const after = clone(before);
  after.generalizationSets[0].disjoint = false;
  assert.equal(
    atlas.compareModels(before, after).changes[0].properties[0].key,
    "disjoint",
  );
  after.generalizationSets[0].disjoint = true;
  after.generalizationSets[0].generalizations.reverse();
  assert.equal(atlas.compareModels(before, after).changes.length, 0);
});

test("Imported comparison metadata rejects incomplete cells, duplicate conflicts and dangling context", () => {
  const proposal = atlas.createProposal(example());
  const malformed = clone(proposal);
  const conflict = {
    id: "conflict",
    path: ["title"],
    base: { present: true },
    left: { present: false },
    right: { present: false },
    reason: "fixture",
  };
  malformed.comparison.conflicts = [conflict];
  assert(!atlas.validateDocument(malformed).valid);
  conflict.base.value = "Enrollment";
  malformed.comparison.conflicts = [conflict, clone(conflict)];
  assert(
    atlas
      .validateDocument(malformed)
      .issues.some((i) => i.code === "CONFLICT_ID"),
  );
  const dangling = clone(proposal);
  dangling.comparison.baselineContexts.missing = clone(
    Object.values(proposal.comparison.baselineContexts)[0],
  );
  assert(
    atlas
      .validateDocument(dangling)
      .issues.some((i) => i.code === "BASELINE_CONTEXT"),
  );
});
test("Comparisons keep the document's authored views and their removed members", async () => {
  const node = (id, name) => ({ id, name, attributes: [] });
  const base = atlas.createDocument({
    id: "authored-views",
    profile: "code",
    model: {
      type: "StructuralModel",
      nodes: [
        node("student", "Student"),
        node("enrollment", "Enrollment"),
        node("course", "Course"),
      ],
      relations: [
        {
          id: "enrolled",
          name: "enrolled",
          sourceId: "student",
          targetId: "enrollment",
          sourceMultiplicity: "1",
          targetMultiplicity: "0..*",
        },
      ],
      generalizations: [],
      generalizationSets: [],
    },
    views: [
      { key: "core", label: "Core", nodeIds: ["student", "enrollment"] },
      {
        key: "all",
        label: "All",
        nodeIds: ["student", "enrollment", "course"],
      },
    ],
  });
  const proposal = atlas.createProposal(base);
  const model = clone(proposal.model);
  model.nodes = model.nodes.filter((n) => n.id !== "enrollment");
  model.nodes.push(node("registration", "Registration"));
  model.relations = [
    {
      id: "registered",
      name: "registered",
      sourceId: "student",
      targetId: "registration",
      sourceMultiplicity: "1",
      targetMultiplicity: "0..*",
    },
  ];
  const changed = atlas.reviseDocument(proposal, {
    model,
    views: [
      { key: "core", label: "Core", nodeIds: ["student", "registration"] },
      {
        key: "all",
        label: "All",
        nodeIds: ["student", "course", "registration"],
      },
    ],
  });
  const { payload } = await atlas.prepareViewer({
    document: changed,
    includeArtifacts: false,
  });
  const ids = (views) =>
    Object.fromEntries(
      views.map((v) => [v.key, v.diagram.nodes.map((n) => n.id).sort()]),
    );
  assert.deepEqual(ids(payload.comparison.changeView.views), {
    core: ["enrollment", "registration", "student"],
    all: ["course", "enrollment", "registration", "student"],
  });
  assert.deepEqual(ids(payload.comparison.baseline.views), {
    core: ["enrollment", "student"],
    all: ["course", "enrollment", "student"],
  });
  assert.deepEqual(ids(payload.views), {
    core: ["registration", "student"],
    all: ["course", "registration", "student"],
  });
  assert.deepEqual(
    payload.comparison.changeView.views.map((v) => v.label),
    ["Core", "All"],
  );
  const unscoped = await atlas.prepareViewer({
    document: revise(atlas.createProposal(example()), (m) => {
      m.nodes[1].name = "Registration";
    }),
    includeArtifacts: false,
  });
  assert.deepEqual(
    unscoped.payload.comparison.changeView.views.map((v) => v.key),
    ["comparison"],
  );
});
test("Rationale linked to both a member and its owner is listed once", () => {
  const base = example();
  const proposal = atlas.reviseDocument(atlas.createProposal(base), {
    context: {
      records: base.context.records,
      links: [
        ...base.context.links,
        { elementId: "student-name", recordId: "plan" },
      ],
    },
  });
  const changed = revise(proposal, (m) => {
    m.nodes[0].attributes[0].type = "text";
  });
  const diff = atlas.compareDocuments(baselineDocument(changed), changed);
  const member = diff.changes.find((c) => c.elementId === "student-name");
  assert.deepEqual(
    member.rationale.map((r) => r.id),
    ["plan"],
  );
});
