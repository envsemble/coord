// Reviewing a proposal: changes rolled up per element, the change view's
// marks, the details that explain a change, and less noise on the canvas.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const atlas = require("../lib/index.cjs");
const { renderSVG } = require("../lib/layout/renderSVG.cjs");
const { validateDiagram } = require("../lib/layout/validateDiagram.cjs");
const { relationLabel } = require("../lib/layout/layoutDiagram.cjs");
const { loadComponents } = require("./load-components.cjs");

const clone = (value) => JSON.parse(JSON.stringify(value));
const id = (file, name) =>
  `code:ts:shop:${encodeURIComponent(file)}:${encodeURIComponent(name)}`;
const CHECKOUT = id("src/checkout/Checkout.ts", "Checkout");
const GATEWAY = id("src/payments/Gateway.ts", "Gateway");
const LEGACY = id("src/payments/Legacy.ts", "Legacy");
const VAULT = id("src/payments/Vault.ts", "Vault");
const uses = (source, target) => ({
  id: `${source}:uses:${target}`,
  name: "declared type use",
  stereotype: "dependency",
  sourceId: source,
  targetId: target,
  sourceMultiplicity: "?",
  targetMultiplicity: "?",
});
const field = (owner, name, type, line) => ({
  id: `${owner}:field%3A${name}%3A:0`,
  name,
  type,
  modifiers: [],
  optional: false,
  ...(line
    ? {
        location: {
          file: "src/checkout/Checkout.ts",
          startLine: line,
          endLine: line,
        },
      }
    : {}),
});

function captured() {
  return atlas.createDocument({
    id: "shop",
    title: "Checkout",
    profile: "code",
    model: {
      type: "StructuralModel",
      nodes: [
        {
          id: CHECKOUT,
          name: "Checkout",
          kind: "class",
          attributes: [
            field(CHECKOUT, "gateway", "Gateway", 3),
            field(CHECKOUT, "total", "number", 4),
            field(CHECKOUT, "legacy", "Legacy", 5),
          ],
          methods: [],
          location: {
            file: "src/checkout/Checkout.ts",
            startLine: 2,
            endLine: 20,
          },
        },
        {
          id: GATEWAY,
          name: "Gateway",
          kind: "interface",
          attributes: [],
          methods: [],
        },
        {
          id: LEGACY,
          name: "Legacy",
          kind: "class",
          attributes: [],
          methods: [],
        },
      ],
      relations: [uses(CHECKOUT, GATEWAY), uses(CHECKOUT, LEGACY)],
      generalizations: [],
      generalizationSets: [],
      constraints: [],
    },
    context: {
      records: [
        {
          id: "plan-flow",
          kind: "plan",
          title: "Checkout flow",
          path: "plan.md",
          section: "Checkout flow",
          text: "1. Pick a saved method.\n2. `Checkout.pay` charges the **vault** token.",
        },
      ],
      links: [{ elementId: CHECKOUT, recordId: "plan-flow" }],
    },
  });
}

function proposed() {
  const proposal = atlas.createProposal(captured());
  const model = clone(proposal.model);
  const checkout = model.nodes.find((n) => n.id === CHECKOUT);
  checkout.attributes = checkout.attributes.filter((a) => a.name !== "legacy");
  checkout.attributes.find((a) => a.name === "total").type = "Money";
  checkout.attributes.push(field(CHECKOUT, "vault", "Vault"));
  checkout.methods.push({
    id: `${CHECKOUT}:method%3Apay%3Astring:0`,
    name: "pay",
    type: "pay(methodId: string): Promise<void>",
    modifiers: [],
    optional: false,
  });
  model.nodes = model.nodes.filter((n) => n.id !== LEGACY);
  model.nodes.push({
    id: VAULT,
    name: "Vault",
    kind: "interface",
    attributes: [],
    methods: [
      {
        id: `${VAULT}:method%3Asave:0`,
        name: "save",
        type: "save(): void",
        modifiers: [],
        optional: false,
      },
    ],
  });
  model.relations = [uses(CHECKOUT, GATEWAY), uses(CHECKOUT, VAULT)];
  const context = clone(proposal.context);
  context.links.push({ elementId: VAULT, recordId: "plan-flow" });
  return atlas.reviseDocument(proposal, { model, context });
}

async function preparedProposal() {
  return (
    await atlas.prepareViewer({ document: proposed(), includeArtifacts: false })
  ).payload;
}

test("the change view keeps removed members in place and marks every change", async () => {
  const payload = await preparedProposal();
  const view = payload.comparison.changeView;
  const checkout = view.model.classes.find((c) => c.id === CHECKOUT);
  assert.equal(checkout.changeStatus, "modified");
  assert.deepEqual(
    checkout.attributes.map((a) => [a.name, a.changeStatus]),
    [
      ["gateway", "unchanged"],
      ["total", "modified"],
      ["legacy", "removed"],
      ["vault", "added"],
    ],
  );
  assert.deepEqual(
    checkout.methods.map((m) => [m.name, m.changeStatus]),
    [["pay", "added"]],
  );
  assert.equal(
    view.model.relations.find((r) => r.id === `${CHECKOUT}:uses:${VAULT}`)
      .changeStatus,
    "added",
  );
  assert.equal(
    view.model.relations.find((r) => r.id === `${CHECKOUT}:uses:${GATEWAY}`)
      .changeStatus,
    "unchanged",
  );
  const scene = view.views[0].diagramFields;
  const node = scene.nodes.find((n) => n.id === CHECKOUT);
  assert(
    node.attributes.some(
      (a) => a.name === "legacy" && a.changeStatus === "removed",
    ),
  );
  // The view opens on what changed.
  assert.deepEqual(
    [...view.views[0].diagram.initialFocus].sort(),
    [CHECKOUT, LEGACY, VAULT].sort(),
  );
  for (const diagram of [view.views[0].diagram, scene])
    validateDiagram(diagram);
});

