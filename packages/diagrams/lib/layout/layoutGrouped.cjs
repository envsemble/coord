// A diagram laid out in its groups (see groups.cjs), as people draw one: each
// group laid out compactly on its own, as a small diagram, the groups packed
// beside each other with room between them, the more related ones nearer,
// and the relations between groups routed around everything as the longer
// lines. A package's group is drawn as a quiet region with its name.
const ELK = require("elkjs");
const elk = new ELK();

/** The room between two groups, on top of each one's own padding. */
const GROUP_GAP = 96;
/** The room round a package's elements, and its name's above them (as arrange.mjs keeps it). */
const PACKAGE_MARGIN = 16;
/** The room a package's name takes above its elements. */
const PACKAGE_HEADER = 22;
/** How wide than tall the packed groups aim to be. */
const ASPECT = 1.6;

const round = (n) => Number(n.toFixed(2));
const shiftPath = (d, dx, dy) =>
  d.replace(
    /(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g,
    (_, x, y) => `${round(Number(x) + dx)} ${round(Number(y) + dy)}`,
  );
const shiftLabel = (l, dx, dy) => ({
  ...l,
  x: round(l.x + dx),
  y: round(l.y + dy),
});

/**
 * The groups in the order they are packed: the most related first, then
 * each next the one most related to those already placed, so related groups
 * end up side by side.
 */
function packingOrder(count, ties) {
  const weight = (a, b) => ties.get(a < b ? `${a} ${b}` : `${b} ${a}`) || 0;
  const total = (a) =>
    Array.from({ length: count }, (_, b) =>
      a === b ? 0 : weight(a, b),
    ).reduce((sum, w) => sum + w, 0);
  const left = new Set(Array.from({ length: count }, (_, i) => i));
  const order = [];
  while (left.size) {
    let best = null,
      score = -1;
    for (const g of left) {
      const s = order.length
        ? order.reduce((sum, p) => sum + weight(g, p), 0) * 1000 + total(g)
        : total(g);
      if (s > score) {
        best = g;
        score = s;
      }
    }
    order.push(best);
    left.delete(best);
  }
  return order;
}

/**
 * Lays out a view in `clusters`, with `layoutFlat` (the layout of one
 * group) and `route` (the router that draws the relations between groups;
 * arrange.mjs's arrangeScene). `edgeLabels(edge)` gives a relation's labels as
 * the flat layout sizes them.
 */
async function layoutGrouped(
  view,
  classes,
  relations,
  generalizations,
  clusters,
  { layoutFlat, route, edgeLabels },
) {
  const clusterOf = new Map();
  clusters.forEach((c, i) => c.members.forEach((id) => clusterOf.set(id, i)));
  // The elements outside every package are one group of their own, laid out
  // together as a small diagram of their relations.
  const all = [...clusters];
  const loose = view.names.filter((id) => !clusterOf.has(id));
  if (loose.length) {
    for (const id of loose) clusterOf.set(id, all.length);
    all.push({ id: `group-${all.length}`, name: null, members: loose });
  }
  const within = (a, b) => clusterOf.get(a) === clusterOf.get(b);
  const ends = (g) => [g.specificId, g.generalId];
  // Each group as a small diagram of its own relations.
  const parts = [];
  for (const cluster of all) {
    const members = new Set(cluster.members);
    const sub = {
      ...view,
      names: cluster.members,
      nodeIds: cluster.members,
      columns: view.columns
        .map((column) => column.filter((id) => members.has(id)))
        .filter((column) => column.length),
      focusNames: view.focusNames.filter((id) => members.has(id)),
    };
    const own = relations.filter(
      (r) => members.has(r.sourceId) && members.has(r.targetId),
    );
    const ownGeneralizations = generalizations.filter((g) =>
      ends(g).every((id) => members.has(id)),
    );
    const { diagram, check } = await layoutFlat(
      sub,
      classes,
      own,
      ownGeneralizations,
    );
    parts.push({ cluster, diagram, check });
  }
  // How strongly the groups relate, for packing related ones together.
  const ties = new Map();
  const tie = (a, b, w) => {
    const [x, y] = [clusterOf.get(a), clusterOf.get(b)].sort((p, q) => p - q);
    if (x === y) return;
    ties.set(`${x} ${y}`, (ties.get(`${x} ${y}`) || 0) + w);
  };
  for (const r of relations) tie(r.sourceId, r.targetId, 1);
  for (const g of generalizations) tie(g.specificId, g.generalId, 2);
  const order = packingOrder(parts.length, ties);
  const header = (part) => (part.cluster.name ? PACKAGE_HEADER : 0);
  const packed = await elk.layout({
    id: "groups",
    layoutOptions: {
      "elk.algorithm": "rectpacking",
      "elk.aspectRatio": String(ASPECT),
      "elk.spacing.nodeNode": String(GROUP_GAP),
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
      "elk.rectpacking.trybox": "false",
    },
    children: order.map((i) => ({
      id: String(i),
      width: parts[i].diagram.width,
      height: parts[i].diagram.height + header(parts[i]),
      layoutOptions: {
        "elk.priority": String(parts.length - order.indexOf(i)),
      },
    })),
  });
  const at = new Map(packed.children.map((c) => [Number(c.id), c]));
  // Each group's elements, relations and trees moved to its place.
  const nodes = [],
    edges = [],
    trees = [],
    packages = [];
  parts.forEach((part, i) => {
    const box = at.get(i);
    const dx = box.x,
      dy = box.y + header(part);
    const d = part.diagram;
    for (const n of d.nodes)
      nodes.push({ ...n, x: round(n.x + dx), y: round(n.y + dy) });
    for (const e of d.edges)
      edges.push({
        ...e,
        paths: e.paths.map((p) => shiftPath(p, dx, dy)),
        ...(e.branchPaths
          ? { branchPaths: e.branchPaths.map((p) => shiftPath(p, dx, dy)) }
          : {}),
        labels: e.labels.map((l) => shiftLabel(l, dx, dy)),
      });
    for (const g of d.generalizationGroups || [])
      trees.push({
        ...g,
        paths: g.paths.map((p) => shiftPath(p, dx, dy)),
        labels: (g.labels || []).map((l) => shiftLabel(l, dx, dy)),
      });
    // The region sits inside the group's padding, round its elements.
    if (part.cluster.name) {
      const own = d.nodes;
      const x0 = Math.min(...own.map((n) => n.x)) - PACKAGE_MARGIN,
        y0 = Math.min(...own.map((n) => n.y)) - PACKAGE_MARGIN - PACKAGE_HEADER,
        x1 = Math.max(...own.map((n) => n.x + n.width)) + PACKAGE_MARGIN,
        y1 = Math.max(...own.map((n) => n.y + n.height)) + PACKAGE_MARGIN;
      packages.push({
        name: part.cluster.name,
        members: part.cluster.members,
        x: round(x0 + dx),
        y: round(y0 + dy),
        width: round(x1 - x0),
        height: round(y1 - y0),
      });
    }
  });
  // The relations between groups, routed around every element.
  for (const r of relations)
    if (!within(r.sourceId, r.targetId))
      edges.push(betweenGroups(r, classes, edgeLabels, false));
  for (const g of generalizations)
    if (!within(g.specificId, g.generalId))
      edges.push(
        betweenGroups(
          {
            ...g,
            id: g.id || `generalization-${g.specificId}-${g.generalId}`,
            sourceId: g.specificId,
            targetId: g.generalId,
          },
          classes,
          edgeLabels,
          true,
        ),
      );
  const width = Math.max(...packed.children.map((c) => c.x + c.width));
  const height = Math.max(...packed.children.map((c) => c.y + c.height));
  const composed = {
    key: view.key,
    title: view.title,
    width: round(width),
    height: round(height),
    initialFocus: view.focusNames.map((name) => classes.get(name).id),
    ...(packages.length ? { packages } : {}),
    nodes,
    generalizationGroups: trees,
    edges,
  };
  const diagram = route(composed, {});
  // The router shifts the packages with everything else when it must.
  delete diagram.offset;
  const check = {
    nodes: view.names.length,
    edges: relations.length + generalizations.length,
    generalizationGroups: trees.length,
    groups: all.length,
    width: diagram.width,
    height: diagram.height,
    layout: { groups: parts.map((p) => p.check.layout) },
  };
  return { diagram, check };
}

/** A relation between two groups, as the scene holds it, still to be routed. */
function betweenGroups(data, classes, edgeLabels, generalization) {
  const source = classes.get(data.sourceId),
    target = classes.get(data.targetId);
  return {
    id: data.id,
    type: generalization ? "generalization" : "association",
    realization: data.realization,
    source: source.id,
    target: target.id,
    sourceName: source.name,
    targetName: target.name,
    name: data.name || "Generalization",
    stereotype: data.stereotype || "",
    sourceMultiplicity: data.sourceMultiplicity,
    sourceAggregation: data.sourceAggregation,
    targetAggregation: data.targetAggregation,
    targetMultiplicity: data.targetMultiplicity,
    ...(data.navigable ? { navigable: true } : {}),
    paths: [],
    labels: generalization
      ? []
      : edgeLabels(data).map((l) => ({
          id: l.id,
          text: l.text,
          x: 0,
          y: 0,
          width: l.width,
          height: l.height,
          kind: l.id.endsWith("-tail")
            ? "source"
            : l.id.endsWith("-head")
              ? "target"
              : "name",
          ...(l.id.endsWith("-tail")
            ? { nodeId: source.id }
            : l.id.endsWith("-head")
              ? { nodeId: target.id }
              : {}),
        })),
  };
}

module.exports = { layoutGrouped };
