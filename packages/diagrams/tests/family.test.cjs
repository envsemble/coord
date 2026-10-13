const { test } = require("node:test"),
  assert = require("node:assert/strict");
const atlas = require("../lib/index.cjs");
const clone = (v) => JSON.parse(JSON.stringify(v));
const node = (id, name, attributes = []) => ({ id, name, attributes });
const relation = (id, sourceId, targetId, name = "uses") => ({
  id,
  name,
  sourceId,
  targetId,
  sourceMultiplicity: "1",
  targetMultiplicity: "0..*",
});
// A captured baseline and two alternative proposals over it.
function family() {
  const model = {
    type: "StructuralModel",
    nodes: [
      node("checkout", "Checkout"),
      node("customer", "Customer", [
        { id: "customer-name", name: "name", type: "string" },
      ]),
      node("payment", "Payment"),
      node("gateway", "Gateway"),
    ],
    relations: [
      relation("pays", "checkout", "payment", "pays with"),
      relation("charges", "payment", "gateway"),
      relation("buys", "customer", "checkout"),
    ],
    generalizations: [],
    generalizationSets: [],
  };
  const snapshot = atlas.createSnapshot({
    id: "capture-checkout",
    profile: "code",
    model,
    capture: {
      capturedAt: "2026-09-14T08:00:00.000Z",
      adapter: { id: "test", version: "1" },
      source: { kind: "typescript", identity: "shop", scope: ["src"] },
      coverage: { status: "complete", diagnostics: [] },
      limitations: [],
    },
  });
  const captured = atlas.createDocument({
    id: "checkout-capture",
    title: "Checkout",
    profile: "code",
    state: "snapshot",
    model,
    snapshots: [snapshot],
    baselineId: snapshot.id,
    views: [
      {
        key: "checkout",
        label: "Checkout",
        nodeIds: ["checkout", "customer", "payment", "gateway"],
      },
    ],
  });
  const revise = (document, change, views) => {
    const model = clone(document.model);
    change(model);
    return atlas.reviseDocument(document, {
      model,
      ...(views ? { views } : {}),
    });
  };
  // A: a vault holds saved methods; the payment relation is renamed in place.
  const vault = revise(
    atlas.createProposal(captured, { id: "option-a", title: "Option A" }),
    (m) => {
      m.nodes.push(node("vault", "Vault"), node("method", "SavedMethod"));
      m.relations.push(
        relation("stores", "vault", "method"),
        relation("uses-vault", "checkout", "vault"),
      );
      m.relations.find((r) => r.id === "pays").name = "pays with saved";
    },
    [
      {
        key: "checkout",
        label: "Checkout",
        nodeIds: [
          "checkout",
          "customer",
          "payment",
          "gateway",
          "vault",
          "method",
        ],
      },
    ],
  );
  // B: the customer holds its methods; the gateway goes.
  const onCustomer = revise(
    atlas.createProposal(captured, { id: "option-b", title: "Option B" }),
    (m) => {
      m.nodes.push(node("method", "SavedMethod"));
      m.nodes
        .find((n) => n.id === "customer")
        .attributes.push({
          id: "customer-methods",
          name: "savedMethods",
          type: "SavedMethod[]",
        });
      m.nodes = m.nodes.filter((n) => n.id !== "gateway");
      m.relations = m.relations.filter((r) => r.id !== "charges");
      m.relations.push(relation("holds", "customer", "method"));
    },
    [
      {
        key: "checkout",
        label: "Checkout",
        nodeIds: ["checkout", "customer", "payment", "method"],
      },
    ],
  );
  return { captured, vault, onCustomer };
}
// What each member shows: a proposal's change view, or the capture itself.
const shown = (payload) => payload.comparison?.changeView || payload;
function placements(payloads, fields = false) {
  const seen = new Map();
  let compared = 0;
  for (const payload of payloads)
    for (const view of shown(payload).views) {
      const scene = view[fields ? "diagramFields" : "diagram"];
      for (const n of scene.nodes) {
        const box = [view.key, n.x, n.y, n.width, n.height].join();
        const key = `${view.key}:${n.id}`;
        if (seen.has(key)) {
          compared++;
          assert.equal(box, seen.get(key), `${n.id} moved in ${view.key}`);
        } else seen.set(key, box);
      }
    }
  return compared;
}