test("changes roll up per element: types with their members, then relations, without the model root", async () => {
  const payload = await preparedProposal();
  const { rollupChanges, rowFor, describeClassChange } = loadComponents(
    "src/review/changes.js",
  );
  const rollup = rollupChanges(
    payload.comparison,
    payload.comparison.changeView.model,
  );
  assert.deepEqual(
    rollup.groups.map((g) => [
      g.label,
      g.elements.map((r) => r.name),
      g.relations.map((r) => r.name),
    ]),
    [
      ["New", ["Vault"], ["Checkout → Vault"]],
      ["Changed", ["Checkout"], []],
      ["Removed", ["Legacy"], ["Checkout → Legacy"]],
    ],
  );
  // One row per element: the root's member lists are not a change of their own.
  assert(!rollup.rows.some((r) => r.name === "Model contents"));
  assert.equal(rollup.total, 5);
  const checkout = rollup.rows.find((r) => r.name === "Checkout");
  assert.deepEqual(
    checkout.summary.tokens.map((t) => `${t.status}:${t.text}`),
    ["modified:total", "removed:legacy", "added:vault", "added:pay()"],
  );
  assert.equal(
    rollup.rows.find((r) => r.name === "Vault").summary.text,
    "save()",
  );
  // Relations of a profile's single kind carry no tag; a type use names
  // the members that declare it.
  const uses = rollup.rows.find((r) => r.name === "Checkout → Vault");
  assert.equal(uses.tag, "");
  assert.equal(uses.summary.text, "via vault");
  assert.equal(rowFor(rollup, { kind: "node", id: CHECKOUT }), checkout);
  const element = payload.comparison.changeView.model.classes.find(
    (c) => c.id === CHECKOUT,
  );
  const described = describeClassChange(rollup, element, "code");
  assert.deepEqual(
    described.members.map((m) => [m.status, m.signature, m.previous]),
    [
      ["modified", "total: Money", "total: number"],
      ["removed", "legacy: Legacy", null],
      ["added", "vault: Vault", null],
      ["added", "pay(methodId: string): Promise<void>", null],
    ],
  );
  assert.equal(described.members[0].location.startLine, 4);
});

test("a new declaration's intended file is decoded from its identity", () => {
  const { decodeIdentity, elementFile, fileExists } = loadComponents(
    "src/review/changes.js",
  );
  assert.deepEqual(decodeIdentity(VAULT), {
    source: "code",
    language: "ts",
    repository: "shop",
    file: "src/payments/Vault.ts",
    name: "Vault",
  });
  assert.equal(
    decodeIdentity("db:sqlite:inventory:main:stock_level").schema,
    "main",
  );
  assert.equal(decodeIdentity("student"), null);
  assert.equal(decodeIdentity("code:ts:shop:%E0%A4%A:x"), null);
  assert.equal(elementFile({ id: VAULT }), "src/payments/Vault.ts");
  assert.equal(
    elementFile({ id: VAULT, location: { file: "src/other.ts" } }),
    "src/other.ts",
  );
  const model = {
    classes: [
      {
        id: CHECKOUT,
        changeStatus: "modified",
        location: { file: "src/checkout/Checkout.ts" },
      },
      { id: VAULT, changeStatus: "added" },
    ],
  };
  assert(fileExists(model, "src/checkout/Checkout.ts"));
  assert(!fileExists(model, "src/payments/Vault.ts"));
});

test("details explain a change: its members, where it lives, and why, without capture noise", async () => {
  const payload = await preparedProposal();
  const { rollupChanges } = loadComponents("src/review/changes.js");
  const { ConceptDetails } = loadComponents("src/viewer/DetailsContent.jsx");
  const view = payload.comparison.changeView;
  const review = { rollup: rollupChanges(payload.comparison, view.model) };
  const render = (id) =>
    renderToStaticMarkup(
      createElement(ConceptDetails, {
        concept: view.model.classes.find((c) => c.id === id),
        model: view.model,
        snippets: view.snippets,
        review,
        onReference() {},
      }),
    );
  const changed = render(CHECKOUT);
  assert(changed.includes(">Changed<"));
  assert(changed.includes("What changes"));
  // A field whose type changed reads as its name with both types.
  assert.match(
    changed,
    /total<\/span>: <del class="change-before">number<\/del>.*<ins class="change-after">Money<\/ins>/,
  );
  assert(changed.includes("legacy: Legacy"));
  assert(changed.includes("Where in code"));
  assert(changed.includes("src/checkout/Checkout.ts"));
  assert(changed.includes("lines 2–20"));
  assert(changed.includes('aria-label="Open Plan › Checkout flow"'));
  // Inline code survives, Markdown emphasis does not.
  assert(changed.includes("<code>Checkout.pay</code>"));
  assert(!changed.includes("**"));
  for (const noise of [
    "observed",
    "Capture ·",
    "Mappings",
    "Definition",
    "diagnostic",
  ])
    assert(!changed.includes(noise), noise);
  const added = render(VAULT);
  assert(added.includes(">New<"));
  assert(added.includes("New interface with 1 method."));
  assert(
    added.includes(
      "Proposed in <code>src/payments/Vault.ts</code> (a new file)",
    ),
  );
  assert(!added.includes("Where in code"));
  const removed = render(LEGACY);
  assert(removed.includes(">Removed<"));
  assert(removed.includes("The class is removed."));
});

test("panels show the Changes overview and step through changes; the report is gone", async () => {
  const payload = await preparedProposal();
  const { payload: standalone } = await atlas.prepareViewer({
    document: proposed(),
  });
  const { AtlasPanel, DiagramViewer } = loadComponents();
  for (const html of [
    renderToStaticMarkup(createElement(AtlasPanel, { payload })),
    renderToStaticMarkup(createElement(DiagramViewer, standalone)),
  ]) {
    assert(html.includes('aria-label="Changes, 5"'));
    assert(html.includes('aria-label="Fade unchanged elements"'));
    assert(html.includes("fade-unchanged"));
    for (const removed of [
      ">Baseline<",
      "Semantic changes",
      "Open model report",
      ">Report<",
    ])
      assert(!html.includes(removed), removed);
  }
  const { ChangesOverview, ChangeNavigation } = loadComponents(
    "src/review/ChangesOverview.jsx",
  );
  const { rollupChanges } = loadComponents("src/review/changes.js");
  const rollup = rollupChanges(
    payload.comparison,
    payload.comparison.changeView.model,
  );
  const overview = renderToStaticMarkup(
    createElement(ChangesOverview, {
      rollup,
      baselineDate: "Oct 8, 2026",
      profile: "code",
      active: rollup.rows[0].key,
      onSelect() {},
    }),
  );
  assert(overview.includes("Compared with the code captured Oct 8, 2026."));
  assert(overview.includes(">New<") && overview.includes(">Removed<"));
  assert.equal(
    (overview.match(/<button[^>]*class="change-row"/g) || []).length,
    5,
  );
  assert(overview.includes('aria-current="true"'));
  assert(
    !overview.includes("1. Pick a saved method"),
    "rationale stays out of the list",
  );
  const navigation = renderToStaticMarkup(
    createElement(ChangeNavigation, {
      position: 1,
      total: 5,
      onBack() {},
      onStep() {},
    }),
  );
  assert(navigation.includes("All changes"));
  assert(navigation.includes("2 of 5"));
  assert(navigation.includes('aria-label="Previous change"'));
  assert(navigation.includes('aria-label="Next change"'));
});

