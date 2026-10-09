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
test("Independent changes and selected references merge from explicit ancestry", () => {
  const ancestor = example(),
    a = atlas.createProposal(ancestor),
    b = atlas.createProposal(ancestor);
  const left = revise(a, (m) => (m.nodes[0].name = "Learner")),
    right = revise(b, (m) => (m.relations[0].targetMultiplicity = "1..*"));
  const merged = atlas.mergeDocuments(ancestor, left, right);
  assert.equal(merged.comparison.conflicts.length, 0);
  assert.equal(
    merged.model.nodes.find((n) => n.id === "student").name,
    "Learner",
  );
  assert.equal(merged.model.relations[0].targetMultiplicity, "1..*");
  assert.deepEqual(merged.context, ancestor.context);
  assert.deepEqual(baselineDocument(merged).model, ancestor.model);
  assert.throws(
    () =>
      atlas.mergeDocuments(
        ancestor,
        left,
        atlas.createProposal(
          atlas.createDocument({ ...example(), id: "unrelated" }),
        ),
      ),
    /MERGE_ANCESTRY/,
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

test("Independent planning references survive three-way merging", () => {
  const ancestor = example(),
    a = atlas.createProposal(ancestor),
    b = atlas.createProposal(ancestor);
  const context = (d, id, element) => ({
    ...d.context,
    records: [
      ...d.context.records,
      { id, kind: "plan", title: id, text: "Chosen architecture" },
    ],
    links: [...d.context.links, { elementId: element, recordId: id }],
  });
  const left = atlas.reviseDocument(a, {
      context: context(a, "left-plan", "student"),
    }),
    right = atlas.reviseDocument(b, {
      context: context(b, "right-plan", "enrollment"),
    });
  const merged = atlas.mergeDocuments(ancestor, left, right);
  assert.equal(merged.comparison.conflicts.length, 0);
  assert.equal(merged.context.links.length, 3);
  assert.equal(merged.context.records.length, 3);
});
test("Frozen cross-layer mappings validate, survive comparison and reopening, and reject missing identities", async () => {
  const ancestor = example(),
    targetBase = example(),
    snapshot = atlas.createSnapshot({
      profile: "code",
      model: targetBase.model,
      capture: {
        capturedAt: "2026-10-08T00:00:00.000Z",
        adapter: { id: "fixture", version: "1" },
        source: { kind: "code", identity: "fixture", scope: ["model"] },
        coverage: { status: "complete", diagnostics: [] },
      },
    });
  const target = atlas.createDocument({
    ...targetBase,
    id: "target",
    state: "snapshot",
    snapshots: [snapshot],
    baselineId: snapshot.id,
  });
  const proposal = revise(atlas.createProposal(ancestor), (m) =>
    m.nodes.push({ id: "added", name: "Added", attributes: [] }),
  );
  const mapped = atlas.linkMapping(proposal, target, {
    id: "mapping",
    elementId: "added",
    targetElementId: "student",
    reason: "Explicit authored correspondence",
  });
  assert(atlas.validateDocument(mapped).valid);
  assert.equal(mapped.snapshots.length, 2);
  const prepared = await atlas.prepareViewer({
    document: mapped,
    includeArtifacts: false,
  });
  assert.equal(prepared.model.document.mappings.length, 1);
  const imported = atlas.importDocument(
    (await atlas.buildViewer({ document: mapped })).html,
  );
  assert.deepEqual(imported.mappings, mapped.mappings);
  assert.throws(
    () =>
      atlas.linkMapping(proposal, target, {
        id: "missing",
        elementId: "absent",
        targetElementId: "student",
        reason: "Reason",
      }),
    /MAPPING_REFERENCE/,
  );
});
test("Agent comparison, branches, conflicts and resolution preserve stored revisions", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-comparison-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const w = atlas.createWorkspace(root),
    a = await w.execute("atlas_create", { input: example() }),
    left = await w.execute("atlas_proposal", { handle: a.handle }),
    right = await w.execute("atlas_proposal", { handle: a.handle });
  for (const [branch, name] of [
    [left, "Left"],
    [right, "Right"],
  ]) {
    const doc = w.load(branch.handle),
      model = clone(doc.model);
    model.nodes[0].name = name;
    await w.execute("atlas_revise", {
      handle: branch.handle,
      expectedRevision: branch.revision,
      changes: { model },
    });
  }
  const merged = await w.execute("atlas_merge", {
    ancestorHandle: a.handle,
    leftHandle: left.handle,
    rightHandle: right.handle,
  });
  assert.equal(merged.conflicts, 1);
  const doc = w.load(merged.handle),
    conflict = doc.comparison.conflicts[0];
  assert(
    atlas.validateDocument(doc).issues.some((i) => i.code === "MERGE_CONFLICT"),
  );
  const exported = await w.execute("atlas_export", { handle: merged.handle });
  assert.deepEqual(
    atlas.importDocument(
      fs.readFileSync(path.join(root, exported.htmlFile), "utf8"),
    ).comparison.conflicts,
    doc.comparison.conflicts,
  );
  const resolved = await w.execute("atlas_resolve_merge", {
    handle: merged.handle,
    expectedRevision: doc.revision.id,
    choices: [{ conflictId: conflict.id, choice: "right" }],
  });
  assert.equal(resolved.conflicts, 0);
  assert.equal(
    w.load(resolved.handle).model.nodes.find((n) => n.id === "student").name,
    "Right",
  );
  const diff = await w.execute("atlas_compare", {
    handle: resolved.handle,
    limit: 1,
  });
  assert.equal(diff.changes.length, 1);
  assert(diff.total >= 1);
  await assert.rejects(
    w.execute("atlas_resolve_merge", {
      handle: resolved.handle,
      expectedRevision: doc.revision.id,
      choices: [],
    }),
    /REVISION_CONFLICT/,
  );
});
test("Delete versus modify remains an explicit conflict and choices preserve baseline", () => {
  const ancestor = example(),
    a = atlas.createProposal(ancestor),
    b = atlas.createProposal(ancestor);
  const left = revise(a, (m) => {
      m.nodes[0].attributes = [];
    }),
    right = revise(b, (m) => {
      m.nodes[0].attributes[0].type = "number";
    });
  const merged = atlas.mergeDocuments(ancestor, left, right),
    conflict = merged.comparison.conflicts[0];
  assert.equal(conflict.reason, "delete-versus-modify");
  assert.equal(
    merged.model.nodes.find((n) => n.id === "student").attributes[0].type,
    "string",
  );
  const resolved = atlas.resolveMerge(merged, [
    { conflictId: conflict.id, choice: "right" },
  ]);
  assert.equal(resolved.comparison.conflicts.length, 0);
  assert.equal(
    resolved.model.nodes.find((n) => n.id === "student").attributes[0].type,
    "number",
  );
  assert.deepEqual(baselineDocument(resolved).model, ancestor.model);
  assert.throws(
    () => atlas.resolveMerge(merged, [], "stale"),
    /REVISION_CONFLICT/,
  );
});
test("Independent changes that create dangling references stay a visible complete-payload conflict", () => {
  const ancestor = example(),
    a = atlas.createProposal(ancestor),
    b = atlas.createProposal(ancestor);
  const left = atlas.reviseDocument(a, {
    model: {
      ...a.model,
      nodes: a.model.nodes.filter((n) => n.id !== "enrollment"),
      relations: [],
    },
  });
  const right = revise(b, (m) => {
    m.relations.push({
      id: "new-link",
      name: "new",
      sourceId: "student",
      targetId: "enrollment",
      sourceMultiplicity: "?",
      targetMultiplicity: "?",
    });
  });
  const merged = atlas.mergeDocuments(ancestor, left, right);
  assert.equal(merged.comparison.conflicts[0].id, "conflict:references");
  assert(atlas.validateDocument(merged).valid);
  assert.equal(
    atlas.resolveMerge(merged, [
      { conflictId: "conflict:references", choice: "right" },
    ]).model.relations.length,
    2,
  );
});
test("New source adoption retains old captures, proposal and baseline-specific context across HTML reopening", async () => {
  const source = example();
  const captured = atlas.createSnapshot({
    profile: "code",
    model: source.model,
    capture: {
      capturedAt: "2026-10-08T00:00:00.000Z",
      adapter: { id: "fixture", version: "1" },
      source: { kind: "code", identity: "fixture", scope: ["model.ts"] },
      coverage: { status: "complete", diagnostics: [] },
    },
  });
  const frozen = atlas.createDocument({
    ...source,
    state: "snapshot",
    snapshots: [captured],
    baselineId: captured.id,
  });
  const proposal = revise(
    atlas.createProposal(frozen),
    (m) => (m.nodes[0].name = "Planned Learner"),
  );
  const newerModel = clone(source.model);
  newerModel.nodes[0].name = "Actual Learner";
  const newerSnapshot = atlas.createSnapshot({
    profile: "code",
    model: newerModel,
    capture: { ...captured.capture, capturedAt: "2026-10-09T00:00:00.000Z" },
  });
  const newer = atlas.createDocument({
    ...source,
    state: "snapshot",
    model: newerModel,
    snapshots: [newerSnapshot],
    baselineId: newerSnapshot.id,
  });
  const adopted = atlas.adoptSnapshot(proposal, newer);
  const merged = atlas.mergeDocuments(
    frozen,
    atlas.createProposal(frozen),
    adopted,
  );
  assert.equal(merged.baselineId, newer.baselineId);
  assert.deepEqual(merged.comparison.adoptions, adopted.comparison.adoptions);
  assert.equal(adopted.snapshots.length, 2);
  assert.deepEqual(adopted.snapshots[0], captured);
  assert.equal(adopted.model.nodes[0].name, "Planned Learner");
  assert.equal(baselineDocument(adopted).model.nodes[0].name, "Actual Learner");
  const reopened = atlas.importDocument(
    (await atlas.buildViewer({ document: adopted })).html,
  );
  assert.deepEqual(reopened.comparison, adopted.comparison);
  assert.deepEqual(reopened.snapshots, adopted.snapshots);
});
test("Competing baseline adoptions remain explicit selectable conflicts", () => {
  const ancestor = example(),
    a = atlas.createProposal(ancestor),
    b = atlas.createProposal(ancestor);
  const captured = (name) => {
    const doc = example(),
      model = clone(doc.model);
    model.nodes[0].name = name;
    const snapshot = atlas.createSnapshot({
      profile: "code",
      model,
      capture: {
        capturedAt: "2026-10-08T00:00:00.000Z",
        adapter: { id: "fixture", version: "1" },
        source: { kind: "code", identity: "fixture", scope: ["model"] },
        coverage: { status: "complete", diagnostics: [] },
      },
    });
    return atlas.createDocument({
      ...doc,
      state: "snapshot",
      model,
      snapshots: [snapshot],
      baselineId: snapshot.id,
    });
  };
  const x = captured("X"),
    y = captured("Y");
  const merged = atlas.mergeDocuments(
    ancestor,
    atlas.adoptSnapshot(a, x),
    atlas.adoptSnapshot(b, y),
  );
  const conflict = merged.comparison.conflicts.find(
    (c) => c.path[0] === "baselineId",
  );
  assert(conflict);
  assert.equal(merged.comparison.adoptions.length, 2);
  const resolved = atlas.resolveMerge(merged, [
    { conflictId: conflict.id, choice: "right" },
  ]);
  assert.equal(resolved.baselineId, y.baselineId);
  assert.equal(resolved.snapshots.length, 3);
});
test("Proposal rendering rejects unsupported n-ary relations and preserves real baseline revision", async () => {
  const p = new atlas.Project(),
    root = p.packageBuilder().root().name("Root").build(),
    classes = ["A", "B", "C"].map((name) =>
      root.classBuilder().kind().name(name).build(),
    );
  root
    .naryRelationBuilder()
    .members(...classes)
    .name("Three way")
    .build();
  const document = atlas.createDocument({
    id: "nary",
    profile: "ontouml",
    model: JSON.parse(JSON.stringify(p)),
  });
  await assert.rejects(
    atlas.prepareViewer({
      document: atlas.createProposal(document),
      includeArtifacts: false,
    }),
    /binary class relations/,
  );
  const original = example(),
    proposal = atlas.createProposal(original);
  assert.equal(
    atlas.compareDocuments(baselineDocument(proposal), proposal).baseRevision,
    original.revision.id,
  );
});

test("Direct authored revisions merge without inventing null extension values", () => {
  const ancestor = atlas.createDocument({
    ...example(),
    extension: { nullable: null },
  });
  const left = atlas.reviseDocument(ancestor, { title: "Plan" });
  const right = revise(ancestor, (m) => (m.nodes[0].name = "Learner"));
  const merged = atlas.mergeDocuments(ancestor, left, right);
  assert.equal(merged.comparison.conflicts.length, 0);
  assert.equal(merged.title, "Plan");
  assert.equal(merged.model.nodes[0].name, "Learner");
  assert.deepEqual(merged.extension, { nullable: null });
  assert.equal(baselineDocument(merged).model.nodes[0].name, "Student");
});

test("Independent evidence references combine and generalization-set constraints remain semantic", () => {
  const ancestor = example();
  const withEvidence = (id) =>
    atlas.reviseDocument(atlas.createProposal(ancestor), {
      evidence: {
        sources: [{ id, file: id, title: id, claim: "Fixture" }],
        elements: { student: { evidence: [id] } },
      },
    });
  const merged = atlas.mergeDocuments(
    ancestor,
    withEvidence("a"),
    withEvidence("b"),
  );
  assert.equal(merged.comparison.conflicts.length, 0);
  assert.deepEqual(merged.evidence.elements.student.evidence.sort(), [
    "a",
    "b",
  ]);
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