test("A capture and its proposals share one layout and keep their own review data", async () => {
  const { captured, vault, onCustomer } = family();
  const documents = [captured, vault, onCustomer];
  const { key, members } = await atlas.prepareFamily({ documents });
  assert.equal(key, captured.baselineId);
  assert.deepEqual(
    members.map((m) => m.payload.family),
    [key, key, key],
  );
  const payloads = members.map((m) => m.payload);
  // Every class every member shows sits in one place, with or without fields,
  // and every member's scene has the same size.
  assert(placements(payloads) >= 8);
  assert(placements(payloads, true) >= 8);
  const sizes = payloads.map((p) =>
    shown(p).views.map((v) => [v.key, v.diagram.width, v.diagram.height]),
  );
  assert.deepEqual(sizes[1], sizes[0]);
  assert.deepEqual(sizes[2], sizes[0]);
  // The capture shows itself: its classes, unmarked, and no review.
  const capture = payloads[0];
  assert.equal(capture.comparison, undefined);
  assert.deepEqual(capture.views[0].diagram.nodes.map((n) => n.id).sort(), [
    "checkout",
    "customer",
    "gateway",
    "payment",
  ]);
  assert(capture.views[0].diagram.nodes.every((n) => !n.changeStatus));
  // Each proposal changes what it changes alone, marked in its change view.
  for (const [index, document] of [
    [1, vault],
    [2, onCustomer],
  ]) {
    const alone = (
      await atlas.prepareViewer({ document, includeArtifacts: false })
    ).payload;
    assert.deepEqual(
      payloads[index].comparison.changes,
      alone.comparison.changes,
    );
    const marks = (payload) =>
      Object.fromEntries(
        shown(payload).views[0].diagram.nodes.map((n) => [
          n.id,
          n.changeStatus,
        ]),
      );
    assert.deepEqual(marks(payloads[index]), marks(alone));
  }
  const statuses = (payload) =>
    Object.fromEntries(
      shown(payload).views[0].diagram.nodes.map((n) => [n.id, n.changeStatus]),
    );
  assert.equal(statuses(payloads[1]).vault, "added");
  assert.equal(statuses(payloads[1]).gateway, "unchanged");
  assert.equal(statuses(payloads[2]).gateway, "removed");
  assert.equal(statuses(payloads[2]).customer, "modified");
  for (const payload of payloads)
    for (const view of shown(payload).views)
      require("../lib/layout/validateDiagram.cjs").validateDiagram(
        view.diagram,
      );
});

test("A relation renamed in one proposal is drawn on one route by every member", async () => {
  const { captured, vault, onCustomer } = family();
  const { members } = await atlas.prepareFamily({
    documents: [captured, vault, onCustomer],
  });
  const routes = members.map((m) =>
    shown(m.payload).views[0].diagram.edges.find((e) => e.id === "pays"),
  );
  assert(routes.every(Boolean));
  for (const route of routes.slice(1))
    assert.deepEqual(route.paths, routes[0].paths);
  // Each member labels the route with its own name.
  assert.deepEqual(
    routes.map((r) => r.labels.find((l) => l.kind === "name")?.text),
    ["pays with", "pays with saved", "pays with"],
  );
  assert.equal(routes[1].changeStatus, "modified");
  assert.equal(routes[2].changeStatus, "unchanged");
});

