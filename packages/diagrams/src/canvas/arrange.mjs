// Moves diagram elements to the positions a person chose and re-routes the
// relations they touch. ELK lays a diagram out from scratch and cannot keep
// positions it did not choose, so the routes here come from a small
// orthogonal router of our own, in the style of libavoid's: a sparse grid of
// lines along the boxes' margins and the ports, searched with A* for the
// route with the least length plus a cost per bend. Routes keep off each
// other: running along a route drawn costs many times its length and crossing
// one a lot, the ends on a side keep a port apart, and a crowded side gives way
// to another, so lines do not lie on top of each other. It runs on every
// pointer move of a drag (quickly then, without tracks beside the routes), so
// it only re-routes what a move disturbs.

// Clearance a route keeps from the boxes it passes.
const MARGIN = 12;
// The straight run out of a box before a route may turn, so arrowheads and
// diamonds sit on a straight line.
const STUB = 18;
// Distance between the ends that share one side of a box, where it fits.
const PORT_GAP = 20;
// What a bend costs, in pixels of length.
const BEND = 24;
// Length inside another box's margin counts this many times over: a route may
// squeeze between boxes that stand close, but only when it must.
const SOFT = 4;
// How far a generalization tree's junction stands out from its supertype.
const JUNCTION = 28;
// The scene's padding, as the layout gives it.
const PADDING = 28;
// The least gap between a newly placed element and the others.
const PLACE_GAP = 40;
// The spacing between routes that would otherwise share a line.
const NUDGE = 8;
// A package's region: the room round its elements, and above them for its
// name (as the grouped layout draws it).
const PACKAGE_MARGIN = 16;
const PACKAGE_HEADER = 22;
// How far past its two ends a route's search grid reaches first.
const REGION = 64;
// The size of the cells the search finds nearby boxes by.
const CELL = 96;
// What each step down a label's list of places costs: little, so a place
// clear of other labels and lines wins however far down the list it is.
const RANK = 0.1;
// Routes keep off each other: a run along another route (on the same line, or
// nearer than TRACK) costs SHARED times its length, and crossing one costs
// CROSSING; the search may take a track TRACK beside each route drawn.
const TRACK = 10;
const SHARED = 12;
const CROSSING = 240;
// What running through a label that stays costs, beyond its length counted
// as within a margin.
const LABEL_CROSSING = 120;
// Directions, which double as box sides: a side's number is the direction
// that leaves the box through it (right, bottom, left, top).
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

const round = (n) => Number(n.toFixed(2));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const centreOf = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const pointBox = (p) => ({ x: p.x, y: p.y, width: 0, height: 0 });

function parsePath(d) {
  const n = (d.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g) || []).map(Number);
  const points = [];
  for (let i = 0; i + 1 < n.length; i += 2)
    points.push({ x: n[i], y: n[i + 1] });
  return points;
}
// The same text the layout writes, so unchanged geometry reads the same.
const pathOf = (points) =>
  points
    .map((p, i) => (i ? "L" : "M") + round(p.x) + " " + round(p.y))
    .join(" ");

// Drops repeated points and the middle of straight runs.
function simplify(points) {
  const out = [];
  const same = (a, b) => Math.abs(a - b) < 0.01;
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && same(last.x, p.x) && same(last.y, p.y)) continue;
    const before = out[out.length - 2];
    if (
      before &&
      ((same(before.x, last.x) && same(last.x, p.x)) ||
        (same(before.y, last.y) && same(last.y, p.y)))
    ) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

function segmentsOf(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) out.push([points[i - 1], points[i]]);
  return out;
}

// Whether an axis-aligned segment runs through the inside of a box, shrunk by
// inset (or grown, when inset is negative).
function crosses(a, b, box, inset) {
  const left = box.x + inset,
    right = box.x + box.width - inset,
    top = box.y + inset,
    bottom = box.y + box.height - inset;
  if (left >= right || top >= bottom) return false;
  return (
    Math.max(a.x, b.x) > left &&
    Math.min(a.x, b.x) < right &&
    Math.max(a.y, b.y) > top &&
    Math.min(a.y, b.y) < bottom
  );
}

function hits(points, boxes, skip) {
  for (let i = 1; i < points.length; i++)
    for (const box of boxes)
      if (!skip?.has(box.id) && crosses(points[i - 1], points[i], box, 1))
        return true;
  return false;
}

// Whether two rectangles come closer than gap.
function overlapping(a, b, gap = 0) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

function rectTouchesSegment(r, a, b, gap) {
  return (
    Math.max(a.x, b.x) > r.x - gap &&
    Math.min(a.x, b.x) < r.x + r.width + gap &&
    Math.max(a.y, b.y) > r.y - gap &&
    Math.min(a.y, b.y) < r.y + r.height + gap
  );
}

// Sides run along y for left and right, along x for top and bottom.
const alongY = (side) => side % 2 === 0;
function sideRange(box, side) {
  return alongY(side)
    ? [box.y, box.y + box.height]
    : [box.x, box.x + box.width];
}
function portPoint(box, side, t) {
  if (side === 0) return { x: box.x + box.width, y: t };
  if (side === 1) return { x: t, y: box.y + box.height };
  if (side === 2) return { x: box.x, y: t };
  return { x: t, y: box.y };
}
// The side of box that faces other: across the wider of the two gaps.
function facing(box, other) {
  const gapX = Math.max(
    other.x - (box.x + box.width),
    box.x - (other.x + other.width),
  );
  const gapY = Math.max(
    other.y - (box.y + box.height),
    box.y - (other.y + other.height),
  );
  const a = centreOf(box),
    b = centreOf(other);
  if (gapX >= gapY) return b.x >= a.x ? 0 : 2;
  return b.y >= a.y ? 1 : 3;
}
// The side a route's end point lies on, or -1.
function sideOf(box, p) {
  for (let side = 0; side < 4; side++) {
    const t = alongY(side) ? p.y : p.x;
    const q = portPoint(box, side, t);
    const [lo, hi] = sideRange(box, side);
    if (
      Math.abs(q.x - p.x) < 1.5 &&
      Math.abs(q.y - p.y) < 1.5 &&
      t >= lo - 1 &&
      t <= hi + 1
    )
      return side;
  }
  return -1;
}
// The usable stretch of a side, kept clear of its rounded corners.
function sideSpan(box, side) {
  const [lo, hi] = sideRange(box, side);
  const inset = Math.min(16, (hi - lo) / 4);
  return [lo + inset, hi - inset];
}
// Where on its side an end would like to be: level with the other end where
// the two overlap, so the route can run straight, and otherwise as near it as
// the side reaches.
function preferredAlong(box, side, other) {
  const [lo, hi] = sideSpan(box, side);
  // Both ends measure the overlap the same way, so they agree on where it is.
  const [olo, ohi] = sideSpan(other, (side + 2) & 3);
  const from = Math.max(lo, olo),
    to = Math.min(hi, ohi);
  if (from <= to) return (from + to) / 2;
  const c = alongY(side) ? centreOf(other).y : centreOf(other).x;
  return clamp(c, lo, hi);
}

