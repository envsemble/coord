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
  const { AtlasPanel, OntoUMLViewer } = loadComponents();
  for (const html of [
    renderToStaticMarkup(createElement(AtlasPanel, { payload })),
    renderToStaticMarkup(createElement(OntoUMLViewer, standalone)),
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
