// A family: a capture and the proposals of it, laid out once together so
// every member draws its classes and routes where the others do.
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const atlas = require("../lib/index.cjs");
const { validateDiagram } = require("../lib/layout/validateDiagram.cjs");

const CAPTURE = {
  capturedAt: "2026-09-14T08:00:00.000Z",
  adapter: { id: "test", version: "1" },
  source: { kind: "typescript", identity: "shop", scope: ["src"] },
  coverage: { status: "complete", diagnostics: [] },
  limitations: [],
};
const CHECKOUT = `class Checkout
class Customer {
  name : string
}
class Payment
class Gateway
Checkout "1" -- "0..*" Payment : pays with
Payment "1" -- "0..*" Gateway : uses
Customer "1" -- "0..*" Checkout : buys`;
// A captured baseline and two alternative proposals of it: A, a vault holding
// saved methods, with a count of the payment relation changed in place; B,
// the customer holding its methods, without the gateway.
function family() {
  const { diagram } = atlas.parseDiagram(
    `@startuml\ntitle Checkout\n${CHECKOUT}\n@enduml\n`,
  );
  const capture = atlas.formatDiagram({ ...diagram, capture: CAPTURE });
  const proposal = (title, body) =>
    `@startuml\ntitle ${title}\n' atlas proposal capture.puml\n${body}\n@enduml\n`;
  return [
    { path: "capture.puml", text: capture },
    {
      path: "vault.puml",
      text: proposal(
        "Option A",
        `${CHECKOUT.replace('"0..*" Payment : pays with', '"1..*" Payment : pays with')}
class Vault
class SavedMethod
Vault "1" -- "0..*" SavedMethod : uses
Checkout "1" -- "0..*" Vault : uses`,
      ),
    },
    {
      path: "customer.puml",
      text: proposal(
        "Option B",
        CHECKOUT.replace(
          "  name : string",
          "  name : string\n  savedMethods : SavedMethod[]",
        )
          .replace("class Gateway\n", "class SavedMethod\n")
          .replace(
            'Payment "1" -- "0..*" Gateway : uses',
            'Customer "1" -- "0..*" SavedMethod : holds',
          ),
      ),
    },
  ];
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
async function prepared(files, paths) {
  const { prepared } = await atlas.prepareDiagrams({ files, paths });
  return (paths || files.map((f) => f.path)).map(
    (p) => prepared.get(p).payload,
  );
}

test("A capture and its proposals share one layout and keep their own review data", async () => {
  const files = family();
  const payloads = await prepared(files);
  assert.deepEqual(
    payloads.map((p) => p.family),
    ["capture.puml", "capture.puml", "capture.puml"],
  );
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
    "Checkout",
    "Customer",
    "Gateway",
    "Payment",
  ]);
  assert(capture.views[0].diagram.nodes.every((n) => !n.changeStatus));
  // Each proposal changes what it changes alone, marked in its change view.
  const marks = (payload) =>
    Object.fromEntries(
      shown(payload).views[0].diagram.nodes.map((n) => [n.id, n.changeStatus]),
    );
  for (const index of [1, 2]) {
    const [alone] = await prepared(
      [files[0], files[index]],
      [files[index].path],
    );
    assert.deepEqual(
      payloads[index].comparison.changes,
      alone.comparison.changes,
    );
    assert.deepEqual(marks(payloads[index]), marks(alone));
  }
  assert.equal(marks(payloads[1]).Vault, "added");
  assert.equal(marks(payloads[1]).Gateway, "unchanged");
  assert.equal(marks(payloads[2]).Gateway, "removed");
  assert.equal(marks(payloads[2]).Customer, "modified");
  for (const payload of payloads)
    for (const view of shown(payload).views) validateDiagram(view.diagram);
});

test("A relation changed in place in one proposal is drawn on one route by every member", async () => {
  const payloads = await prepared(family());
  const routes = payloads.map((p) =>
    shown(p).views[0].diagram.edges.find(
      (e) => e.id === "relation:Checkout:Payment:pays%20with",
    ),
  );
  assert(routes.every(Boolean));
  for (const route of routes.slice(1))
    assert.deepEqual(route.paths, routes[0].paths);
  // Each member labels the route with its own counts.
  assert.deepEqual(
    routes.map((r) => r.labels.find((l) => l.kind === "target")?.text),
    ["0..*", "1..*", "0..*"],
  );
  assert.equal(routes[1].changeStatus, "modified");
  assert.equal(routes[2].changeStatus, "unchanged");
});

test("Members lay out alike in any order, and a removed class keeps its place in the change view that removes it", async () => {
  const files = family();
  const first = await prepared(files);
  const reversed = await prepared([...files].reverse());
  assert.deepEqual(first, [...reversed].reverse());
  const removed = shown(first[2]).views[0].diagram.nodes.find(
    (n) => n.id === "Gateway",
  );
  const kept = first[0].views[0].diagram.nodes.find((n) => n.id === "Gateway");
  assert.equal(removed.changeStatus, "removed");
  assert.deepEqual([removed.x, removed.y], [kept.x, kept.y]);
});