// Places the ends on one side as near their preferences as they can be while
// keeping their order and the port gap. Taking off i gaps turns this into an
// ordered (isotonic) fit, which pooling adjacent violators solves exactly.
function spread(items, lo, hi) {
  const n = items.length;
  const gap = n > 1 ? Math.min(PORT_GAP, Math.max(0, hi - lo) / (n - 1)) : 0;
  const top = Math.max(lo, hi - (n - 1) * gap);
  const blocks = [];
  items.forEach((item, i) => {
    let block = {
      total: (item.pref - i * gap) * item.weight,
      weight: item.weight,
      count: 1,
    };
    while (
      blocks.length &&
      blocks[blocks.length - 1].total / blocks[blocks.length - 1].weight >=
        block.total / block.weight
    ) {
      const last = blocks.pop();
      block = {
        total: last.total + block.total,
        weight: last.weight + block.weight,
        count: last.count + block.count,
      };
    }
    blocks.push(block);
  });
  const out = [];
  for (const block of blocks) {
    const v = clamp(block.total / block.weight, lo, top);
    for (let k = 0; k < block.count; k++) out.push(v + out.length * gap);
  }
  return out;
}

// The place on a side's stretch [lo, hi] nearest pref that keeps gap from
// every place taken, or else the middle of the widest free stretch.
function freePlace(pref, taken, lo, hi, gap) {
  const clear = (v) => taken.every((t) => Math.abs(t - v) >= gap - 0.01);
  const candidates = [clamp(pref, lo, hi)];
  for (const t of taken) candidates.push(t - gap, t + gap);
  let best = null;
  for (const c of candidates)
    if (c >= lo - 0.01 && c <= hi + 0.01 && clear(c))
      if (best === null || Math.abs(c - pref) < Math.abs(best - pref)) best = c;
  if (best !== null) return best;
  const edges = [lo, ...taken.filter((t) => t > lo && t < hi), hi].sort(
    (a, b) => a - b,
  );
  let at = clamp(pref, lo, hi),
    widest = -1;
  for (let k = 1; k < edges.length; k++)
    if (edges[k] - edges[k - 1] > widest) {
      widest = edges[k] - edges[k - 1];
      at = (edges[k] + edges[k - 1]) / 2;
    }
  return at;
}

// How far a route may run straight out of a side before it turns: the stub,
// or half the room to the next box in front, so two facing ends meet halfway.
function stubLength(box, side, port, boxes) {
  let room = Infinity;
  for (const o of boxes) {
    if (o.id === box.id) continue;
    if (alongY(side)) {
      if (port.y <= o.y - MARGIN || port.y >= o.y + o.height + MARGIN) continue;
      const d = side === 0 ? o.x - port.x : port.x - (o.x + o.width);
      if (d >= 0) room = Math.min(room, d);
    } else {
      if (port.x <= o.x - MARGIN || port.x >= o.x + o.width + MARGIN) continue;
      const d = side === 1 ? o.y - port.y : port.y - (o.y + o.height);
      if (d >= 0) room = Math.min(room, d);
    }
  }
  return clamp(room / 2, 2, STUB);
}

class Heap {
  constructor() {
    this.keys = [];
    this.values = [];
  }
  get size() {
    return this.keys.length;
  }
  push(key, value) {
    const { keys, values } = this;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      values[i] = values[parent];
      i = parent;
    }
    keys[i] = key;
    values[i] = value;
  }
  pop() {
    const { keys, values } = this;
    const top = values[0];
    const key = keys.pop(),
      value = values.pop();
    if (keys.length) {
      let i = 0;
      const n = keys.length;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= key) break;
        keys[i] = keys[child];
        values[i] = values[child];
        i = child;
      }
      keys[i] = key;
      values[i] = value;
    }
    return top;
  }
}

function uniqueSorted(values) {
  values.sort((a, b) => a - b);
  const out = [];
  for (const v of values)
    if (!out.length || v !== out[out.length - 1]) out.push(v);
  return out;
}
function indexIn(sorted, v) {
  let lo = 0,
    hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return sorted[lo] === v ? lo : -1;
}

