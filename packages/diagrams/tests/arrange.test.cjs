const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { buildSync } = require("esbuild");
const { layoutDiagram } = require("../lib/layout/layoutDiagram.cjs");
const { prepareViews } = require("../lib/layout/prepareViews.cjs");

const code = buildSync({
  entryPoints: [path.join(__dirname, "../src/canvas/arrange.mjs")],
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
}).outputFiles[0].text;
const loaded = { exports: {} };
new Function("module", "exports", code)(loaded, loaded.exports);
const { arrangeScene, positionsOf } = loaded.exports;

const points = (d) => {
  const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return n.flatMap((_, i) => (i % 2 ? [] : [{ x: n[i], y: n[i + 1] }]));
};
const onSide = (box, p) =>
  ((Math.abs(p.x - box.x) < 0.01 || Math.abs(p.x - box.x - box.width) < 0.01) &&
    p.y >= box.y &&
    p.y <= box.y + box.height) ||
  ((Math.abs(p.y - box.y) < 0.01 ||
    Math.abs(p.y - box.y - box.height) < 0.01) &&
    p.x >= box.x &&
    p.x <= box.x + box.width);
const crosses = (a, b, n) =>
  Math.max(a.x, b.x) > n.x + 1 &&
  Math.min(a.x, b.x) < n.x + n.width - 1 &&
  Math.max(a.y, b.y) > n.y + 1 &&
  Math.min(a.y, b.y) < n.y + n.height - 1;
const overlaps = (a, b) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

// An orthogonal route from a side of `from` to a side of `to` (boxes, or a
// point) that runs through no box at all.
function assertRoute(scene, d, from, to) {
  const p = points(d);
  for (let i = 1; i < p.length; i++) {
    const [a, b] = [p[i - 1], p[i]];
    assert.ok(
      Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01,
      `diagonal segment in ${d}`,
    );
    for (const n of scene.nodes)
      assert.ok(!crosses(a, b, n), `${d} runs through ${n.id}`);
  }
  const at = (end, q) =>
    end.width === undefined
      ? Math.abs(end.x - q.x) < 0.01 && Math.abs(end.y - q.y) < 0.01
      : onSide(end, q);
  assert.ok(at(from, p[0]), `${d} starts off its source`);
  assert.ok(at(to, p[p.length - 1]), `${d} ends off its target`);
}
const node = (scene, id) => scene.nodes.find((n) => n.id === id);

let scene;
before(async () => {
  const ids = [
    "Customer",
    "Order",
    "LineItem",
    "Product",
    "Payment",
    "Card",
    "Cash",
    "Address",
  ];
  const pairs = [
    ["Customer", "Order"],
    ["Order", "LineItem"],
    ["LineItem", "Product"],
    ["Order", "Payment"],
    ["Customer", "Address"],
    ["Product", "Product"],
  ];
  const model = {
    title: "Shop",
    classes: ids.map((id) => ({
      id,
      name: id,
      stereotype: "kind",
      attributes: [],
    })),
    relations: pairs.map(([sourceId, targetId], i) => ({
      id: `r${i}`,
      sourceId,
      targetId,
      name: `link ${i}`,
      sourceMultiplicity: "1",
      targetMultiplicity: "0..*",
      sourceAggregation: i === 1 ? "COMPOSITE" : "NONE",
    })),
    generalizations: ["Card", "Cash"].map((id) => ({
      id: `inherits-${id}`,
      specificId: id,
      generalId: "Payment",
    })),
    partitions: [],
  };
  const [view] = prepareViews(model);
  scene = (
    await layoutDiagram(
      view,
      new Map(model.classes.map((c) => [c.id, c])),
      view.edges,
      view.generalizations,
    )
  ).diagram;
});

