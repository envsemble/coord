const { createHash, randomUUID } = require("node:crypto");
const Ajv = require("ajv/dist/2020");
const { validateModel, toViewerModel } = require("../index.cjs");
const schema = require("../../schemas/document-schema.json");
const validator = new Ajv({ strict: false, allErrors: true }).compile(schema);
const clone = (value) => JSON.parse(JSON.stringify(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const fingerprint = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const issue = (code, message, elementId = null, layer = "references") => ({
  code,
  message,
  elementId,
  layer,
  severity: "error",
});
function graphIssues(model) {
  const issues = [],
    ids = new Set();
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  for (const element of [
    ...model.nodes,
    ...model.nodes.flatMap((n) => n.attributes || []),
    ...model.nodes.flatMap((n) => n.methods || []),
    ...model.relations,
    ...model.generalizations,
    ...model.generalizationSets,
  ]) {
    if (!element.id) continue;
    if (ids.has(element.id))
      issues.push(
        issue("DUPLICATE_ID", `Duplicate identity ${element.id}`, element.id),
      );
    ids.add(element.id);
  }
  const ref = (id, owner) => {
    if (!nodes.has(id))
      issues.push(issue("INVALID_REFERENCE", `Missing endpoint ${id}`, owner));
  };
  const multiplicity = (value) =>
    value === "?" ||
    (/^(?:\d+|\*)(?:\.\.(?:\d+|\*))?$/.test(value) &&
      (!value.includes("..") ||
        (value.split("..")[0] !== "*" &&
          (value.endsWith("..*") ||
            +value.split("..")[0] <= +value.split("..")[1]))));
  for (const attribute of model.nodes.flatMap((n) => n.attributes))
    if (attribute.multiplicity != null && !multiplicity(attribute.multiplicity))
      issues.push(
        issue(
          "MULTIPLICITY",
          `Invalid attribute count ${attribute.multiplicity}`,
          attribute.id,
        ),
      );
  for (const relation of model.relations) {
    ref(relation.sourceId, relation.id);
    ref(relation.targetId, relation.id);
    for (const value of [
      relation.sourceMultiplicity,
      relation.targetMultiplicity,
    ])
      if (!multiplicity(value))
        issues.push(
          issue("MULTIPLICITY", `Invalid count ${value}`, relation.id),
        );
  }
  const parents = new Map(model.nodes.map((n) => [n.id, []]));
  for (const g of model.generalizations) {
    ref(g.specificId, g.id);
    ref(g.generalId, g.id);
    parents.get(g.specificId)?.push(g.generalId);
  }
  const colors = new Map();
  for (const id of nodes.keys()) {
    if (colors.get(id) === 2) continue;
    const stack = [{ id, next: 0 }];
    colors.set(id, 1);
    while (stack.length) {
      const frame = stack.at(-1),
        adjacent = parents.get(frame.id) || [];
      if (frame.next === adjacent.length) {
        colors.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const parent = adjacent[frame.next++];
      if (colors.get(parent) === 1)
        issues.push(issue("INHERITANCE_CYCLE", "Inheritance cycle", parent));
      else if (!colors.has(parent)) {
        colors.set(parent, 1);
        stack.push({ id: parent, next: 0 });
      }
    }
  }
  const generals = new Map(model.generalizations.map((g) => [g.id, g]));
  for (const set of model.generalizationSets) {
    const members = set.generalizations.map((id) => generals.get(id));
    if (
      !members.length ||
      members.some((g) => !g) ||
      new Set(set.generalizations).size !== members.length ||
      new Set(members.filter(Boolean).map((g) => g.generalId)).size !== 1
    )
      issues.push(
        issue(
          "GENERALIZATION_SET",
          "Generalization set needs unique members sharing a supertype",
          set.id,
        ),
      );
  }
  return { issues, ids };
}
function validateDocument(document) {
  const issues = [],
    add = (code, message, id, layer) =>
      issues.push(issue(code, message, id, layer));
  if (!validator(document))
    return report(
      (validator.errors || []).map((e) =>
        issue(
          "DOCUMENT_SCHEMA",
          `${e.instancePath || "/"} ${e.message}`,
          null,
          "schema",
        ),
      ),
    );
  let ids;
  if (document.profile === "ontouml") {
    if (
      !Array.isArray(document.model.elements) ||
      document.model.elements.some(
        (e) => !e || typeof e !== "object" || Array.isArray(e),
      )
    )
      return report([
        issue(
          "DOCUMENT_SCHEMA",
          "OntoUML elements must be objects",
          null,
          "schema",
        ),
      ]);
    const result = validateModel(document.model, document.evidence);
    issues.push(...result.issues);
    if (
      result.issues.some((i) => i.severity === "error" && i.layer === "schema")
    )
      return report(issues);
    ids = new Set([
      document.model.id,
      ...(Array.isArray(document.model.elements)
        ? document.model.elements
        : []
      ).map((e) => e.id),
    ]);
  } else {
    if (document.model.type !== "StructuralModel")
      add(
        "PROFILE_MODEL",
        "Database/code profiles require StructuralModel",
        null,
        "schema",
      );
    else {
      const result = graphIssues(document.model);
      issues.push(...result.issues);
      ids = result.ids;
      issues.push(
        ...require("../validation/validateEvidence.cjs").validateEvidence(
          { elements: [...ids].map((id) => ({ id })) },
          document.evidence,
        ),
      );
    }
  }
  for (const snapshot of document.snapshots) {
    if (
      snapshot.integrity !==
      fingerprint({
        profile: snapshot.profile,
        model: snapshot.model,
        capture: snapshot.capture,
      })
    )
      add(
        "SNAPSHOT_INTEGRITY",
        "Captured snapshot contents changed",
        snapshot.id,
        "integrity",
      );
    issues.push(
      ...validateDocument({
        ...document,
        profile: snapshot.profile,
        model: snapshot.model,
        evidence: {},
        snapshots: [],
        baselineId: null,
        state: "authored",
        views: [],
        context: { records: [], links: [] },
        mappings: [],
        comparison: undefined,
        learning: undefined,
      }).issues,
    );
  }
  if (
    new Set(document.snapshots.map((s) => s.id)).size !==
    document.snapshots.length
  )
    add("SNAPSHOT_ID", "Repeated snapshot identity");
  if (
    document.baselineId &&
    !document.snapshots.some((s) => s.id === document.baselineId)
  )
    add("BASELINE_REFERENCE", "Baseline snapshot is missing");
  if (document.state === "snapshot") {
    const baseline = document.snapshots.find(
      (s) => s.id === document.baselineId,
    );
    if (
      !baseline ||
      baseline.profile !== document.profile ||
      fingerprint(baseline.model) !== fingerprint(document.model)
    )
      add(
        "SNAPSHOT_STATE",
        "Snapshot documents must retain their backing captured model",
        null,
        "integrity",
      );
  }
  const nodeIds = new Set(
    document.profile === "ontouml"
      ? document.model.elements
          .filter((e) => e.type === "Class")
          .map((e) => e.id)
      : document.model.nodes.map((n) => n.id),
  );
  const exchangeElements = new Map(
    (document.profile === "ontouml" ? document.model.elements : []).map((e) => [
      e.id,
      e,
    ]),
  );
  const edges =
    document.profile === "ontouml"
      ? document.model.elements
          .filter((e) => ["BinaryRelation", "Generalization"].includes(e.type))
          .map((e) => ({
            id: e.id,
            ends:
              e.type === "Generalization"
                ? [e.specific, e.general]
                : (e.properties || []).map(
                    (id) => exchangeElements.get(id)?.propertyType,
                  ),
          }))
      : [
          ...document.model.relations.map((e) => ({
            id: e.id,
            ends: [e.sourceId, e.targetId],
          })),
          ...document.model.generalizations.map((g) => ({
            id: g.id,
            ends: [g.specificId, g.generalId],
          })),
        ];
  if (new Set(document.views.map((v) => v.key)).size !== document.views.length)
    add("VIEW_ID", "Repeated view key");
  for (const view of document.views) {
    const visible = new Set(view.nodeIds);
    if (
      view.nodeIds.some((id) => !nodeIds.has(id)) ||
      view.focusIds?.some((id) => !visible.has(id))
    )
      add("VIEW_REFERENCE", `View ${view.key} refers to a missing/hidden node`);
    if (
      view.edgeIds?.some(
        (id) =>
          !edges.some(
            (e) => e.id === id && e.ends.every((end) => visible.has(end)),
          ),
      )
    )
      add("VIEW_REFERENCE", `View ${view.key} refers to a missing/hidden edge`);
    if (
      view.columns &&
      (view.columns.flat().length !== visible.size ||
        new Set(view.columns.flat()).size !== visible.size ||
        view.columns.flat().some((id) => !visible.has(id)))
    )
      add("VIEW_COLUMNS", `View ${view.key} must rank each visible node once`);
  }
  const records = new Set(document.context.records.map((r) => r.id));
  issues.push(
    ...require("../learning/scenarios.cjs").learningIssues(
      document,
      ids || new Set(),
      nodeIds,
    ),
  );
  if (records.size !== document.context.records.length)
    add("CONTEXT_ID", "Repeated context identity");
  for (const link of document.context.links)
    if (!ids?.has(link.elementId) || !records.has(link.recordId))
      add(
        "CONTEXT_REFERENCE",
        "Context link has a missing model element or record",
        link.elementId,
      );
  const conflicts = document.comparison?.conflicts || [];
  if (new Set(conflicts.map((c) => c.id)).size !== conflicts.length)
    add("CONFLICT_ID", "Repeated merge conflict identity");
  for (const [snapshotId, context] of Object.entries(
    document.comparison?.baselineContexts || {},
  )) {
    const snapshot = document.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) {
      add(
        "BASELINE_CONTEXT",
        "Baseline context must refer to a retained snapshot",
        snapshotId,
      );
      continue;
    }
    const targetIds =
      snapshot.profile === "ontouml"
        ? new Set([
            snapshot.model.id,
            ...snapshot.model.elements.map((e) => e.id),
          ])
        : graphIssues(snapshot.model).ids;
    const recordIds = new Set(context.context.records.map((r) => r.id));
    if (
      recordIds.size !== context.context.records.length ||
      context.context.links.some(
        (l) => !targetIds.has(l.elementId) || !recordIds.has(l.recordId),
      )
    )
      add(
        "BASELINE_CONTEXT",
        "Retained context has missing elements or repeated records",
        snapshotId,
      );
  }
  if (conflicts.length)
    issues.push({
      code: "MERGE_CONFLICT",
      message: `${document.comparison.conflicts.length} unresolved merge choices; this is a draft`,
      elementId: null,
      layer: "semantic",
      severity: "warning",
    });
  const mappings = document.mappings || [];
  if (new Set(mappings.map((m) => m.id)).size !== mappings.length)
    add("MAPPING_ID", "Repeated authored mapping identity");
  for (const mapping of mappings) {
    const snapshot = document.snapshots.find(
      (s) => s.id === mapping.snapshotId,
    );
    const targetIds =
      snapshot?.profile === "ontouml"
        ? new Set(snapshot.model.elements.map((e) => e.id))
        : snapshot
          ? graphIssues(snapshot.model).ids
          : new Set();
    if (!ids?.has(mapping.elementId) || !targetIds.has(mapping.targetElementId))
      add(
        "MAPPING_REFERENCE",
        "Authored mapping needs a current element and retained target snapshot element",
        mapping.elementId,
      );
  }
  return report(issues);
}
function report(issues) {
  return {
    valid: !issues.some((i) => i.severity === "error"),
    schema: "atlas/document/v1",
    engines: [{ name: "Atlas profiles", version: "1", layer: "schema" }],
    issues,
    counts: Object.fromEntries(
      ["error", "warning", "info"].map((s) => [
        s,
        issues.filter((i) => i.severity === s).length,
      ]),
    ),
    limitations: [
      "Checks cover documented structural/profile rules; they do not establish domain accuracy or verify an unavailable source.",
    ],
  };
}
function assertDocument(document) {
  const result = validateDocument(document);
  const blocking = result.issues.filter(
    (i) => i.severity === "error" && i.layer !== "ontology",
  );
  if (blocking.length)
    throw new Error(blocking.map((i) => `${i.code}: ${i.message}`).join("\n"));
  return result;
}
function createDocument(input) {
  if (!input || !(input.model || input.project))
    throw new Error("DOCUMENT_INPUT: provide a model or OntoUML project");
  const model = clone(input.model || input.project);
  const document = {
    ...clone(input),
    format: "atlas/document",
    formatVersion: 1,
    id: input.id || `atlas-${randomUUID()}`,
    title: input.title || input.evidence?.title || "Atlas model",
    profile: input.profile || "ontouml",
    state: input.state || "authored",
    model,
    evidence: clone(input.evidence || {}),
    views: clone(input.views || []),
    snippets: clone(input.snippets || {}),
    context: clone(input.context || { records: [], links: [] }),
    snapshots: clone(input.snapshots || []),
    baselineId: input.baselineId || null,
    revision: {
      ...clone(input.revision || {}),
      id: "",
      parentId: input.parentId || null,
      createdAt: input.createdAt || new Date().toISOString(),
      reason: input.reason || "Created model",
    },
  };
  for (const field of ["project", "parentId", "createdAt", "reason"])
    delete document[field];
  document.revision.id = fingerprint({
    ...document,
    revision: { ...document.revision, id: "" },
  });
  assertDocument(document);
  return document;
}
function reviseDocument(
  document,
  changes,
  expectedRevision = document.revision.id,
) {
  assertDocument(document);
  if (expectedRevision !== document.revision.id)
    throw new Error("REVISION_CONFLICT: document has changed");
  const allowed = new Set([
    "title",
    "model",
    "evidence",
    "views",
    "snippets",
    "context",
    "learning",
    "reporting",
    "reason",
  ]);
  if (Object.keys(changes).some((key) => !allowed.has(key)))
    throw new Error(
      "Revisions cannot change snapshots, identities, or profile",
    );
  const revised = clone(document);
  for (const [key, value] of Object.entries(changes))
    if (key !== "reason") revised[key] = clone(value);
  revised.state = document.baselineId ? "proposal" : document.state;
  revised.revision = {
    ...revised.revision,
    id: "",
    parentId: document.revision.id,
    createdAt: new Date().toISOString(),
    reason: changes.reason || "Revised model",
  };
  revised.revision.id = fingerprint(revised);
  assertDocument(revised);
  return revised;
}
// Move a document to another work item: change only its work identity and the
// paths of its context records. No modeled fact changes, so its state (including
// a captured snapshot) is kept; the move is still a recorded revision.
function relocateDocument(
  document,
  changes = {},
  expectedRevision = document.revision.id,
) {
  const plain = (value) =>
    value !== null &&
    typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
  if (!plain(changes))
    throw new Error("RELOCATE_INPUT: changes must be a plain object");
  const unknown = Object.keys(changes).filter(
    (key) => !["workId", "recordPaths", "reason"].includes(key),
  );
  if (unknown.length)
    throw new Error(
      `RELOCATE_INPUT: relocation changes only workId and recordPaths, not ${unknown.join(", ")}`,
    );
  const { workId, recordPaths = {}, reason } = changes;
  if (!plain(recordPaths))
    throw new Error("RELOCATE_RECORD: recordPaths must be a plain object");
  if (reason !== undefined && (typeof reason !== "string" || !reason))
    throw new Error("RELOCATE_INPUT: reason must be nonempty text");
  assertDocument(document);
  if (expectedRevision !== document.revision.id)
    throw new Error("REVISION_CONFLICT: document has changed");
  if (
    workId !== undefined &&
    (typeof workId !== "string" || !/^work-[0-9]{4,}$/.test(workId))
  )
    throw new Error("RELOCATE_WORK: workId must be a work-NNNN identity");
  const records = new Map(document.context.records.map((r) => [r.id, r]));
  for (const [id, path] of Object.entries(recordPaths)) {
    if (!records.has(id))
      throw new Error(`RELOCATE_RECORD: no context record ${id}`);
    if (
      path !== null &&
      (typeof path !== "string" || !path || path.length > 2048)
    )
      throw new Error("RELOCATE_PATH: a record path must be text or null");
  }
  if (workId === undefined && !Object.keys(recordPaths).length)
    throw new Error("RELOCATE_EMPTY: nothing to relocate");
  const relocated = clone(document);
  if (workId !== undefined) relocated.workId = workId;
  relocated.context.records = relocated.context.records.map((record) => {
    if (!Object.hasOwn(recordPaths, record.id)) return record;
    const { path: ignored, ...rest } = record;
    return recordPaths[record.id] === null
      ? rest
      : { ...record, path: recordPaths[record.id] };
  });
  relocated.revision = {
    ...relocated.revision,
    id: "",
    parentId: document.revision.id,
    createdAt: new Date().toISOString(),
    reason: reason || "Relocated model",
  };
  relocated.revision.id = fingerprint(relocated);
  assertDocument(relocated);
  return relocated;
}
function createSnapshot({ profile, model, capture, id }) {
  const snapshot = {
    id: id || `capture-${randomUUID()}`,
    profile,
    model: clone(model),
    capture: clone(capture),
  };
  snapshot.integrity = fingerprint({
    profile: snapshot.profile,
    model: snapshot.model,
    capture: snapshot.capture,
  });
  return snapshot;
}
function documentViewerModel(document) {
  const validation = assertDocument(document);
  let model;
  if (document.profile === "ontouml")
    model = toViewerModel(document.model, document.evidence);
  else
    model = {
      id: document.id,
      title: document.title,
      version: document.revision.id.slice(0, 8),
      date: document.revision.createdAt.slice(0, 10),
      status: `${document.profile} ${document.state}`,
      repositories: document.evidence.repositories || [],
      sources: document.evidence.sources || [],
      unknowns: document.evidence.unknowns || [],
      constraints: document.model.constraints || [],
      classes: document.model.nodes.map((n) => ({
        description: "",
        evidence: [],
        ...n,
        stereotype:
          n.kind || (document.profile === "database" ? "table" : "class"),
        attributes: n.attributes || [],
        ...(document.evidence.elements?.[n.id] || {}),
      })),
      relations: document.model.relations.map((r) => ({
        description: "",
        evidence: [],
        stereotype: "",
        ...r,
        ...(document.evidence.elements?.[r.id] || {}),
      })),
      generalizations: document.model.generalizations,
      partitions: document.model.generalizationSets,
    };
  model.title = document.title;
  model.validation = validation;
  model.document = {
    id: document.id,
    profile: document.profile,
    state: document.state,
    revision: document.revision,
    baselineId: document.baselineId,
    snapshots: document.snapshots.map(({ model: ignored, ...s }) => s),
    context: document.context,
    imported: document.imported || false,
    comparison: document.comparison || null,
    mappings: document.mappings || [],
  };
  return model;
}
module.exports = {
  createDocument,
  reviseDocument,
  relocateDocument,
  validateDocument,
  assertDocument,
  createSnapshot,
  documentViewerModel,
  fingerprint,
  clone,
};