/** The first index of a sorted list whose value is at least v. */
function firstAt(sorted, v) {
  let lo = 0,
    hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// A* over the grid that the obstacles' margins and the two ends span. A state
// is a grid point and the direction the route arrived in, so a bend can be
// charged where the direction changes. `arrival` is what entering the goal in
// each direction costs: Infinity rules a direction out.
function search(from, fromDir, to, arrival, obstacles, region, occupied) {
  const xv = [region.x0, region.x1, from.x, to.x];
  const yv = [region.y0, region.y1, from.y, to.y];
  for (const o of obstacles) {
    xv.push(round(o.x - MARGIN), round(o.x + o.width + MARGIN));
    yv.push(round(o.y - MARGIN), round(o.y + o.height + MARGIN));
  }
  // The routes drawn in this region, and a track beside each.
  const inside = (v, lo, hi) => v >= lo && v <= hi;
  const flat = (occupied?.flat || []).filter(
    (g) =>
      inside(g.y, region.y0, region.y1) &&
      g.x1 >= region.x0 &&
      g.x0 <= region.x1,
  );
  const upright = (occupied?.upright || []).filter(
    (g) =>
      inside(g.x, region.x0, region.x1) &&
      g.y1 >= region.y0 &&
      g.y0 <= region.y1,
  );
  // Sorted by where they lie, so a step finds the few near it at once.
  flat.sort((a, b) => a.y - b.y);
  upright.sort((a, b) => a.x - b.x);
  const flatAt = flat.map((g) => g.y),
    uprightAt = upright.map((g) => g.x);
  // Tracks beside the routes, only in a search near the ends: across the
  // whole scene they would make the grid too large to search quickly.
  if (!occupied?.wide) {
    for (const g of flat)
      for (const y of [g.y - TRACK, g.y + TRACK])
        if (inside(y, region.y0, region.y1)) yv.push(round(y));
    for (const g of upright)
      for (const x of [g.x - TRACK, g.x + TRACK])
        if (inside(x, region.x0, region.x1)) xv.push(round(x));
  }
  const labels = (occupied?.labels || []).filter(
    (l) =>
      l.x < region.x1 &&
      l.x + l.width > region.x0 &&
      l.y < region.y1 &&
      l.y + l.height > region.y0,
  );
  const xs = uniqueSorted(xv),
    ys = uniqueSorted(yv);
  const nx = xs.length,
    ny = ys.length;
  const si = indexIn(xs, from.x),
    sj = indexIn(ys, from.y),
    gi = indexIn(xs, to.x),
    gj = indexIn(ys, to.y);
  if (si < 0 || sj < 0 || gi < 0 || gj < 0) return null;
  const states = nx * ny * 4;
  const GOAL = states;
  const cost = new Float64Array(states + 1).fill(Infinity);
  const parent = new Int32Array(states + 1).fill(-1);
  const closed = new Uint8Array(states + 1);
  const across = new Float64Array(Math.max(0, (nx - 1) * ny)).fill(-1);
  const down = new Float64Array(Math.max(0, nx * (ny - 1))).fill(-1);
  // What a step between neighbouring grid points costs: Infinity through a
  // box, more inside a box's margin.
  // The boxes by the cells of a coarse grid their margins touch, so a step
  // looks only at the boxes near it.
  const cells = new Map();
  const cellOf = (v) => Math.floor(v / CELL);
  obstacles.forEach((o, n) => {
    for (
      let cx = cellOf(o.x - MARGIN);
      cx <= cellOf(o.x + o.width + MARGIN);
      cx++
    )
      for (
        let cy = cellOf(o.y - MARGIN);
        cy <= cellOf(o.y + o.height + MARGIN);
        cy++
      ) {
        const key = cx * 65536 + cy;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(n);
      }
  });
  const labelCells = new Map();
  labels.forEach((l, n) => {
    for (let cx = cellOf(l.x); cx <= cellOf(l.x + l.width); cx++)
      for (let cy = cellOf(l.y); cy <= cellOf(l.y + l.height); cy++) {
        const key = cx * 65536 + cy;
        if (!labelCells.has(key)) labelCells.set(key, []);
        labelCells.get(key).push(n);
      }
  });
  let visit = 0;
  const seen = new Int32Array(obstacles.length);
  const labelSeen = new Int32Array(labels.length);
  const classify = (x1, y1, x2, y2) => {
    const a = { x: x1, y: y1 },
      b = { x: x2, y: y2 };
    let soft = false;
    visit++;
    for (let cx = cellOf(x1); cx <= cellOf(x2); cx++)
      for (let cy = cellOf(y1); cy <= cellOf(y2); cy++)
        for (const n of cells.get(cx * 65536 + cy) || []) {
          if (seen[n] === visit) continue;
          seen[n] = visit;
          const o = obstacles[n];
          if (crosses(a, b, o, 0.5)) return Infinity;
          if (!soft && crosses(a, b, o, 0.5 - MARGIN)) soft = true;
        }
    const length = x2 - x1 + (y2 - y1);
    let extra = 0;
    if (y1 === y2) {
      const near = firstAt(flatAt, y1 - TRACK + 0.5);
      for (let k = near; k < flat.length && flatAt[k] < y1 + TRACK - 0.5; k++)
        extra +=
          Math.max(0, Math.min(x2, flat[k].x1) - Math.max(x1, flat[k].x0)) *
          (SHARED - 1);
      // A route crossed at a grid point is counted by the step that ends
      // there, so each crossing is charged once.
      for (let k = firstAt(uprightAt, x1 + 1e-6); k < upright.length; k++) {
        if (uprightAt[k] > x2 + 1e-6) break;
        if (y1 > upright[k].y0 && y1 < upright[k].y1) extra += CROSSING;
      }
    } else {
      const near = firstAt(uprightAt, x1 - TRACK + 0.5);
      for (
        let k = near;
        k < upright.length && uprightAt[k] < x1 + TRACK - 0.5;
        k++
      )
        extra +=
          Math.max(
            0,
            Math.min(y2, upright[k].y1) - Math.max(y1, upright[k].y0),
          ) *
          (SHARED - 1);
      for (let k = firstAt(flatAt, y1 + 1e-6); k < flat.length; k++) {
        if (flatAt[k] > y2 + 1e-6) break;
        if (x1 > flat[k].x0 && x1 < flat[k].x1) extra += CROSSING;
      }
    }
    for (let cx = cellOf(x1); cx <= cellOf(x2); cx++)
      for (let cy = cellOf(y1); cy <= cellOf(y2); cy++)
        for (const n of labelCells.get(cx * 65536 + cy) || []) {
          if (labelSeen[n] === visit) continue;
          labelSeen[n] = visit;
          if (crosses(a, b, labels[n], 0.5))
            extra += length * (SOFT - 1) + LABEL_CROSSING;
        }
    return (soft ? length * SOFT : length) + extra;
  };
  const step = (i, j, d) => {
    if (d === 0 || d === 2) {
      const a = d === 0 ? i : i - 1;
      const k = j * (nx - 1) + a;
      if (across[k] < 0) across[k] = classify(xs[a], ys[j], xs[a + 1], ys[j]);
      return across[k];
    }
    const b = d === 1 ? j : j - 1;
    const k = i * (ny - 1) + b;
    if (down[k] < 0) down[k] = classify(xs[i], ys[b], xs[i], ys[b + 1]);
    return down[k];
  };
  const goalPoint = gj * nx + gi;
  const heap = new Heap();
  const start = (sj * nx + si) * 4 + fromDir;
  cost[start] = 0;
  heap.push(Math.abs(from.x - to.x) + Math.abs(from.y - to.y), start);
  while (heap.size) {
    const s = heap.pop();
    if (closed[s]) continue;
    closed[s] = 1;
    if (s === GOAL) break;
    const p = s >> 2,
      d = s & 3;
    const i = p % nx,
      j = (p - i) / nx;
    if (p === goalPoint) {
      const total = cost[s] + arrival[d];
      if (total < cost[GOAL]) {
        cost[GOAL] = total;
        parent[GOAL] = s;
        heap.push(total, GOAL);
      }
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === ((d + 2) & 3)) continue;
      const ni = i + DX[nd],
        nj = j + DY[nd];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const c = step(i, j, nd);
      if (c === Infinity) continue;
      const ns = (nj * nx + ni) * 4 + nd;
      const g = cost[s] + c + (nd === d ? 0 : BEND);
      if (g < cost[ns]) {
        cost[ns] = g;
        parent[ns] = s;
        heap.push(g + Math.abs(xs[ni] - to.x) + Math.abs(ys[nj] - to.y), ns);
      }
    }
  }
  if (parent[GOAL] < 0) return null;
  const points = [];
  for (let s = parent[GOAL]; s >= 0; s = parent[s]) {
    const p = s >> 2;
    const i = p % nx;
    points.push({ x: xs[i], y: ys[(p - i) / nx] });
  }
  return points.reverse();
}

/** The routes drawn, split into their level and upright segments, for the search to keep off. */
function occupancy() {
  const flat = [],
    upright = [],
    labels = [];
  return {
    flat,
    upright,
    // Labels that stay: a route may cross one, at a cost.
    labels,
    wide: false,
    add(points) {
      for (let k = 1; k < (points?.length || 0); k++) {
        const a = points[k - 1],
          b = points[k];
        if (a.y === b.y && a.x !== b.x)
          flat.push({ y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) });
        else if (a.x === b.x && a.y !== b.y)
          upright.push({
            x: a.x,
            y0: Math.min(a.y, b.y),
            y1: Math.max(a.y, b.y),
          });
      }
    },
  };
}

function regionAround(points, boxes, pad) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const b of [...points.map(pointBox), ...boxes]) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return {
    x0: round(x0 - pad),
    y0: round(y0 - pad),
    x1: round(x1 + pad),
    y1: round(y1 + pad),
  };
}