test("the canvas marks changes in its own geometry, so exports and the backdrop keep them", async () => {
  const payload = await preparedProposal();
  const scene = payload.comparison.changeView.views[0].diagramFields;
  const svg = renderSVG(scene);
  assert(
    svg.includes(">New<") &&
      svg.includes(">Changed<") &&
      svg.includes(">Removed<"),
  );
  assert(svg.includes('stroke="var(--change-added,#1a7f37)"'));
  assert(
    svg.includes('stroke-dasharray="2 4"'),
    "removed relations are dotted",
  );
  assert.match(svg, /marker-end="url\(#[^"]+-DEPENDENCY-added\)"/);
  // Beyond colour, a changed relation carries its +, ~ or − on the line.
  assert.match(
    svg,
    /<g class="edge-change-mark"[^>]*><circle r="7.5" fill="var\(--change-added,#1a7f37\)"><\/circle><text[^>]*>\+<\/text>/,
  );
  assert.match(svg, /<marker[^>]+-DEPENDENCY-removed"/);
  // Member rows: a removed member is struck through, an added one marked +.
  assert.match(svg, /text-decoration="line-through"[^>]*>legacy : Legacy</);
  assert(svg.includes(">+</text>"));
  // A diagram without changes draws no change markers.
  const plain = renderSVG(payload.comparison.baseline.views[0].diagram);
  assert(!plain.includes("-added") && !plain.includes("change-tag"));
});

test("unknown counts and generic dependency names add no labels to the canvas", async () => {
  const payload = await preparedProposal();
  for (const view of payload.comparison.changeView.views)
    for (const edge of view.diagram.edges) assert.deepEqual(edge.labels, []);
  assert.equal(relationLabel(uses("a", "b")), null);
  assert.equal(
    relationLabel({ name: "sku → sku", stereotype: "foreign key" }),
    "sku → sku",
  );
  assert.equal(
    relationLabel({ name: "notifies", stereotype: "dependency" }),
    "notifies",
  );
  assert.equal(
    relationLabel({ name: "placed with", stereotype: "mediation" }),
    "«mediation»\nplaced with",
  );
  assert.equal(relationLabel({ name: "", stereotype: "" }), null);
  // Known counts keep their labels, unknown ones are omitted and still valid.
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
          id: "ab",
          name: "holds",
          sourceId: "a",
          targetId: "b",
          sourceMultiplicity: "?",
          targetMultiplicity: "0..*",
        },
      ],
      generalizations: [],
      generalizationSets: [],
    },
  });
  const { payload: lean } = await atlas.prepareViewer({
    document,
    includeArtifacts: false,
  });
  const edge = lean.views[0].diagram.edges[0];
  assert.deepEqual(
    edge.labels.map((l) => [l.kind, l.text]),
    [
      ["name", "holds"],
      ["target", "0..*"],
    ],
  );
  assert.equal(
    validateDiagram(lean.views[0].diagram, lean.model).multiplicityLabels,
    1,
  );
});

test("the layout and the viewer agree on known counts and uninformative names", () => {
  const layout = require("../lib/layout/multiplicity.cjs");
  const viewer = loadComponents("src/model/multiplicity.js");
  for (const value of ["1", "0..*", " 1 ", "?", " ? ", "", "  ", null, 1])
    assert.equal(
      viewer.knownMultiplicity(value),
      layout.knownMultiplicity(value),
      String(value),
    );
  const { informativeName } = loadComponents("src/review/changes.js");
  for (const name of ["declared type use", "Association", "holds", "", " "])
    assert.equal(
      !!informativeName({ name }),
      relationLabel({ name, stereotype: "" }) !== null,
      name,
    );
  // A generic name gives way to the stereotype alone.
  assert.equal(
    relationLabel({ name: "Association", stereotype: "mediation" }),
    "«mediation»",
  );
});

test("model-level changes are listed under Model; the root's element lists are not", async () => {
  const proposal = atlas.createProposal(captured());
  const model = clone(proposal.model);
  model.constraints = [[CHECKOUT, "A payment needs a saved method"]];
  const { payload } = await atlas.prepareViewer({
    document: atlas.reviseDocument(proposal, { model }),
    includeArtifacts: false,
  });
  const view = payload.comparison.changeView;
  const { rollupChanges } = loadComponents("src/review/changes.js");
  const rollup = rollupChanges(payload.comparison, view.model, view.views);
  assert.deepEqual(
    rollup.groups.map((g) => [g.label, g.elements.map((r) => r.name)]),
    [["Model", ["Model"]]],
  );
  const [row] = rollup.rows;
  assert.equal(row.target, null);
  // A constraint reads as what the list gains, its identities as names.
  assert.deepEqual(
    row.summary.tokens.map((t) => `${t.status}:${t.text}`),
    ["added:Checkout, A payment needs a saved method"],
  );
  // Nothing on the canvas changed: nothing to step to, but the change counts.
  assert.deepEqual(rollup.navigable, []);
  assert.equal(rollup.count, 1);
  const { ChangesOverview } = loadComponents("src/review/ChangesOverview.jsx");
  const html = renderToStaticMarkup(
    createElement(ChangesOverview, { rollup, profile: "code", onSelect() {} }),
  );
  assert(html.includes("Compared with the code"));
  assert(html.includes(">Model<"));
  assert(!html.includes('<button type="button" class="change-row"'));
});

// A class diagram and a proposal copied from it, prepared as a work folder
// shows them: the proposal's payload, its change view and rolled-up changes.
async function diagramProposal(base, proposal) {
  const { prepared } = await atlas.prepareDiagrams({
    files: [
      { path: "base.puml", text: `@startuml\n${base}\n@enduml\n` },
      {
        path: "proposal.puml",
        text: `@startuml\n' atlas proposal base.puml\n${proposal}\n@enduml\n`,
      },
    ],
  });
  const payload = prepared.get("proposal.puml").payload;
  const view = payload.comparison.changeView;
  const { rollupChanges } = loadComponents("src/review/changes.js");
  return {
    payload,
    view,
    rollup: rollupChanges(payload.comparison, view.model, view.views),
  };
}
const ENROLLMENT = `class Person {
  name : String
}
class Institution
class Enrollment
Enrollment "0..*" -- "1" Person : learner
Enrollment "0..*" -- "1" Institution : school`;

test("diagram proposals group each change under its class or relation, by name", async () => {
  const { view, rollup } = await diagramProposal(
    ENROLLMENT,
    ENROLLMENT.replace(
      "class Institution",
      "class Institution {\n  code : String\n}",
    )
      .replace("name : String", "name : Text")
      .replace('"1" Person : learner', '"0..1" Person : learner'),
  );
  // A relation that kept its ends is drawn once, marked changed.
  assert.deepEqual(
    view.model.relations
      .filter(
        (r) => (r.originalId || r.id) === "relation:Enrollment:Person:learner",
      )
      .map((r) => r.changeStatus),
    ["modified"],
  );
  assert.deepEqual(
    rollup.groups.map((g) => [
      g.label,
      [...g.elements, ...g.relations].map(
        (r) =>
          `${r.name}: ${r.summary.tokens.map((t) => `${t.status} ${t.text}`).join(" | ") || r.summary.text}`,
      ),
    ]),
    [
      [
        "Changed",
        [
          "Institution: added code",
          "Person: modified name",
          "Enrollment → Person: learner · targetMultiplicity: 1 → 0..1",
        ],
      ],
    ],
  );
  assert(rollup.rows.every((r) => r.target));
  assert.equal(rollup.count, 3);
});

