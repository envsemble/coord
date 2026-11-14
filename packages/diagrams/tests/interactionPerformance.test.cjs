const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { buildSync } = require("esbuild");

function load(name) {
  const code = buildSync({
    entryPoints: [path.join(__dirname, "../src", name)],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
  }).outputFiles[0].text;
  const module = { exports: {} };
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}
const { focusedElements, interactionIndex } = load("canvas/interaction.js");
const { createHighlightController } = load("canvas/highlight.js");
const { createZoomStore } = load("viewer/zoomStore.js");

function graph(count = 1000) {
  return {
    nodes: Array.from({ length: count }, (_, i) => ({ id: `N${i}` })),
    edges: Array.from({ length: count - 1 }, (_, i) => ({
      id: `E${i}`,
      source: `N${i}`,
      target: `N${i + 1}`,
    })),
    generalizationGroups: [],
  };
}

test("focus queries reuse adjacency and read only the incident edges", () => {
  const scene = graph();
  let reads = 0;
  for (const edge of scene.edges) {
    const { source, target } = edge;
    Object.defineProperties(edge, {
      source: {
        get() {
          reads++;
          return source;
        },
      },
      target: {
        get() {
          reads++;
          return target;
        },
      },
    });
  }
  const index = interactionIndex(scene);
  reads = 0;
  const focus = focusedElements(scene, { kind: "node", id: "N500" });
  assert.deepEqual([...focus.nodes].sort(), ["N499", "N500", "N501"]);
  assert.deepEqual([...focus.edges].sort(), ["E499", "E500"]);
  assert(reads <= 4, "a hover must not scan the entire graph");
  assert.equal(interactionIndex(scene), index);
  const revised = {
    ...scene,
    edges: [{ id: "replacement", source: "N500", target: "N900" }],
  };
  assert.deepEqual(
    [...focusedElements(revised, { kind: "node", id: "N500" }).nodes].sort(),
    ["N500", "N900"],
  );
});

function dom(scene) {
  const counts = { queries: 0, writes: 0 };
  const makeElement = (kind, id, accessible = true, marker) => {
    const classes = new Set();
    const attributes = new Map(
      accessible
        ? [
            ["role", "button"],
            ["aria-pressed", "false"],
          ]
        : [],
    );
    const paths = marker
      ? [
          {
            attributes: new Map([["marker-end", marker]]),
            getAttribute(name) {
              return this.attributes.get(name) ?? null;
            },
            setAttribute(name, value) {
              counts.writes++;
              this.attributes.set(name, value);
            },
          },
        ]
      : [];
    return {
      dataset: { elementKind: kind, elementId: id },
      classes,
      attributes,
      paths,
      classList: {
        contains: (name) => classes.has(name),
        remove(name) {
          if (classes.delete(name)) counts.writes++;
        },
        toggle(name, value) {
          if (classes.has(name) === value) return value;
          counts.writes++;
          if (value) classes.add(name);
          else classes.delete(name);
          return value;
        },
      },
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute(name, value) {
        counts.writes++;
        attributes.set(name, value);
      },
      querySelectorAll() {
        counts.queries++;
        return paths;
      },
    };
  };
  const elements = [
    ...scene.nodes.map((n) => makeElement("node", n.id)),
    ...scene.edges.flatMap((e) => [
      makeElement("edge", e.id, true, e.marker),
      makeElement("edge", e.id, false),
    ]),
    ...scene.generalizationGroups.flatMap((g) => [
      makeElement("group", g.id, true, "url(#inheritance)"),
      makeElement("group", g.id, false),
    ]),
  ];
  const svg = makeElement("svg", "root");
  svg.querySelectorAll = () => {
    counts.queries++;
    return elements;
  };
  const controller = createHighlightController(svg, scene);
  counts.queries = counts.writes = 0;
  return {
    svg,
    elements,
    counts,
    controller,
    find: (kind, id) =>
      elements.filter(
        (el) => el.dataset.elementKind === kind && el.dataset.elementId === id,
      ),
  };
}

test("large-scene hover changes touch only the old/new neighborhoods and never query the DOM again", () => {
  const scene = graph();
  const h = dom(scene);
  h.controller.update(
    { kind: "node", id: "N500" },
    { kind: "node", id: "N500" },
  );
  assert(h.svg.classes.has("has-focus"));
  assert.equal(h.find("node", "N500")[0].getAttribute("aria-pressed"), "true");
  h.counts.writes = 0;
  h.controller.update(
    { kind: "node", id: "N700" },
    { kind: "node", id: "N500" },
  );
  assert.equal(h.counts.queries, 0);
  assert(
    h.counts.writes < 30,
    `local focus produced ${h.counts.writes} writes`,
  );
  assert(h.find("node", "N700")[0].classes.has("primary"));
  assert(!h.find("node", "N500")[0].classes.has("primary"));
  assert(h.find("node", "N500")[0].classes.has("selected"));
  h.counts.writes = 0;
  h.controller.update(
    { kind: "node", id: "N700" },
    { kind: "node", id: "N500" },
  );
  assert.equal(h.counts.writes, 0, "duplicate targets must do no DOM work");
  h.controller.update(null, null);
  assert(!h.svg.classes.has("has-focus"));
  assert(
    h.elements.every(
      (el) =>
        !el.classes.has("highlighted") &&
        !el.classes.has("selected") &&
        !el.classes.has("primary"),
    ),
  );
});