// Routes from one end to the other: first on a grid of the boxes near the
// two ends, which is all most routes need, then on the whole scene's when the
// near grid has no way through or its route runs into a box it left out.
function routeBetween(start, end, boxes, near, everything, occupied) {
  const local = regionAround([start.stub, end.stub], near, REGION);
  const tries = [
    [
      local,
      boxes.filter(
        (o) =>
          o.x - MARGIN < local.x1 &&
          o.x + o.width + MARGIN > local.x0 &&
          o.y - MARGIN < local.y1 &&
          o.y + o.height + MARGIN > local.y0,
      ),
    ],
    [regionAround([start.stub, end.stub], [everything], REGION), boxes],
  ];
  for (const [region, obstacles] of tries) {
    const found = search(
      start.stub,
      start.dir,
      end.stub,
      end.arrival,
      obstacles,
      region,
      obstacles === boxes && occupied && !occupied.wide
        ? { ...occupied, wide: true }
        : occupied,
    );
    if (!found) continue;
    const points = simplify([start.port, ...found, end.port]);
    if (obstacles === boxes || !hits(points, boxes)) return points;
  }
  // Nothing gets through: the boxes overlap or wall an end in. A plain elbow
  // at least stays orthogonal and joins the right ends.
  return simplify([
    start.port,
    start.stub,
    { x: end.stub.x, y: start.stub.y },
    end.stub,
    end.port,
  ]);
}

function arrivalInto(side) {
  const arrival = [BEND, BEND, BEND, BEND];
  arrival[(side + 2) & 3] = 0;
  arrival[side] = Infinity;
  return arrival;
}

// A self-relation's loop round one corner of its box. The k-th loop on a box
// stands a little further out than the one before.
function selfLoop(box, k, boxes) {
  const a = Math.min(16 + 12 * k, box.width / 2, box.height / 2);
  const r = 20 + 10 * k;
  const loopAt = (corner) => {
    const sx = corner === 0 || corner === 1 ? 1 : -1;
    const sy = corner === 1 || corner === 2 ? 1 : -1;
    const kx = sx > 0 ? box.x + box.width : box.x;
    const ky = sy > 0 ? box.y + box.height : box.y;
    const points = [
      { x: kx, y: ky - sy * a },
      { x: kx + sx * r, y: ky - sy * a },
      { x: kx + sx * r, y: ky + sy * r },
      { x: kx - sx * a, y: ky + sy * r },
      { x: kx - sx * a, y: ky },
    ].map((p) => ({ x: round(p.x), y: round(p.y) }));
    return { points, sides: [sx > 0 ? 0 : 2, sy > 0 ? 1 : 3] };
  };
  // Top right first, as the layout draws them, then the corners with room.
  for (const corner of [0, 1, 3, 2]) {
    const loop = loopAt(corner);
    const area = regionAround(loop.points, [], MARGIN);
    const clear = !boxes.some(
      (o) =>
        o.id !== box.id &&
        overlapping(
          {
            x: area.x0,
            y: area.y0,
            width: area.x1 - area.x0,
            height: area.y1 - area.y0,
          },
          o,
        ),
    );
    if (clear) return loop;
  }
  return loopAt(0);
}

// Moves the middle run of a Z-shaped route to the middle of the free room
// between the runs either side of it, as a layered layout would draw it,
// instead of hugging whichever margin the grid happened to offer.
function centreJogs(route, boxes, others = []) {
  const p = route.points;
  for (let k = 1; k < p.length - 2; k++) {
    const a = p[k],
      b = p[k + 1],
      before = p[k - 1],
      after = p[k + 2];
    const vertical = Math.abs(a.x - b.x) < 0.01;
    const axis = vertical ? "x" : "y",
      cross = vertical ? "y" : "x",
      size = vertical ? "width" : "height",
      crossSize = vertical ? "height" : "width";
    const c = a[axis];
    const d1 = c - before[axis],
      d2 = after[axis] - c;
    if (d1 * d2 <= 0) continue;
    const firstMin = k === 1 ? route.stubs[0] : 4;
    const lastMin = k + 2 === p.length - 1 ? route.stubs[1] : 4;
    let lo = d1 > 0 ? before[axis] + firstMin : after[axis] + lastMin;
    let hi = d1 > 0 ? after[axis] - lastMin : before[axis] - firstMin;
    const spanLo = Math.min(a[cross], b[cross]),
      spanHi = Math.max(a[cross], b[cross]);
    let blocked = false;
    for (const o of boxes) {
      if (
        o[cross] - MARGIN > spanHi ||
        o[cross] + o[crossSize] + MARGIN < spanLo
      )
        continue;
      const from = o[axis] - MARGIN,
        to = o[axis] + o[size] + MARGIN;
      if (to <= c) lo = Math.max(lo, to);
      else if (from >= c) hi = Math.min(hi, from);
      else blocked = true;
    }
    // Other routes running the same way bound the channel too, a track's
    // width off, so two routes in one channel are not both centred on it.
    for (const [m, n] of others) {
      if (vertical ? m.x !== n.x : m.y !== n.y) continue;
      if (
        Math.max(m[cross], n[cross]) < spanLo ||
        Math.min(m[cross], n[cross]) > spanHi
      )
        continue;
      const v = m[axis];
      if (v <= c) lo = Math.max(lo, v + TRACK);
      else hi = Math.min(hi, v - TRACK);
    }
    if (blocked || lo > hi || c < lo - 0.01 || c > hi + 0.01) continue;
    a[axis] = b[axis] = round((lo + hi) / 2);
  }
}

// Spreads routes that would run along the same line, libavoid's nudging in
// small: each extra route on a shared stretch moves a few pixels aside, if it
// can without coming near a box. Routes that stay as they were do not move.
function nudge(routes, boxes) {
  const lines = new Map();
  routes.forEach((route, r) => {
    const p = route.points;
    for (let k = 0; k + 1 < p.length; k++) {
      const vertical = Math.abs(p[k].x - p[k + 1].x) < 0.01;
      const c = vertical ? p[k].x : p[k].y;
      const ends = vertical ? [p[k].y, p[k + 1].y] : [p[k].x, p[k + 1].x];
      const key = (vertical ? "v" : "h") + c;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push({
        r,
        k,
        vertical,
        lo: Math.min(...ends),
        hi: Math.max(...ends),
        movable: route.movable && k > 0 && k < p.length - 2,
      });
    }
  });
  const offsets = [
    0,
    NUDGE,
    -NUDGE,
    2 * NUDGE,
    -2 * NUDGE,
    3 * NUDGE,
    -3 * NUDGE,
  ];
  const shift = (seg, offset) => {
    const p = routes[seg.r].points;
    const axis = seg.vertical ? "x" : "y";
    const moved = p.map((q) => ({ ...q }));
    moved[seg.k][axis] = round(moved[seg.k][axis] + offset);
    moved[seg.k + 1][axis] = round(moved[seg.k + 1][axis] + offset);
    // The runs either side keep their direction and some length.
    for (const [i, j] of [
      [seg.k - 1, seg.k],
      [seg.k + 1, seg.k + 2],
    ]) {
      const before = p[j][axis] - p[i][axis],
        after = moved[j][axis] - moved[i][axis];
      if (before * after <= 0 || Math.abs(after) < 4) return false;
      if (boxes.some((o) => crosses(moved[i], moved[j], o, 0.5))) return false;
    }
    if (
      boxes.some((o) => crosses(moved[seg.k], moved[seg.k + 1], o, -MARGIN / 2))
    )
      return false;
    routes[seg.r].points = moved;
    return true;
  };
  for (const segments of lines.values()) {
    if (segments.length < 2) continue;
    segments.sort((a, b) => a.lo - b.lo);
    let cluster = [];
    let reach = -Infinity;
    const settle = () => {
      if (
        new Set(cluster.map((s) => s.r)).size > 1 &&
        cluster.some((s) => s.movable)
      ) {
        const used = new Set(cluster.some((s) => !s.movable) ? [0] : []);
        for (const seg of cluster.filter((s) => s.movable))
          for (const offset of offsets) {
            if (used.has(offset)) continue;
            if (offset === 0 || shift(seg, offset)) {
              used.add(offset);
              break;
            }
          }
      }
    };
    for (const seg of segments) {
      if (seg.lo >= reach - 1 && cluster.length) {
        settle();
        cluster = [];
      }
      cluster.push(seg);
      reach = Math.max(reach, seg.hi);
    }
    settle();
  }
}