test("Proposals without their capture share the baseline they retain, in any order", async () => {
  const { vault, onCustomer } = family();
  const first = await atlas.prepareFamily({ documents: [vault, onCustomer] });
  const reversed = await atlas.prepareFamily({
    documents: [onCustomer, vault],
  });
  assert(placements(first.members.map((m) => m.payload)) >= 3);
  assert.deepEqual(
    first.members.map((m) => m.payload),
    [...reversed.members].reverse().map((m) => m.payload),
  );
  // The removed gateway keeps its place in the change view that removes it.
  const removed = shown(first.members[1].payload).views[0].diagram.nodes.find(
    (n) => n.id === "gateway",
  );
  assert.equal(removed.changeStatus, "removed");
});

test("A family is a capture and the proposals over its snapshot", async () => {
  const { captured, vault } = family();
  assert.equal(atlas.familyKey(captured), captured.baselineId);
  assert.equal(atlas.familyKey(vault), captured.baselineId);
  const authored = atlas.createDocument({
    profile: "code",
    model: clone(captured.model),
  });
  assert.equal(atlas.familyKey(authored), null);
  await assert.rejects(
    atlas.prepareFamily({ documents: [captured] }),
    /FAMILY_INPUT/,
  );
  const other = atlas.createProposal(authored);
  await assert.rejects(
    atlas.prepareFamily({ documents: [vault, other] }),
    /FAMILY_INPUT/,
  );
  await assert.rejects(atlas.prepareFamily({}), /FAMILY_INPUT/);
});

// What each state of a payload shows, view by view: its classes and the
// relations drawn between them, with and without fields.
const scenes = (payload) =>
  [
    payload,
    ...(payload.comparison
      ? [payload.comparison.baseline, payload.comparison.changeView]
      : []),
  ].map((state) =>
    state.views.map((view) => ({
      key: view.key,
      label: view.label,
      nodeIds: view.nodeIds,
      ...Object.fromEntries(
        ["diagram", "diagramFields"].map((scene) => [
          scene,
          {
            title: view[scene].title,
            nodes: view[scene].nodes.map((n) => n.id).sort(),
            edges: view[scene].edges.map((e) => e.id).sort(),
          },
        ]),
      ),
    })),
  );
const ids = (list) => list.map((item) => item.id).sort();
const capture = {
  capturedAt: "2026-09-14T08:00:00.000Z",
  adapter: { id: "test", version: "1" },
  source: { kind: "typescript", identity: "shop", scope: ["src"] },
  coverage: { status: "complete", diagnostics: [] },
  limitations: [],
};

test("Each member shows its own views as it does alone, where the others' views differ", async () => {
  const model = {
    type: "StructuralModel",
    nodes: [
      node("checkout", "Checkout"),
      node("customer", "Customer"),
      node("payment", "Payment"),
      node("gateway", "Gateway"),
      node("audit", "Audit"),
    ],
    relations: [
      relation("pays", "checkout", "payment", "pays with"),
      relation("charges", "payment", "gateway"),
      relation("buys", "customer", "checkout"),
      relation("logs", "audit", "checkout"),
    ],
    generalizations: [],
    generalizationSets: [],
  };
  const snapshot = atlas.createSnapshot({
    id: "capture-views",
    profile: "code",
    model,
    capture,
  });
  const captured = atlas.createDocument({
    id: "views-capture",
    title: "Checkout",
    profile: "code",
    state: "snapshot",
    model,
    snapshots: [snapshot],
    baselineId: snapshot.id,
    views: [
      {
        key: "checkout",
        label: "Checkout",
        nodeIds: ["checkout", "customer", "payment"],
      },
      { key: "ops", label: "Ops", nodeIds: ["gateway", "audit", "payment"] },
    ],
  });
  const revise = (id, change, views) => {
    const proposal = atlas.createProposal(captured, { id, title: id });
    const changed = clone(proposal.model);
    change(changed);
    return atlas.reviseDocument(proposal, { model: changed, views });
  };
  // A removes the audit, which its change view keeps beside the checkout it
  // logged; B renames a relation and shows the gateway with the checkout.
  const a = revise(
    "option-a",
    (m) => {
      m.nodes = m.nodes.filter((n) => n.id !== "audit");
      m.relations = m.relations.filter((r) => r.id !== "logs");
    },
    [
      {
        key: "checkout",
        label: "Checkout",
        nodeIds: ["checkout", "customer", "payment"],
      },
      { key: "ops", label: "Ops", nodeIds: ["gateway", "payment"] },
    ],
  );
  const b = revise(
    "option-b",
    (m) => {
      m.relations.find((r) => r.id === "pays").name = "pays via";
    },
    [
      {
        key: "checkout",
        label: "Checkout",
        nodeIds: ["checkout", "customer", "payment", "gateway"],
      },
      { key: "ops", label: "Ops", nodeIds: ["gateway", "audit", "payment"] },
    ],
  );
  const documents = [captured, a, b];
  const { members } = await atlas.prepareFamily({ documents });
  for (const [index, document] of documents.entries()) {
    const alone = (
      await atlas.prepareViewer({ document, includeArtifacts: false })
    ).payload;
    assert.deepEqual(
      scenes(members[index].payload),
      scenes(alone),
      `${document.id} shows what it shows alone`,
    );
  }
  const checkout = (payload) =>
    shown(payload).views.find((v) => v.key === "checkout").diagram;
  assert.deepEqual(ids(checkout(members[0].payload).nodes), [
    "checkout",
    "customer",
    "payment",
  ]);
  assert.deepEqual(ids(checkout(members[1].payload).nodes), [
    "audit",
    "checkout",
    "customer",
    "payment",
  ]);
  assert.deepEqual(ids(checkout(members[2].payload).edges), [
    "buys",
    "charges",
    "pays",
  ]);
  // Every class keeps its place from one member to the next.
  assert(placements(members.map((m) => m.payload)) >= 12);
});

