const epsilon = 0.02;
const between = (n, a, b) =>
  n > Math.min(a, b) + epsilon && n < Math.max(a, b) - epsilon;

function routePoints(edge) {
  return edge.sections.flatMap((s) => [
    s.startPoint,
    ...(s.bendPoints || []),
    s.endPoint,
  ]);
}

function segments(edge) {
  const result = [];
  for (const section of edge.sections) {
    const points = routePoints({ sections: [section] });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < epsilon) continue;
      result.push({ a, b, horizontal: Math.abs(a.y - b.y) < epsilon });
    }
  }
  return result;
}

// Measure geometry, never domain names or stereotypes. Intentional shared
// inheritance bars are exempt; independent associations remain distinct.
function readability(graph, groups = []) {
  const shared = new Map();
  for (const group of groups)
    for (const id of [...group.branchIds, group.trunkId])
      shared.set(id, group.id);
  const routes = graph.edges.map((edge) => ({
    edge,
    segments: segments(edge),
  }));
  let crossings = 0,
    overlaps = 0,
    labelIntersections = 0,
    bends = 0,
    length = 0;
  for (const route of routes) {
    for (let i = 0; i < route.segments.length; i++) {
      const s = route.segments[i];
      length += Math.abs(s.a.x - s.b.x) + Math.abs(s.a.y - s.b.y);
      if (i && s.horizontal !== route.segments[i - 1].horizontal) bends++;
    }
  }
  for (let i = 0; i < routes.length; i++)
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i],
        b = routes[j];
      if (
        shared.has(a.edge.id) &&
        shared.get(a.edge.id) === shared.get(b.edge.id)
      )
        continue;
      const intersections = new Set();
      for (const s of a.segments)
        for (const t of b.segments) {
          if (s.horizontal !== t.horizontal) {
            const h = s.horizontal ? s : t,
              v = s.horizontal ? t : s;
            if (between(v.a.x, h.a.x, h.b.x) && between(h.a.y, v.a.y, v.b.y))
              intersections.add(`${v.a.x.toFixed(2)},${h.a.y.toFixed(2)}`);
          } else {
            const axis = s.horizontal ? "x" : "y",
              fixed = s.horizontal ? "y" : "x";
            if (
              Math.abs(s.a[fixed] - t.a[fixed]) < epsilon &&
              Math.min(
                Math.max(s.a[axis], s.b[axis]),
                Math.max(t.a[axis], t.b[axis]),
              ) -
                Math.max(
                  Math.min(s.a[axis], s.b[axis]),
                  Math.min(t.a[axis], t.b[axis]),
                ) >
                epsilon
            )
              overlaps++;
          }
        }
      crossings += intersections.size;
    }
  for (const { edge, segments: path } of routes)
    for (const other of graph.edges) {
      if (
        edge.id === other.id ||
        (shared.has(edge.id) && shared.get(edge.id) === shared.get(other.id))
      )
        continue;
      for (const label of other.labels || [])
        if (
          path.some(({ a, b, horizontal }) =>
            horizontal
              ? between(a.y, label.y, label.y + label.height) &&
                Math.max(a.x, b.x) > label.x + epsilon &&
                Math.min(a.x, b.x) < label.x + label.width - epsilon
              : between(a.x, label.x, label.x + label.width) &&
                Math.max(a.y, b.y) > label.y + epsilon &&
                Math.min(a.y, b.y) < label.y + label.height - epsilon,
          )
        )
          labelIntersections++;
    }
  const area = graph.width * graph.height;
  // Minimize wire length first, with smaller penalties for bends and crossings.
  // Ambiguous shared paths and obscured labels carry a stronger penalty.
  const score =
    overlaps * 2400 +
    labelIntersections * 1600 +
    crossings * 120 +
    bends * 24 +
    length +
    area / 4000;
  return {
    crossings,
    overlaps,
    labelIntersections,
    bends,
    length: +length.toFixed(2),
    area: +area.toFixed(2),
    score: +score.toFixed(2),
  };
}

module.exports = { readability, routePoints };