test("a change no view draws is listed and counted, but not stepped to", async () => {
  const node = (id, name) => ({ id, name, attributes: [] });
  const base = atlas.createDocument({
    id: "split",
    title: "Split",
    profile: "code",
    model: {
      type: "StructuralModel",
      nodes: [node("a", "A"), node("b", "B")],
      relations: [],
      generalizations: [],
      generalizationSets: [],
      constraints: [],
    },
    views: [
      { key: "left", label: "Left", nodeIds: ["a"] },
      { key: "right", label: "Right", nodeIds: ["b"] },
    ],
  });
  const proposal = atlas.createProposal(base);
  const model = clone(proposal.model);
  // A new class outside both views would add an all-elements view.
  model.nodes[0].name = "Alpha";
  model.relations.push({
    id: "ab",
    name: "holds",
    sourceId: "a",
    targetId: "b",
    sourceMultiplicity: "1",
    targetMultiplicity: "0..*",
  });
  const { payload } = await atlas.prepareViewer({
    document: atlas.reviseDocument(proposal, { model }),
    includeArtifacts: false,
  });
  const view = payload.comparison.changeView;
  const { rollupChanges } = loadComponents("src/review/changes.js");
  const rollup = rollupChanges(payload.comparison, view.model, view.views);
  const relation = rollup.rows.find((r) => r.name === "Alpha → B");
  assert.equal(relation.target, null);
  assert.equal(relation.summary.note, "Not drawn in any view");
  assert.deepEqual(
    rollup.navigable.map((r) => r.name),
    ["Alpha"],
  );
  assert.equal(rollup.count, 2);
  const { ChangesOverview } = loadComponents("src/review/ChangesOverview.jsx");
  const html = renderToStaticMarkup(
    createElement(ChangesOverview, { rollup, profile: "code", onSelect() {} }),
  );
  assert(html.includes("Not drawn in any view"));
  assert.match(html, /<li class="change-row static"[^>]*>.*?Alpha → B/);
});

test("a new Java class is proposed where its package's classes live", () => {
  const { decodeIdentity, elementFile } = loadComponents(
    "src/review/changes.js",
  );
  const java = (name) => `code:java:shop:${encodeURIComponent(name)}`;
  assert.deepEqual(decodeIdentity(java("com.shop.Cart")), {
    source: "code",
    language: "java",
    repository: "shop",
    file: null,
    name: "com.shop.Cart",
  });
  const model = {
    classes: [
      {
        id: java("com.shop.Checkout"),
        name: "com.shop.Checkout",
        location: { file: "src/main/java/com/shop/Checkout.java" },
      },
    ],
  };
  const file = (name, within = model) =>
    elementFile({ id: java(name) }, within);
  assert.equal(file("com.shop.Cart"), "src/main/java/com/shop/Cart.java");
  assert.equal(
    file("com.shop.Checkout.Line"),
    "src/main/java/com/shop/Checkout.java",
  );
  assert.equal(
    file("com.billing.Invoice"),
    "src/main/java/com/billing/Invoice.java",
  );
  assert.equal(file("com.shop.Cart", { classes: [] }), null);
  const { WhatChanges } = loadComponents("src/viewer/DetailSections.jsx");
  const render = (within) =>
    renderToStaticMarkup(
      createElement(WhatChanges, {
        change: { status: "added", properties: [], members: [] },
        element: { id: java("com.shop.Cart"), name: "Cart", attributes: [] },
        model: within,
        profile: "code",
      }),
    );
  assert(
    render(model).includes(
      "Proposed in <code>src/main/java/com/shop/Cart.java</code> (a new file)",
    ),
  );
  // Without a captured class to place it by, its identity still names it.
  assert(
    render({ classes: [] }).includes("Proposed as <code>com.shop.Cart</code>"),
  );
});

test("a table's keys list each foreign key once, with its change", async () => {
  const table = (id, columns) => ({
    id,
    name: id,
    attributes: columns.map((c) => ({
      id: `${id}.${c}`,
      name: c,
      type: "integer",
    })),
  });
  const fk = (name, column, target) => ({
    id: `orders:fk:${name}`,
    name,
    stereotype: "foreign key",
    sourceId: "orders",
    targetId: target,
    sourceMultiplicity: "0..*",
    targetMultiplicity: "1",
    columns: [column],
    targetColumns: ["id"],
  });
  const base = atlas.createDocument({
    id: "shop",
    title: "Shop",
    profile: "database",
    model: {
      type: "StructuralModel",
      nodes: [
        table("orders", ["id", "created_by", "updated_by", "legacy_id"]),
        table("users", ["id"]),
        table("accounts", ["id"]),
      ],
      relations: [
        fk("created_by_fkey", "created_by", "users"),
        fk("updated_by_fkey", "updated_by", "users"),
        fk("legacy_fkey", "legacy_id", "users"),
      ],
      generalizations: [],
      generalizationSets: [],
    },
  });
  const proposal = atlas.createProposal(base);
  const model = clone(proposal.model);
  model.relations = [
    fk("created_by_fkey", "created_by", "users"),
    fk("updated_by_fkey", "updated_by", "accounts"),
  ];
  const { payload } = await atlas.prepareViewer({
    document: atlas.reviseDocument(proposal, { model }),
    includeArtifacts: false,
  });
  const view = payload.comparison.changeView;
  const { rollupChanges } = loadComponents("src/review/changes.js");
  const { ConceptDetails } = loadComponents("src/viewer/DetailsContent.jsx");
  const review = {
    rollup: rollupChanges(payload.comparison, view.model, view.views),
  };
  const html = renderToStaticMarkup(
    createElement(ConceptDetails, {
      concept: view.model.classes.find((c) => c.id === "orders"),
      model: view.model,
      snippets: {},
      review,
      onReference() {},
    }),
  );
  const keys = html.slice(html.indexOf(">Keys<"));
  const rows = keys.slice(0, keys.indexOf("</ul>")).split("<li").slice(1);
  assert.equal(rows.length, 3);
  assert(rows[0].includes("created_by") && !rows[0].includes("data-change"));
  assert(rows[1].includes('data-change="modified"'));
  assert(
    rows[1].includes('<del class="change-before">updated_by → users(id)</del>'),
  );
  assert(
    rows[1].includes(
      '<ins class="change-after">updated_by → accounts(id)</ins>',
    ),
  );
  assert(
    rows[2].includes('data-change="removed"') && rows[2].includes("legacy_id"),
  );
  // The relation's own change names the tables, not their identities.
  const relation = review.rollup.rows.find(
    (r) => r.label === "updated_by_fkey",
  );
  assert.equal(
    relation.summary.text,
    "updated_by_fkey · targetId: users → accounts",
  );
});

