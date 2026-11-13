// The groups a diagram is laid out in, as a person would draw it: related
// elements close together, and room between the groups, so a relation from
// one group to another is a longer line. A diagram's packages are its groups;
// without packages, the groups are found from the relations by modularity
// (Louvain's method, deterministic), with a hierarchy kept in one group. A
// small diagram is one group.
//
// Pure and deterministic: the same diagram always groups the same way.

/** A diagram of this many elements or fewer is drawn as one group. */
const SMALL = 6;
/** A group found from the relations has at least this many elements. */
const MIN_GROUP = 3;
/** How strongly a kind of relation ties its ends to one group. */
const WEIGHT = {
  generalization: 3,
  whole: 2,
  association: 1.5,
  dependency: 0.5,
};

function relationWeight(relation) {
  if (relation.stereotype === "dependency") return WEIGHT.dependency;
  const whole = ["COMPOSITE", "SHARED"];
  if (
    whole.includes(relation.sourceAggregation) ||
    whole.includes(relation.targetAggregation)
  )
    return WEIGHT.whole;
  return WEIGHT.association;
}

// One level of Louvain's local moving: each node, in order, joins the
// neighbouring community that gains the most modularity, until none moves.
// `weights` maps "a b" (a < b by index) to the weight between two nodes.
function localMoving(count, adjacency, degree, total) {
  const community = Array.from({ length: count }, (_, i) => i);
  const communityDegree = degree.slice();
  for (let pass = 0, moved = true; moved && pass < 50; pass++) {
    moved = false;
    for (let node = 0; node < count; node++) {
      const own = community[node];
      const links = new Map();
      for (const [other, weight] of adjacency[node])
        if (other !== node)
          links.set(
            community[other],
            (links.get(community[other]) || 0) + weight,
          );
      communityDegree[own] -= degree[node];
      let best = own,
        gain =
          (links.get(own) || 0) -
          (communityDegree[own] * degree[node]) / (2 * total);
      for (const [candidate, weight] of [...links].sort(
        (a, b) => a[0] - b[0],
      )) {
        const candidateGain =
          weight - (communityDegree[candidate] * degree[node]) / (2 * total);
        if (candidateGain > gain + 1e-9) {
          best = candidate;
          gain = candidateGain;
        }
      }
      communityDegree[best] += degree[node];
      if (best !== own) {
        community[node] = best;
        moved = true;
      }
    }
  }
  // Communities renumbered in order of their first node.
  const numbers = new Map();
  return community.map((c) => {
    if (!numbers.has(c)) numbers.set(c, numbers.size);
    return numbers.get(c);
  });
}

/** Louvain's method: local moving, then the communities as nodes, until nothing merges. */
function louvain(count, edges) {
  let assignment = Array.from({ length: count }, (_, i) => i);
  let nodes = count,
    links = edges;
  for (let level = 0; level < 10; level++) {
    const adjacency = Array.from({ length: nodes }, () => new Map());
    const degree = new Array(nodes).fill(0);
    let total = 0;
    for (const [a, b, w] of links) {
      adjacency[a].set(b, (adjacency[a].get(b) || 0) + w);
      adjacency[b].set(a, (adjacency[b].get(a) || 0) + w);
      degree[a] += w;
      degree[b] += w;
      total += w;
    }
    if (!total) break;
    const community = localMoving(nodes, adjacency, degree, total);
    const merged = Math.max(...community) + 1;
    assignment = assignment.map((c) => community[c]);
    if (merged === nodes) break;
    const next = new Map();
    for (const [a, b, w] of links) {
      // A community keeps the weight inside it as a loop, so its degree stays
      // whole and merging it is weighed fairly.
      const [x, y] = [community[a], community[b]].sort((p, q) => p - q);
      next.set(`${x} ${y}`, (next.get(`${x} ${y}`) || 0) + w);
    }
    links = [...next].map(([key, w]) => [...key.split(" ").map(Number), w]);
    nodes = merged;
  }
  return assignment;
}

/**
 * The groups of a view's elements: `[{ id, name, members }]`, members in the
 * view's order, `name` a package's or null for a group found. Empty when the
 * diagram is one group. `relations` and `generalizations` are the view's.
 */
