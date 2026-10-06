const ELK = require("elkjs");
const elk = new ELK();
const colors = {
  kind: "#edf4ff",
  role: "#fff3da",
  relator: "#f3eaff",
  phase: "#eaf8f0",
  event: "#fff0ed",
  mode: "#eaf7fa",
};
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const round = (n) => Number(n.toFixed(2));
function label(id, text, placement = "CENTER") {
  const lines = text.split("\n");
  const end = placement !== "CENTER";
  return {
    id,
    text,
    width:
      Math.max(...lines.map((t) => t.length)) * (end ? 6 : 6.7) +
      (end ? 6 : 12),
    height: end ? 16 : lines.length * 17 + 6,
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
      const candidates = [{ x: l.x, y: l.y, score: 0 }];
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
async function render(
  view,
  classes,
  relations,
  generalizations,
  fields = false,
) {
  const allEdges = [
    ...generalizations.map((g, i) => ({
      id: "generalization-" + i,
      a: g.child,
      b: g.parent,
      generalization: true,
    })),
    ...relations,
  ];
  // Class-diagram relations have no process-flow ordering. Give the layered
  // router a balanced rank order, while preserving every UML end and arrow.
  const columns =
    view.key === "runtime"
      ? [
          [
            "GameSession",
            "ClientSlot",
            "AssignedPlayerEntity",
            "Respawn",
            "CommandProcessing",
            "ClientApplication",
            "Downing",
          ],
          [
            "PlayerEntity",
            "GameServer",
            "SessionParticipant",
            "NetworkChannel",
            "Snapshot",
            "EliminationStatus",
          ],
          [
            "MatchSquad",
            "ServerFrame",
            "PlatformIdentity",
            "SessionParticipation",
            "SnapshotEmission",
            "AvatarAssignment",
            "ReadyPlayer",
            "DownedPlayer",
          ],
          [
            "EliminatedIdentity",
            "GameStateChange",
            "GameMatch",
            "InputCommand",
            "PlaylistConfig",
            "ActiveClientSlot",
            "ClientReplicationState",
          ],
        ]
      : [
          ["DirectoryService", "ClientApplication", "ServerListing"],
          [
            "ListingPublication",
            "ServerLookup",
            "ListingUpdate",
            "HiddenListing",
            "PublicListing",
          ],
          ["PublishedListing", "GameServer"],
        ];
  const rank = new Map(columns.flatMap((ns, i) => ns.map((n) => [n, i])));
  for (const e of allEdges) {
    if (rank.get(e.a) === rank.get(e.b))
      throw Error("Adjacent nodes share a layout rank: " + e.a + " / " + e.b);
    e.reversed = rank.get(e.a) > rank.get(e.b);
  }
  const graph = {
    id: "diagram",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.padding": "[top=28,left=28,bottom=28,right=28]",
      "elk.spacing.nodeNode": "30",
      "elk.spacing.edgeNode": "16",
      "elk.spacing.edgeEdge": "12",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.layered.spacing.edgeNodeBetweenLayers": "20",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
      "elk.spacing.edgeLabel": "6",
      "elk.spacing.labelNode": "12",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.nodePlacement.favorStraightEdges": "true",
      "elk.layered.edgeLabels.sideSelection": "SMART_UP",
      "elk.layered.thoroughness": "25",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.cycleBreaking.strategy": "GREEDY",
      "elk.portAlignment.default": "DISTRIBUTED",
      "elk.layered.mergeEdges": "false",
    },
    children: view.names.map((name) => {
      const c = classes.get(name);
      return {
        id: name,
        width: 232,
        height: fields && c.attrs.length ? 70 + c.attrs.length * 20 : 66,
      };
    }),
    edges: allEdges.map((e) => ({
      id: e.id,
      sources: [e.reversed ? e.b : e.a],
      targets: [e.reversed ? e.a : e.b],
      labels: e.generalization
        ? []
        : [
            label(
              e.id + "-name",
              ["mediation", "characterization"].includes(e.stereo)
                ? "«" + e.stereo + "»"
                : (e.stereo ? "«" + e.stereo + "»\n" : "") + e.name,
            ),
            label(e.id + "-tail", e.ac, e.reversed ? "HEAD" : "TAIL"),
            label(e.id + "-head", e.bc, e.reversed ? "TAIL" : "HEAD"),
          ],
    })),
  };
  const result = await elk.layout(graph);
  placeEndLabels(result);
  const check = geometry(result),
    byEdge = new Map(allEdges.map((e) => [e.id, e]));
  const shapes = [];
  for (const e of result.edges) {
    const data = byEdge.get(e.id);
    for (const s of e.sections) {
      const p = [s.startPoint, ...(s.bendPoints || []), s.endPoint];
      if (data.reversed) p.reverse();
      const d = p
        .map((p, i) => (i ? "L" : "M") + round(p.x) + " " + round(p.y))
        .join(" ");
      shapes.push(
        `<g class="edge${data.generalization ? " generalization" : ""}" data-edge="${esc(e.id)}"><path d="${d}" fill="none" stroke="${data.generalization ? "var(--diagram-inheritance,#57667e)" : "var(--diagram-edge,#77859a)"}" stroke-width="1.4"${data.generalization ? ' marker-end="url(#inheritance)"' : ""}/></g>`,
      );
    }
  }
  // Labels are rendered after routes to keep them legible at crossings.
  for (const e of result.edges)
    for (const l of e.labels || []) {
      const lines = l.text.split("\n"),
        isEnd = l.id.endsWith("-head") || l.id.endsWith("-tail");
      shapes.push(
        `<g class="edge-label" transform="translate(${round(l.x)} ${round(l.y)})"><rect x="0" y="0" width="${round(l.width)}" height="${round(l.height)}" rx="3" fill="var(--canvas,#fafbfe)"/><text x="${round(l.width / 2)}" text-anchor="middle" fill="var(--diagram-label,#42516a)" font-size="${isEnd ? 10.5 : 12.5}">${lines.map((line, i) => `<tspan x="${round(l.width / 2)}" y="${(isEnd ? 12 : 16) + i * 17}"${i === 0 && lines.length > 1 ? ' font-size="11.5" fill="var(--diagram-muted,#5b687f)"' : ""}>${esc(line)}</tspan>`).join("")}</text></g>`,
      );
    }
  for (const n of result.children) {
    const c = classes.get(n.id),
      fieldsSvg =
        fields && c.attrs.length
          ? `<path d="M0 66 H${n.width}" stroke="var(--diagram-divider,#b7c2d2)"/><g class="attributes" fill="var(--diagram-attribute,#44546c)" font-size="12">${c.attrs.map(([a, t, k], i) => `<text x="14" y="${85 + i * 20}">${esc(a + " : " + t + (k ? " [" + k + "]" : ""))}</text>`).join("")}</g>`
          : "";
    shapes.push(
      `<g class="node" id="node-${c.name}" data-name="${c.name}" role="button" tabindex="0" aria-label="${c.name}" transform="translate(${round(n.x)} ${round(n.y)})"><rect class="node-box" width="${n.width}" height="${n.height}" rx="4" fill="var(--node-${c.stereo},${colors[c.stereo]})" stroke="var(--diagram-border,#72839d)" stroke-width="1.25"/><text x="${n.width / 2}" y="23" text-anchor="middle" fill="var(--diagram-muted,#5b687f)" font-size="11.5">«${c.stereo}»</text><text x="${n.width / 2}" y="46" text-anchor="middle" fill="var(--text,#26354c)" font-size="15" font-weight="600">${c.name}</text>${fieldsSvg}</g>`,
    );
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${round(result.width)}" height="${round(result.height)}" viewBox="0 0 ${round(result.width)} ${round(result.height)}" role="img" aria-label="${esc(view.title)}" style="font-family:Inter,Segoe UI,Arial,sans-serif"><defs><marker id="inheritance" markerWidth="13" markerHeight="12" refX="11" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L11 6 L1 11 Z" fill="var(--canvas,#fafbfe)" stroke="var(--diagram-inheritance,#57667e)" stroke-width="1.4"/></marker></defs>${shapes.join("\n")}</svg>`;
  return { svg, check, layout: result };
}
module.exports = { render };
