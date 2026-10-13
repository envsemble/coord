const { clone, documentViewerModel } = require("../document/document.cjs");
const {
  semantic,
  baselineDocument,
  compareDocuments,
} = require("../document/comparison.cjs");
const { prepareModel } = require("./buildViewer.cjs");
const { fingerprint } = require("../document/document.cjs");
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
// member kept where it was, so the change view can show what disappears.
function changedMembers(before = [], after = [], statuses) {
  const proposed = new Set(after.map((m) => m.id));
  const out = after.map((m) => ({
    ...m,
    changeStatus: statuses.get(m.id) || "unchanged",
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
  for (const model of [before, after])
    model.document.comparison = {
      ...(model.document.comparison || {}),
      changes: diff,
    };
  const statuses = new Map(diff.changes.map((c) => [c.elementId, c.kind]));
  for (const c of diff.changes)
    if (c.ownerId && c.ownerId !== "$model" && !statuses.has(c.ownerId))
      statuses.set(c.ownerId, "modified");
  const routes = new Map();
  for (const e of [
    ...before.relations,
    ...after.relations,
    ...before.generalizations,
    ...after.generalizations,
  ])
    routes.set(keyOf(e), e);
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
      template.edges = template.edges
        .filter((e) => ownRoutes.has(e.id))
        .map((e) => {
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
  for (const [kind, old, newer] of [
    ["relations", before.relations, after.relations],
    ["generalizations", before.generalizations, after.generalizations],
  ])
    for (const e of old)
      if (!newer.some((n) => keyOf(n) === keyOf(e))) {
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
