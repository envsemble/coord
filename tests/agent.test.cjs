const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StdioClientTransport,
} = require("@modelcontextprotocol/sdk/client/stdio.js");
const {
  createWorkspace,
  importDocument,
  Project,
} = require("../lib/index.cjs");
const { createProject } = require("../examples/r5/create-project.cjs");
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-agent-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, workspace: createWorkspace(root) };
}
const structural = () => ({
  type: "StructuralModel",
  nodes: [{ id: "user", name: "User", attributes: [] }],
  relations: [],
  generalizations: [],
  generalizationSets: [],
});
test("MCP annotations distinguish observation, additive creation and destructive updates", () => {
  const definitions = new Map(
    require("../lib/agent/service.cjs").toolDefinitions.map((tool) => [
      tool.name,
      tool.annotations,
    ]),
  );
  for (const name of ["list", "inspect", "validate", "compare", "scenarios"]) {
    assert.equal(definitions.get(`atlas_${name}`).readOnlyHint, true);
    assert.equal(definitions.get(`atlas_${name}`).destructiveHint, false);
  }
  for (const name of [
    "revise",
    "map",
    "resolve_merge",
    "adopt_snapshot",
    "export",
  ]) {
    assert.equal(definitions.get(`atlas_${name}`).readOnlyHint, false);
    assert.equal(definitions.get(`atlas_${name}`).destructiveHint, true);
  }
  for (const name of [
    "create",
    "proposal",
    "merge",
    "load",
    "import",
    "capture_code",
    "capture_database",
    "prepare",
  ]) {
    assert.equal(definitions.get(`atlas_${name}`).readOnlyHint, false);
    assert.equal(definitions.get(`atlas_${name}`).destructiveHint, false);
  }
  assert.equal(definitions.get("atlas_capture_database").openWorldHint, true);
});
test("atomic batches, optimistic conflicts, restart, scoped paths and paginated inspection", async (t) => {
  const { root, workspace: w } = workspace(t);
  const created = await w.execute("atlas_create", {
    input: { profile: "code", model: structural(), workId: "work-0008" },
  });
  const request = {
    handle: created.handle,
    expectedRevision: created.revision,
    operations: [
      {
        action: "upsert",
        collection: "nodes",
        id: "order",
        value: { id: "order", name: "Order", attributes: [] },
      },
      {
        action: "upsert",
        collection: "relations",
        id: "owner",
        value: {
          id: "owner",
          name: "Owner",
          sourceId: "order",
          targetId: "user",
          sourceMultiplicity: "0..*",
          targetMultiplicity: "1",
        },
      },
    ],
  };
  const revised = await w.execute("atlas_revise", request);
  await assert.rejects(w.execute("atlas_revise", request), /REVISION_CONFLICT/);
  await assert.rejects(
    w.execute("atlas_revise", {
      ...request,
      expectedRevision: revised.revision,
      operations: [{ action: "delete", collection: "nodes", id: "user" }],
    }),
    /INVALID_REFERENCE/,
  );
  const restarted = createWorkspace(root);
  assert.equal(restarted.load(created.handle).revision.id, revised.revision);
  assert.equal(
    (await restarted.execute("atlas_list", { workId: "work-0008" })).total,
    1,
  );
  assert.equal(
    (await restarted.execute("atlas_list", { workId: "other" })).total,
    0,
  );
  assert.equal(
    (
      await restarted.execute("atlas_inspect", {
        handle: created.handle,
        limit: 1,
      })
    ).items.length,
    1,
  );
  const loaded = await restarted.execute("atlas_load", { file: created.file });
  assert.equal(loaded.revision, revised.revision);
  await assert.rejects(
    restarted.execute("atlas_inspect", { handle: "../outside" }),
    /TOOL_ARGUMENTS/,
  );
  await assert.rejects(
    restarted.execute("atlas_import", { file: "../outside.html" }),
    /WORKSPACE_PATH/,
  );
  await assert.rejects(
    restarted.execute("atlas_list", { limit: 101 }),
    /TOOL_ARGUMENTS/,
  );
  await assert.rejects(
    restarted.execute("atlas_list", { unknown: true }),
    /TOOL_ARGUMENTS/,
  );
  const start = performance.now();
  for (let i = 0; i < 10; i++)
    await restarted.execute("atlas_inspect", { handle: created.handle });
  assert(performance.now() - start < 1000);
});
test("real SDK client and JSON CLI share conceptual create/revise/validate/export/reopen behavior", async (t) => {
  const { root } = workspace(t);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(__dirname, "../bin/atlas.cjs"), "mcp", "--root", root],
    stderr: "pipe",
  });
  const client = new Client({ name: "atlas-capability-test", version: "1" });
  await client.connect(transport);
  t.after(() => client.close());
  const tools = await client.listTools();
  assert(tools.tools.some((tool) => tool.name === "atlas_capture_database"));
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, result.content[0].text);
    assert(Buffer.byteLength(result.content[0].text) <= 16 * 1024);
    return result.structuredContent;
  };
  const created = await call("atlas_create", {
    input: { project: createProject(), title: "Conceptual plan" },
  });
  const revised = await call("atlas_revise", {
    handle: created.handle,
    expectedRevision: created.revision,
    changes: { title: "Conceptual proposal", reason: "Clarify planned scope" },
  });
  const inspected = await call("atlas_inspect", { handle: created.handle });
  assert.equal(inspected.title, "Conceptual proposal");
  const findings = await call("atlas_validate", { handle: created.handle });
  assert(findings.limitations.length);
  const invalid = await client.callTool({
    name: "atlas_revise",
    arguments: {
      handle: created.handle,
      expectedRevision: created.revision,
      changes: { title: "Stale" },
    },
  });
  assert.equal(invalid.isError, true);
  const malformed = structural();
  malformed.relations.push({
    id: "bad",
    name: "Bad",
    sourceId: "user",
    targetId: "missing".repeat(3000),
    sourceMultiplicity: "?",
    targetMultiplicity: "?",
  });
  const largeError = await client.callTool({
    name: "atlas_create",
    arguments: { input: { profile: "code", model: malformed } },
  });
  assert.equal(largeError.isError, true);
  assert(Buffer.byteLength(largeError.content[0].text) <= 16 * 1024);
  assert(
    fs.existsSync(
      path.join(root, JSON.parse(largeError.content[0].text).errorFile),
    ),
  );
  const prepared = await call("atlas_prepare", { handle: created.handle });
  assert(fs.existsSync(path.join(root, prepared.payloadFile)));
  const exported = await call("atlas_export", { handle: created.handle });
  const reopened = importDocument(
    fs.readFileSync(path.join(root, exported.htmlFile), "utf8"),
  );
  assert.equal(reopened.title, inspected.title);
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve(__dirname, "../bin/atlas.cjs"),
        "inspect",
        "--root",
        root,
        "--input",
        "-",
      ],
      { input: JSON.stringify({ handle: created.handle }), encoding: "utf8" },
    ),
  );
  assert.equal(result.revision, revised.revision);
  await client.close();
  const transport2 = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(__dirname, "../bin/atlas.cjs"), "mcp", "--root", root],
  });
  const restarted = new Client({ name: "restart", version: "1" });
  await restarted.connect(transport2);
  const after = await restarted.callTool({
    name: "atlas_inspect",
    arguments: { handle: created.handle },
  });
  assert.equal(after.structuredContent.revision, revised.revision);
  await restarted.close();
});
test("large detailed results become references and invalid operations leave persistence unchanged", async (t) => {
  const { workspace: w } = workspace(t);
  const graph = structural();
  graph.nodes[0].attributes = Array.from({ length: 100 }, (_, i) => ({
    id: `f-${i}`,
    name: "field".repeat(200),
    type: "type".repeat(200),
  }));
  const created = await w.execute("atlas_create", {
    input: { profile: "code", model: graph },
  });
  const detail = await w.execute("atlas_inspect", {
    handle: created.handle,
    elementId: "user",
  });
  assert(Buffer.byteLength(JSON.stringify(detail)) <= 16 * 1024);
  assert(detail.resultFile);
  await assert.rejects(
    w.execute("atlas_revise", {
      handle: created.handle,
      expectedRevision: created.revision,
      operations: [
        {
          action: "upsert",
          collection: "nodes",
          id: "other",
          value: { id: "wrong", name: "Wrong", attributes: [] },
        },
      ],
    }),
    /BATCH_ID/,
  );
  assert.equal(w.load(created.handle).revision.id, created.revision);
});
test("100-node warm inspection/validation meet the budget and direct file edits are detected", async (t) => {
  const { root, workspace: w } = workspace(t);
  const graph = structural();
  graph.nodes = Array.from({ length: 100 }, (_, i) => ({
    id: `n-${i}`,
    name: `Node ${i}`,
    attributes: [],
  }));
  const created = await w.execute("atlas_create", {
    input: { profile: "code", model: graph },
  });
  const started = performance.now();
  const inspection = await w.execute("atlas_inspect", {
    handle: created.handle,
  });
  const validation = await w.execute("atlas_validate", {
    handle: created.handle,
  });
  assert.equal(inspection.items.length, 25);
  assert.equal(validation.valid, true);
  assert(performance.now() - started < 1000);
  const file = path.join(root, created.file),
    changed = JSON.parse(fs.readFileSync(file));
  changed.title = "Unrevisioned external edit";
  fs.writeFileSync(file, JSON.stringify(changed));
  await assert.rejects(
    w.execute("atlas_inspect", { handle: created.handle }),
    /REVISION_INTEGRITY/,
  );
});
test("validation pagination retains requested pages and root-contained storage aliases remain protected", async (t) => {
  const { root, workspace: w } = workspace(t);
  const project = new Project(),
    model = project.packageBuilder().root().name("Roles").build();
  for (let i = 0; i < 70; i++)
    model.classBuilder().role().name(`Role ${i}`).build();
  const created = await w.execute("atlas_create", {
    input: { project: JSON.parse(JSON.stringify(project)) },
  });
  const first = await w.execute("atlas_validate", {
    handle: created.handle,
    limit: 100,
  });
  const page = first.resultFile
    ? JSON.parse(fs.readFileSync(path.join(root, first.resultFile)))
    : first;
  assert.equal(page.issues.length, 100);
  const remaining = await w.execute("atlas_validate", {
    handle: created.handle,
    offset: 100,
    limit: 100,
  });
  const rest = remaining.resultFile
    ? JSON.parse(fs.readFileSync(path.join(root, remaining.resultFile)))
    : remaining;
  assert.equal(page.issues.length + rest.issues.length, page.total);
  fs.symlinkSync(
    path.join(root, ".atlas/models"),
    path.join(root, "storage-alias"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () =>
      w.writeOutput("storage-alias/m-000000000000000000000000.json", "invalid"),
    /WORKSPACE_PATH/,
  );
  assert.equal((await w.execute("atlas_list", {})).total, 1);
  if (process.platform === "win32")
    assert.throws(
      () => w.writeOutput(".ATLAS/MODELS/invalid.json", "invalid"),
      /WORKSPACE_PATH/,
    );
});