test("moving an element re-routes its relations around the others and leaves the rest alone", () => {
  const positions = positionsOf(scene);
  positions.Order = [scene.width + 40, 40];
  const moved = arrangeScene(scene, positions);
  assert.deepEqual(node(moved, "Order").x, scene.width + 40);
  assert.deepEqual(moved.offset, { x: 0, y: 0 });
  assert.ok(moved.width >= scene.width + 40 + node(scene, "Order").width);
  for (const edge of moved.edges) {
    const before = scene.edges.find((e) => e.id === edge.id);
    if (edge.source === "Order" || edge.target === "Order") {
      assert.notDeepEqual(edge.paths, before.paths);
      assertRoute(
        moved,
        edge.paths[0],
        node(moved, edge.source),
        node(moved, edge.target),
      );
    } else assert.deepEqual(edge.paths, before.paths);
  }
  // Two ends on one side do not share a point.
  const ends = moved.edges
    .filter((e) => e.target === "Order" || e.source === "Order")
    .map((e) => {
      const p = points(e.paths[0]);
      return JSON.stringify(e.source === "Order" ? p[0] : p.at(-1));
    });
  assert.equal(new Set(ends).size, ends.length);
  // Labels stay off every box and keep their size.
  for (const edge of moved.edges)
    for (const label of edge.labels) {
      const was = scene.edges
        .find((e) => e.id === edge.id)
        .labels.find((l) => l.id === label.id);
      assert.equal(label.width, was.width);
      for (const n of moved.nodes)
        assert.ok(!overlaps(label, n), `${label.id} covers ${n.id}`);
    }
});

test("moving a supertype rebuilds its generalization tree from a junction beside it", () => {
  const positions = positionsOf(scene);
  positions.Payment = [scene.width + 60, scene.height - 120];
  const moved = arrangeScene(scene, positions);
  const group = moved.generalizationGroups[0];
  const payment = node(moved, "Payment");
  const [junction, port] = points(group.paths[0]);
  assert.ok(onSide(payment, port));
  assert.equal(
    Math.abs(junction.x - port.x) + Math.abs(junction.y - port.y),
    28,
  );
  assertRoute(moved, group.paths[0], junction, payment);
  for (const id of group.memberIds) {
    const edge = moved.edges.find((e) => e.id === id);
    assertRoute(moved, edge.branchPaths[0], node(moved, edge.source), junction);
    assert.equal(
      edge.paths[0],
      edge.branchPaths[0] + group.paths[0].replace(/^M\S+ \S+/, ""),
    );
  }
});

test("a self-relation loops round a corner of its moved element", () => {
  const positions = positionsOf(scene);
  positions.Product = [scene.width + 40, 300];
  const moved = arrangeScene(scene, positions);
  const product = node(moved, "Product");
  const loop = moved.edges.find(
    (e) => e.source === "Product" && e.target === "Product",
  );
  assertRoute(moved, loop.paths[0], product, product);
  const p = points(loop.paths[0]);
  assert.equal(p.length, 5);
  for (const q of p)
    assert.ok(
      Math.abs(q.x - product.x - product.width) <= 40 &&
        Math.abs(q.y - product.y) <= 40,
      "the loop stays at the top right corner",
    );
});

test("place puts an element without a position beside its neighbour", () => {
  const positions = positionsOf(scene);
  delete positions.Address;
  const placed = arrangeScene(scene, positions, { place: true });
  const address = node(placed, "Address");
  const customer = node(placed, "Customer");
  for (const n of placed.nodes)
    if (n !== address)
      assert.ok(
        !overlaps(
          {
            x: address.x - 40,
            y: address.y - 40,
            width: address.width + 80,
            height: address.height + 80,
          },
          {
            ...n,
            x: n.x + 0.01,
            y: n.y + 0.01,
            width: n.width - 0.02,
            height: n.height - 0.02,
          },
        ),
        `Address keeps 40px from ${n.id}`,
      );
  const gap = Math.max(
    address.x - (customer.x + customer.width),
    customer.x - (address.x + address.width),
    address.y - (customer.y + customer.height),
    customer.y - (address.y + address.height),
  );
  assert.ok(gap < 120, `Address is ${gap}px from Customer`);
  const edge = placed.edges.find((e) => e.target === "Address");
  assertRoute(placed, edge.paths[0], customer, address);
  assert.equal(arrangeScene(scene, {}, { place: true }), scene);
});

test("an element dragged past the top left shifts the whole scene back inside the padding", () => {
  const positions = positionsOf(scene);
  positions.Card = [-100, -50];
  const moved = arrangeScene(scene, positions);
  const card = node(moved, "Card");
  assert.ok(moved.offset.x >= 128 && moved.offset.y >= 78);
  assert.equal(card.x, -100 + moved.offset.x);
  assert.equal(card.y, -50 + moved.offset.y);
  const lowest = Math.min(
    ...moved.nodes.flatMap((n) => [n.x, n.y]),
    ...moved.edges.flatMap((e) =>
      e.paths.flatMap((d) => points(d).flatMap((q) => [q.x, q.y])),
    ),
  );
  assert.ok(lowest >= 28 - 0.01);
  // Elements that stayed shift with everything else.
  const order = node(scene, "Order");
  assert.equal(node(moved, "Order").x, order.x + moved.offset.x);
});

