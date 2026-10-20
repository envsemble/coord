const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { transformSync } = require("esbuild");
const { renderSVG } = require("../lib/render/renderSVG.cjs");
const { validateDiagram } = require("../lib/layout/validateDiagram.cjs");

const code = transformSync(
  fs.readFileSync(path.join(__dirname, "../src/canvas/interaction.js"), "utf8"),
  { format: "cjs" },
).code;
const context = vm.createContext({ module: { exports: {} } });
new vm.Script(code).runInContext(context);
const { focusedElements, elementClass } = context.module.exports;
const graph = {
  nodes: ["A", "B", "C", "D"].map((id) => ({ id })),
  edges: [
    { id: "AB", source: "A", target: "B" },
    { id: "AB2", source: "A", target: "B" },
    { id: "BC", source: "B", target: "C" },
    { id: "CD", source: "C", target: "D" },
  ],
};

test("relation focus isolates exactly two ends and one edge, including parallel edges", () => {
  const focus = focusedElements(graph, { kind: "edge", id: "AB" });
  assert.deepEqual([...focus.nodes].sort(), ["A", "B"]);
  assert.deepEqual([...focus.edges], ["AB"]);
});
test("node focus reveals one hop and does not leak into neighbors' other edges", () => {
  const focus = focusedElements(graph, { kind: "node", id: "B" });
  assert.deepEqual([...focus.nodes].sort(), ["A", "B", "C"]);
  assert.deepEqual([...focus.edges].sort(), ["AB", "AB2", "BC"]);
  assert.equal(focusedElements(graph, null), null);
  assert.equal(focusedElements(graph, { kind: "edge", id: "missing" }), null);
});

test("the active entity has a distinct outline state from its connected entities", () => {
  const selected = { kind: "node", id: "B" };
  const focus = focusedElements(graph, selected);
  assert.equal(
    elementClass("node", "B", focus, selected),
    "diagram-element node highlighted primary selected",
  );
  assert.equal(
    elementClass("node", "A", focus, selected),
    "diagram-element node highlighted",
  );
  const hover = focusedElements(graph, { kind: "node", id: "A" });
  assert.match(elementClass("node", "A", hover, selected), /primary/);
  assert(!elementClass("node", "B", hover, selected).includes("primary"));
  const relation = focusedElements(graph, { kind: "edge", id: "AB" });
  assert(!elementClass("node", "A", relation, selected).includes("primary"));
  assert(!elementClass("node", "B", relation, selected).includes("primary"));
});

function diagramFixture() {
  return {
    key: "example",
    title: "Example",
    fields: false,
    width: 420,
    height: 100,
    initialFocus: [],
    nodes: [
      {
        id: "A",
        name: "Order",
        stereotype: "",
        x: 10,
        y: 10,
        width: 100,
        height: 70,
        attributes: [],
      },
      {
        id: "B",
        name: "Item <Draft>",
        stereotype: "kind",
        x: 300,
        y: 10,
        width: 100,
        height: 70,
        attributes: [],
      },
    ],
    edges: [
      {
        id: "contains",
        type: "association",
        source: "A",
        target: "B",
        sourceName: "Order",
        targetName: "Item <Draft>",
        name: "contains",
        stereotype: "",
        sourceMultiplicity: "1",
        targetMultiplicity: "0..*",
        paths: ["M110 50 L300 50"],
        labels: [
          {
            id: "source",
            kind: "source",
            nodeId: "A",
            text: "1",
            x: 120,
            y: 19,
            width: 26,
            height: 24,
          },
          {
            id: "target",
            kind: "target",
            nodeId: "B",
            text: "0..*",
            x: 246,
            y: 19,
            width: 44,
            height: 24,
          },
        ],
      },
    ],
  };
}
test("reusable UML renderer supports another domain and safely renders plain labels", () => {
  const diagram = diagramFixture();
  assert.equal(validateDiagram(diagram).multiplicityLabels, 2);
  const svg = renderSVG(diagram);
  assert(svg.includes('data-node-id="B"'));
  assert(svg.includes("Item &lt;Draft&gt;"));
  assert(
    !svg.includes("«»"),
    "Plain UML classes should not get an empty stereotype",
  );
  assert.equal((svg.match(/class="multiplicity"/g) || []).length, 2);
});
test("endpoint validation rejects switched multiplicities and wrong physical attachment", () => {
  const diagram = diagramFixture();
  diagram.edges[0].labels[0].nodeId = "B";
  assert.throws(() => validateDiagram(diagram), /wrong endpoint/);
  diagram.edges[0].labels[0].nodeId = "A";
  diagram.edges[0].paths = ["M300 50 L110 50"];
  assert.throws(() => validateDiagram(diagram), /starts at wrong entity/);
});
test("same-named entities have unique SVG identities, and abstract classes use UML italics", () => {
  const diagram = diagramFixture();
  for (const node of diagram.nodes) {
    node.name = "Shared name";
    node.isAbstract = true;
  }
  diagram.edges[0].sourceAggregation = "COMPOSITE";
  const svg = renderSVG(diagram);
  assert(svg.includes('id="node-A"') && svg.includes('id="node-B"'));
  assert.equal((svg.match(/font-style="italic"/g) || []).length, 2);
  assert.match(svg, /marker-start="url\(#[^"]+-COMPOSITE\)"/);
});
test("every class has the one neutral look, whatever its stereotype", () => {
  const diagram = diagramFixture();
  diagram.nodes[0].stereotype = "type alias";
  diagram.nodes[1].stereotype = "interface";
  const svg = renderSVG(diagram);
  assert(svg.includes("«type alias»"));
  assert.equal(
    svg.match(/class="node-box"[^>]*fill="var\(--surface,#f6f8fa\)"/g).length,
    diagram.nodes.length,
  );
  assert(!/var\(--(?:node|type)-/.test(svg));
});
