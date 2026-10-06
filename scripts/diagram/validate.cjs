const assert = require("node:assert/strict");

function onBoundary(point, node) {
  const [x, y] = point;
  const epsilon = 0.03;
  return (
    x >= node.x - epsilon &&
    x <= node.x + node.width + epsilon &&
    y >= node.y - epsilon &&
    y <= node.y + node.height + epsilon &&
    (Math.abs(x - node.x) < epsilon ||
      Math.abs(x - node.x - node.width) < epsilon ||
      Math.abs(y - node.y) < epsilon ||
      Math.abs(y - node.y - node.height) < epsilon)
  );
}

function validateDiagram(diagram, model) {
  const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
  const associations = new Map(
    (model?.relations || []).map((edge) => [edge.id, edge]),
  );
  const generalizations = new Map(
    (model?.generalizations || []).map((edge) => [edge.id, edge]),
  );
  assert.equal(nodes.size, diagram.nodes.length, "Duplicate node identity");
  assert.equal(
    new Set(diagram.edges.map((edge) => edge.id)).size,
    diagram.edges.length,
    "Duplicate edge identity",
  );
  let multiplicityLabels = 0,
    maxMultiplicityDistance = 0;
  for (const edge of diagram.edges) {
    const source = nodes.get(edge.source),
      target = nodes.get(edge.target);
    assert(source && target, `Unknown endpoint: ${edge.id}`);
    const routes = edge.paths.map((path) =>
      path.match(/-?\d+(?:\.\d+)?/g).map(Number),
    );
    for (const route of routes) {
      assert(
        route.length >= 4 && route.length % 2 === 0,
        `Invalid route: ${edge.id}`,
      );
      for (let i = 2; i < route.length; i += 2)
        assert(
          Math.abs(route[i] - route[i - 2]) < 0.02 ||
            Math.abs(route[i + 1] - route[i - 1]) < 0.02,
          `Diagonal route: ${edge.id}`,
        );
    }
    const sourcePoint = routes[0].slice(0, 2),
      targetPoint = routes.at(-1).slice(-2);
    assert(
      onBoundary(sourcePoint, source),
      `Route starts at wrong entity: ${edge.id}`,
    );
    assert(
      onBoundary(targetPoint, target),
      `Route ends at wrong entity: ${edge.id}`,
    );
    if (edge.type === "generalization") {
      assert.equal(
        edge.labels.length,
        0,
        "Inheritance does not have association multiplicities",
      );
      if (model) {
        const semantic = generalizations.get(edge.id);
        assert(semantic, `Unknown generalization: ${edge.id}`);
        assert.equal(source.name, semantic.child);
        assert.equal(target.name, semantic.parent);
      }
      continue;
    }
    assert.equal(edge.type, "association");
    if (model) {
      const semantic = associations.get(edge.id);
      assert(semantic, `Unknown association: ${edge.id}`);
      assert.equal(source.name, semantic.a);
      assert.equal(target.name, semantic.b);
      assert.equal(edge.sourceMultiplicity, semantic.ac);
      assert.equal(edge.targetMultiplicity, semantic.bc);
    }
    const ends = edge.labels.filter((label) => label.kind !== "name");
    assert.equal(
      ends.length,
      2,
      `Association must have two counts: ${edge.id}`,
    );
    for (const [kind, node, value, point] of [
      ["source", source, edge.sourceMultiplicity, sourcePoint],
      ["target", target, edge.targetMultiplicity, targetPoint],
    ]) {
      const labels = ends.filter((label) => label.kind === kind);
      assert.equal(
        labels.length,
        1,
        `Missing/duplicate ${kind} count: ${edge.id}`,
      );
      const label = labels[0];
      assert.equal(label.nodeId, node.id, "Count belongs to wrong endpoint");
      assert.equal(label.text, value, "Count differs from model multiplicity");
      assert(
        label.height >= 24 && label.width >= 26,
        "Count label is too small",
      );
      const distance =
        Math.abs(label.x + label.width / 2 - point[0]) +
        Math.abs(label.y + label.height / 2 - point[1]);
      assert(distance <= 80, `Count is too far from its endpoint: ${edge.id}`);
      maxMultiplicityDistance = Math.max(maxMultiplicityDistance, distance);
      multiplicityLabels++;
    }
  }
  return { multiplicityLabels, maxMultiplicityDistance };
}

module.exports = { validateDiagram };