// Label candidates beside a route's segments, longest segment first and from
// its middle outward, above or right of the line before below or left.
function nameCandidates(label, routes) {
  const segments = routes
    .flatMap(segmentsOf)
    .map(([a, b]) => ({
      a,
      b,
      length: Math.abs(b.x - a.x) + Math.abs(b.y - a.y),
    }))
    .filter((s) => s.length > 0)
    .sort((s, t) => t.length - s.length);
  const out = [];
  for (const { a, b, length } of segments) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const ux = Math.sign(b.x - a.x),
      uy = Math.sign(b.y - a.y);
    for (let n = 0; n < 41; n++) {
      const offset = n === 0 ? 0 : (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 8;
      if (Math.abs(offset) > length / 2) break;
      const x = mid.x + ux * offset,
        y = mid.y + uy * offset;
      if (uy === 0)
        out.push(
          { x: x - label.width / 2, y: y - label.height - 4 },
          { x: x - label.width / 2, y: y + 4 },
        );
      else
        out.push(
          { x: x + 6, y: y - label.height / 2 },
          { x: x - label.width - 6, y: y - label.height / 2 },
        );
    }
  }
  return out;
}

// A count's candidates near its end of the route, as the layout offers them:
// beside the end itself, then beside the first stretch of the route.
function endCandidates(label, points) {
  const endpoint = points[0];
  const candidates = [];
  for (const x of [endpoint.x + 4, endpoint.x - label.width - 4])
    for (const y of [endpoint.y + 4, endpoint.y - label.height - 4])
      candidates.push({ x, y, score: label.width / 2 + label.height / 2 + 24 });
  let traveled = 0;
  for (let i = 1; i < points.length && traveled < 260; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = Math.sign(b.x - a.x),
      dy = Math.sign(b.y - a.y),
      length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    for (let d = 10; d < Math.min(length, 260 - traveled); d += 8) {
      const x = a.x + dx * d,
        y = a.y + dy * d;
      if (dx) {
        const left = dx > 0 ? x : x - label.width;
        candidates.push(
          { x: left, y: y - label.height - 3, score: traveled + d + 4 },
          { x: left, y: y + 3, score: traveled + d + 6 },
        );
      } else
        candidates.push(
          { x: x + 4, y: y - label.height / 2, score: traveled + d + 12 },
          {
            x: x - label.width - 4,
            y: y - label.height / 2,
            score: traveled + d + 14,
          },
        );
    }
    traveled += length;
  }
  return candidates
    .filter(
      (c) =>
        Math.abs(c.x + label.width / 2 - endpoint.x) +
          Math.abs(c.y + label.height / 2 - endpoint.y) <=
        80,
    )
    .sort((a, b) => a.score - b.score);
}

// Places each task's labels on its new routes. A label must keep clear of
// the boxes and the labels placed before it, and, where it can, of every
// route; failing that, of its own route; failing that, of the boxes alone.
function placeLabels(tasks, boxes, fixedLabels, allSegments) {
  const occupied = [...boxes, ...fixedLabels];
  for (const names of [true, false])
    for (const task of tasks) {
      const own = task.routes.flatMap(segmentsOf);
      for (const label of task.labels) {
        if ((label.kind === "name") !== names) continue;
        const candidates = names
          ? nameCandidates(label, task.nameRoutes)
          : endCandidates(
              label,
              label.kind === "target"
                ? task.routes[0].slice().reverse()
                : task.routes[0],
            );
        const fits = (c, tier) => {
          const r = {
            x: c.x,
            y: c.y,
            width: label.width,
            height: label.height,
          };
          const others = tier < 3 ? occupied : boxes;
          if (others.some((o) => overlapping(r, o, 2))) return false;
          if (tier < 2 && own.some(([a, b]) => rectTouchesSegment(r, a, b, 1)))
            return false;
          if (
            tier < 1 &&
            allSegments.some(([a, b]) => rectTouchesSegment(r, a, b, 1))
          )
            return false;
          return true;
        };
        // The cheapest place: never on a box; then as few labels, other
        // routes and stretches of its own route under it as can be, and as
        // near its first choice.
        let chosen = null,
          lowest = Infinity;
        for (let rank = 0; rank < candidates.length; rank++) {
          // Nothing further down can beat what is found: its rank alone costs more.
          if (rank * RANK >= lowest) break;
          const c = candidates[rank];
          const r = {
            x: c.x,
            y: c.y,
            width: label.width,
            height: label.height,
          };
          if (boxes.some((o) => overlapping(r, o, 2))) continue;
          let cost = rank * RANK;
          for (const o of occupied) if (overlapping(r, o, 2)) cost += 400;
          for (const [a, b] of allSegments)
            if (rectTouchesSegment(r, a, b, 1)) cost += 120;
          for (const [a, b] of own)
            if (rectTouchesSegment(r, a, b, 1)) cost += 60;
          if (cost < lowest) {
            lowest = cost;
            chosen = c;
          }
        }
        if (!chosen)
          for (let tier = 0; tier < 4 && !chosen; tier++)
            chosen = candidates.find((c) => fits(c, tier)) || null;
        chosen ||= candidates[0] || { x: label.x, y: label.y };
        label.x = round(chosen.x);
        label.y = round(chosen.y);
        occupied.push(label);
      }
    }
}