function layoutGroups(view, classes, relations, generalizations) {
  const names = view.names;
  if (names.length <= SMALL) return [];
  const packaged = names.filter((id) => classes.get(id)?.namespace);
  if (packaged.length) {
    // Each package is a group; an element outside every package stands alone.
    const byPackage = new Map();
    for (const id of packaged) {
      const name = classes.get(id).namespace;
      if (!byPackage.has(name)) byPackage.set(name, []);
      byPackage.get(name).push(id);
    }
    return [...byPackage].map(([name, members], i) => ({
      id: `group-${i}`,
      name,
      members,
    }));
  }
  // A hierarchy is one node to begin with, so it stays in one group.
  const index = new Map(names.map((id, i) => [id, i]));
  const parent = names.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (const g of generalizations) {
    const a = root(index.get(g.specificId)),
      b = root(index.get(g.generalId));
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  }
  const roots = [...new Set(names.map((_, i) => root(i)))];
  const nodeOf = new Map(roots.map((r, i) => [r, i]));
  const node = (id) => nodeOf.get(root(index.get(id)));
  const links = new Map();
  const link = (a, b, w) => {
    if (a === b) return;
    const key = a < b ? `${a} ${b}` : `${b} ${a}`;
    links.set(key, (links.get(key) || 0) + w);
  };
  for (const r of relations)
    link(node(r.sourceId), node(r.targetId), relationWeight(r));
  const edges = [...links].map(([key, w]) => [
    ...key.split(" ").map(Number),
    w,
  ]);
  const community = louvain(roots.length, edges);
  const groupOf = (id) => community[node(id)];
  // A group of one joins the group it relates to most; elements related to
  // nothing gather in one group of their own.
  const sizes = new Map();
  for (const id of names)
    sizes.set(groupOf(id), (sizes.get(groupOf(id)) || 0) + 1);
  // Lone elements tied only to other lone elements go together.
  const merged = new Map();
  const find = (g) => (merged.has(g) ? find(merged.get(g)) : g);
  for (const id of names) {
    const own = groupOf(id);
    if (sizes.get(own) > 1) continue;
    const ties = new Map();
    for (const r of relations) {
      const other =
        r.sourceId === id ? r.targetId : r.targetId === id ? r.sourceId : null;
      if (other === null || other === id) continue;
      const g = groupOf(other);
      ties.set(g, (ties.get(g) || 0) + relationWeight(r));
    }
    const ranked = [...ties].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const [best] = ranked.filter(([g]) => sizes.get(g) > 1);
    if (best && find(own) !== find(best[0])) merged.set(find(own), best[0]);
    else if (ranked.length) {
      const [a, b] = [find(own), find(ranked[0][0])].sort((p, q) => p - q);
      if (a !== b) merged.set(b, a);
    } else merged.set(find(own), -1);
  }
  const final = (id) => find(groupOf(id));
  const groups = new Map();
  for (const id of names) {
    const g = final(id);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(id);
  }
  // A group of two says little and costs long lines: it joins the group it
  // relates to most, smallest first, while it relates to one.
  const tieBetween = (a, b) => {
    const inA = new Set(a);
    const inB = new Set(b);
    let weight = 0;
    for (const r of relations)
      if (
        (inA.has(r.sourceId) && inB.has(r.targetId)) ||
        (inB.has(r.sourceId) && inA.has(r.targetId))
      )
        weight += relationWeight(r);
    return weight;
  };
  for (;;) {
    const lists = [...groups.values()];
    const small = lists
      .filter((m) => m.length < MIN_GROUP)
      .sort((a, b) => a.length - b.length);
    const merge = small
      .map((m) => {
        const [best] = lists
          .filter((other) => other !== m)
          .map((other) => [other, tieBetween(m, other)])
          .filter(([, w]) => w > 0)
          .sort((x, y) => y[1] - x[1]);
        return best && [m, best[0]];
      })
      .find(Boolean);
    if (!merge) break;
    const [from, into] = merge;
    into.push(...from);
    for (const [key, list] of groups) if (list === from) groups.delete(key);
  }
  if (groups.size < 2) return [];
  // Members in the view's order, as each group is laid out.
  const order = new Map(names.map((id, i) => [id, i]));
  for (const list of groups.values())
    list.sort((a, b) => order.get(a) - order.get(b));
  return [...groups.values()].map((members, i) => ({
    id: `group-${i}`,
    name: null,
    members,
  }));
}

module.exports = { layoutGroups, SMALL };
