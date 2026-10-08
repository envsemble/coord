const { randomUUID } = require("node:crypto");
const {
  clone,
  fingerprint,
  assertDocument,
  validateDocument,
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
      "Stable identities only; no name matching or inference of cross-layer meaning. Layout and source locations are excluded.",
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
    change.rationale = proposed.context.links
      .filter((l) => [change.elementId, change.ownerId].includes(l.elementId))
      .map((l) => records.get(l.recordId))
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
const identityOf = (value) =>
  value && typeof value === "object"
    ? typeof value.id === "string"
      ? value.id
      : typeof value.elementId === "string" &&
          typeof value.recordId === "string"
        ? `link:${fingerprint([value.elementId, value.recordId]).slice(0, 24)}`
        : null
    : null;
function createProposal(base, options = {}) {
  assertDocument(base);
  if (base.comparison?.conflicts?.length)
    throw new Error("MERGE_CONFLICT: resolve the draft before branching");
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
      conflicts: [],
    },
  });
}
const payloadOf = (d) => {
  const reserved = new Set([
    "format",
    "formatVersion",
    "id",
    "profile",
    "state",
    "revision",
    "snapshots",
    "comparison",
    "imported",
  ]);
  return Object.fromEntries(
    [
      ...new Set([
        ...Object.keys(d).filter((k) => !reserved.has(k)),
        "mappings",
      ]),
    ].map((k) => [k, clone(k === "mappings" ? d[k] || [] : d[k])]),
  );
};
function mergeValue(base, left, right, path, conflicts, depth = 0) {
  if (depth > 100) throw new Error("MERGE_LIMIT: nesting exceeds 100");
  if (same(left, right)) return clone(left);
  if (same(left, base)) return clone(right);
  if (same(right, base)) return clone(left);
  let values = [base, left, right];
  // Two independently introduced containers can combine their members.
  // Preserve absent primitive cells inside them as explicit overlap choices.
  if (
    !base.present &&
    left.present &&
    right.present &&
    left.value &&
    right.value &&
    typeof left.value === "object" &&
    typeof right.value === "object" &&
    Array.isArray(left.value) === Array.isArray(right.value)
  )
    values = [cell(Array.isArray(left.value) ? [] : {}), left, right];
  if (
    values.every(
      (c) =>
        c.present &&
        c.value &&
        typeof c.value === "object" &&
        !Array.isArray(c.value),
    )
  ) {
    const keys = [
        ...new Set(values.flatMap((c) => Object.keys(c.value))),
      ].sort(),
      out = {};
    for (const key of keys) {
      const result = mergeValue(
        ...values.map((c) => cell(c.value[key], Object.hasOwn(c.value, key))),
        [...path, key],
        conflicts,
        depth + 1,
      );
      if (result.present)
        Object.defineProperty(out, key, {
          value: result.value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
    }
    return cell(out);
  }
  if (
    values.every(
      (c) =>
        c.present &&
        Array.isArray(c.value) &&
        c.value.every((v) => identityOf(v)),
    )
  ) {
    const maps = values.map(
        (c) => new Map(c.value.map((v) => [identityOf(v), v])),
      ),
      ids = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort(),
      out = [];
    for (const id of ids) {
      const result = mergeValue(
        ...maps.map((m) => cell(m.get(id), m.has(id))),
        [...path, `@id:${id}`],
        conflicts,
        depth + 1,
      );
      if (result.present) out.push(result.value);
    }
    return cell(out);
  }
  const isReferenceSet =
    (path[0] === "evidence" &&
      path.includes("elements") &&
      path.at(-1) === "evidence") ||
    (path[0] === "model" && path.at(-1) === "generalizations");
  if (
    isReferenceSet &&
    values.every(
      (c) =>
        c.present &&
        Array.isArray(c.value) &&
        c.value.every((v) => typeof v === "string"),
    )
  ) {
    const sets = values.map((c) => new Set(c.value)),
      out = [];
    for (const id of [...new Set(values.flatMap((c) => c.value))].sort()) {
      const [a, b, c] = sets.map((s) => s.has(id));
      if (b === c ? b : b === a ? c : b) out.push(id);
    }
    return cell(out);
  }
  const conflict = {
    id: `conflict:${fingerprint(path).slice(0, 24)}`,
    path,
    base: clone(base),
    left: clone(left),
    right: clone(right),
    reason:
      !left.present || !right.present
        ? "delete-versus-modify"
        : "overlapping changes",
  };
  conflicts.push(conflict);
  return clone(base);
}
function unionSnapshots(documents) {
  const out = new Map();
  for (const d of documents)
    for (const s of d.snapshots) {
      if (out.has(s.id) && !same(out.get(s.id), s))
        throw new Error(
          "SNAPSHOT_CONFLICT: same identity has different capture contents",
        );
      out.set(s.id, clone(s));
    }
  return [...out.values()];
}
function mergeDocuments(ancestor, left, right, options = {}) {
  for (const d of [ancestor, left, right]) assertDocument(d);
  if (new Set([ancestor.profile, left.profile, right.profile]).size !== 1)
    throw new Error("MERGE_PROFILE: profiles differ");
  const origin = ancestor.comparison?.originDocumentId || ancestor.id;
  for (const d of [left, right]) {
    const related =
      (d.id === ancestor.id && d.revision.parentId === ancestor.revision.id) ||
      (d.comparison?.originDocumentId === origin &&
        (
          d.comparison.ancestorRevisions || [d.comparison.ancestorRevision]
        ).includes(ancestor.revision.id));
    if (!related)
      throw new Error(
        "MERGE_ANCESTRY: branches must retain the explicit common ancestor",
      );
    if (d.comparison?.conflicts?.length)
      throw new Error("MERGE_CONFLICT: resolve input drafts first");
  }
  const anchor = ancestor.baselineId ? ancestor : createProposal(ancestor);
  const base = cell({ ...payloadOf(ancestor), baselineId: anchor.baselineId }),
    a = cell({
      ...payloadOf(left),
      baselineId: left.baselineId || anchor.baselineId,
    }),
    b = cell({
      ...payloadOf(right),
      baselineId: right.baselineId || anchor.baselineId,
    }),
    conflicts = [];
  let payload = mergeValue(base, a, b, [], conflicts).value;
  const snapshots = unionSnapshots([anchor, left, right]);
  const common = {
    ...ancestor,
    id: options.id || `merge-${randomUUID()}`,
    state: "proposal",
    snapshots,
    baselineId: anchor.baselineId,
    parentId: ancestor.revision.id,
    reason: options.reason || "Three-way merge",
  };
  if (
    validateDocument({ ...common, ...payload }).issues.some(
      (i) => i.severity === "error" && i.layer !== "ontology",
    )
  ) {
    conflicts.length = 0;
    conflicts.push({
      id: "conflict:references",
      path: [],
      base,
      left: a,
      right: b,
      reason:
        "Combined changes violate model or context references; choose a valid complete payload",
    });
    payload = base.value;
  }
  return createDocument({
    ...common,
    ...payload,
    comparison: {
      ...clone(left.comparison || {}),
      originDocumentId: origin,
      ancestorRevision: ancestor.revision.id,
      ancestorRevisions: [
        ...new Set([
          ...(left.comparison?.ancestorRevisions || []),
          ...(right.comparison?.ancestorRevisions || []),
          ancestor.revision.id,
        ]),
      ],
      parents: [left.revision.id, right.revision.id],
      adoptions: [
        ...new Map(
          [
            ...(ancestor.comparison?.adoptions || []),
            ...(left.comparison?.adoptions || []),
            ...(right.comparison?.adoptions || []),
          ].map((item) => [fingerprint(item), clone(item)]),
        ).values(),
      ],
      baselineContexts: {
        ...clone(anchor.comparison?.baselineContexts || {}),
        ...clone(left.comparison?.baselineContexts || {}),
        ...clone(right.comparison?.baselineContexts || {}),
      },
      conflicts,
    },
  });
}
function applyCell(payload, path, replacement) {
  if (!path.length) return clone(replacement.value);
  let owner = payload;
  for (const key of path.slice(0, -1)) {
    if (key.startsWith("@id:") && Array.isArray(owner))
      owner = owner.find((v) => identityOf(v) === key.slice(4));
    else if (owner && Object.hasOwn(owner, key)) owner = owner[key];
    else throw new Error("MERGE_PATH: conflict path is unavailable");
  }
  const key = path.at(-1);
  if (key.startsWith("@id:")) {
    const i = owner.findIndex((v) => identityOf(v) === key.slice(4));
    if (replacement.present) {
      if (i < 0) owner.push(clone(replacement.value));
      else owner[i] = clone(replacement.value);
    } else if (i >= 0) owner.splice(i, 1);
  } else if (replacement.present)
    Object.defineProperty(owner, key, {
      value: clone(replacement.value),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  else delete owner[key];
  return payload;
}
function resolveMerge(
  document,
  choices,
  expectedRevision = document.revision.id,
) {
  assertDocument(document);
  if (expectedRevision !== document.revision.id)
    throw new Error("REVISION_CONFLICT: document has changed");
  const conflicts = clone(document.comparison?.conflicts || []),
    seen = new Set();
  let payload = payloadOf(document);
  for (const choice of choices) {
    const conflict = conflicts.find((c) => c.id === choice.conflictId);
    if (
      !conflict ||
      seen.has(choice.conflictId) ||
      !["left", "right", "base"].includes(choice.choice)
    )
      throw new Error("MERGE_CHOICE: choose each existing conflict once");
    seen.add(choice.conflictId);
    payload = applyCell(payload, conflict.path, conflict[choice.choice]);
  }
  return createDocument({
    ...document,
    ...payload,
    parentId: document.revision.id,
    reason: "Resolved merge choices",
    comparison: {
      ...document.comparison,
      conflicts: conflicts.filter((c) => !seen.has(c.id)),
      resolutions: [
        ...(document.comparison.resolutions || []),
        ...clone(choices),
      ],
    },
  });
}
function adoptSnapshot(
  document,
  captured,
  expectedRevision = document.revision.id,
) {
  assertDocument(document);
  assertDocument(captured);
  if (expectedRevision !== document.revision.id)
    throw new Error("REVISION_CONFLICT: document has changed");
  if (
    document.profile !== captured.profile ||
    captured.state !== "snapshot" ||
    !captured.baselineId
  )
    throw new Error(
      "ADOPTION_SOURCE: select a captured baseline of the same profile",
    );
  if (document.comparison?.conflicts?.length)
    throw new Error("MERGE_CONFLICT: resolve draft before baseline adoption");
  return createDocument({
    ...document,
    state: "proposal",
    snapshots: unionSnapshots([document, captured]),
    baselineId: captured.baselineId,
    parentId: document.revision.id,
    reason: "Explicitly adopted newer source snapshot",
    comparison: {
      ...clone(document.comparison || {}),
      baselineContexts: {
        ...clone(document.comparison?.baselineContexts || {}),
        [captured.baselineId]: contextOf(captured),
      },
      adoptions: [
        ...(document.comparison?.adoptions || []),
        {
          from: document.baselineId,
          to: captured.baselineId,
          sourceRevision: captured.revision.id,
        },
      ],
    },
  });
}
function linkMapping(
  document,
  target,
  { id, elementId, targetElementId, reason },
  expectedRevision = document.revision.id,
) {
  assertDocument(document);
  assertDocument(target);
  if (expectedRevision !== document.revision.id)
    throw new Error("REVISION_CONFLICT: document has changed");
  if (
    !id ||
    typeof reason !== "string" ||
    !reason.trim() ||
    reason.length > 2000
  )
    throw new Error(
      "MAPPING_ARGUMENTS: identify and explain the authored mapping",
    );
  if (
    !records(document.model).has(JSON.stringify(["element", elementId])) ||
    !records(target.model).has(JSON.stringify(["element", targetElementId]))
  )
    throw new Error("MAPPING_REFERENCE: choose existing semantic elements");
  if (target.state !== "snapshot" || !target.baselineId)
    throw new Error(
      "MAPPING_TARGET: cross-layer links need a frozen target snapshot",
    );
  const mapping = {
    id,
    kind: "authored",
    elementId,
    snapshotId: target.baselineId,
    targetElementId,
    targetProfile: target.profile,
    targetTitle: target.title,
    sourceRevision: target.revision.id,
    reason,
  };
  return createDocument({
    ...document,
    parentId: document.revision.id,
    reason: "Linked explicit cross-layer mapping",
    snapshots: unionSnapshots([document, target]),
    mappings: [
      ...(document.mappings || []).filter((m) => m.id !== id),
      mapping,
    ],
    comparison: document.comparison
      ? {
          ...document.comparison,
          baselineContexts: {
            ...document.comparison.baselineContexts,
            [target.baselineId]: contextOf(target),
          },
        }
      : undefined,
  });
}
module.exports = {
  semantic,
  compareModels,
  compareDocuments,
  createProposal,
  baselineDocument,
  mergeDocuments,
  resolveMerge,
  adoptSnapshot,
  linkMapping,
};
