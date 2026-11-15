const ELK = require("elkjs");
const elk = new ELK();
const { readability } = require("./readability.cjs");
const {
  generalizationGroups,
  groupLabel,
} = require("./generalizationGroups.cjs");
const { knownMultiplicity } = require("./multiplicity.cjs");
const { layoutGroups } = require("./groups.cjs");
const { layoutGrouped } = require("./layoutGrouped.cjs");
const round = (n) => Number(n.toFixed(2));
// Names that only repeat what a relation is: every captured type-use
// dependency has the first, and some relations are named only the second.
// Repeated on each edge they say nothing the line does not.
const GENERIC_NAMES = new Set(["declared type use", "association"]);
/**
 * The relation's name label, or null when it would carry no information. A
 * stereotype is not drawn: the line's style shows a dependency, and diagrams
 * stay plain.
 */
function relationLabel(relation) {
  const name =
    typeof relation.name === "string" &&
    !GENERIC_NAMES.has(relation.name.trim().toLowerCase())
      ? relation.name.trim()
      : "";
  return name || null;
}
/** The box a label's text needs: a count at a relation's end, or a name. */
function labelSize(text, end) {
  const lines = text.split("\n");
  return {
    width: Math.max(
      end ? 26 : 0,
      Math.max(...lines.map((t) => t.length)) * (end ? 7.5 : 7) + 14,
    ),
    height: end ? 24 : lines.length * 17 + 8,
  };
}
function label(id, text, placement = "CENTER") {
  return {
    id,
    text,
    ...labelSize(text, placement !== "CENTER"),
    layoutOptions: { "elk.edgeLabels.placement": placement },
  };
}
function points(edge) {
  return edge.sections.flatMap((s) => [
    s.startPoint,
    ...(s.bendPoints || []),
    s.endPoint,
  ]);
}
function overlapping(a, b, pad = 0) {
  return (
    a.x < b.x + b.width - pad &&
    a.x + a.width > b.x + pad &&
    a.y < b.y + b.height - pad &&
    a.y + a.height > b.y + pad
  );
}
function placeEndLabels(graph) {
  const occupied = [
    ...graph.children,
    ...graph.edges.flatMap((e) =>
      (e.labels || []).filter((l) => l.id.endsWith("-name")),
    ),
  ];
  for (const e of graph.edges)
    for (const l of (e.labels || []).filter((l) => !l.id.endsWith("-name"))) {
      let p = points(e);
      if (l.layoutOptions["elk.edgeLabels.placement"] === "HEAD")
        p = p.slice().reverse();
      const endpoint = p[0];
      const candidates = [
        {
          x: l.x,
          y: l.y,
          score:
            Math.abs(l.x + l.width / 2 - endpoint.x) +
            Math.abs(l.y + l.height / 2 - endpoint.y) +
            20,
        },
      ];
      // Self-loops have very short terminal segments. Offer placements beside
      // each actual endpoint so a count cannot migrate to the opposite side.
      for (const x of [endpoint.x + 4, endpoint.x - l.width - 4])
        for (const y of [endpoint.y + 4, endpoint.y - l.height - 4])
          candidates.push({ x, y, score: l.width / 2 + l.height / 2 + 24 });
      let traveled = 0;
      for (let i = 1; i < p.length && traveled < 260; i++) {
        const a = p[i - 1],
          b = p[i],
          dx = Math.sign(b.x - a.x),
          dy = Math.sign(b.y - a.y),
          length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        for (let d = 10; d < Math.min(length, 260 - traveled); d += 8) {
          const x = a.x + dx * d,
            y = a.y + dy * d;
          if (dx) {
            const left = dx > 0 ? x : x - l.width;
            candidates.push(
              { x: left, y: y - l.height - 3, score: traveled + d + 4 },
              { x: left, y: y + 3, score: traveled + d + 6 },
            );
          } else
            candidates.push(
              { x: x + 4, y: y - l.height / 2, score: traveled + d + 12 },
              {
                x: x - l.width - 4,
                y: y - l.height / 2,
                score: traveled + d + 14,
              },
            );
        }
        traveled += length;
      }
      const chosen = candidates
        .sort((a, b) => a.score - b.score)
        .find(
          (c) =>
            c.x >= 0 &&
            c.y >= 0 &&
            Math.abs(c.x + l.width / 2 - endpoint.x) +
              Math.abs(c.y + l.height / 2 - endpoint.y) <=
              80 &&
            !occupied.some((o) => overlapping({ ...l, ...c }, o, -2)),
        );
      if (!chosen)
        throw Error(
          "No readable cardinality placement: " + e.id + " / " + l.text,
        );
      Object.assign(l, { x: chosen.x, y: chosen.y });
      occupied.push(l);
    }
}
function geometry(graph) {
  const byId = new Map(graph.children.map((n) => [n.id, n]));
  let segments = 0;
  for (const edge of graph.edges) {
    if (!edge.sections?.length) throw Error("Missing edge route: " + edge.id);
    for (const section of edge.sections) {
      const p = [
        section.startPoint,
        ...(section.bendPoints || []),
        section.endPoint,
      ];
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1],
          b = p[i];
        segments++;
        if (Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01)
          throw Error("Diagonal edge: " + edge.id);
        for (const n of graph.children) {
          if (n.id === edge.sources[0] || n.id === edge.targets[0]) continue;
          const inset = 1;
          if (
            Math.abs(a.x - b.x) < 0.01 &&
            a.x > n.x + inset &&
            a.x < n.x + n.width - inset &&
            Math.max(a.y, b.y) > n.y + inset &&
            Math.min(a.y, b.y) < n.y + n.height - inset
          )
            throw Error("Edge crosses node: " + edge.id + " / " + n.id);
          if (
            Math.abs(a.y - b.y) < 0.01 &&
            a.y > n.y + inset &&
            a.y < n.y + n.height - inset &&
            Math.max(a.x, b.x) > n.x + inset &&
            Math.min(a.x, b.x) < n.x + n.width - inset
          )
            throw Error("Edge crosses node: " + edge.id + " / " + n.id);
        }
      }
    }
    for (const l of edge.labels || [])
      for (const n of byId.values())
        if (overlapping(l, n, 1))
          throw Error("Label overlaps node: " + edge.id + " / " + n.id);
  }
  for (let i = 0; i < graph.children.length; i++)
    for (let j = i + 1; j < graph.children.length; j++)
      if (overlapping(graph.children[i], graph.children[j], 1))
        throw Error("Nodes overlap");
  const labels = graph.edges.flatMap((e) => e.labels || []);
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++)
      if (overlapping(labels[i], labels[j], 1))
        throw Error("Relation labels overlap");
  return {
    nodes: graph.children.length,
    edges: graph.edges.length,
    orthogonalSegments: segments,
    width: round(graph.width),
    height: round(graph.height),
  };
}
function alignInheritanceBars(graph, groups, routedEdges, direction) {
  const routes = new Map(graph.edges.map((e) => [e.id, e]));
  const data = new Map(routedEdges.map((e) => [e.id, e]));
  const originals = new Map();
  const axis = direction === "DOWN" ? "y" : "x";
  for (const group of groups) {
    const branches = group.branchIds.map((id) => {
      const edge = routes.get(id);
      const p = points(edge);
      if (data.get(id).reversed) p.reverse();
      return { edge, source: p[0], junction: p.at(-1) };
    });
    // Siblings on one row/column can use a single straight crossbar. Keep ELK's
    // attachment ports and its routes for mixed levels or crowded diagrams.
    if (
      !branches.every(
        (b) => Math.abs(b.source[axis] - branches[0].source[axis]) < 0.02,
      )
    )
      continue;
    for (const { edge, source, junction } of branches) {
      originals.set(edge.id, edge.sections);
      let p = [
        source,
        direction === "DOWN"
          ? { x: source.x, y: junction.y }
          : { x: junction.x, y: source.y },
        junction,
      ];
      p = p.filter(
        (point, i) => !i || point.x !== p[i - 1].x || point.y !== p[i - 1].y,
      );
      if (data.get(edge.id).reversed) p.reverse();
      edge.sections = [
        { startPoint: p[0], bendPoints: p.slice(1, -1), endPoint: p.at(-1) },
      ];
    }
  }
  try {
    geometry(graph);
  } catch {
    for (const [id, sections] of originals) routes.get(id).sections = sections;
  }
}
async function layoutFlat(view, classes, relations, generalizations) {
  const allEdges = [
    ...generalizations.map((g) => ({
      ...g,
      id: g.id || `generalization-${g.specificId}-${g.generalId}`,
      sourceId: g.specificId,
      targetId: g.generalId,
      generalization: true,
    })),
    ...relations.map((r) => ({ ...r })),
  ];
  // Class-diagram relations have no process-flow ordering. Give the layered
  // router a balanced rank order, while preserving every UML end and arrow.
  const columns = view.columns;
  const rank = new Map(columns.flatMap((ns, i) => ns.map((n) => [n, i])));
  const groups = generalizationGroups(view, generalizations);
  const inheritanceOnly = groups.length > 0 && relations.length === 0;
  const bySemanticId = new Map(allEdges.map((e) => [e.id, e]));
  const routedEdges = [];
  const memberRoutes = new Map();
  for (const group of groups) {
    const parentRank = rank.get(group.target);
    const average =
      group.sourceIds.reduce((sum, id) => sum + rank.get(id), 0) /
      group.sourceIds.length;
    rank.set(
      group.junctionId,
      parentRank + (average < parentRank ? -0.5 : 0.5),
    );
    for (const [i, id] of group.memberIds.entries()) {
      const edge = bySemanticId.get(id);
      const route = {
        ...edge,
        id: group.branchIds[i],
        targetId: group.junctionId,
      };
      routedEdges.push(route);
      if (!memberRoutes.has(id)) memberRoutes.set(id, []);
      memberRoutes.get(id).push({ route, group });
    }
    routedEdges.push({
      id: group.trunkId,
      sourceId: group.junctionId,
      targetId: group.target,
      generalization: true,
      groupLabel: groupLabel(group),
    });
  }
  routedEdges.push(...allEdges.filter((e) => !memberRoutes.has(e.id)));
  for (const e of routedEdges) {
    if (
      e.sourceId !== e.targetId &&
      rank.get(e.sourceId) === rank.get(e.targetId)
    )
      throw Error(
        "Adjacent nodes share a layout rank: " +
          e.sourceId +
          " / " +
          e.targetId,
      );
    e.reversed = rank.get(e.sourceId) > rank.get(e.targetId);
  }
  const portCounts = new Map(
    [...view.names, ...groups.map((g) => g.junctionId)].map((name) => [
      name,
      { left: 0, right: 0 },
    ]),
  );
  for (const edge of routedEdges) {
    portCounts.get(edge.sourceId)[edge.reversed ? "left" : "right"]++;
    portCounts.get(edge.targetId)[edge.reversed ? "right" : "left"]++;
  }
  const graph = {
    id: "diagram",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": view.direction || "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.padding": "[top=28,left=28,bottom=28,right=28]",
      "elk.spacing.nodeNode": "30",
      "elk.spacing.edgeNode": "20",
      "elk.spacing.edgeEdge": "16",
      "elk.layered.spacing.nodeNodeBetweenLayers": inheritanceOnly
        ? "28"
        : "56",
      "elk.layered.spacing.edgeNodeBetweenLayers": "20",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
      "elk.spacing.edgeLabel": "6",
      "elk.spacing.labelNode": "12",
      "elk.layered.nodePlacement.strategy": inheritanceOnly
        ? "BRANDES_KOEPF"
        : "NETWORK_SIMPLEX",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.layered.nodePlacement.favorStraightEdges": inheritanceOnly
        ? "false"
        : "true",
      "elk.layered.edgeLabels.sideSelection": "SMART_UP",
      "elk.layered.thoroughness": "25",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.cycleBreaking.strategy": "GREEDY",
      "elk.portAlignment.default": "DISTRIBUTED",
      "elk.layered.mergeEdges": "false",
    },
    children: [
      ...view.names.map((name) => {
        const c = classes.get(name);
        const ports = portCounts.get(name);
        return {
          id: name,
          width: Math.max(
            232,
            c.name.length * 8 + 28,
            view.direction === "DOWN"
              ? (Math.max(ports.left, ports.right) + 1) * 28
              : 0,
            ...[
              ...c.attributes,
              ...(c.methods || []),
              ...(c.measureMembers || []),
            ].map(
              (a) =>
                `${a.name} : ${a.type} [${a.multiplicity || ""}]`.length * 7.5 +
                28,
            ),
          ),
          height: Math.max(
            c.attributes.length || c.methods?.length
              ? 60 +
                  (c.attributes.length + (c.methods?.length || 0)) * 20 +
                  (c.attributes.length && c.methods?.length ? 12 : 0)
              : 56,
            view.direction === "DOWN"
              ? 0
              : (Math.max(ports.left, ports.right) + 1) * 28,
          ),
        };
      }),
      ...groups.map((g) => ({ id: g.junctionId, width: 0, height: 0 })),
    ],
    edges: routedEdges.map((e) => {
      const name = e.generalization ? e.groupLabel : relationLabel(e);
      return {
        id: e.id,
        sources: [e.reversed ? e.targetId : e.sourceId],
        targets: [e.reversed ? e.sourceId : e.targetId],
        labels: [
          ...(name ? [label(e.id + "-name", name)] : []),
          ...(!e.generalization && knownMultiplicity(e.sourceMultiplicity)
            ? [
                label(
                  e.id + "-tail",
                  e.sourceMultiplicity,
                  e.reversed ? "HEAD" : "TAIL",
                ),
              ]
            : []),
          ...(!e.generalization && knownMultiplicity(e.targetMultiplicity)
            ? [
                label(
                  e.id + "-head",
                  e.targetMultiplicity,
                  e.reversed ? "TAIL" : "HEAD",
                ),
              ]
            : []),
        ],
      };
    }),
  };
  // Try a bounded portfolio of generic placement strategies. Each candidate
  // must satisfy the same geometry and label checks before it can be chosen.
  const baseline = graph.layoutOptions["elk.layered.nodePlacement.strategy"];
  const variants = [
    { strategy: baseline, compact: false },
    { strategy: "NETWORK_SIMPLEX", compact: true },
    { strategy: "BRANDES_KOEPF", compact: true },
  ];
  let result, check, best, referenceQuality;
  const candidates = [],
    failures = [];
  for (const { strategy, compact } of variants) {
    try {
      const input = JSON.parse(JSON.stringify(graph));
      input.layoutOptions["elk.layered.nodePlacement.strategy"] = strategy;
      input.layoutOptions["elk.randomSeed"] = "1";
      if (compact) {
        Object.assign(input.layoutOptions, {
          "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
          "elk.layered.spacing.nodeNodeBetweenLayers": inheritanceOnly
            ? "28"
            : "32",
          "elk.layered.spacing.edgeNodeBetweenLayers": "16",
          "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
          "elk.spacing.nodeNode": "24",
          "elk.spacing.edgeEdge": "12",
        });
      }
      const candidate = await elk.layout(input);
      if (groups.length)
        alignInheritanceBars(
          candidate,
          groups,
          routedEdges,
          view.direction || "RIGHT",
        );
      placeEndLabels(candidate);
      const verified = geometry(candidate);
      const quality = readability(candidate, groups);
      referenceQuality ||= quality;
      const eligible = ["overlaps", "labelIntersections", "crossings"].every(
        (metric) => quality[metric] <= referenceQuality[metric],
      );
      candidates.push({ strategy, compact, eligible, ...quality });
      if (eligible && (!best || quality.score < best.score)) {
        result = candidate;
        check = verified;
        best = { strategy, compact, ...quality };
      }
    } catch (error) {
      failures.push({ strategy, compact, message: error.message });
    }
  }
  if (!result)
    throw Error(
      "No valid orthogonal layout: " +
        failures.map((f) => `${f.strategy}: ${f.message}`).join("; "),
    );
  check.layout = { ...best, candidates, rejected: failures };
  check.nodes = view.names.length;
  check.edges = allEdges.length;
  check.generalizationGroups = groups.length;
  const byRoute = new Map(result.edges.map((e) => [e.id, e]));
  const routingData = new Map(routedEdges.map((e) => [e.id, e]));
  const orientedPoints = (id) => {
    const p = points(byRoute.get(id));
    return routingData.get(id).reversed ? p.reverse() : p;
  };
  const pathOf = (p) =>
    p
      .map(
        (point, i) => (i ? "L" : "M") + round(point.x) + " " + round(point.y),
      )
      .join(" ");
  const labelsOf = (e, source, target) =>
    (e.labels || []).map((l) => ({
      id: l.id,
      text: l.text,
      x: round(l.x),
      y: round(l.y),
      width: round(l.width),
      height: round(l.height),
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
    }));
  const diagram = {
    key: view.key,
    title: view.title,
    width: round(result.width),
    height: round(result.height),
    initialFocus: view.focusNames.map((name) => classes.get(name).id),
    nodes: result.children
      .filter((n) => classes.has(n.id))
      .map((n) => {
        const c = classes.get(n.id);
        return {
          id: c.id,
          name: c.name,
          stereotype: c.stereotype,
          ...(c.description ? { description: c.description } : {}),
          isAbstract: c.isAbstract ?? c.abstract,
          x: round(n.x),
          y: round(n.y),
          width: round(n.width),
          height: round(n.height),
          attributes: c.attributes,
          methods: c.methods || [],
        };
      }),
    generalizationGroups: groups.map((g) => ({
      id: g.id,
      type: g.type,
      realization: g.realization,
      name: g.name,
      complete: g.complete,
      disjoint: g.disjoint,
      memberIds: g.memberIds,
      sourceIds: g.sourceIds,
      target: g.target,
      totalMembers: g.totalMembers,
      sourceNames: g.sourceIds.map((id) => classes.get(id).name),
      targetName: classes.get(g.target).name,
      paths: [pathOf(orientedPoints(g.trunkId))],
      labels: labelsOf(byRoute.get(g.trunkId)),
    })),
    edges: allEdges.map((data) => {
      const source = classes.get(data.sourceId),
        target = classes.get(data.targetId);
      const members = memberRoutes.get(data.id);
      return {
        id: data.id,
        type: data.generalization ? "generalization" : "association",
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
        paths: members
          ? members.map(({ route, group }) =>
              pathOf([
                ...orientedPoints(route.id),
                ...orientedPoints(group.trunkId).slice(1),
              ]),
            )
          : [pathOf(orientedPoints(data.id))],
        ...(members
          ? {
              branchPaths: members.map(({ route }) =>
                pathOf(orientedPoints(route.id)),
              ),
            }
          : {}),
        labels: members ? [] : labelsOf(byRoute.get(data.id), source, target),
      };
    }),
  };
  return { diagram, check };
}
/** A relation's labels as the flat layout sizes them: its name, and the counts at its ends. */
function edgeLabels(edge) {
  const name = relationLabel(edge);
  return [
    ...(name ? [label(edge.id + "-name", name)] : []),
    ...(knownMultiplicity(edge.sourceMultiplicity)
      ? [label(edge.id + "-tail", edge.sourceMultiplicity, "TAIL")]
      : []),
    ...(knownMultiplicity(edge.targetMultiplicity)
      ? [label(edge.id + "-head", edge.targetMultiplicity, "HEAD")]
      : []),
  ];
}
/**
 * A view laid out: in one piece when it is small or its relations hold it
 * together, or else in its groups (packages, or the groups its relations
 * form), each group compact and the groups apart (see layoutGrouped.cjs).
 */
async function layoutDiagram(view, classes, relations, generalizations) {
  const clusters = layoutGroups(view, classes, relations, generalizations);
  if (!clusters.length)
    return layoutFlat(view, classes, relations, generalizations);
  // The router the viewer re-routes a dragged element's relations with.
  const { arrangeScene } = require("../../src/canvas/arrange.mjs");
  return layoutGrouped(view, classes, relations, generalizations, clusters, {
    layoutFlat,
    route: arrangeScene,
    edgeLabels,
  });
}
module.exports = { layoutDiagram, relationLabel, labelSize };