// Puts the elements without a saved position next to the ones they relate
// to, in the nearest free spot; those with no placed neighbour stack in a
// column to the right of what is placed.
function placeMissing(scene, target) {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const neighbours = new Map(scene.nodes.map((n) => [n.id, new Set()]));
  const link = (a, b) => {
    if (a === b || !neighbours.has(a) || !neighbours.has(b)) return;
    neighbours.get(a).add(b);
    neighbours.get(b).add(a);
  };
  for (const e of scene.edges) link(e.source, e.target);
  for (const g of scene.generalizationGroups || [])
    for (const id of g.sourceIds) link(id, g.target);
  const boxAt = (id, [x, y]) => ({
    x,
    y,
    width: byId.get(id).width,
    height: byId.get(id).height,
  });
  const placed = [...target].map(([id, p]) => boxAt(id, p));
  const free = (b) => !placed.some((o) => overlapping(b, o, PLACE_GAP - 0.01));
  const right = Math.max(
    PADDING - PLACE_GAP,
    ...placed.map((b) => b.x + b.width),
  );
  let columnY = placed.length ? Math.min(...placed.map((b) => b.y)) : PADDING;
  const columnX = right + PLACE_GAP;
  const pending = scene.nodes.filter((n) => !target.has(n.id));
  while (pending.length) {
    let progressed = false;
    for (let i = 0; i < pending.length; i++) {
      const node = pending[i];
      const near = [...neighbours.get(node.id)].filter((id) => target.has(id));
      if (!near.length) continue;
      const centres = near.map((id) => centreOf(boxAt(id, target.get(id))));
      const cx = centres.reduce((s, c) => s + c.x, 0) / centres.length;
      const cy = centres.reduce((s, c) => s + c.y, 0) / centres.length;
      const want = { x: cx - node.width / 2, y: cy - node.height / 2 };
      let spot = null;
      // Rings of growing size round the wanted spot; the nearest free point
      // of the first ring that has one.
      for (let r = 0; r < 400 && !spot; r++) {
        let best = Infinity;
        const ring = r
          ? Array.from({ length: 2 * r + 1 }, (_, k) => k - r).flatMap((k) => [
              [k, -r],
              [k, r],
              [-r, k],
              [r, k],
            ])
          : [[0, 0]];
        for (const [i2, j2] of ring) {
          const b = {
            x: want.x + i2 * 20,
            y: want.y + j2 * 20,
            width: node.width,
            height: node.height,
          };
          const d = Math.hypot(b.x - want.x, b.y - want.y);
          if (d < best && free(b)) {
            best = d;
            spot = [round(b.x), round(b.y)];
          }
        }
      }
      target.set(node.id, spot || [round(want.x), round(want.y)]);
      placed.push(boxAt(node.id, target.get(node.id)));
      pending.splice(i--, 1);
      progressed = true;
    }
    if (progressed) continue;
    const node = pending.shift();
    let y = columnY;
    while (!free({ x: columnX, y, width: node.width, height: node.height }))
      y += 20;
    target.set(node.id, [round(columnX), round(y)]);
    placed.push(boxAt(node.id, target.get(node.id)));
    columnY = y + node.height + PLACE_GAP;
  }
}

/** Every element's current top-left corner, keyed by its id. */
export function positionsOf(scene) {
  return Object.fromEntries(scene.nodes.map((n) => [n.id, [n.x, n.y]]));
}

/**
 * A new scene with the elements at `positions` ({ id: [x, y] }, top-left) and
 * the relations they disturb re-routed. With `options.place`, elements
 * missing from `positions` are placed beside their neighbours. When anything
 * would sit above or left of the padding, the whole scene shifts, and
 * `offset` says by how much.
 */
