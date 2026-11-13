// The groups a diagram is laid out in, and the grouped layout: packages are
// groups, groups are otherwise found from the relations with a hierarchy kept
// whole, and the groups sit apart with the relations between them routed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const atlas = require("../lib/index.cjs");
const { layoutGroups } = require("../lib/layout/groups.cjs");
const { validateDiagram } = require("../lib/layout/validateDiagram.cjs");

const classes = (ids, namespaces = {}) =>
  new Map(ids.map((id) => [id, { id, namespace: namespaces[id] }]));
const relation = (sourceId, targetId, extra = {}) => ({
  sourceId,
  targetId,
  ...extra,
});
// Two triangles of associations, a dependency between them, each with a tail.
const IDS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const RELATIONS = [
  relation("A", "B"),
  relation("B", "C"),
  relation("A", "C"),
  relation("C", "D"),
  relation("E", "F"),
  relation("F", "G"),
  relation("E", "G"),
  relation("G", "H"),
  relation("D", "E", { stereotype: "dependency" }),
];
const members = (groups) => groups.map((g) => g.members);

test("a diagram groups by its packages, else by its relations with a hierarchy kept whole; a small one is one group", () => {
  assert.deepEqual(
    members(layoutGroups({ names: IDS }, classes(IDS), RELATIONS, [])),
    [
      ["A", "B", "C", "D"],
      ["E", "F", "G", "H"],
    ],
  );
  // Two subtypes of G, related to nothing else, stay in G's group; a lone
  // element goes in a group of its own.
  const more = [...IDS, "X", "Y", "Z"];
  const generalizations = ["X", "Y"].map((id) => ({
    specificId: id,
    generalId: "G",
  }));
  const groups = layoutGroups(
    { names: more },
    classes(more),
    RELATIONS,
    generalizations,
  );
  assert(
    groups.some((g) => ["G", "X", "Y"].every((id) => g.members.includes(id))),
  );
  assert(groups.some((g) => g.members.join() === "Z"));
  // Packages are the groups, named; an element outside them is left out of all.
  const packaged = layoutGroups(
    { names: IDS },
    classes(IDS, { A: "Sales", B: "Sales", E: "Billing" }),
    RELATIONS,
    [],
  );
  assert.deepEqual(
    packaged.map((g) => [g.name, g.members]),
    [
      ["Sales", ["A", "B"]],
      ["Billing", ["E"]],
    ],
  );
  assert.deepEqual(
    layoutGroups({ names: IDS.slice(0, 6) }, classes(IDS), RELATIONS, []),
    [],
  );
  // A type every element uses would draw many lines between groups: the
  // diagram stays in one piece.
  const hub = [...IDS, "Money"];
  const uses = IDS.map((id) =>
    relation(id, "Money", { stereotype: "dependency" }),
  );
  assert.deepEqual(
    layoutGroups({ names: hub }, classes(hub), [...RELATIONS, ...uses], []),
    [],
  );
});

test("a grouped diagram draws its packages apart, with the relations between them routed and its geometry valid", async () => {
  const text = `@startuml
title Shop
package Sales {
  class Customer
  class Order
  class Line
}
package Billing {
  class Invoice
  class Payment
  class Refund
}
class Audit
Customer "1" -- "0..*" Order
Order "1" *-- "1..*" Line
Invoice "1" -- "0..*" Payment
Payment "1" -- "0..*" Refund
Order "1" -- "0..1" Invoice : billed by
Audit ..> Payment
@enduml
`;
  const { prepared } = await atlas.prepareDiagrams({
    files: [{ path: "shop.puml", text }],
  });
  const { payload, model } = prepared.get("shop.puml");
  const scene = payload.views[0].diagram;
  validateDiagram(scene, model);
  assert.deepEqual(
    scene.packages.map((p) => p.name),
    ["Sales", "Billing"],
  );
  const [sales, billing] = scene.packages;
  const inside = (box, n) =>
    n.x >= box.x &&
    n.y >= box.y &&
    n.x + n.width <= box.x + box.width &&
    n.y + n.height <= box.y + box.height;
  const nodes = new Map(scene.nodes.map((n) => [n.id, n]));
  for (const id of ["Customer", "Order", "Line"])
    assert(inside(sales, nodes.get(id)), id);
  // The packages stand well apart.
  const gap = Math.max(
    billing.x - (sales.x + sales.width),
    sales.x - (billing.x + billing.width),
    billing.y - (sales.y + sales.height),
    sales.y - (billing.y + billing.height),
  );
  assert(gap >= 60, `packages ${gap} apart`);
  // The relation between them is routed, and labelled.
  const billed = scene.edges.find(
    (e) => e.source === "Order" && e.target === "Invoice",
  );
  assert(billed.paths[0].startsWith("M"));
  assert(billed.labels.some((l) => l.text === "billed by" && l.x > 0));
});
