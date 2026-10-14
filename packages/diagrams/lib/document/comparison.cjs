const { randomUUID } = require("node:crypto");
const {
  clone,
  fingerprint,
  assertDocument,
  createDocument,
  createSnapshot,
} = require("./document.cjs");
const PRESENTATION = new Set([
  "x",
  "y",
  "width",
  "height",
  "position",
  "points",
  "bounds",
  "layout",
  "diagrams",
  "diagram",
  "location",
]);
function semantic(value, depth = 0) {
  if (depth > 100)
    throw new Error("COMPARISON_LIMIT: model nesting exceeds 100");
  if (Array.isArray(value)) {
    const array = value
      .filter(
        (v) =>
          !v ||
          ![
            "Diagram",
            "ClassView",
            "RelationView",
            "GeneralizationView",
          ].includes(v.type),
      )
      .map((v) => semantic(v, depth + 1));
    return array.length && array.every((v) => v && typeof v.id === "string")
      ? array.sort((a, b) => a.id.localeCompare(b.id, "en"))
      : array;
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => !PRESENTATION.has(k))
        .map((k) => [
          k,
          k === "generalizations" &&
          (value.type === "GeneralizationSet" || "complete" in value) &&
          Array.isArray(value[k]) &&
          value[k].every((v) => typeof v === "string")
            ? [...value[k]].sort()
            : semantic(value[k], depth + 1),
        ]),
    );
  return value;
}
function records(model) {
  const output = new Map();
  function visit(value, owner = null, depth = 0) {
    if (depth > 100)
      throw new Error("COMPARISON_LIMIT: model nesting exceeds 100");
    if (Array.isArray(value))
      return value.map((v) => visit(v, owner, depth + 1));
    if (!value || typeof value !== "object") return value;
    if (typeof value.id === "string") {
      const id = value.id;
      const data = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, visit(v, id, depth + 1)]),
      );
      output.set(JSON.stringify(["element", id]), { id, owner, data });
      return { $element: id };
    }
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, visit(v, owner, depth + 1)]),
    );
  }
  const root = visit(semantic(model));
  output.set(JSON.stringify(["root"]), { id: null, owner: null, data: root });
  if (output.size > 20000)
    throw new Error("COMPARISON_LIMIT: at most 20000 semantic records");
  return output;
}
const same = (a, b) => fingerprint(a) === fingerprint(b);
const cell = (value, present = true) =>
  present ? { present: true, value: clone(value) } : { present: false };