export function arrangeScene(scene, positions = {}, options = {}) {
  positions = positions || {};
  if (options.place && !Object.keys(positions).length) return scene;
  const target = new Map();
  for (const n of scene.nodes) {
    const p = positions[n.id];
    if (p) target.set(n.id, Array.isArray(p) ? p : [p.x, p.y]);
    else if (!options.place) target.set(n.id, [n.x, n.y]);
  }
  if (options.place) placeMissing(scene, target);

  const moved = new Set();
  const nodes = scene.nodes.map((n) => {
    const [x, y] = target.get(n.id);
    if (Math.abs(x - n.x) < 0.005 && Math.abs(y - n.y) < 0.005) return n;
    moved.add(n.id);
    return { ...n, x: round(x), y: round(y) };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const boxes = nodes;
  const everything = regionAround([], boxes, 0);
  const everythingBox = {
    x: everything.x0,
    y: everything.y0,
    width: everything.x1 - everything.x0,
    height: everything.y1 - everything.y0,
  };

  const groups = scene.generalizationGroups || [];
  // Which of a member edge's paths belongs to which group: the layout writes
  // them in the order of the groups.
  const membership = new Map();
  for (const g of groups)
    for (const id of g.memberIds) {
      if (!membership.has(id)) membership.set(id, []);
      membership.get(id).push({ group: g, index: membership.get(id).length });
    }
  const edgesById = new Map(scene.edges.map((e) => [e.id, e]));

  // Decide what to re-route.
  const plain = [];
  for (const edge of scene.edges) {
    if (membership.has(edge.id)) continue;
    const ok = byId.has(edge.source) && byId.has(edge.target);
    const points = edge.paths?.length ? parsePath(edge.paths[0]) : [];
    const reroute =
      ok &&
      (moved.has(edge.source) ||
        moved.has(edge.target) ||
        points.length < 2 ||
        hits(points, boxes, new Set([edge.source, edge.target])));
    plain.push({ edge, points, reroute });
  }
  const trees = groups.map((group) => {
    const members = group.memberIds.map((id) => {
      const edge = edgesById.get(id);
      const index = membership.get(id).find((m) => m.group === group).index;
      const d = edge?.branchPaths?.[index];
      return { id, edge, index, points: d ? parsePath(d) : [] };
    });
    const trunk = group.paths?.length ? parsePath(group.paths[0]) : [];
    const ok =
      byId.has(group.target) &&
      members.every((m) => m.edge && byId.has(m.edge.source));
    const reroute =
      ok &&
      (moved.has(group.target) ||
        members.some((m) => moved.has(m.edge.source)) ||
        trunk.length < 2 ||
        hits(trunk, boxes, new Set([group.target])) ||
        members.some(
          (m) =>
            m.points.length < 2 ||
            hits(m.points, boxes, new Set([m.edge.source])),
        ));
    return { group, members, trunk, reroute };
  });

  // Ends on each side of each box: those of routes that stay are fixed, and
  // those of new routes spread round them.
  const sides = new Map();
  const addEnd = (box, side, item) => {
    const key = box.id + "\u0000" + side;
    if (!sides.has(key)) sides.set(key, { box, side, items: [] });
    sides.get(key).items.push(item);
  };
  const fixEnd = (id, p) => {
    const box = byId.get(id);
    if (!box || !p) return;
    const side = sideOf(box, p);
    if (side >= 0) addEnd(box, side, { pref: alongY(side) ? p.y : p.x });
  };
  for (const r of plain)
    if (!r.reroute && r.points.length) {
      fixEnd(r.edge.source, r.points[0]);
      fixEnd(r.edge.target, r.points[r.points.length - 1]);
    }
  for (const t of trees)
    if (!t.reroute) {
      fixEnd(t.group.target, t.trunk[t.trunk.length - 1]);
      for (const m of t.members) if (m.edge) fixEnd(m.edge.source, m.points[0]);
    }

  // Self loops sit on corners; their ends then count as fixed.
  const loopCount = new Map();
  for (const r of plain)
    if (r.reroute && r.edge.source === r.edge.target) {
      const box = byId.get(r.edge.source);
      const k = loopCount.get(box.id) || 0;
      loopCount.set(box.id, k + 1);
      const loop = selfLoop(box, k, boxes);
      r.route = loop.points;
      fixEnd(box.id, loop.points[0]);
      fixEnd(box.id, loop.points[loop.points.length - 1]);
    }

  // An end takes the side facing the other box, or, when that side has no
  // room left for another port, the side facing it the other way.
  const room = (box, side) => {
    const [lo, hi] = sideSpan(box, side);
    const used = sides.get(box.id + "\u0000" + side)?.items.length || 0;
    return Math.floor((hi - lo) / PORT_GAP) + 1 - used;
  };
  const endOf = (box, primary, other, order = "") => {
    let side = primary;
    if (room(box, primary) <= 0) {
      const o = centreOf(other),
        c = centreOf(box);
      const second = alongY(primary)
        ? o.y >= c.y
          ? 1
          : 3
        : o.x >= c.x
          ? 0
          : 2;
      if (room(box, second) > 0) side = second;
    }
    const end = { box, side, along: null };
    addEnd(box, side, {
      pref: preferredAlong(box, side, other),
      weight: 1,
      order,
      end,
    });
    return end;
  };
  for (const r of plain)
    if (r.reroute && !r.route) {
      const s = byId.get(r.edge.source),
        t = byId.get(r.edge.target);
      r.ends = [
        endOf(s, facing(s, t), t, r.edge.id),
        endOf(t, facing(t, s), s, r.edge.id),
      ];
    }
  for (const t of trees)
    if (t.reroute) {
      const box = byId.get(t.group.target);
      const sources = t.members.map((m) => centreOf(byId.get(m.edge.source)));
      const centroid = {
        x: sources.reduce((s, c) => s + c.x, 0) / sources.length,
        y: sources.reduce((s, c) => s + c.y, 0) / sources.length,
      };
      const side = facing(box, pointBox(centroid));
      const [lo, hi] = sideRange(box, side);
      const middle = (lo + hi) / 2;
      // The trunk leans toward the subtypes, within the middle third of the
      // side, so the tree's branches stay short without leaving its centre.
      const along = round(
        clamp(
          alongY(side) ? centroid.y : centroid.x,
          middle - (hi - lo) / 6,
          middle + (hi - lo) / 6,
        ),
      );
      const port = portPoint(box, side, along);
      const junction = {
        x: round(port.x + DX[side] * JUNCTION),
        y: round(port.y + DY[side] * JUNCTION),
      };
      t.side = side;
      t.trunk = [junction, port];
      addEnd(box, side, { pref: along });
      for (const m of t.members) {
        const s = byId.get(m.edge.source);
        m.end = endOf(
          s,
          facing(s, pointBox(junction)),
          pointBox(junction),
          m.id,
        );
      }
    }

  // On each side the ends that stay keep their places and mark out free
  // stretches, a port gap clear of them. Each new end goes to the stretch it
  // would like to be in (or the nearest with room), and the new ends of a
  // stretch are laid out in order, a port gap apart, so relations between
  // the same two boxes keep their order at both and do not cross.
  for (const { box, side, items } of sides.values()) {
    if (!items.some((item) => item.end)) continue;
    const [lo, hi] = sideSpan(box, side);
    const gap = Math.min(
      PORT_GAP,
      Math.max(0, hi - lo) / Math.max(1, items.length - 1),
    );
    const fixed = items
      .filter((item) => !item.end)
      .map((item) => item.pref)
      .sort((p, q) => p - q);
    const stretches = [];
    let start = lo;
    // Kept clear of the side's rounded corners, as every end is.
    for (const f of fixed) {
      stretches.push({
        lo: Math.max(lo, start),
        hi: Math.min(hi, f - gap),
        items: [],
      });
      start = f + gap;
    }
    stretches.push({ lo: Math.max(lo, start), hi, items: [] });
    const open = stretches.filter((st) => st.hi >= st.lo - 0.01);
    const fresh = items
      .filter((item) => item.end)
      .sort(
        (p, q) =>
          p.pref - q.pref ||
          (p.order < q.order ? -1 : p.order > q.order ? 1 : 0),
      );
    // A stretch a rounding error leaves inverted still holds one end.
    const capacity = (st) =>
      Math.max(1, Math.floor((st.hi - st.lo) / Math.max(gap, 1e-6) + 1e-6) + 1);
    const overflow = [];
    for (const item of fresh) {
      const ranked = open
        .map((st) => ({
          st,
          away:
            item.pref < st.lo
              ? st.lo - item.pref
              : item.pref > st.hi
                ? item.pref - st.hi
                : 0,
        }))
        .sort((p, q) => p.away - q.away);
      const home = ranked.find(({ st }) => st.items.length < capacity(st))?.st;
      if (home) home.items.push(item);
      else overflow.push(item);
    }
    const taken = [...fixed];
    for (const st of open) {
      if (!st.items.length) continue;
      const at = spread(st.items, st.lo, Math.max(st.lo, st.hi));
      st.items.forEach((item, k) => {
        item.end.along = round(at[k]);
        taken.push(item.end.along);
      });
    }
    // Ends no stretch has room for take the free place nearest them, clear
    // of every end placed, each in turn.
    for (const item of overflow) {
      item.end.along = round(freePlace(item.pref, taken, lo, hi, gap));
      taken.push(item.end.along);
    }
  }
  const terminal = (end) => {
    const port = portPoint(end.box, end.side, end.along);
    const length = round(stubLength(end.box, end.side, port, boxes));
    const stub = {
      x: round(port.x + DX[end.side] * length),
      y: round(port.y + DY[end.side] * length),
    };
    return { port, stub, length };
  };

  // What is drawn already, which new routes keep off: the routes that stay,
  // then each new one as it is drawn, the shortest first.
  const occupied = occupancy();
  // While an element is dragged, routes keep off the others by cost alone,
  // without the tracks beside them, so each move routes at once.
  if (options.quick) occupied.wide = true;
  for (const r of plain)
    if (!r.reroute) {
      occupied.add(r.points);
      occupied.labels.push(...(r.edge.labels || []));
    }
  for (const t of trees)
    if (!t.reroute) {
      occupied.add(t.trunk);
      for (const m of t.members) occupied.add(m.points);
    }
  const pending = plain
    .filter((r) => r.reroute && !r.route)
    .map((r) => ({ r, from: terminal(r.ends[0]), to: terminal(r.ends[1]) }))
    .sort(
      (a, b) =>
        Math.abs(a.from.stub.x - a.to.stub.x) +
          Math.abs(a.from.stub.y - a.to.stub.y) -
          (Math.abs(b.from.stub.x - b.to.stub.x) +
            Math.abs(b.from.stub.y - b.to.stub.y)) ||
        (a.r.edge.id < b.r.edge.id ? -1 : 1),
    );
  const routed = [];
  for (const { r, from, to } of pending) {
    r.route = routeBetween(
      { ...from, dir: r.ends[0].side },
      { ...to, arrival: arrivalInto(r.ends[1].side) },
      boxes,
      [r.ends[0].box, r.ends[1].box],
      everythingBox,
      occupied,
    );
    occupied.add(r.route);
    routed.push({
      points: r.route,
      movable: true,
      stubs: [from.length, to.length],
      owner: r,
    });
  }
  for (const t of trees)
    if (t.reroute) {
      const junction = t.trunk[0];
      // A branch may meet the junction from any side but the trunk's.
      const arrival = [0, 0, 0, 0];
      arrival[t.side] = Infinity;
      for (const m of t.members) {
        const from = terminal(m.end);
        m.points = routeBetween(
          { ...from, dir: m.end.side },
          { port: junction, stub: junction, arrival },
          boxes,
          [m.end.box, byId.get(t.group.target)],
          everythingBox,
          occupied,
        );
        occupied.add(m.points);
      }
    }

  // Straighten and separate the new routes against everything drawn.
  const everyRoute = [
    ...routed.map((r) => r.points),
    ...plain.filter((r) => !r.reroute).map((r) => r.points),
    ...trees.flatMap((t) => [t.trunk, ...t.members.map((m) => m.points)]),
  ];
  for (const route of routed)
    centreJogs(
      route,
      boxes,
      everyRoute.filter((p) => p !== route.points).flatMap(segmentsOf),
    );
  const drawn = [
    ...routed,
    ...plain
      .filter((r) => !r.reroute || !routed.some((x) => x.owner === r))
      .map((r) => ({ points: r.route || r.points, movable: false })),
    ...trees.flatMap((t) => [
      { points: t.trunk, movable: false },
      ...t.members.map((m) => ({ points: m.points, movable: false })),
    ]),
  ];
  nudge(drawn, boxes);
  for (const route of routed) route.owner.route = route.points;

  // Labels: those of new routes, and any a moved box now covers.
  const tasks = [];
  const fixedLabels = [];
  const newLabels = new Map();
  const relabel = (owner, labels, routes, nameRoutes) => {
    const copies = labels.map((l) => ({ ...l }));
    newLabels.set(owner, copies);
    tasks.push({ labels: copies, routes, nameRoutes });
  };
  for (const r of plain) {
    const labels = r.edge.labels || [];
    if (!labels.length) continue;
    const route = r.route || r.points;
    if (
      r.route ||
      (route.length >= 2 &&
        labels.some((l) => boxes.some((b) => overlapping(l, b, 0))))
    )
      relabel(r.edge, labels, [route], [route]);
    else fixedLabels.push(...labels);
  }
  for (const t of trees) {
    const labels = t.group.labels || [];
    if (!labels.length) continue;
    const routes = [t.trunk, ...t.members.map((m) => m.points)];
    if (
      t.reroute ||
      (t.trunk.length >= 2 &&
        labels.some((l) => boxes.some((b) => overlapping(l, b, 0))))
    )
      relabel(t.group, labels, [t.trunk], routes);
    else fixedLabels.push(...labels);
  }
  const allSegments = drawn.flatMap((d) => segmentsOf(d.points));
  placeLabels(tasks, boxes, fixedLabels, allSegments);

  // The new scene.
  const changed = new Map();
  for (const r of plain)
    if (r.route || newLabels.has(r.edge))
      changed.set(r.edge.id, {
        ...r.edge,
        ...(r.route ? { paths: [pathOf(r.route)] } : {}),
        labels: newLabels.get(r.edge) || r.edge.labels,
      });
  const newGroups = trees.map((t) => {
    if (!t.reroute && !newLabels.has(t.group)) return t.group;
    if (t.reroute)
      for (const m of t.members) {
        const edge = changed.get(m.id) || m.edge;
        const paths = [...edge.paths];
        const branchPaths = [...(edge.branchPaths || [])];
        paths[m.index] = pathOf([...m.points, ...t.trunk.slice(1)]);
        branchPaths[m.index] = pathOf(m.points);
        changed.set(m.id, { ...edge, paths, branchPaths });
      }
    return {
      ...t.group,
      ...(t.reroute ? { paths: [pathOf(t.trunk)] } : {}),
      labels: newLabels.get(t.group) || t.group.labels,
    };
  });
  let edges = scene.edges.map((e) => changed.get(e.id) || e);
  let outGroups = newGroups;
  let outNodes = nodes;
  // A package's region follows its elements: round them, with room for its
  // name above them.
  const placedNodes = new Map(nodes.map((n) => [n.id, n]));
  let packages = (scene.packages || []).map((p) => {
    const own = (p.members || [])
      .map((id) => placedNodes.get(id))
      .filter(Boolean);
    if (!own.length) return p;
    const px0 = Math.min(...own.map((n) => n.x)) - PACKAGE_MARGIN,
      py0 = Math.min(...own.map((n) => n.y)) - PACKAGE_MARGIN - PACKAGE_HEADER,
      px1 = Math.max(...own.map((n) => n.x + n.width)) + PACKAGE_MARGIN,
      py1 = Math.max(...own.map((n) => n.y + n.height)) + PACKAGE_MARGIN;
    return {
      ...p,
      x: round(px0),
      y: round(py0),
      width: round(px1 - px0),
      height: round(py1 - py0),
    };
  });

  // Size, and the shift that keeps everything inside the padding.
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const take = (x, y, w = 0, h = 0) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };
  for (const n of nodes) take(n.x, n.y, n.width, n.height);
  for (const p of packages) take(p.x, p.y, p.width, p.height);
  for (const item of [...edges, ...outGroups]) {
    for (const d of item.paths || [])
      for (const p of parsePath(d)) take(p.x, p.y);
    for (const l of item.labels || []) take(l.x, l.y, l.width, l.height);
  }
  if (x0 === Infinity) x0 = y0 = x1 = y1 = PADDING;
  const dx = x0 < PADDING ? round(PADDING - x0) : 0;
  const dy = y0 < PADDING ? round(PADDING - y0) : 0;
  if (dx || dy) {
    const movePath = (d) =>
      pathOf(parsePath(d).map((p) => ({ x: p.x + dx, y: p.y + dy })));
    const moveLabel = (l) => ({ ...l, x: round(l.x + dx), y: round(l.y + dy) });
    const moveItem = (item) => ({
      ...item,
      ...(item.paths ? { paths: item.paths.map(movePath) } : {}),
      ...(item.branchPaths
        ? { branchPaths: item.branchPaths.map(movePath) }
        : {}),
      ...(item.labels ? { labels: item.labels.map(moveLabel) } : {}),
    });
    outNodes = nodes.map((n) => ({
      ...n,
      x: round(n.x + dx),
      y: round(n.y + dy),
    }));
    edges = edges.map(moveItem);
    outGroups = outGroups.map(moveItem);
    packages = packages.map((p) => ({
      ...p,
      x: round(p.x + dx),
      y: round(p.y + dy),
    }));
  }
  return {
    ...scene,
    nodes: outNodes,
    edges,
    ...(scene.generalizationGroups ? { generalizationGroups: outGroups } : {}),
    ...(scene.packages ? { packages } : {}),
    width: round(x1 + dx + PADDING),
    height: round(y1 + dy + PADDING),
    offset: { x: dx, y: dy },
  };
}