const tokensOf = (row) =>
  row.summary.tokens.map((t) => `${t.status} ${t.text}`);
function renderDetails({ view, rollup }, id) {
  const { ConceptDetails } = loadComponents("src/viewer/DetailsContent.jsx");
  return renderToStaticMarkup(
    createElement(ConceptDetails, {
      concept: view.model.classes.find((c) => c.id === id),
      model: view.model,
      snippets: {},
      review: { rollup },
      onReference() {},
    }),
  );
}
// A structural proposal: `change` edits a copy of the baseline's model.
async function proposing(base, change) {
  const proposal = atlas.createProposal(base);
  const model = clone(proposal.model);
  change(model, new Map(model.nodes.map((n) => [n.id, n])));
  const { payload } = await atlas.prepareViewer({
    document: atlas.reviseDocument(proposal, { model }),
    includeArtifacts: false,
  });
  const view = payload.comparison.changeView;
  const { rollupChanges } = loadComponents("src/review/changes.js");
  return {
    payload,
    view,
    rollup: rollupChanges(payload.comparison, view.model, view.views),
  };
}
const member = (id, name, type) => ({ id, name, type });
// Person, Institution and an optional Campus, as code with stable identities.
function people({ campus = false } = {}) {
  return atlas.createDocument({
    id: "people",
    title: "People",
    profile: "code",
    model: {
      type: "StructuralModel",
      nodes: [
        { id: "person", name: "Person", kind: "class", attributes: [] },
        {
          id: "institution",
          name: "Institution",
          kind: "class",
          attributes: [member("institution-code", "code", "Person")],
        },
        ...(campus
          ? [
              {
                id: "campus",
                name: "Campus",
                kind: "class",
                attributes: [
                  member("campus-code", "code", "string"),
                  member("campus-name", "name", "string"),
                ],
              },
            ]
          : []),
      ],
      relations: [],
      generalizations: [],
      generalizationSets: [],
    },
  });
}

test("an attribute's change reads by its name and type", async () => {
  const { describeClassChange } = loadComponents("src/review/changes.js");
  const retyped = await diagramProposal(
    ENROLLMENT,
    ENROLLMENT.replace("name : String", "name : Text"),
  );
  const person = retyped.view.model.classes.find((c) => c.id === "Person");
  assert.deepEqual(
    describeClassChange(retyped.rollup, person, "class").members.map((m) => [
      m.status,
      m.previous,
      m.signature,
    ]),
    [["modified", "name: String", "name: Text"]],
  );
  assert.match(
    renderDetails(retyped, "Person"),
    /name<\/span>: <del class="change-before">String<\/del>.*<ins class="change-after">Text<\/ins>/,
  );
  const counted = await diagramProposal(
    ENROLLMENT,
    ENROLLMENT.replace("name : String", "name : String [0..1]"),
  );
  assert.match(
    renderDetails(counted, "Person"),
    /name: String<\/code>.*multiplicity: <del class="change-before">none<\/del>.*<ins class="change-after">0..1<\/ins>/,
  );
});

const KNOWS = `${ENROLLMENT}
Person "0..*" -- "0..*" Person : knows`;
test("a relation changed in place is laid out once, also on one class, and the baseline keeps its own labels", async () => {
  const id = "relation:Person:Person:knows";
  const { payload, view, rollup } = await diagramProposal(
    KNOWS,
    KNOWS.replace(
      'Person "0..*" -- "0..*" Person',
      'Person "0..*" -- "0..1" Person',
    ),
  );
  assert.deepEqual(
    view.model.relations
      .filter((r) => (r.originalId || r.id) === id)
      .map((r) => r.changeStatus),
    ["modified"],
  );
  // The view that draws the relation, and its labels there.
  const drawing = (views) =>
    views.find((v) => v.diagram.edges.some((e) => e.id === id)).diagram;
  const labels = (views) =>
    drawing(views)
      .edges.find((e) => e.id === id)
      .labels.map((l) => l.text);
  assert(labels(view.views).includes("0..1"));
  assert(
    labels(payload.comparison.baseline.views).filter((l) => l === "0..*")
      .length === 2,
  );
  validateDiagram(
    drawing(payload.comparison.baseline.views),
    payload.comparison.baseline.model,
  );
  const row = rollup.rows.find((r) => r.id === id);
  assert(row.target);
  assert.equal(row.summary.text, "knows · targetMultiplicity: 0..* → 0..1");
});

test("a self-referencing foreign key whose delete rule changes opens, and its key says what changed", async () => {
  const table = {
    id: "category",
    name: "category",
    attributes: [
      { id: "category.id", name: "id", type: "integer" },
      { id: "category.parent_id", name: "parent_id", type: "integer" },
    ],
  };
  const fk = (onDelete) => ({
    id: "category:fk:parent",
    name: "category_parent_id_fkey",
    stereotype: "foreign key",
    sourceId: "category",
    targetId: "category",
    sourceMultiplicity: "0..*",
    targetMultiplicity: "0..1",
    columns: ["parent_id"],
    targetColumns: ["id"],
    onDelete,
  });
  const base = atlas.createDocument({
    id: "shop",
    title: "Shop",
    profile: "database",
    model: {
      type: "StructuralModel",
      nodes: [table],
      relations: [fk("NO ACTION")],
      generalizations: [],
      generalizationSets: [],
    },
  });
  const proposal = atlas.createProposal(base);
  const model = clone(proposal.model);
  model.relations = [fk("CASCADE")];
  const { payload } = await atlas.prepareViewer({
    document: atlas.reviseDocument(proposal, { model }),
    includeArtifacts: false,
  });
  const view = payload.comparison.changeView;
  assert.deepEqual(
    view.model.relations.map((r) => [r.id, r.changeStatus]),
    [["category:fk:parent", "modified"]],
  );
  const { rollupChanges } = loadComponents("src/review/changes.js");
  const rollup = rollupChanges(payload.comparison, view.model, view.views);
  const html = renderDetails({ view, rollup }, "category");
  const keys = html.slice(html.indexOf(">Keys<"));
  assert.match(
    keys,
    /parent_id<\/span> <span class="member-type">→ category\(id\)<\/span><\/code><span class="change-detail">onDelete: <del class="change-before">NO ACTION<\/del>.*<ins class="change-after">CASCADE<\/ins>/,
  );
});

