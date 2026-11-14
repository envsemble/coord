const assert = require("node:assert/strict");
const { test } = require("node:test");
const { layoutDiagram } = require("../lib/layout/layoutDiagram.cjs");
const { prepareViews } = require("../lib/layout/prepareViews.cjs");
const { validateDiagram } = require("../lib/layout/validateDiagram.cjs");
const { readability } = require("../lib/layout/readability.cjs");

function modelFixture(pairs) {
  const ids = [...new Set(pairs.flat())];
  return {
    title: "Unrelated graph fixture",
    classes: ids.map((id) => ({
      id,
      name: id,
      stereotype: "kind",
      attributes: [{ name: "value", type: "Text", multiplicity: "1" }],
    })),
    relations: pairs.map(([sourceId, targetId], i) => ({
      id: `edge-${i}`,
      sourceId,
      targetId,
      name: `link ${i}`,
      sourceMultiplicity: i % 2 ? "1..*" : "1",
      targetMultiplicity: "0..*",
      sourceAggregation: i === 0 ? "COMPOSITE" : "NONE",
    })),
    generalizations: [],
    partitions: [],
  };
}

async function draw(model) {
  const [view] = prepareViews(model);
  const rendered = await layoutDiagram(
    view,
    new Map(model.classes.map((c) => [c.id, c])),
    view.edges,
    view.generalizations,
  );
  validateDiagram(rendered.diagram, model);
  return rendered;
}

test("generic compaction shortens links across chains, hubs, cycles and disconnected graphs without changing semantics", async () => {
  const topologies = [
    [
      ["A", "B"],
      ["B", "C"],
      ["C", "D"],
    ],
    [1, 2, 3, 4, 5, 6].map((n) => ["Hub", `Leaf${n}`]),
    [
      ["A", "B"],
      ["A", "C"],
      ["B", "D"],
      ["C", "D"],
      ["D", "E"],
      ["E", "A"],
    ],
    [
      ["A", "B"],
      ["A", "B"],
      ["B", "B"],
      ["C", "D"],
    ],
  ];
  let shortened = 0;
  for (const pairs of topologies) {
    const model = modelFixture(pairs);
    const original = structuredClone(model);
    const { diagram, check } = await draw(model);
    const layout = check.layout,
      baseline = layout.candidates[0];
    assert(layout.score <= baseline.score);
    for (const metric of ["crossings", "overlaps", "labelIntersections"])
      assert(layout[metric] <= baseline[metric], `${metric} regressed`);
    if (layout.length < baseline.length * 0.95) shortened++;
    assert.equal(diagram.edges.length, model.relations.length);
    for (const edge of diagram.edges) {
      const semantic = model.relations.find((r) => r.id === edge.id);
      assert.equal(edge.sourceAggregation, semantic.sourceAggregation);
      assert.equal(edge.source, semantic.sourceId);
      assert.equal(edge.target, semantic.targetId);
    }
    assert(diagram.nodes.every((n) => n.attributes.length === 1));
    assert.deepEqual(model, original);
  }
  assert(
    shortened >= 2,
    "Compaction should make a material improvement on varied graphs",
  );
});

test("layout selection is deterministic and retains distinct parallel routes", async () => {
  const model = modelFixture([
    ["A", "B"],
    ["A", "B"],
    ["B", "C"],
  ]);
  const first = await draw(model),
    second = await draw(model);
  assert.deepEqual(first, second);
  assert.notDeepEqual(
    first.diagram.edges[0].paths,
    first.diagram.edges[1].paths,
  );
});

test("readability measures wire length, bends and ambiguous crossings while allowing joined inheritance bars", () => {
  const edge = (id, points) => ({
    id,
    sections: [
      {
        startPoint: points[0],
        bendPoints: points.slice(1, -1),
        endPoint: points.at(-1),
      },
    ],
    labels: [],
  });
  const graph = {
    width: 100,
    height: 100,
    edges: [
      edge("horizontal", [
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ]),
      edge("vertical", [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ]),
      edge("overlap", [
        { x: 20, y: 50 },
        { x: 80, y: 50 },
      ]),
    ],
  };
  const quality = readability(graph);
  assert.equal(quality.length, 260);
  assert.equal(quality.crossings, 2);
  assert.equal(quality.overlaps, 1);
  assert.equal(quality.bends, 0);
  const joined = readability(graph, [
    { id: "set", branchIds: ["horizontal", "vertical"], trunkId: "overlap" },
  ]);
  assert.equal(joined.crossings, 0);
  assert.equal(joined.overlaps, 0);
  graph.edges[1].labels.push({ x: 10, y: 40, width: 20, height: 20 });
  assert.equal(readability(graph).labelIntersections, 2);
});
