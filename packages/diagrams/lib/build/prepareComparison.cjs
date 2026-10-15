// Families: models laid out once together, each shown alone or compared with
// its baseline. A family's members are entries (see prepareEntry): a model with
// its views, snippets and semantic content, and a proposal's baseline entry.
const { clone, fingerprint } = require("../fingerprint.cjs");
const { semantic, compareModels } = require("./compareModels.cjs");
const { prepareModel } = require("./buildViewer.cjs");
const { defaultNodeIds } = require("../layout/prepareViews.cjs");
const { relationLabel, labelSize } = require("../layout/layoutDiagram.cjs");
const { knownMultiplicity } = require("../layout/multiplicity.cjs");
const keyOf = (e) => {
  const { originalId, changeStatus, ...data } = e;
  const id = originalId || e.id;
  data.id = id;
  return `route-${fingerprint([id, semantic(data)]).slice(0, 24)}`;
};
// Each list's items by ID, a later list's version replacing an earlier one in
// its place.
function members(...lists) {
  const out = new Map();
  for (const list of lists) for (const v of list) out.set(v.id, v);
  return [...out.values()];
}
// A changed class lists its proposed members in their order, with each removed
// member kept where it was, so the change view can show what disappears. A
// member new to the class is added, also when it moved from another class.
function changedMembers(before = [], after = [], statuses) {
  const proposed = new Set(after.map((m) => m.id));
  const had = new Set(before.map((m) => m.id));
  const out = after.map((m) => ({
    ...m,
    changeStatus: had.has(m.id) ? statuses.get(m.id) || "unchanged" : "added",
  }));
  let previous = null;
  for (const m of before) {
    if (proposed.has(m.id)) {
      previous = m.id;
      continue;
    }
    const at = previous ? out.findIndex((n) => n.id === previous) + 1 : 0;
    out.splice(at, 0, { ...m, changeStatus: "removed" });
    previous = m.id;
  }
  return out;
}
// What a proposal changes against its baseline, element by element, with the
// planning records its context links to each change.
function compareEntries(baseline, entry) {
  const result = compareModels(baseline.semantic, entry.semantic);
  const context = entry.model.document?.context || { records: [], links: [] };
  const records = new Map(context.records.map((r) => [r.id, r]));
  const elements = new Map(
    [
      ...entry.model.classes,
      ...entry.model.relations,
      ...entry.model.generalizations,
    ].map((e) => [e.id, e]),
  );
  const evidenceOf = (id) => {
    const element = elements.get(id);
    return element?.evidence?.length
      ? {
          evidence: element.evidence,
          ...(element.primarySource
            ? { primarySource: element.primarySource }
            : {}),
          ...(element.status ? { status: element.status } : {}),
        }
      : null;
  };
  for (const change of result.changes) {
    // An element and its owner may link the same record; list it once.
    change.rationale = [
      ...new Set(
        context.links
          .filter((l) =>
            [change.elementId, change.ownerId].includes(l.elementId),
          )
          .map((l) => l.recordId),
      ),
    ]
      .map((id) => records.get(id))
      .filter(Boolean);
    change.evidence =
      evidenceOf(change.elementId) || evidenceOf(change.ownerId) || null;
  }
  return {
    ...result,
    baseRevision: baseline.revision,
    proposedRevision: entry.revision,
    missingRationale: result.changes
      .filter((c) => c.elementId && !c.rationale.length)
      .map((c) => c.elementId),
  };
}
// A table lists its foreign keys (SQLite as `foreignKeys`, PostgreSQL as
// constraints of type "f"), and those whose target was captured are its
// relations too, which tell them. Each change keeps only the keys no relation
// shows; a change left with nothing else to tell is the relations'.
const KEY_LISTS = new Set(["foreignKeys", "constraints"]);
function keepUnshownKeys(diff, ...models) {
  const relations = models
    .flatMap((m) => m.relations)
    .filter((r) => Array.isArray(r.columns));
  const names = new Map(
    models.flatMap((m) => m.classes.map((c) => [c.id, c.name])),
  );
  const shown = (table, key) =>
    !!key &&
    typeof key === "object" &&
    relations.some((r) =>
      r.sourceId !== table
        ? false
        : key.type === "f"
          ? r.name === key.name
          : Array.isArray(key.columns) &&
            typeof key.target === "string" &&
            JSON.stringify(r.columns) === JSON.stringify(key.columns) &&
            (r.target === key.target || names.get(r.targetId) === key.target),
    );
  const unshown = (table, cell) =>
    cell.present && Array.isArray(cell.value)
      ? { present: true, value: cell.value.filter((k) => !shown(table, k)) }
      : cell;
  diff.changes = diff.changes.filter((change) => {
    if (change.kind !== "modified" || !change.elementId) return true;
    change.properties = change.properties
      .map((p) =>
        KEY_LISTS.has(p.key)
          ? {
              ...p,
              before: unshown(change.elementId, p.before),
              after: unshown(change.elementId, p.after),
            }
          : p,
      )
      .filter(
        (p) =>
          !KEY_LISTS.has(p.key) ||
          JSON.stringify(p.before) !== JSON.stringify(p.after),
      );
    return change.properties.length > 0;
  });
  diff.counts = Object.fromEntries(
    ["added", "removed", "modified"].map((kind) => [
      kind,
      diff.changes.filter((c) => c.kind === kind).length,
    ]),
  );
}
const ends = (e) => [e.sourceId ?? e.specificId, e.targetId ?? e.generalId];
// The same relation, of the same kind, between the same ends: an association
// that becomes inheritance is a new route.
const sameEnds = (a, b) =>
  a.id === b.id &&
  "specificId" in a === "specificId" in b &&
  ends(a).every((end, i) => end === ends(b)[i]);
