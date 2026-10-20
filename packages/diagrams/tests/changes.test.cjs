// Reviewing a proposal: changes rolled up per element, the change view's
// marks, the details that explain a change, and less noise on the canvas.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const atlas = require("../lib/index.cjs");
const { renderSVG } = require("../lib/render/renderSVG.cjs");
const { validateDiagram } = require("../lib/layout/validateDiagram.cjs");
const { relationLabel } = require("../lib/layout/layoutDiagram.cjs");
const { loadComponents } = require("./loadComponents.cjs");

const CHECKOUT = "Checkout",
  LEGACY = "Legacy",
  VAULT = "Vault";
const at = (line, endLine) =>
  `' atlas evidence ${JSON.stringify({ file: "src/checkout/Checkout.ts", line, ...(endLine ? { endLine } : {}) })}`;
// A capture of checkout code, and a proposal of it: the vault replaces the
// legacy payments, the total becomes money and checkout learns to pay.
function captured() {
  const { diagram } = atlas.parseDiagram(`@startuml
title Checkout
${at(2, 20)}
class Checkout {
  ${at(3)}
  gateway : Gateway
  ${at(4)}
  total : number
  ${at(5)}
  legacy : Legacy
}
interface Gateway
class Legacy
Checkout ..> Gateway
Checkout ..> Legacy
@enduml
`);
  return atlas.formatDiagram({
    ...diagram,
    capture: {
      capturedAt: "2026-10-08T10:00:00.000Z",
      adapter: { id: "atlas-typescript", version: "1.0.0" },
      source: { kind: "typescript", identity: "shop", scope: ["src"] },
      coverage: { status: "complete", diagnostics: [] },
    },
  });
}
const PROPOSED = `@startuml
title Checkout
' atlas proposal capture.puml
${at(2, 20)}
class Checkout {
  ${at(3)}
  gateway : Gateway
  ${at(4)}
  total : Money
  vault : Vault
  pay(methodId: string) : Promise<void>
}
interface Gateway
' atlas evidence {"file":"src/payments/Vault.ts"}
interface Vault {
  save() : void
}
Checkout ..> Gateway
Checkout ..> Vault
@enduml
`;
async function prepared(includeArtifacts = false) {
  const { prepared } = await atlas.prepareDiagrams({
    files: [
      { path: "capture.puml", text: captured() },
      { path: "proposal.puml", text: PROPOSED },
    ],
    includeArtifacts,
  });
  return prepared.get("proposal.puml");
}
// The tests only read the proposal's payload: it is prepared once.
let proposal;
function preparedProposal() {
  return (proposal ??= prepared().then((viewer) => viewer.payload));
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
    view.model.relations.find((r) => r.id === "relation:Checkout:Vault")
      .changeStatus,
    "added",
  );
  assert.equal(
    view.model.relations.find((r) => r.id === "relation:Checkout:Gateway")
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

test("details explain a change: its members and where it lives, without capture noise", async () => {
  const payload = await preparedProposal();
  const { rollupChanges } = loadComponents("src/review/changes.js");
  const { ConceptDetails } = loadComponents("src/details/ElementDetails.jsx");
  const view = payload.comparison.changeView;
  const review = { rollup: rollupChanges(payload.comparison, view.model) };
  const render = (id) =>
    renderToStaticMarkup(
      createElement(ConceptDetails, {
        concept: view.model.classes.find((c) => c.id === id),
        model: view.model,
        snippets: view.snippets,
        review,
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
  for (const noise of [
    "observed",
    "Capture ·",
    "Mappings",
    "Definition",
    "diagnostic",
  ])
    assert(!changed.includes(noise), noise);
  // A new class says where it goes when its evidence names a file.
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
  const { payload: standalone } = await prepared(true);
  const { DiagramPanel, DiagramViewer } = loadComponents();
  for (const html of [
    renderToStaticMarkup(createElement(DiagramPanel, { payload })),
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

test("unnamed dependencies and missing counts add no labels to the canvas", async () => {
  const payload = await preparedProposal();
  for (const view of payload.comparison.changeView.views)
    for (const edge of view.diagram.edges) assert.deepEqual(edge.labels, []);
  assert.equal(
    relationLabel({ name: "declared type use", stereotype: "dependency" }),
    null,
  );
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
  // A count that is written keeps its label; one that is not adds none.
  const { prepared: lean } = await atlas.prepareDiagrams({
    files: [
      {
        path: "ab.puml",
        text: '@startuml\nclass A\nclass B\nA -- "0..*" B : holds\n@enduml\n',
      },
    ],
  });
  const { payload: ab } = lean.get("ab.puml");
  const edge = ab.views[0].diagram.edges[0];
  assert.deepEqual(
    edge.labels.map((l) => [l.kind, l.text]),
    [
      ["name", "holds"],
      ["target", "0..*"],
    ],
  );
  assert.equal(
    validateDiagram(ab.views[0].diagram, ab.model).multiplicityLabels,
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

const tokensOf = (row) =>
  row.summary.tokens.map((t) => `${t.status} ${t.text}`);
function renderDetails({ view, rollup }, id) {
  const { ConceptDetails } = loadComponents("src/details/ElementDetails.jsx");
  return renderToStaticMarkup(
    createElement(ConceptDetails, {
      concept: view.model.classes.find((c) => c.id === id),
      model: view.model,
      snippets: {},
      review: { rollup },
    }),
  );
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

test("a changed relation's mark avoids its labels", async () => {
  const { changeMarkPoint } = loadComponents("src/canvas/UMLRelation.jsx");
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

test("a table's keys list each foreign key once, with its change", async () => {
  const tables = (updatedBy) => `entity orders {
  *id : integer <<PK>>
  --
  *created_by : integer <<FK>>
  *updated_by : integer <<FK>>
}
entity users {
  *id : integer <<PK>>
}
entity accounts {
  *id : integer <<PK>>
}
users ||--o{ orders : created_by
${updatedBy} ||--o{ orders : updated_by`;
  const { view, rollup } = await diagramProposal(
    tables("users"),
    tables("accounts"),
  );
  const keys = renderDetails({ view, rollup }, "orders").split(">Keys<")[1];
  const rows = keys.slice(0, keys.indexOf("</ul>")).split("<li").slice(1);
  assert(
    rows.some((r) => r.includes("created_by") && !r.includes("data-change")),
  );
  // A key to another table is another key: the old one goes, the new comes.
  const marked = (change, text) =>
    rows.some((r) => r.includes(`data-change="${change}"`) && r.includes(text));
  assert.equal(rows.length, 3);
  assert(marked("added", "→ accounts(id)"));
  assert(marked("removed", "→ users(id)"));
});