test("routes keep off each other: relations between the same elements run a track apart, not on one line", () => {
  const box = (id, x, y) => ({
    id,
    name: id,
    x,
    y,
    width: 180,
    height: 70,
    attributes: [],
    methods: [],
  });
  const relation = (id, source, target) => ({
    id,
    type: "association",
    source,
    target,
    paths: [],
    labels: [],
  });
  const scene = {
    nodes: [box("A", 28, 28), box("B", 600, 300), box("C", 28, 400)],
    edges: [
      relation("one", "A", "B"),
      relation("two", "A", "B"),
      relation("three", "C", "B"),
      relation("four", "A", "C"),
    ],
    width: 900,
    height: 600,
  };
  const routed = arrangeScene(scene, {});
  const segments = routed.edges.map((e) => {
    const n = e.paths[0].match(/-?\d+(?:\.\d+)?/g).map(Number);
    const out = [];
    for (let i = 2; i + 1 < n.length; i += 2)
      out.push([n[i - 2], n[i - 1], n[i], n[i + 1]]);
    return out;
  });
  const overlap = ([x1, y1, x2, y2], [u1, v1, u2, v2]) => {
    const along = (a, b, c, d) =>
      Math.min(Math.max(a, b), Math.max(c, d)) -
      Math.max(Math.min(a, b), Math.min(c, d));
    if (y1 === y2 && v1 === v2 && Math.abs(y1 - v1) < 9)
      return along(x1, x2, u1, u2);
    if (x1 === x2 && u1 === u2 && Math.abs(x1 - u1) < 9)
      return along(y1, y2, v1, v2);
    return 0;
  };
  for (let a = 0; a < segments.length; a++)
    for (let b = a + 1; b < segments.length; b++)
      for (const p of segments[a])
        for (const q of segments[b])
          assert(
            overlap(p, q) <= 2,
            `${routed.edges[a].id} and ${routed.edges[b].id} share a line`,
          );
});

test("re-routing every relation of a 40-element diagram stays fast", () => {
  let seed = 7;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const nodes = Array.from({ length: 40 }, (_, i) => ({
    id: `N${i}`,
    x: 28 + (i % 8) * 300,
    y: 28 + Math.floor(i / 8) * 150,
    width: 232,
    height: 74,
  }));
  const label = (id, kind, width) => ({
    id,
    text: "x",
    x: 0,
    y: 0,
    width,
    height: 24,
    kind,
  });
  const edges = Array.from({ length: 60 }, (_, i) => {
    const s = Math.floor(random() * 40);
    const t = (s + 1 + Math.floor(random() * 39)) % 40;
    return {
      id: `E${i}`,
      type: "association",
      source: `N${s}`,
      target: `N${t}`,
      paths: [`M${nodes[s].x} ${nodes[s].y} L${nodes[t].x} ${nodes[s].y}`],
      labels: [
        label(`E${i}-name`, "name", 60),
        label(`E${i}-tail`, "source", 26),
        label(`E${i}-head`, "target", 40),
      ],
    };
  });
  const big = { nodes, edges, width: 2500, height: 800 };
  // Every element moves, so every relation is re-routed.
  const positions = Object.fromEntries(
    nodes.map((n, i) => {
      const from = nodes[(i * 7) % 40];
      return [n.id, [from.x + 20, from.y + 10]];
    }),
  );
  arrangeScene(big, positions);
  const start = performance.now();
  const moved = arrangeScene(big, positions);
  const all = performance.now() - start;
  // Laying every relation out again happens when a diagram opens, not on
  // every move: it only has to stay well within a second.
  assert.ok(all < 1000, `took ${all}ms`);
  for (const edge of moved.edges)
    assertRoute(
      moved,
      edge.paths[0],
      node(moved, edge.source),
      node(moved, edge.target),
    );
  // A drag re-routes only the moved element's relations, quickly while it moves.
  const dragged = positionsOf(moved);
  dragged.N3 = [dragged.N3[0] + 30, dragged.N3[1] + 20];
  const dragStart = performance.now();
  arrangeScene(moved, dragged, { quick: true });
  assert.ok(performance.now() - dragStart < all);
});
