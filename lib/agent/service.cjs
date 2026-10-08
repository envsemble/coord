const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const Ajv = require("ajv");
const {
  createDocument,
  reviseDocument,
  validateDocument,
  assertDocument,
  fingerprint,
  clone,
} = require("../document/document.cjs");
const {
  importDocument,
  MAX_INPUT,
  MAX_DATA,
} = require("../document/portable.cjs");
const handleSchema = { type: "string", pattern: "^m-[a-f0-9]{24}$" };
const string = { type: "string", minLength: 1 };
const object = { type: "object" };
const page = {
  offset: { type: "integer", minimum: 0 },
  limit: { type: "integer", minimum: 1, maximum: 100 },
};
const definitions = [
  [
    "create",
    "Create a validated model document; returns a persistent handle.",
    { input: object },
    ["input"],
  ],
  [
    "load",
    "Load an existing Atlas JSON/HTML file into the persistent workspace.",
    { file: string },
    ["file"],
  ],
  [
    "list",
    "List stored model summaries, scoped by optional work identity.",
    { ...page, workId: string },
    [],
  ],
  [
    "inspect",
    "Inspect a model summary or a particular semantic element and its references.",
    { handle: handleSchema, elementId: string, ...page },
    ["handle"],
  ],
  [
    "revise",
    "Apply an atomic batch of semantic changes with an expected revision. Snapshots stay frozen.",
    {
      handle: handleSchema,
      expectedRevision: string,
      changes: {
        type: "object",
        properties: Object.fromEntries(
          [
            "title",
            "model",
            "evidence",
            "views",
            "snippets",
            "context",
            "reason",
          ].map((k) => [k, {}]),
        ),
        additionalProperties: false,
      },
      operations: {
        type: "array",
        maxItems: 1000,
        items: {
          type: "object",
          required: ["action", "collection", "id"],
          properties: {
            action: { enum: ["upsert", "delete"] },
            collection: {
              enum: [
                "elements",
                "nodes",
                "relations",
                "generalizations",
                "generalizationSets",
              ],
            },
            id: string,
            value: object,
          },
          additionalProperties: false,
        },
      },
    },
    ["handle", "expectedRevision"],
  ],
  [
    "validate",
    "Return paginated findings and explicit validator coverage.",
    { handle: handleSchema, ...page },
    ["handle"],
  ],
  [
    "prepare",
    "Prepare a diagram payload locally; return its file reference, not the scene.",
    { handle: handleSchema },
    ["handle"],
  ],
  [
    "import",
    "Reopen Atlas HTML/JSON safely without executing its scripts.",
    { file: string },
    ["file"],
  ],
  [
    "export",
    "Build a self-contained HTML from a stored document.",
    { handle: handleSchema, file: string },
    ["handle"],
  ],
].map(([name, description, properties, required]) => ({
  name: `atlas_${name}`,
  description,
  inputSchema: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: ["list", "inspect", "validate"].includes(name),
    destructiveHint: false,
    openWorldHint: false,
  },
}));
const ajv = new Ajv({ strict: false, allErrors: true });
const validators = new Map(
  definitions.map((d) => [d.name, ajv.compile(d.inputSchema)]),
);
function compact(value, depth = 0) {
  if (typeof value === "string")
    return value.length > 800
      ? `${value.slice(0, 800)}… [see document]`
      : value;
  if (depth > 6) return "[see document]";
  if (Array.isArray(value))
    return value.slice(0, 25).map((v) => compact(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 25)
        .map(([k, v]) => [k, compact(v, depth + 1)]),
    );
  return value;
}
function collection(document) {
  return document.profile === "ontouml"
    ? document.model.elements
    : [
        ...document.model.nodes,
        ...document.model.relations,
        ...document.model.generalizations,
        ...document.model.generalizationSets,
        ...document.model.nodes.flatMap((n) => n.attributes),
      ];
}
function modelSummary(document, handle) {
  const elements = collection(document);
  return {
    handle,
    id: document.id,
    title: document.title,
    profile: document.profile,
    state: document.state,
    revision: document.revision.id,
    workId: document.workId || null,
    elements: elements.length,
    baselineId: document.baselineId,
    captures: document.snapshots.map((s) => ({
      id: s.id,
      capturedAt: s.capture.capturedAt,
      coverage: s.capture.coverage.status,
    })),
    file: `.atlas/models/${handle}.json`,
  };
}
function boundedError(error, workspace) {
  const message = String(error.message || error);
  const result = { error: message.slice(0, 2000) };
  if (message.length > 2000) {
    result.error += "… [details omitted]";
    if (workspace && Buffer.byteLength(message) <= MAX_DATA) {
      try {
        result.errorFile = workspace.writeOutput(
          `.atlas/results/error-${fingerprint(message)}.txt`,
          message,
        );
      } catch {
        /* Preserve the original error when result storage is unavailable. */
      }
    }
  }
  return result;
}
function batchModel(document, operations) {
  const model = clone(document.model);
  for (const operation of operations) {
    const allowed =
      document.profile === "ontouml"
        ? ["elements"]
        : ["nodes", "relations", "generalizations", "generalizationSets"];
    if (!allowed.includes(operation.collection))
      throw new Error(
        "BATCH_PROFILE: collection does not belong to this profile",
      );
    const entries = model[operation.collection],
      index = entries.findIndex((e) => e.id === operation.id);
    if (operation.action === "delete") {
      if (index < 0)
        throw new Error("ELEMENT_NOT_FOUND: cannot delete missing element");
      entries.splice(index, 1);
    } else {
      if (!operation.value || operation.value.id !== operation.id)
        throw new Error(
          "BATCH_ID: upsert value must retain the specified identity",
        );
      if (index < 0) entries.push(clone(operation.value));
      else entries[index] = clone(operation.value);
    }
  }
  return model;
}
class AtlasWorkspace {
  constructor(root) {
    if (!root) throw new Error("WORKSPACE_REQUIRED: configure an Atlas root");
    this.root = fs.realpathSync(root);
    fs.mkdirSync(this.resolve(".atlas/models"), { recursive: true });
  }
  resolve(file) {
    const resolved = path.resolve(this.root, file);
    const inside = (value) => {
      const relative = path.relative(this.root, value);
      return (
        relative === "" ||
        (!relative.startsWith(`..${path.sep}`) &&
          relative !== ".." &&
          !path.isAbsolute(relative))
      );
    };
    if (!inside(resolved))
      throw new Error("WORKSPACE_PATH: file is outside the configured root");
    let ancestor = resolved;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    if (!inside(fs.realpathSync(ancestor)))
      throw new Error("WORKSPACE_PATH: symlink leaves configured root");
    return resolved;
  }
  readFile(file) {
    const resolved = this.resolve(file);
    if (fs.statSync(resolved).size > MAX_INPUT)
      throw new Error("IMPORT_LIMIT: input exceeds 64 MiB");
    return fs.readFileSync(resolved, "utf8");
  }
  load(handle) {
    if (!/^m-[a-f0-9]{24}$/.test(handle))
      throw new Error("HANDLE_FORMAT: invalid model handle");
    const document = JSON.parse(this.readFile(`.atlas/models/${handle}.json`));
    assertDocument(document);
    if (`m-${fingerprint(document.id).slice(0, 24)}` !== handle)
      throw new Error("HANDLE_ID: stored identity does not match handle");
    const history = this.resolve(
      `.atlas/history/${handle}/${fingerprint(document.revision.id)}.json`,
    );
    if (
      !fs.existsSync(history) ||
      fingerprint(
        JSON.parse(this.readFile(path.relative(this.root, history))),
      ) !== fingerprint(document)
    )
      throw new Error(
        "REVISION_INTEGRITY: stored document changed outside a revision; reopen the edited file in a separate workspace to reconcile",
      );
    return document;
  }
  locked(handle, operation) {
    const file = this.resolve(`.atlas/models/${handle}.lock`);
    let fd;
    try {
      fd = fs.openSync(file, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let pid;
      try {
        pid = Number(fs.readFileSync(file, "utf8"));
        if (!Number.isInteger(pid) || pid < 1) throw new Error("invalid");
        process.kill(pid, 0);
      } catch (failure) {
        if (failure.code === "ESRCH") {
          fs.unlinkSync(file);
          return this.locked(handle, operation);
        }
        throw new Error(
          "WORKSPACE_BUSY: lock is active or requires explicit recovery",
        );
      }
      throw new Error("WORKSPACE_BUSY: another process is writing this model");
    }
    try {
      fs.writeFileSync(fd, String(process.pid));
      return operation();
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(file);
    }
  }
  save(document, expectedRevision = null) {
    assertDocument(document);
    const data = JSON.stringify(document, null, 2);
    if (Buffer.byteLength(data) > MAX_DATA)
      throw new Error("DOCUMENT_LIMIT: stored document exceeds 32 MiB");
    const handle = `m-${fingerprint(document.id).slice(0, 24)}`;
    return this.locked(handle, () => {
      const file = this.resolve(`.atlas/models/${handle}.json`);
      if (fs.existsSync(file)) {
        const previous = this.load(handle);
        if (previous.revision.id !== expectedRevision)
          throw new Error(
            "REVISION_CONFLICT: load the current document before updating",
          );
      } else if (expectedRevision)
        throw new Error("MODEL_NOT_FOUND: cannot revise a missing model");
      const history = this.resolve(
        `.atlas/history/${handle}/${fingerprint(document.revision.id)}.json`,
      );
      fs.mkdirSync(path.dirname(history), { recursive: true });
      if (fs.existsSync(history)) {
        if (fs.readFileSync(history, "utf8") !== data)
          throw new Error(
            "REVISION_ID: revision identity was reused for different contents",
          );
      } else fs.writeFileSync(history, data, { flag: "wx" });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, data, { flag: "wx" });
        fs.renameSync(temporary, file);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
      return modelSummary(document, handle);
    });
  }
  writeOutput(file, data) {
    const resolved = this.resolve(file),
      relative = path.relative(this.root, resolved).replaceAll("\\", "/");
    let ancestor = resolved;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const canonical = path.resolve(
      fs.realpathSync(ancestor),
      path.relative(ancestor, resolved),
    );
    if (
      [".atlas/models", ".atlas/history"].some((folder) => {
        const protectedPath = this.resolve(folder);
        const realProtectedPath = fs.existsSync(protectedPath)
          ? fs.realpathSync(protectedPath)
          : protectedPath;
        const difference = path.relative(realProtectedPath, canonical);
        return (
          difference === "" ||
          (!difference.startsWith(`..${path.sep}`) &&
            difference !== ".." &&
            !path.isAbsolute(difference))
        );
      })
    )
      throw new Error("WORKSPACE_PATH: export cannot overwrite model storage");
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    if (fs.existsSync(resolved)) {
      if (fs.readFileSync(resolved, "utf8") !== data)
        throw new Error("OUTPUT_EXISTS: choose a new export filename");
    } else fs.writeFileSync(resolved, data, { flag: "wx" });
    return relative;
  }
  async execute(name, args = {}) {
    const result = await this.operation(name, args);
    if (Buffer.byteLength(JSON.stringify(result)) <= 16 * 1024) return result;
    const file = this.writeOutput(
      `.atlas/results/${fingerprint(result)}.json`,
      JSON.stringify(result),
    );
    return {
      handle: result.handle || args.handle || null,
      revision: result.revision || null,
      resultFile: file,
      notice:
        "Detailed result stored locally; inspect smaller pages for inline results.",
    };
  }
  async operation(name, args = {}) {
    const validate = validators.get(name);
    if (!validate)
      throw new Error("TOOL_NOT_FOUND: unsupported Atlas operation");
    if (!validate(args))
      throw new Error(`TOOL_ARGUMENTS: ${ajv.errorsText(validate.errors)}`);
    if (Buffer.byteLength(JSON.stringify(args)) > MAX_DATA)
      throw new Error("TOOL_LIMIT: arguments exceed 32 MiB");
    const offset = args.offset || 0,
      limit = args.limit || 25;
    if (name === "atlas_create") return this.save(createDocument(args.input));
    if (name === "atlas_import")
      return this.save(importDocument(this.readFile(args.file)));
    if (name === "atlas_load") {
      const text = this.readFile(args.file);
      const document = text.trimStart().startsWith("{")
        ? JSON.parse(text)
        : importDocument(text);
      assertDocument(document);
      const handle = `m-${fingerprint(document.id).slice(0, 24)}`;
      const stored = this.resolve(`.atlas/models/${handle}.json`);
      if (fs.existsSync(stored)) {
        if (fingerprint(this.load(handle)) !== fingerprint(document))
          throw new Error(
            "REVISION_CONFLICT: model identity already has a different current document",
          );
        return modelSummary(document, handle);
      }
      return this.save(document);
    }
    if (name === "atlas_list") {
      const files = fs
        .readdirSync(this.resolve(".atlas/models"))
        .filter((f) => /^m-[a-f0-9]{24}\.json$/.test(f))
        .sort();
      const all = files
        .map((f) => modelSummary(this.load(f.slice(0, -5)), f.slice(0, -5)))
        .filter((d) => !args.workId || d.workId === args.workId);
      return {
        total: all.length,
        offset,
        models: all.slice(offset, offset + limit),
      };
    }
    const document = this.load(args.handle);
    if (name === "atlas_inspect") {
      const summary = modelSummary(document, args.handle),
        elements = collection(document);
      if (args.elementId) {
        const element = elements.find((e) => e.id === args.elementId);
        if (!element)
          throw new Error("ELEMENT_NOT_FOUND: unknown semantic identity");
        return {
          ...summary,
          element: compact(element),
          evidence: compact(document.evidence.elements?.[args.elementId] || {}),
          context: compact(
            document.context.records.filter((r) =>
              document.context.links.some(
                (l) => l.elementId === args.elementId && l.recordId === r.id,
              ),
            ),
          ),
        };
      }
      return {
        ...summary,
        offset,
        items: elements.slice(offset, offset + limit).map((e) => ({
          id: e.id,
          name: compact(e.name),
          type: e.type || e.kind || "element",
        })),
      };
    }
    if (name === "atlas_revise") {
      const changes = clone(args.changes || {});
      if (args.operations?.length) {
        if (changes.model)
          throw new Error(
            "BATCH_MODEL: choose whole-model replacement or batch operations",
          );
        changes.model = batchModel(document, args.operations);
      }
      return this.save(
        reviseDocument(document, changes, args.expectedRevision),
        args.expectedRevision,
      );
    }
    if (name === "atlas_validate") {
      const report = validateDocument(document);
      return {
        valid: report.valid,
        counts: report.counts,
        total: report.issues.length,
        offset,
        issues: report.issues
          .slice(offset, offset + limit)
          .map((i) => compact(i)),
        limitations: report.limitations,
        schema: report.schema,
      };
    }
    if (name === "atlas_prepare") {
      const prepared = await require("../build/buildViewer.cjs").prepareViewer({
        document,
        includeArtifacts: false,
      });
      const file = this.writeOutput(
        `.atlas/prepared/${args.handle}-${fingerprint(document.revision.id).slice(0, 12)}.json`,
        JSON.stringify(prepared.payload),
      );
      return {
        ...modelSummary(document, args.handle),
        payloadFile: file,
        views: prepared.views.map((v) => ({
          key: v.key,
          title: v.title,
          nodes: v.nodeIds.length,
        })),
        validation: prepared.report.counts,
      };
    }
    if (name === "atlas_export") {
      const built = await require("../build/buildViewer.cjs").buildViewer({
        document,
        slug: args.handle,
      });
      const file = this.writeOutput(
        args.file ||
          `.atlas/exports/${args.handle}-${fingerprint(document.revision.id).slice(0, 12)}.html`,
        built.html,
      );
      return {
        ...modelSummary(document, args.handle),
        htmlFile: file,
        bytes: Buffer.byteLength(built.html),
        validation: built.report.counts,
      };
    }
  }
}
module.exports = {
  AtlasWorkspace,
  toolDefinitions: definitions,
  batchModel,
  boundedError,
};