test("a changed relation's mark avoids its labels", async () => {
  const { changeMarkPoint } = loadComponents(
    "src/visualization/UMLRelation.jsx",
  );
  // The middle is under the name label; the mark moves along the segment.
  const point = changeMarkPoint(
    ["M0 0 L200 0"],
    [{ x: 80, y: -10, width: 40, height: 20 }],
  );
  assert(point && (point.x < 71 || point.x > 129), JSON.stringify(point));
  assert.equal(changeMarkPoint(["M0 0 L30 0"], []), null, "too short");
  // A relation whose count changed carries its mark, on a route long enough
  // to leave room beside its labels.
  const order = [
    "class Order",
    "class Line",
    "class Product",
    'Order "1" -- "0..*" Line',
    'Line "0..*" -- "1" Product',
    'Order "0..*" -- "0..*" Product',
  ].join("\n");
  const { view } = await diagramProposal(
    order,
    order.replace('"0..*" -- "0..*" Product', '"0..*" -- "1..*" Product'),
  );
  const id = "relation:Order:Product";
  const svg = renderSVG(
    view.views.find((v) => v.diagram.edges.some((e) => e.id === id)).diagram,
  );
  const start = svg.indexOf(`data-edge="${id}"`);
  assert(start > 0);
  const end = svg.indexOf("data-edge=", start + 1);
  assert(svg.slice(start, end).includes('class="edge-change-mark"'));
});

test("what moves between classes is listed, by name, where it left and where it went", async () => {
  const move = (model, byId) => {
    const code = byId.get("institution").attributes.pop();
    byId.get("person").attributes.push(code);
    return code;
  };
  const moved = await proposing(people(), move);
  const row = (name) => moved.rollup.rows.find((r) => r.name === name);
  assert.deepEqual(tokensOf(row("Institution")), ["removed code"]);
  assert.deepEqual(tokensOf(row("Person")), ["added code"]);
  const status = (id) =>
    moved.view.model.classes
      .find((c) => c.id === id)
      .attributes.find((a) => a.id === "institution-code").changeStatus;
  assert.equal(status("person"), "added");
  assert.equal(status("institution"), "removed");
  assert(renderDetails(moved, "person").includes("Moved from Institution"));
  assert(renderDetails(moved, "institution").includes("Moved to Person"));
  // Renamed on the way, it reads as before → after where it arrived.
  const renamed = await proposing(people(), (model, byId) => {
    move(model, byId).name = "identifier";
  });
  assert.match(
    renderDetails(renamed, "person"),
    /<del class="change-before">code: Person<\/del>.*<ins class="change-after">identifier: Person<\/ins>.*Moved from Institution/,
  );
});

test("a class moved to another package says so", async () => {
  const { rollup } = await diagramProposal(
    ENROLLMENT,
    ENROLLMENT.replace(
      "class Institution",
      "package people {\n  class Institution\n}",
    ),
  );
  assert.deepEqual(
    rollup.groups.map((g) => [g.label, g.elements.map(tokensOf)]),
    [["Changed", [["modified namespace: none → people"]]]],
  );
});

test("a foreign key whose columns change shows the key it was", async () => {
  const table = (id, columns) => ({
    id,
    name: id,
    attributes: columns.map((c) => ({
      id: `${id}.${c}`,
      name: c,
      type: "integer",
    })),
  });
  const fk = (column) => ({
    id: "orders:fk:creator",
    name: "orders_creator_fkey",
    stereotype: "foreign key",
    sourceId: "orders",
    targetId: "users",
    sourceMultiplicity: "0..*",
    targetMultiplicity: "1",
    columns: [column],
    targetColumns: ["id"],
  });
  const base = atlas.createDocument({
    id: "shop",
    title: "Shop",
    profile: "database",
    model: {
      type: "StructuralModel",
      nodes: [
        table("orders", ["id", "created_by", "creator_id"]),
        table("users", ["id"]),
      ],
      relations: [fk("created_by")],
      generalizations: [],
      generalizationSets: [],
    },
  });
  const proposal = atlas.createProposal(base);
  const model = clone(proposal.model);
  model.relations = [fk("creator_id")];
  const { payload } = await atlas.prepareViewer({
    document: atlas.reviseDocument(proposal, { model }),
    includeArtifacts: false,
  });
  const view = payload.comparison.changeView;
  const { rollupChanges } = loadComponents("src/review/changes.js");
  const rollup = rollupChanges(payload.comparison, view.model, view.views);
  const keys = renderDetails({ view, rollup }, "orders").split(">Keys<")[1];
  assert.match(
    keys,
    /data-change="modified".*<del class="change-before">created_by → users\(id\)<\/del>.*<ins class="change-after">creator_id → users\(id\)<\/ins>/,
  );
});

test("a table's own foreign keys and SQL stay out of its summary, and the model's copies of them out of Model", async () => {
  const definition = (columns) =>
    `CREATE TABLE "orders" (${columns.map((c) => `"${c}" INTEGER`).join(", ")})`;
  const orders = (columns, foreignKeys) => ({
    id: "orders",
    name: "orders",
    kind: "table",
    attributes: columns.map((c) => ({
      id: `orders.${c}`,
      name: c,
      type: "INTEGER",
    })),
    definition: definition(columns),
    foreignKeys,
  });
  const users = {
    id: "users",
    name: "users",
    kind: "table",
    attributes: [{ id: "users.id", name: "id", type: "INTEGER" }],
  };
  const base = atlas.createDocument({
    id: "shop",
    title: "Shop",
    profile: "database",
    model: {
      type: "StructuralModel",
      nodes: [orders(["id"], []), users],
      relations: [],
      generalizations: [],
      generalizationSets: [],
      constraints: [["orders", definition(["id"])]],
    },
  });
  const proposal = atlas.createProposal(base);
  const model = clone(proposal.model);
  const key = { columns: ["user_id"], target: "users", targetColumns: ["id"] };
  model.nodes[0] = orders(["id", "user_id"], [key]);
  model.constraints = [["orders", definition(["id", "user_id"])]];
  model.relations = [
    {
      id: "orders:fk:user",
      name: "user_id → id",
      stereotype: "foreign key",
      sourceId: "orders",
      targetId: "users",
      sourceMultiplicity: "0..*",
      targetMultiplicity: "1",
      ...key,
    },
  ];
  const { payload } = await atlas.prepareViewer({
    document: atlas.reviseDocument(proposal, { model }),
    includeArtifacts: false,
  });
  const view = payload.comparison.changeView;
  const { rollupChanges } = loadComponents("src/review/changes.js");
  const changes = rollupChanges(payload.comparison, view.model, view.views);
  assert.deepEqual(
    changes.groups.map((g) => g.label),
    ["New", "Changed"],
  );
  assert.deepEqual(tokensOf(changes.rows.find((r) => r.name === "orders")), [
    "modified definition changed",
    "added user_id",
  ]);
});