test("A capture without views of its own shows what it shows alone, in its proposals' view", async () => {
  const model = {
    type: "StructuralModel",
    nodes: [
      node("base", "Base"),
      node("a", "A"),
      node("b", "B"),
      { ...node("status", "Status"), kind: "enumeration" },
    ],
    relations: [relation("uses", "a", "status")],
    generalizations: [
      { id: "a-base", specificId: "a", generalId: "base" },
      { id: "b-base", specificId: "b", generalId: "base" },
    ],
    generalizationSets: [],
  };
  const snapshot = atlas.createSnapshot({
    id: "capture-shapes",
    profile: "code",
    model,
    capture,
  });
  const captured = atlas.createDocument({
    id: "shapes",
    title: "Shapes",
    profile: "code",
    state: "snapshot",
    model,
    snapshots: [snapshot],
    baselineId: snapshot.id,
  });
  const proposal = atlas.createProposal(captured, { id: "shapes-c" });
  const changed = clone(proposal.model);
  changed.nodes.push(node("c", "C"));
  const documents = [
    captured,
    atlas.reviseDocument(proposal, { model: changed }),
  ];
  const { members } = await atlas.prepareFamily({ documents });
  const alone = await Promise.all(
    documents.map(
      async (document) =>
        (await atlas.prepareViewer({ document, includeArtifacts: false }))
          .payload,
    ),
  );
  // The capture shows its classes but the enumeration, as alone, in the view
  // its proposal's is keyed as, so switching keeps the view.
  const unkeyed = (payload) =>
    scenes(payload).map((views) => views.map(({ key, ...view }) => view));
  assert.deepEqual(unkeyed(members[0].payload), unkeyed(alone[0]));
  assert.deepEqual(ids(members[0].payload.views[0].diagram.nodes), [
    "a",
    "b",
    "base",
  ]);
  assert.equal(
    members[0].payload.views[0].key,
    shown(members[1].payload).views[0].key,
  );
  assert.deepEqual(scenes(members[1].payload), scenes(alone[1]));
  assert(placements(members.map((m) => m.payload)) >= 3);
  // Its inheritance is drawn as separate arrows, as in its proposal's view,
  // where alone it is joined.
  assert.equal(alone[0].views[0].diagram.generalizationGroups.length, 1);
  assert.deepEqual(
    members[0].payload.views[0].diagram.generalizationGroups,
    [],
  );
});