const round = (n) => Number(n.toFixed(2));
const pointsOf = (path) => {
  const n = (path.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const points = [];
  for (let i = 0; i + 1 < n.length; i += 2) points.push([n[i], n[i + 1]]);
  return points;
};
// The earlier version of a relation the proposal changed in place takes the
// proposal's route with its own name and counts. Each label keeps the place
// of the proposal's; one the proposal has not got sits beside its end of the
// route, or above the middle of its longest segment.
function relabel(edge, relation) {
  if ("specificId" in relation) return edge.labels;
  const texts = {
    name: relationLabel(relation),
    source: knownMultiplicity(relation.sourceMultiplicity)
      ? relation.sourceMultiplicity
      : null,
    target: knownMultiplicity(relation.targetMultiplicity)
      ? relation.targetMultiplicity
      : null,
  };
  const routes = edge.paths.map(pointsOf);
  return Object.entries(texts)
    .filter(([, text]) => text)
    .map(([kind, text]) => {
      const size = labelSize(text, kind !== "name");
      const at = edge.labels.find((l) => l.kind === kind);
      if (at)
        return {
          ...at,
          text,
          ...size,
          x: round(at.x + (at.width - size.width) / 2),
        };
      let center;
      if (kind === "name") {
        const segments = routes.flatMap((points) =>
          points.slice(1).map((p, i) => [points[i], p]),
        );
        const [a, b] = segments.sort(
          ([a1, b1], [a2, b2]) =>
            Math.abs(b2[0] - a2[0]) +
            Math.abs(b2[1] - a2[1]) -
            Math.abs(b1[0] - a1[0]) -
            Math.abs(b1[1] - a1[1]),
        )[0];
        center = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - size.height / 2 - 4];
      } else {
        const points =
          kind === "source" ? routes[0] : [...routes.at(-1)].reverse();
        const [end, next] = points;
        const dx = Math.sign(next[0] - end[0]),
          dy = Math.sign(next[1] - end[1]);
        center = [end[0] + dx * 22 + dy * 16, end[1] + dy * 22 - dx * 16];
      }
      return {
        id: `${edge.id}-${kind === "name" ? "name" : kind === "source" ? "tail" : "head"}`,
        text,
        ...size,
        x: round(center[0] - size.width / 2),
        y: round(center[1] - size.height / 2),
        kind,
        ...(kind === "name"
          ? {}
          : { nodeId: kind === "source" ? edge.source : edge.target }),
      };
    });
}
// Comparisons keep the document's authored views (falling back to the
// baseline's), so a focused view stays focused. Removed classes join a view
// when the baseline showed them there or they were connected to its classes.
// Classes outside every authored view appear in an extra all-elements view.
// `classIds` are the baseline's and the proposal's classes; `routes` the laid
// out routes they draw.
function comparisonViews(entry, baseline, classIds, before, after, routes) {
  const ids = new Set(classIds);
  const all = {
    key: "comparison",
    label: "Model",
    title: entry.model.title,
    nodeIds: [...ids],
    mergeGeneralizations: false,
  };
  const authored = entry.views.length ? entry.views : baseline.views;
  if (!authored?.length) return [all];
  const afterIds = new Set(after.classes.map((c) => c.id));
  const removed = before.classes
    .map((c) => c.id)
    .filter((id) => !afterIds.has(id));
  const beforeEdges = [
    ...before.relations.map((r) => [r.sourceId, r.targetId]),
    ...before.generalizations.map((g) => [g.specificId, g.generalId]),
  ];
  const afterRouteIds = new Set(
    [...after.relations, ...after.generalizations].map((e) => e.id),
  );
  const views = authored.map((view) => {
    const baselineView = baseline.views?.find((v) => v.key === view.key);
    const members = new Set(view.nodeIds.filter((id) => ids.has(id)));
    for (const id of removed)
      if (
        baselineView?.nodeIds.includes(id) ||
        beforeEdges.some(
          ([a, b]) =>
            (a === id && members.has(b)) || (b === id && members.has(a)),
        )
      )
        members.add(id);
    const nodeIds = [...members];
    const columns = view.columns
      ?.map((column) => column.filter((id) => members.has(id)))
      .filter((column) => column.length);
    const placed = new Set(columns?.flat());
    const unplaced = nodeIds.filter((id) => !placed.has(id));
    const focusIds = view.focusIds?.filter((id) => members.has(id));
    const edgeIds = view.edgeIds
      ? [...routes]
          .filter(
            ([, e]) =>
              (view.edgeIds.includes(e.id) || !afterRouteIds.has(e.id)) &&
              members.has(e.sourceId ?? e.specificId) &&
              members.has(e.targetId ?? e.generalId),
          )
          .map(([key]) => key)
      : undefined;
    return {
      key: view.key,
      label: view.label,
      title: view.title || entry.model.title,
      nodeIds,
      ...(columns?.length
        ? { columns: unplaced.length ? [...columns, unplaced] : columns }
        : {}),
      ...(focusIds?.length ? { focusIds } : {}),
      ...(edgeIds ? { edgeIds } : {}),
      ...(view.direction ? { direction: view.direction } : {}),
      mergeGeneralizations: false,
    };
  });
  const usable = views.filter((v) => v.nodeIds.length);
  const covered = new Set(usable.flatMap((v) => v.nodeIds));
  if (!usable.length || [...ids].some((id) => !covered.has(id))) {
    let key = all.key;
    while (usable.some((v) => v.key === key)) key += "-all";
    usable.push({
      ...all,
      key,
      label: usable.length ? "All elements" : "Model",
    });
  }
  return usable;
}
// A capture in a family shows its own views, or else the classes it shows
// alone (all but its datatypes and enumerations) in one view keyed as its
// proposals' combined view is, so switching keeps the view. As in those views,
// its inheritance is drawn as separate arrows rather than joined: the shared
// layout routes each member's generalizations alike.
// `laidKey` names the laid out route a relation of the capture is drawn on.
function captureViews(entry, model, laidKey) {
  const ids = new Set(model.classes.map((c) => c.id));
  const views = entry.views
    .map((view) => {
      const nodeIds = view.nodeIds.filter((id) => ids.has(id));
      const shown = new Set(nodeIds);
      return {
        key: view.key,
        label: view.label,
        title: view.title || entry.model.title,
        nodeIds,
        ...(view.columns ? { columns: view.columns } : {}),
        ...(view.focusIds?.length ? { focusIds: view.focusIds } : {}),
        ...(view.edgeIds
          ? {
              edgeIds: [
                ...new Set(
                  [...model.relations, ...model.generalizations]
                    .filter(
                      (e) =>
                        view.edgeIds.includes(e.id) &&
                        shown.has(e.sourceId ?? e.specificId) &&
                        shown.has(e.targetId ?? e.generalId),
                    )
                    .map(laidKey),
                ),
              ],
            }
          : {}),
        ...(view.direction ? { direction: view.direction } : {}),
        mergeGeneralizations: false,
      };
    })
    .filter((view) => view.nodeIds.length);
  return views.length
    ? views
    : [
        {
          key: "comparison",
          label: "Model",
          title: entry.model.title,
          nodeIds: defaultNodeIds(model),
          mergeGeneralizations: false,
        },
      ];
}
// The shared layout draws each view once over every member's version of it:
// their classes in the order the members list them, the routes any of them
// draws (all of them once one draws every route), and the first member's
// columns and direction. Classes no column ranks take ranks of their own
// after the columns, apart from the classes they connect to.
function mergeViews(lists, routes) {
  if (lists.length === 1) return lists[0];
  const merged = new Map();
  for (const views of lists)
    for (const view of views) {
      const into = merged.get(view.key);
      if (!into) {
        merged.set(view.key, { ...view, nodeIds: [...view.nodeIds] });
        continue;
      }
      for (const id of view.nodeIds)
        if (!into.nodeIds.includes(id)) into.nodeIds.push(id);
      if (into.edgeIds && view.edgeIds)
        into.edgeIds = [...new Set([...into.edgeIds, ...view.edgeIds])];
      else delete into.edgeIds;
      into.columns ??= view.columns;
      into.direction ??= view.direction;
    }
  return [...merged.values()].map(({ columns, focusIds, ...view }) => {
    const shown = new Set(view.nodeIds);
    const ranked = columns
      ?.map((column) => column.filter((id) => shown.has(id)))
      .filter((column) => column.length);
    const focus = focusIds?.filter((id) => shown.has(id));
    if (!ranked?.length)
      return { ...view, ...(focus?.length ? { focusIds: focus } : {}) };
    const placed = new Set(ranked.flat());
    const rank = new Map();
    for (const id of view.nodeIds.filter((id) => !placed.has(id))) {
      const taken = new Set(
        [...routes.values()]
          .map(ends)
          .filter((pair) => pair.includes(id))
          .map(([a, b]) => rank.get(a === id ? b : a)),
      );
      let next = 0;
      while (taken.has(next)) next++;
      rank.set(id, next);
    }
    const extra = [...new Set(rank.values())]
      .sort((a, b) => a - b)
      .map((n) => [...rank].filter(([, r]) => r === n).map(([id]) => id));
    return {
      ...view,
      columns: [...ranked, ...extra],
      ...(focus?.length ? { focusIds: focus } : {}),
    };
  });
}
// A family: models laid out together, at least one of them compared with a
// baseline. Its members are of one profile. They take part by key, so any
// order lays the family out alike.
function familyMembers(entries) {
  const sorted = [...entries].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const proposals = sorted.filter((e) => e.baseline);
  const captures = sorted.filter((e) => !e.baseline);
  const profile = (e) => e.model.document?.profile;
  if (
    !proposals.length ||
    sorted.some(
      (e) =>
        profile(e) !== profile(proposals[0]) ||
        (e.baseline && profile(e.baseline) !== profile(e)),
    )
  )
    throw new Error(
      "FAMILY_INPUT: a family is models of one kind, at least one compared with its baseline",
    );
  return { proposals, captures };
}
async function layoutFamily({ entries, slug, includeArtifacts }) {
  const { proposals, captures } = familyMembers(entries);
  const profile = proposals[0].model.document?.profile;
  const reviews = proposals.map((entry) => {
    const baseline = entry.baseline,
      before = clone(baseline.model),
      after = clone(entry.model);
    const diff = compareEntries(baseline, entry);
    if (profile === "database") keepUnshownKeys(diff, before, after);
    for (const model of [before, after])
      model.document = {
        ...(model.document || {}),
        comparison: { ...(model.document?.comparison || {}), changes: diff },
      };
    const statuses = new Map(diff.changes.map((c) => [c.elementId, c.kind]));
    for (const c of diff.changes)
      if (c.ownerId && c.ownerId !== "$model" && !statuses.has(c.ownerId))
        statuses.set(c.ownerId, "modified");
    return { entry, baseline, before, after, diff, statuses };
  });
  const captured = captures.map((entry) => ({ entry, model: entry.model }));
  // The models members are compared with, and the members' own: the layout
  // holds every version of each class and route.
  const befores = [
    ...captured.map((c) => c.model),
    ...reviews
      .filter((r) => !captures.includes(r.baseline))
      .map((r) => r.before),
  ];
  const afters = reviews.map((r) => r.after);
  // A relation is laid out once for every version that keeps its ends (a
  // proposal changed its name or a count in place): on the first proposal's
  // version, or else the baseline's. A second route would bend other
  // relations around a line no state draws, and two loops on one class may
  // leave no readable placement.
  const groupOf = (e) =>
    JSON.stringify([e.originalId || e.id, "specificId" in e, ...ends(e)]);
  const representative = new Map();
  for (const model of [...afters, ...befores])
    for (const e of [...model.relations, ...model.generalizations])
      if (!representative.has(groupOf(e)))
        representative.set(groupOf(e), keyOf(e));
  const laidKey = (e) => representative.get(groupOf(e)) ?? keyOf(e);
  const routes = new Map();
  for (const e of [
    ...befores.flatMap((before) => before.relations),
    ...afters.flatMap((after) => after.relations),
    ...befores.flatMap((before) => before.generalizations),
    ...afters.flatMap((after) => after.generalizations),
  ])
    if (laidKey(e) === keyOf(e)) routes.set(keyOf(e), e);
  const versions = [...befores, ...afters];
  const union = {
    ...clone(afters[0]),
    classes: members(...versions.map((m) => m.classes)).map((c) => {
      const own = versions
        .map((m) => m.classes.find((n) => n.id === c.id))
        .filter(Boolean);
      return {
        ...c,
        // The longest name sizes the box, so every version's fits.
        name: own.reduce(
          (name, v) => (v.name.length >= name.length ? v.name : name),
          "",
        ),
        attributes: members(...own.map((v) => v.attributes || [])),
        methods: members(...own.map((v) => v.methods || [])),
        measureMembers: own.flatMap((v) => [
          ...(v.attributes || []),
          ...(v.methods || []),
        ]),
      };
    }),
    relations: [...routes]
      .filter(([, e]) => "sourceId" in e)
      .map(([key, e]) => ({ ...e, id: key })),
    generalizations: [...routes]
      .filter(([, e]) => "specificId" in e)
      .map(([key, e]) => ({ ...e, id: key })),
    partitions: [],
  };
  for (const r of reviews) {
    const own = new Set(
      [
        ...r.before.relations,
        ...r.after.relations,
        ...r.before.generalizations,
        ...r.after.generalizations,
      ].map(laidKey),
    );
    r.views = comparisonViews(
      r.entry,
      r.baseline,
      members(r.before.classes, r.after.classes).map((c) => c.id),
      r.before,
      r.after,
      new Map([...routes].filter(([key]) => own.has(key))),
    );
  }
  for (const c of captured) c.views = captureViews(c.entry, c.model, laidKey);
  const prepared = new Map();
  if (!union.classes.length) {
    for (const r of reviews) {
      const p = await prepareModel({
        model: r.after,
        excerpts: r.entry.snippets,
        learning: r.entry.learning,
        source: r.entry.source,
        slug,
        includeArtifacts,
      });
      p.payload.comparison = {
        baseline: { model: r.before, views: [], snippets: {} },
        changes: r.diff,
        conflicts: [],
      };
      prepared.set(r.entry, p);
    }
    for (const c of captured)
      prepared.set(
        c.entry,
        await prepareModel({
          model: c.model,
          excerpts: c.entry.snippets,
          learning: c.entry.learning,
          source: c.entry.source,
          slug,
          includeArtifacts,
        }),
      );
    return { members: entries.map((e) => prepared.get(e)) };
  }
  // Shared union positions avoid camera/layout jumps. Relations remain separate
  // during comparison so changed endpoints and overlapping set membership are
  // unambiguous. Only the views' scenes are kept, so no excerpt is highlighted.
  union.validation = clone(afters[0].validation);
  const shared = await prepareModel({
    model: union,
    settings: mergeViews(
      [...reviews.map((r) => r.views), ...captured.map((c) => c.views)],
      routes,
    ),
    excerpts: {},
    slug,
    includeArtifacts: false,
  });
  // A member's state shows its own views of the shared layout, restricted to
  // its classes and routes; `statuses` marks a proposal's change view.
  async function state(model, entry, views, statuses = null) {
    const ownClasses = new Map(model.classes.map((c) => [c.id, c]));
    const ownRoutes = new Map(
      [...model.relations, ...model.generalizations].map((e) => [keyOf(e), e]),
    );
    const routeFilters = new Map(
      views.filter((v) => v.edgeIds).map((v) => [v.key, new Set(v.edgeIds)]),
    );
    const provider = async (view, classes, edges, generalizations, fields) => {
      const sharedView =
        shared.payload.views.find((v) => v.key === view.key) ||
        shared.payload.views[0];
      const template = clone(sharedView[fields ? "diagramFields" : "diagram"]);
      template.title = view.title;
      // The shared view holds every member's version of it, so a member shows
      // the classes its own view lists, as it does alone, and only the routes
      // between them.
      const visible = new Set(view.names);
      const shows = (e) => visible.has(e.source) && visible.has(e.target);
      const allowed = routeFilters.get(view.key);
      const drawn = (key) => !allowed || allowed.has(key);
      template.nodes = template.nodes
        .filter((n) => visible.has(n.id))
        .map((n) => {
          const own = ownClasses.get(n.id);
          return {
            ...n,
            name: own.name,
            stereotype: own.stereotype,
            isAbstract: own.isAbstract ?? own.abstract,
            attributes: fields ? own.attributes : [],
            methods: fields ? own.methods || [] : [],
            ...(statuses
              ? { changeStatus: statuses.get(n.id) || "unchanged" }
              : {}),
          };
        });
      // This state's version of a relation laid out on another version's
      // route takes that route.
      const laidOut = new Set(template.edges.map((e) => e.id));
      const inPlace = [];
      for (const [key, own] of ownRoutes) {
        if (laidOut.has(key)) continue;
        const original = { ...own, id: own.originalId || own.id };
        const match = template.edges.find(
          (e) => !ownRoutes.has(e.id) && sameEnds(routes.get(e.id), original),
        );
        if (match && drawn(match.id) && shows(match))
          inPlace.push({
            ...match,
            id: key,
            realization: own.realization,
            name: own.name || "Generalization",
            stereotype: own.stereotype || "",
            sourceMultiplicity: own.sourceMultiplicity,
            sourceAggregation: own.sourceAggregation,
            targetAggregation: own.targetAggregation,
            targetMultiplicity: own.targetMultiplicity,
            navigable: own.navigable,
            labels: relabel({ ...match, id: key }, own),
          });
      }
      template.edges = [
        ...template.edges.filter(
          (e) => ownRoutes.has(e.id) && drawn(e.id) && shows(e),
        ),
        ...inPlace,
      ].map((e) => {
        const original = ownRoutes.get(e.id);
        return {
          ...e,
          id: original.id,
          ...(original.originalId ? { originalId: original.originalId } : {}),
          sourceName: ownClasses.get(e.source).name,
          targetName: ownClasses.get(e.target).name,
          ...(statuses
            ? {
                changeStatus:
                  original.changeStatus ||
                  statuses.get(original.originalId || original.id) ||
                  "unchanged",
              }
            : {}),
        };
      });
      template.generalizationGroups = [];
      const focus = view.focusNames.filter((id) => ownClasses.has(id));
      // The change view opens on what changed when the whole view is too
      // large to read at once.
      const changed = statuses
        ? template.nodes
            .filter((n) => n.changeStatus !== "unchanged")
            .map((n) => n.id)
        : [];
      template.initialFocus = changed.length
        ? changed
        : focus.length
          ? focus
          : template.nodes.slice(0, 3).map((n) => n.id);
      return { diagram: template, check: { valid: true, issues: [] } };
    };
    // Each state shows the shared views restricted to its own classes. Route
    // filters and columns already shaped the shared layout used as template.
    const stateSettings = views
      .map(({ edgeIds, columns, focusIds, ...view }) => {
        const nodeIds = view.nodeIds.filter((id) => ownClasses.has(id));
        const focus = focusIds?.filter((id) => ownClasses.has(id));
        return {
          ...view,
          nodeIds,
          ...(focus?.length ? { focusIds: focus } : {}),
        };
      })
      .filter((view) => view.nodeIds.length);
    return prepareModel({
      model: { ...model, validation: clone(model.validation) },
      settings: stateSettings.length ? stateSettings : undefined,
      excerpts: entry.snippets,
      learning: entry.learning,
      source: entry.source,
      slug,
      includeArtifacts,
      diagramProvider: provider,
    });
  }
  for (const r of reviews) {
    const { entry, before, after, diff, statuses } = r;
    const proposed = await state(after, entry, r.views),
      base = await state(before, r.baseline, r.views);
    const memberStatuses = new Map(
      diff.changes
        .filter((c) => c.elementId && c.ownerId)
        .map((c) => [c.elementId, c.kind]),
    );
    const changedModel = {
      ...clone(after),
      classes: members(before.classes, after.classes).map((c) => {
        const a = before.classes.find((n) => n.id === c.id),
          b = after.classes.find((n) => n.id === c.id);
        const changeStatus = statuses.get(c.id) || "unchanged";
        return {
          ...c,
          changeStatus,
          // Members of added, removed and unchanged classes share their class's
          // status; a changed class marks each of its own.
          ...(a && b && changeStatus === "modified"
            ? {
                attributes: changedMembers(
                  a.attributes,
                  b.attributes,
                  memberStatuses,
                ),
                methods: changedMembers(
                  a.methods || [],
                  b.methods || [],
                  memberStatuses,
                ),
              }
            : {}),
        };
      }),
      relations: clone(after.relations).map((rel) => ({
        ...rel,
        changeStatus: statuses.get(rel.id) || "unchanged",
      })),
      generalizations: clone(after.generalizations).map((g) => ({
        ...g,
        changeStatus: statuses.get(g.id) || "unchanged",
      })),
      sources: members(before.sources, after.sources),
    };
    // Retain replaced routes as well as deleted IDs. Alternate routes need
    // unique presentation IDs while keeping the semantic identity for inspection.
    const routeIds = new Set(
      [
        ...before.relations,
        ...after.relations,
        ...before.generalizations,
        ...after.generalizations,
        ...changedModel.classes,
      ].map((e) => e.id),
    );
    const currentIds = new Set(
      [
        ...after.relations,
        ...after.generalizations,
        ...changedModel.classes,
      ].map((e) => e.id),
    );
    const proposedRoutes = [...after.relations, ...after.generalizations];
    const proposedKeys = new Set(proposedRoutes.map(keyOf));
    const proposedById = new Map(proposedRoutes.map((e) => [e.id, e]));
    for (const [kind, old] of [
      ["relations", before.relations],
      ["generalizations", before.generalizations],
    ])
      for (const e of old)
        // A relation that kept its ends only changed what it says (a count,
        // a name): the proposal's route shows it, marked as changed.
        if (
          !proposedKeys.has(keyOf(e)) &&
          !(proposedById.has(e.id) && sameEnds(proposedById.get(e.id), e))
        ) {
          let id = e.id;
          if (currentIds.has(e.id)) {
            id = `previous:${keyOf(e)}`;
            while (routeIds.has(id)) id += ":old";
          }
          routeIds.add(id);
          changedModel[kind].push({
            ...e,
            id,
            originalId: e.id,
            changeStatus: "removed",
          });
        }
    const changes = await state(changedModel, entry, r.views, statuses);
    proposed.payload.comparison = {
      baseline: {
        model: base.model,
        views: base.payload.views,
        snippets: base.payload.snippets,
        exports: base.payload.exports,
      },
      changeView: {
        model: changes.model,
        views: changes.payload.views,
        snippets: { ...base.payload.snippets, ...changes.payload.snippets },
        exports: changes.payload.exports,
      },
      changes: diff,
      conflicts: [],
    };
    if (includeArtifacts) {
      for (const [name, content] of base.artifacts)
        if (name.endsWith(".svg"))
          proposed.artifacts.set(
            name.replace(`${slug}-`, `${slug}-baseline-`),
            content,
          );
      for (const [name, content] of changes.artifacts)
        if (name.endsWith(".svg"))
          proposed.artifacts.set(
            name.replace(`${slug}-`, `${slug}-changes-`),
            content,
          );
    }
    prepared.set(entry, proposed);
  }
  for (const c of captured)
    prepared.set(c.entry, await state(c.model, c.entry, c.views));
  return { members: entries.map((e) => prepared.get(e)) };
}
async function prepareComparison({ entry, slug, includeArtifacts }) {
  const { members } = await layoutFamily({
    entries: [entry],
    slug,
    includeArtifacts,
  });
  return members[0];
}
/**
 * Lays a family out once: models of one kind, each shown alone or compared
 * with its baseline. Each member's state comes from that one layout, so
 * classes and routes keep their places from one member to the next. Returns
 * each entry's prepared viewer in the order given, with `payload.family` set
 * to `key`.
 */
async function prepareEntries({
  entries,
  key,
  slug = "model",
  includeArtifacts = false,
}) {
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) throw new Error("Invalid artifact slug");
  const family = await layoutFamily({ entries, slug, includeArtifacts });
  for (const member of family.members) member.payload.family = key;
  return { key, members: family.members };
}
module.exports = {
  prepareComparison,
  prepareEntries,
};