test("a new Java class is placed only by classes of its own repository", () => {
  const { elementFile } = loadComponents("src/review/changes.js");
  const java = (repository, name) =>
    `code:java:${repository}:${encodeURIComponent(name)}`;
  const model = {
    classes: [
      {
        id: java("billing", "com.billing.Invoice"),
        location: { file: "billing/src/main/java/com/billing/Invoice.java" },
      },
    ],
  };
  assert.equal(elementFile({ id: java("shop", "com.shop.Cart") }, model), null);
  assert.equal(
    elementFile({ id: java("billing", "com.billing.Refund") }, model),
    "billing/src/main/java/com/billing/Refund.java",
  );
});

// A database table as captures record it, with its keys, indexes and
// foreign keys; `change` edits the proposal's copy of it.
async function tableProposal(table, change, extra = {}) {
  const users = {
    id: "users",
    name: "users",
    kind: "table",
    attributes: [{ id: "users.id", name: "id", type: "INTEGER" }],
  };
  const base = atlas.createDocument({
    id: "shop",
    title: "Shop",
    profile: "database",
    model: {
      type: "StructuralModel",
      nodes: [table, users],
      relations: [],
      generalizations: [],
      generalizationSets: [],
      ...extra,
    },
  });
  const proposal = atlas.createProposal(base);
  const model = clone(proposal.model);
  change(model.nodes[0], model);
  const { payload } = await atlas.prepareViewer({
    document: atlas.reviseDocument(proposal, { model }),
    includeArtifacts: false,
  });
  const view = payload.comparison.changeView;
  const { rollupChanges } = loadComponents("src/review/changes.js");
  return {
    view,
    rollup: rollupChanges(payload.comparison, view.model, view.views),
  };
}
const ordersTable = () => ({
  id: "orders",
  name: "orders",
  kind: "table",
  attributes: ["id", "user_id", "created_at", "account_id"].map((c) => ({
    id: `orders.${c}`,
    name: c,
    type: "INTEGER",
  })),
  keys: [
    { name: "PRIMARY KEY", columns: ["id"], primary: true },
    { name: "orders_user_key", columns: ["user_id"], primary: false },
  ],
  indexes: [
    {
      name: "idx_orders_user",
      unique: false,
      partial: false,
      columns: ["user_id"],
      definition: null,
    },
  ],
  // Its target table is outside the capture, so no relation shows it.
  foreignKeys: [
    {
      columns: ["account_id"],
      target: "accounts",
      targetColumns: ["id"],
      onDelete: "NO ACTION",
      onUpdate: "NO ACTION",
      match: "SIMPLE",
    },
  ],
});

test("a table's changed keys and indexes read part by part, by name in the list", async () => {
  const proposal = await tableProposal(ordersTable(), (orders) => {
    orders.indexes[0] = {
      ...orders.indexes[0],
      unique: true,
      columns: ["user_id", "created_at"],
    };
    orders.keys[0] = { ...orders.keys[0], columns: ["id", "created_at"] };
    orders.keys[1] = { ...orders.keys[1], columns: ["user_id", "created_at"] };
  });
  const row = proposal.rollup.rows.find((r) => r.name === "orders");
  assert.deepEqual(tokensOf(row), [
    "modified index idx_orders_user",
    "modified key PRIMARY KEY",
    "modified key orders_user_key",
  ]);
  const html = renderDetails(proposal, "orders");
  const changes = html.slice(html.indexOf("What changes"));
  assert.match(
    changes,
    /key PRIMARY KEY<\/span> <del class="change-before">\(id\)<\/del>.*<ins class="change-after">\(id, created_at\)<\/ins>/,
  );
  assert.match(
    changes,
    /index idx_orders_user<\/span> <del class="change-before">\(user_id\)<\/del>.*<ins class="change-after">\(user_id, created_at\), unique<\/ins>/,
  );
  // The Keys section marks the unique key it changes.
  const keys = html.split(">Keys<")[1];
  assert.match(
    keys,
    /data-change="modified".*unique<\/span> <span class="member-type"><del class="change-before">\(user_id\)<\/del>.*<ins class="change-after">\(user_id, created_at\)<\/ins>/,
  );
});

test("a foreign key no relation shows is the table's own change", async () => {
  const proposal = await tableProposal(ordersTable(), (orders) => {
    orders.foreignKeys[0] = { ...orders.foreignKeys[0], onDelete: "CASCADE" };
  });
  const row = proposal.rollup.rows.find((r) => r.name === "orders");
  assert.deepEqual(tokensOf(row), [
    "modified foreign key account_id → accounts(id)",
  ]);
  const html = renderDetails(proposal, "orders");
  assert.match(
    html,
    /foreign key<\/span> <del class="change-before">account_id → accounts\(id\), on delete no action, on update no action<\/del>.*<ins class="change-after">account_id → accounts\(id\), on delete cascade, on update no action<\/ins>/,
  );
  // The table's keys list it too, marked changed.
  assert.match(
    html.split(">Keys<")[1],
    /data-change="modified".*<ins class="change-after">account_id → accounts\(id\), on delete cascade/,
  );
  // One a relation shows stays out of the table's own changes.
  const related = await tableProposal(
    { ...ordersTable(), foreignKeys: [] },
    (orders, model) => {
      const key = {
        columns: ["user_id"],
        target: "users",
        targetColumns: ["id"],
      };
      orders.foreignKeys = [key];
      model.relations = [
        {
          id: "orders:fk:user",
          name: "user_id → id",
          stereotype: "foreign key",
          sourceId: "orders",
          targetId: "users",
          sourceMultiplicity: "0..*",
          targetMultiplicity: "1",
          ...key,
        },
      ];
    },
  );
  assert(!related.rollup.rows.some((r) => r.name === "orders"));
});

test("a list that is only reordered reads before → after", async () => {
  const node = (modifiers) => ({
    id: "checkout",
    name: "Checkout",
    kind: "class",
    attributes: [],
    modifiers,
  });
  const base = atlas.createDocument({
    id: "shop",
    title: "Shop",
    profile: "code",
    model: {
      type: "StructuralModel",
      nodes: [node(["abstract", "export"])],
      relations: [],
      generalizations: [],
      generalizationSets: [],
    },
  });
  const proposal = atlas.createProposal(base);
  const model = clone(proposal.model);
  model.nodes[0].modifiers = ["export", "abstract"];
  const { payload } = await atlas.prepareViewer({
    document: atlas.reviseDocument(proposal, { model }),
    includeArtifacts: false,
  });
  const view = payload.comparison.changeView;
  const { rollupChanges } = loadComponents("src/review/changes.js");
  const rollup = rollupChanges(payload.comparison, view.model, view.views);
  assert.deepEqual(tokensOf(rollup.rows[0]), [
    "modified modifiers: abstract, export → export, abstract",
  ]);
});

