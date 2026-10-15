const assert = require("node:assert/strict");
const { knownMultiplicity } = require("./multiplicity.cjs");
const coordinates = (path) =>
  (path.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

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
  const groups = diagram.generalizationGroups || [];
  const edgeIds = new Map(diagram.edges.map((edge) => [edge.id, edge]));
  assert.equal(
    new Set(groups.map((g) => g.id)).size,
    groups.length,
    "Duplicate inheritance group identity",
  );
  for (const group of groups) {
    assert(
      ["generalizationSet", "generalizationJoin"].includes(group.type),
      "Unknown inheritance group type",
    );
    assert.equal(
      group.paths.length,
      1,
      "Inheritance group must have one shared arrow",
    );
    const trunk = coordinates(group.paths[0]);
    assert(
      trunk.length >= 4 && trunk.length % 2 === 0,
      "Invalid shared inheritance route",
    );
    assert(
      nodes.has(group.target) &&
        onBoundary(trunk.slice(-2), nodes.get(group.target)),
      "Shared arrow points to the wrong supertype",
    );
    assert(
      group.memberIds.length > 0 &&
        new Set(group.memberIds).size === group.memberIds.length,
      `Invalid inheritance group: ${group.id}`,
    );
    assert.equal(group.sourceIds.length, group.memberIds.length);
    for (const [i, id] of group.memberIds.entries()) {
      const edge = edgeIds.get(id);
      assert(
        edge?.type === "generalization",
        `Unknown grouped inheritance: ${id}`,
      );
      assert.equal(edge.source, group.sourceIds[i]);
      assert.equal(
        edge.target,
        group.target,
        "Grouped inheritances must share a supertype",
      );
      assert(
        edge.branchPaths?.length,
        "Grouped inheritance is missing its branch",
      );
      assert(
        edge.branchPaths.some((path) => {
          const branch = coordinates(path);
          if (
            Math.abs(branch.at(-2) - trunk[0]) > 0.02 ||
            Math.abs(branch.at(-1) - trunk[1]) > 0.02
          )
            return false;
          const joined = [...branch, ...trunk.slice(2)];
          return edge.paths.some((path) => {
            const full = coordinates(path);
            return (
              full.length === joined.length &&
              full.every((n, i) => Math.abs(n - joined[i]) < 0.02)
            );
          });
        }),
        "Shared trunk and subtype branch are disconnected",
      );
    }
    assert(
      group.labels.every((l) => l.kind === "name"),
      "Generalization set labels are not counts",
    );
    if (model && group.type === "generalizationSet") {
      const set = (model.partitions || []).find((s) => s.id === group.id);
      assert(set, `Unknown generalization set: ${group.id}`);
      assert.equal(group.complete, set.complete);
      assert.equal(group.disjoint, set.disjoint);
      assert.equal(group.totalMembers, set.generalizations.length);
      assert(
        group.memberIds.every((id) => set.generalizations.includes(id)),
        "Generalization set membership differs from the model",
      );
    }
  }
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
      assert(
        onBoundary(route.slice(0, 2), source),
        `Route starts at wrong entity: ${edge.id}`,
      );
      assert(
        onBoundary(route.slice(-2), target),
        `Route ends at wrong entity: ${edge.id}`,
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
        assert.equal(source.id, semantic.specificId);
        assert.equal(target.id, semantic.generalId);
      }
      continue;
    }
    assert.equal(edge.type, "association");
    if (model) {
      const semantic = associations.get(edge.id);
      assert(semantic, `Unknown association: ${edge.id}`);
      assert.equal(source.id, semantic.sourceId);
      assert.equal(target.id, semantic.targetId);
      assert.equal(edge.sourceMultiplicity, semantic.sourceMultiplicity);
      assert.equal(edge.targetMultiplicity, semantic.targetMultiplicity);
    }
    const ends = edge.labels.filter((label) => label.kind !== "name");
    // Unknown counts ("?", as captures record them) are not drawn.
    const counted = [
      ["source", source, edge.sourceMultiplicity, sourcePoint],
      ["target", target, edge.targetMultiplicity, targetPoint],
    ].filter(([, , value]) => knownMultiplicity(value));
    assert.equal(
      ends.length,
      counted.length,
      `Association must label each known count: ${edge.id}`,
    );
    for (const [kind, node, value, point] of counted) {
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
  return {
    multiplicityLabels,
    maxMultiplicityDistance,
    generalizationGroups: groups.length,
  };
}

module.exports = { validateDiagram };
