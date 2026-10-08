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
  return `route-${fingerprint([e.id, semantic(data)]).slice(0, 24)}`;
};
function members(before, after) {
  const out = new Map(before.map((v) => [v.id, v]));
  for (const v of after) out.set(v.id, v);
  return [...out.values()];
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
  const settings = [
    {
      key: "comparison",
      label: "Model",
      title: document.title,
      nodeIds: union.classes.map((c) => c.id),
      mergeGeneralizations: false,
    },
  ];
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
    const ownRoutes = new Set(
      [...model.relations, ...model.generalizations].map(keyOf),
    );
    const provider = async (view, classes, edges, generalizations, fields) => {
      const template = clone(
        shared.payload.views[0][fields ? "diagramFields" : "diagram"],
      );
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
          const original = routes.get(e.id);
          return {
            ...e,
            id: original.id,
            sourceName: ownClasses.get(e.source).name,
            targetName: ownClasses.get(e.target).name,
            ...(changes
              ? {
                  changeStatus:
                    statuses.get(original.originalId || original.id) ||
                    "unchanged",
                }
              : {}),
          };
        });
      template.generalizationGroups = [];
      template.initialFocus = template.nodes.slice(0, 3).map((n) => n.id);
      return { diagram: template, check: { valid: true, issues: [] } };
    };
    const stateSettings = ownClasses.size
      ? [{ ...settings[0], nodeIds: [...ownClasses.keys()] }]
      : undefined;
    return prepareModel({
      model,
      report: clone(model.validation),
      evidence: doc.evidence,
      project: doc.model,
      settings: stateSettings,
      excerpts: doc.snippets,
      slug,
      includeArtifacts,
      document: doc,
      diagramProvider: provider,
    });
  }
  const proposed = await state(after, document),
    base = await state(before, baseline);
  const changedModel = {
    ...clone(after),
    classes: members(before.classes, after.classes).map((c) => ({
      ...c,
      changeStatus: statuses.get(c.id) || "unchanged",
    })),
    relations: clone(after.relations),
    generalizations: clone(after.generalizations),
    sources: members(before.sources, after.sources),
  };
  // Removed routes are retained in Changes with explicit presentation identities.
  for (const [kind, old, newer] of [
    ["relations", before.relations, after.relations],
    ["generalizations", before.generalizations, after.generalizations],
  ])
    for (const e of old)
      if (!newer.some((n) => n.id === e.id))
        changedModel[kind].push({ ...e, originalId: e.id });
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
