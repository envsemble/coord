const { clone, documentViewerModel } = require("../document/document.cjs");
const {
  semantic,
  baselineDocument,
  compareDocuments,
} = require("../document/comparison.cjs");
const { prepareModel } = require("./buildViewer.cjs");
const { fingerprint } = require("../document/document.cjs");
const { relationLabel, labelSize } = require("../layout/layoutDiagram.cjs");
const { knownMultiplicity } = require("../layout/multiplicity.cjs");
const keyOf = (e) => {
  const { originalId, changeStatus, ...data } = e;
  const id = originalId || e.id;
  data.id = id;
  return `route-${fingerprint([id, semantic(data)]).slice(0, 24)}`;
};
function members(before, after) {
  const out = new Map(before.map((v) => [v.id, v]));
  for (const v of after) out.set(v.id, v);
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
// OntoUML keeps every element in one flat list, so each change's owner is the
// project. For review, a property or literal belongs to the class or relation
// that lists it: an attribute to its class, an association end to its relation.
const refId = (value) =>
  typeof value === "string" ? value : value?.id || null;
// An association end also says which end it is: a relation lists its source
// end first.
function assignOwners(diff, ...projects) {
  const owners = new Map();
  for (const project of projects)
    for (const element of project.elements || []) {
      if (!["Class", "BinaryRelation"].includes(element.type)) continue;
      const relation = element.type === "BinaryRelation";
      for (const [i, item] of [
        ...(element.properties || []),
        ...(element.literals || []),
      ].entries())
        if (refId(item))
          owners.set(refId(item), {
            id: element.id,
            ...(relation ? { end: i === 0 ? "source" : "target" } : {}),
          });
    }
  for (const change of diff.changes) {
    const owner = owners.get(change.elementId);
    if (!owner) continue;
    change.ownerId = owner.id;
    if (owner.end) change.end = owner.end;
  }
}
// A table lists its foreign keys, and those whose target was captured are
// its relations too, which tell them. Each change keeps only the keys no
// relation shows; a change left with nothing else to tell is the relations'.
function keepUnshownKeys(diff, ...models) {
  const relations = models
    .flatMap((m) => m.relations)
    .filter((r) => Array.isArray(r.columns));
  const names = new Map(
    models.flatMap((m) => m.classes.map((c) => [c.id, c.name])),
  );
  const shown = (table, key) =>
    relations.some(
      (r) =>
        r.sourceId === table &&
        JSON.stringify(r.columns) === JSON.stringify(key?.columns) &&
        (r.target === key.target || names.get(r.targetId) === key.target),
    );
  const unshown = (table, cell) =>
    cell.present && Array.isArray(cell.value)
      ? { present: true, value: cell.value.filter((k) => !shown(table, k)) }
      : cell;
  diff.changes = diff.changes.filter((change) => {
    if (change.kind !== "modified") return true;
    change.properties = change.properties
      .map((p) =>
        p.key === "foreignKeys"
          ? {
              ...p,
              before: unshown(change.elementId, p.before),
              after: unshown(change.elementId, p.after),
            }
          : p,
      )
      .filter(
        (p) =>
          p.key !== "foreignKeys" ||
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
function comparisonViews(document, baseline, union, before, after, routes) {
  const ids = new Set(union.classes.map((c) => c.id));
  const all = {
    key: "comparison",
    label: "Model",
    title: document.title,
    nodeIds: [...ids],
    mergeGeneralizations: false,
  };
  const authored = document.views.length ? document.views : baseline.views;
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
      title: view.title || document.title,
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
async function prepareComparison({ document, slug, includeArtifacts }) {
  const baseline = baselineDocument(document),
    before = documentViewerModel(baseline),
    after = documentViewerModel(document);
  if (document.profile === "ontouml") {
    const { assertRenderableProject } = require("./buildViewer.cjs");
    assertRenderableProject(baseline.model);
    assertRenderableProject(document.model);
  }
  const diff = compareDocuments(baseline, document);
  if (document.profile === "ontouml")
    assignOwners(diff, baseline.model, document.model);
  if (document.profile === "database") keepUnshownKeys(diff, before, after);
  for (const model of [before, after])
    model.document.comparison = {
      ...(model.document.comparison || {}),
      changes: diff,
    };
  const statuses = new Map(diff.changes.map((c) => [c.elementId, c.kind]));
  for (const c of diff.changes)
    if (c.ownerId && c.ownerId !== "$model" && !statuses.has(c.ownerId))
      statuses.set(c.ownerId, "modified");
  // A relation the proposal changed in place (its ends kept, a name or a
  // count changed) is laid out once, on the proposal's route: a second route
  // would bend other relations around a line the change view does not draw,
  // and two loops on one class may leave no readable placement.
  const proposedRoutes = [...after.relations, ...after.generalizations];
  const proposedKeys = new Set(proposedRoutes.map(keyOf));
  const proposedById = new Map(proposedRoutes.map((e) => [e.id, e]));
  const changedInPlace = (e) =>
    !proposedKeys.has(keyOf(e)) &&
    proposedById.has(e.id) &&
    sameEnds(proposedById.get(e.id), e);
  const routes = new Map();
  for (const e of [
    ...before.relations,
    ...after.relations,
    ...before.generalizations,
    ...after.generalizations,
  ])
    if (!changedInPlace(e)) routes.set(keyOf(e), e);
  const union = {
    ...clone(after),
    classes: members(before.classes, after.classes).map((c) => {
      const a = before.classes.find((n) => n.id === c.id),
        b = after.classes.find((n) => n.id === c.id);
      return {
        ...c,
        name: (a?.name.length || 0) > (b?.name.length || 0) ? a.name : c.name,
        attributes: members(a?.attributes || [], b?.attributes || []),
        methods: members(a?.methods || [], b?.methods || []),
        measureMembers: [...(a?.attributes || []), ...(a?.methods || [])],
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
  // Shared union positions avoid camera/layout jumps. Relations remain separate
  // during comparison so changed endpoints and overlapping set membership are unambiguous.
  const settings = comparisonViews(
    document,
    baseline,
    union,
    before,
    after,
    routes,
  );
  if (!union.classes.length) {
    const p = await prepareModel({
      model: after,
      report: after.validation,
      evidence: document.evidence,
      project: document.model,
      settings: undefined,
      excerpts: document.snippets,
      slug,
      includeArtifacts,
      document,
    });
    p.payload.comparison = {
      baseline: { model: before, views: [], snippets: {} },
      changes: diff,
      conflicts: document.comparison?.conflicts || [],
    };
    return p;
  }
  const shared = await prepareModel({
    model: union,
    report: clone(after.validation),
    evidence: document.evidence,
    project: document.model,
    settings,
    excerpts: document.snippets,
    slug,
    includeArtifacts: false,
  });
  async function state(model, doc, changes = false) {
    const ownClasses = new Map(model.classes.map((c) => [c.id, c]));
    const ownRoutes = new Map(
      [...model.relations, ...model.generalizations].map((e) => [keyOf(e), e]),
    );
    const provider = async (view, classes, edges, generalizations, fields) => {
      const sharedView =
        shared.payload.views.find((v) => v.key === view.key) ||
        shared.payload.views[0];
      const template = clone(sharedView[fields ? "diagramFields" : "diagram"]);
      template.nodes = template.nodes
        .filter((n) => ownClasses.has(n.id))
        .map((n) => {
          const own = ownClasses.get(n.id);
          return {
            ...n,
            name: own.name,
            stereotype: own.stereotype,
            isAbstract: own.isAbstract ?? own.abstract,
            attributes: fields ? own.attributes : [],
            methods: fields ? own.methods || [] : [],
            ...(changes
              ? { changeStatus: statuses.get(n.id) || "unchanged" }
              : {}),
          };
        });
      // This state's version of a relation changed in place takes the
      // proposal's route, which the shared layout holds instead.
      const laidOut = new Set(template.edges.map((e) => e.id));
      const inPlace = [];
      for (const [key, own] of ownRoutes) {
        if (laidOut.has(key)) continue;
        const match = template.edges.find(
          (e) => !ownRoutes.has(e.id) && sameEnds(routes.get(e.id), own),
        );
        if (match)
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
            labels: relabel({ ...match, id: key }, own),
          });
      }
      template.edges = [
        ...template.edges.filter((e) => ownRoutes.has(e.id)),
        ...inPlace,
      ].map((e) => {
        const original = ownRoutes.get(e.id);
        return {
          ...e,
          id: original.id,
          ...(original.originalId ? { originalId: original.originalId } : {}),
          sourceName: ownClasses.get(e.source).name,
          targetName: ownClasses.get(e.target).name,
          ...(changes
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
      const changed = changes
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
    const stateSettings = settings
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
      model,
      report: clone(model.validation),
      evidence: doc.evidence,
      project: doc.model,
      settings: stateSettings.length ? stateSettings : undefined,
      excerpts: doc.snippets,
      slug,
      includeArtifacts,
      document: doc,
      diagramProvider: provider,
    });
  }
  const proposed = await state(after, document),
    base = await state(before, baseline);
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
    relations: clone(after.relations).map((r) => ({
      ...r,
      changeStatus: statuses.get(r.id) || "unchanged",
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
    [...after.relations, ...after.generalizations, ...changedModel.classes].map(
      (e) => e.id,
    ),
  );
  for (const [kind, old] of [
    ["relations", before.relations],
    ["generalizations", before.generalizations],
  ])
    for (const e of old)
      // A relation that kept its ends only changed what it says (a count,
      // a name): the proposal's route shows it, marked as changed.
      if (!proposedKeys.has(keyOf(e)) && !changedInPlace(e)) {
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
  const changes = await state(changedModel, document, true);
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
    conflicts: document.comparison?.conflicts || [],
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
  return proposed;
}
module.exports = { prepareComparison };