function compareModels(base, proposed) {
  const before = records(base),
    after = records(proposed),
    changes = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(key),
      b = after.get(key),
      id = b?.id ?? a?.id;
    if (a && b && same(a, b)) continue;
    const properties =
      a && b
        ? [...new Set([...Object.keys(a.data), ...Object.keys(b.data)])]
            .sort()
            .filter(
              (key) =>
                !same(
                  cell(a.data[key], key in a.data),
                  cell(b.data[key], key in b.data),
                ),
            )
            .map((key) => ({
              key,
              before: cell(a.data[key], key in a.data),
              after: cell(b.data[key], key in b.data),
            }))
        : [];
    changes.push({
      id: `change:${fingerprint(key).slice(0, 24)}`,
      elementId: id,
      ownerId: b?.owner || a?.owner || null,
      kind: !a ? "added" : !b ? "removed" : "modified",
      name: b?.data.name || a?.data.name || id || "Model contents",
      properties,
      ...(a ? { before: a.data } : {}),
      ...(b ? { after: b.data } : {}),
    });
  }
  return {
    changes,
    counts: Object.fromEntries(
      ["added", "removed", "modified"].map((k) => [
        k,
        changes.filter((c) => c.kind === k).length,
      ]),
    ),
    limitations: [
      "Stable identities only; no inference of cross-layer meaning. Layout and source locations are excluded.",
    ],
  };
}
function baselineDocument(document) {
  assertDocument(document);
  const snapshot = document.snapshots.find((s) => s.id === document.baselineId);
  if (!snapshot)
    throw new Error("COMPARISON_BASELINE: select a retained baseline");
  const saved = document.comparison?.baselineContexts?.[snapshot.id] || {};
  return createDocument({
    ...document,
    ...saved,
    id: document.id,
    model: snapshot.model,
    profile: snapshot.profile,
    state: "snapshot",
    comparison: undefined,
    evidence: saved.evidence || {},
    snippets: saved.snippets || {},
    views: saved.views || [],
    context: saved.context || { records: [], links: [] },
    mappings: saved.mappings || [],
    learning: saved.learning,
    createdAt: snapshot.capture.capturedAt,
    reason: "Inspect retained baseline",
  });
}
function compareDocuments(base, proposed) {
  assertDocument(base);
  assertDocument(proposed);
  if (base.profile !== proposed.profile)
    throw new Error(
      "COMPARISON_PROFILE: compare like model profiles; use explicit mappings across layers",
    );
  const result = compareModels(base.model, proposed.model);
  const records = new Map(proposed.context.records.map((r) => [r.id, r]));
  for (const change of result.changes) {
    // An element and its owner may link the same record; list it once.
    change.rationale = [
      ...new Set(
        proposed.context.links
          .filter((l) =>
            [change.elementId, change.ownerId].includes(l.elementId),
          )
          .map((l) => l.recordId),
      ),
    ]
      .map((id) => records.get(id))
      .filter(Boolean);
    change.evidence =
      proposed.evidence.elements?.[change.elementId] ||
      proposed.evidence.elements?.[change.ownerId] ||
      null;
  }
  return {
    ...result,
    baseRevision: base.sourceRevision || base.revision.id,
    proposedRevision: proposed.revision.id,
    missingRationale: result.changes
      .filter((c) => c.elementId && !c.rationale.length)
      .map((c) => c.elementId),
  };
}
function contextOf(d) {
  return {
    title: d.title,
    evidence: clone(d.evidence),
    snippets: clone(d.snippets),
    context: clone(d.context),
    views: clone(d.views),
    ...(d.learning ? { learning: clone(d.learning) } : {}),
    ...(d.reporting ? { reporting: clone(d.reporting) } : {}),
    mappings: clone(d.mappings || []),
    sourceRevision: d.revision.id,
  };
}
function createProposal(base, options = {}) {
  assertDocument(base);
  const snapshots = clone(base.snapshots);
  let baselineId = base.baselineId;
  if (!baselineId) {
    const snapshot = createSnapshot({
      id: `authored-${fingerprint([base.id, base.revision.id]).slice(0, 32)}`,
      profile: base.profile,
      model: base.model,
      capture: {
        capturedAt: base.revision.createdAt,
        adapter: { id: "atlas-authored-baseline", version: "1.0.0" },
        source: { kind: "authored", identity: base.id, scope: ["model"] },
        coverage: { status: "complete", diagnostics: [] },
        limitations: ["Authored reference model, not a source extraction."],
      },
    });
    snapshots.push(snapshot);
    baselineId = snapshot.id;
  }
  return createDocument({
    ...base,
    id: options.id || `proposal-${randomUUID()}`,
    title: options.title || base.title,
    state: "proposal",
    snapshots,
    baselineId,
    parentId: base.revision.id,
    reason: options.reason || "Created proposal",
    comparison: {
      ...clone(base.comparison || {}),
      originDocumentId: base.comparison?.originDocumentId || base.id,
      ancestorRevision: base.revision.id,
      ancestorRevisions: [
        ...new Set([
          ...(base.comparison?.ancestorRevisions || []),
          base.revision.id,
        ]),
      ],
      baselineContexts: {
        [baselineId]: contextOf(base),
        ...clone(base.comparison?.baselineContexts || {}),
      },
    },
  });
}
module.exports = {
  semantic,
  compareModels,
  compareDocuments,
  createProposal,
  baselineDocument,
};