test("relation/group focus keeps exact ends, parallel edges, inherited markers and accessibility consistent", () => {
  const scene = {
    nodes: ["A", "B", "C", "D"].map((id) => ({ id })),
    edges: [
      {
        id: "AB",
        source: "A",
        target: "B",
        marker: "url(#inheritance-COMPOSITE)",
      },
      { id: "AB2", source: "A", target: "B" },
      { id: "CB", source: "C", target: "B", marker: "url(#inheritance)" },
    ],
    generalizationGroups: [
      { id: "G", target: "B", sourceIds: ["A", "C"], memberIds: ["AB", "CB"] },
    ],
  };
  const h = dom(scene);
  h.controller.update({ kind: "edge", id: "AB" }, { kind: "edge", id: "AB" });
  assert.deepEqual(
    h.elements
      .filter(
        (el) =>
          el.dataset.elementKind === "node" && el.classes.has("highlighted"),
      )
      .map((el) => el.dataset.elementId),
    ["A", "B"],
  );
  assert(
    h
      .find("edge", "AB")
      .every((el) => el.classes.has("primary") && el.classes.has("selected")),
  );
  assert(h.find("edge", "AB2").every((el) => !el.classes.has("highlighted")));
  assert(h.find("group", "G").every((el) => el.classes.has("highlighted")));
  assert.equal(
    h.find("edge", "AB")[0].paths[0].getAttribute("marker-end"),
    "url(#inheritance-COMPOSITE-primary)",
  );
  h.controller.update({ kind: "group", id: "G" }, null);
  assert(h.find("node", "C")[0].classes.has("highlighted"));
  assert(h.find("group", "G").every((el) => el.classes.has("primary")));
  assert.equal(
    h.find("edge", "CB")[0].paths[0].getAttribute("marker-end"),
    "url(#inheritance-active)",
  );
  assert.equal(
    h.find("edge", "AB")[0].paths[0].getAttribute("marker-end"),
    "url(#inheritance-COMPOSITE-active)",
    "a relation returns to connected styling when the set becomes primary",
  );
  assert.equal(
    h.find("group", "G")[0].paths[0].getAttribute("marker-end"),
    "url(#inheritance-primary)",
  );
  // A cached SVG may be reattached while its shared arrow is still primary.
  createHighlightController(h.svg, scene).update(null, null);
  assert.equal(
    h.find("edge", "AB")[0].paths[0].getAttribute("marker-end"),
    "url(#inheritance-COMPOSITE)",
  );
  assert.equal(h.find("edge", "AB")[0].getAttribute("aria-pressed"), "false");
  assert(!h.find("group", "G")[0].classes.has("highlighted"));
  assert.equal(
    h.find("group", "G")[0].paths[0].getAttribute("marker-end"),
    "url(#inheritance)",
  );
});

test("reattaching to cached geometry clears stale focus and selection state", () => {
  const scene = graph(4);
  const h = dom(scene);
  h.controller.update({ kind: "node", id: "N1" }, { kind: "node", id: "N1" });
  const reattached = createHighlightController(h.svg, scene);
  reattached.update(null, { kind: "node", id: "N3" });
  assert(!h.svg.classes.has("has-focus"));
  assert.equal(h.find("node", "N1")[0].getAttribute("aria-pressed"), "false");
  assert.equal(h.find("node", "N3")[0].getAttribute("aria-pressed"), "true");
  assert(
    h.elements.every(
      (el) => !el.classes.has("highlighted") && !el.classes.has("primary"),
    ),
  );
});

test("zoom readout subscriptions deduplicate values and stop after unmount", () => {
  const store = createZoomStore();
  const observed = [];
  const unsubscribe = store.subscribe(() => observed.push(store.getSnapshot()));
  for (const value of [100, 101, 101, 102, 102, 100]) store.set(value);
  assert.deepEqual(observed, [101, 102, 100]);
  unsubscribe();
  store.set(50);
  assert.deepEqual(observed, [101, 102, 100]);
  assert.equal(store.getSnapshot(), 50);
});