test("a removed type counts only what goes with it, and says what moved", async () => {
  const moved = await proposing(people({ campus: true }), (model, byId) => {
    // The campus goes with its name; its code moves to Person.
    const code = byId.get("campus").attributes[0];
    model.nodes = model.nodes.filter((n) => n.id !== "campus");
    byId.get("person").attributes.push(code);
  });
  const html = renderDetails(moved, "campus");
  assert(html.includes("The class is removed, with its 1 field."), html);
  // Its row in the list names only what goes with it.
  assert.equal(
    moved.rollup.rows.find((r) => r.name === "Campus").summary.text,
    "name",
  );
  assert(html.includes("code moved to Person."));
  assert(renderDetails(moved, "person").includes("Moved from Campus"));
});

test("a part of a table reads by its columns, or its statement, and a change hidden from both by its fields", async () => {
  const { describePart } = loadComponents("src/review/changes.js");
  assert.equal(
    describePart({
      name: "chk_qty",
      type: "c",
      columns: ["qty"],
      definition: "CHECK (qty > 0)",
    }),
    "CHECK (qty > 0)",
  );
  assert.equal(
    describePart({
      name: "idx_open",
      unique: false,
      partial: true,
      columns: ["status"],
      definition:
        "CREATE INDEX idx_open ON orders (status) WHERE status = 'open'",
    }),
    "CREATE INDEX idx_open ON orders (status) WHERE status = 'open'",
  );
  const collated = await tableProposal(ordersTable(), (orders) => {
    orders.indexes[0] = { ...orders.indexes[0], collations: ["NOCASE"] };
  });
  assert.match(
    renderDetails(collated, "orders"),
    /index idx_orders_user<\/span> <del class="change-before">\(user_id\); collations none<\/del>.*<ins class="change-after">\(user_id\); collations NOCASE<\/ins>/,
  );
});

test("a table's foreign keys are told once: by the relation that shows them, or by the table", async () => {
  const relation = (key, extra = {}) => ({
    id: "orders:fk:user",
    name: "user_id → id",
    stereotype: "foreign key",
    sourceId: "orders",
    targetId: "users",
    sourceMultiplicity: "0..*",
    targetMultiplicity: "1",
    ...key,
    ...extra,
  });
  const key = {
    columns: ["user_id"],
    target: "users",
    targetColumns: ["id"],
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
    match: "SIMPLE",
  };
  // Pointed from a captured table at one outside the capture: the relation
  // goes, and the table's own key to the other table is listed in Keys.
  const retargeted = await tableProposal(
    { ...ordersTable(), foreignKeys: [key] },
    (orders, model) => {
      orders.foreignKeys = [{ ...key, target: "accounts" }];
      model.relations = [];
    },
    { relations: [relation(key)] },
  );
  assert.deepEqual(
    tokensOf(retargeted.rollup.rows.find((r) => r.name === "orders")),
    ["added foreign key user_id → accounts(id)"],
  );
  const keys = renderDetails(retargeted, "orders").split(">Keys<")[1];
  assert.match(
    keys,
    /data-change="added".*user_id<\/span> <span class="member-type">→ accounts\(id\)/,
  );
  // Two keys over the same columns to different tables stay two.
  const twin = await tableProposal(
    {
      ...ordersTable(),
      foreignKeys: [
        { ...key, target: "accounts" },
        { ...key, target: "legacy_users" },
      ],
    },
    (orders) => {
      orders.foreignKeys = [{ ...key, target: "accounts" }];
    },
  );
  assert.deepEqual(
    tokensOf(twin.rollup.rows.find((r) => r.name === "orders")),
    ["removed foreign key user_id → legacy_users(id)"],
  );
  // So do two to the same table's different columns.
  const columns = await tableProposal(
    {
      ...ordersTable(),
      foreignKeys: [
        { ...key, target: "accounts" },
        { ...key, target: "accounts", targetColumns: ["legacy_id"] },
      ],
    },
    (orders) => {
      orders.foreignKeys = [{ ...key, target: "accounts" }];
    },
  );
  assert.deepEqual(
    tokensOf(columns.rollup.rows.find((r) => r.name === "orders")),
    ["removed foreign key user_id → accounts(legacy_id)"],
  );
  // A key whose referenced columns are unknown is the same key with or
  // without them.
  const { partKey } = loadComponents("src/review/changes.js");
  assert.equal(
    partKey({ ...key, target: "accounts", targetColumns: [null] }),
    partKey({ ...key, target: "accounts", targetColumns: undefined }),
  );
  // It reads without them.
  const unknown = await tableProposal(
    {
      ...ordersTable(),
      foreignKeys: [{ ...key, target: "accounts", targetColumns: [null] }],
    },
    (orders) => {
      orders.foreignKeys = [];
    },
  );
  assert.deepEqual(
    tokensOf(unknown.rollup.rows.find((r) => r.name === "orders")),
    ["removed foreign key user_id → accounts"],
  );
  // Nor does recording them as nulls or leaving them out change it.
  const { itemChanges } = loadComponents("src/review/changes.js");
  const unknownKey = { ...key, target: "accounts", targetColumns: [null] };
  const { targetColumns: _unknown, ...withoutColumns } = unknownKey;
  assert.deepEqual(
    itemChanges({
      before: { present: true, value: [unknownKey] },
      after: { present: true, value: [withoutColumns] },
    }),
    [],
  );
  // PostgreSQL lists a foreign key as a constraint; its relation tells it.
  const constraint = {
    name: "orders_user_id_fkey",
    type: "f",
    columns: ["user_id"],
    definition: "FOREIGN KEY (user_id) REFERENCES users(id)",
  };
  const postgres = await tableProposal(
    { ...ordersTable(), foreignKeys: [], constraints: [] },
    (orders, model) => {
      orders.constraints = [constraint];
      model.relations = [
        relation(
          { columns: ["user_id"], targetColumns: ["id"] },
          {
            id: "orders:fk:orders_user_id_fkey",
            name: "orders_user_id_fkey",
            definition: constraint.definition,
          },
        ),
      ];
    },
  );
  assert.deepEqual(
    postgres.rollup.rows.map((r) => `${r.kind} ${r.status} ${r.name}`),
    ["edge added orders → users"],
  );
});

test("a key that changes only where its description is silent says how", async () => {
  const origin = await tableProposal(
    {
      ...ordersTable(),
      keys: [
        { name: "PRIMARY KEY", columns: ["id"], primary: true },
        {
          name: "orders_user_key",
          columns: ["user_id"],
          primary: false,
          origin: "u",
        },
      ],
    },
    (orders) => {
      orders.keys[1] = { ...orders.keys[1], origin: "c" };
    },
  );
  assert.match(
    renderDetails(origin, "orders").split(">Keys<")[1],
    /<del class="change-before">\(user_id\); origin u<\/del>.*<ins class="change-after">\(user_id\); origin c<\/ins>/,
  );
});
