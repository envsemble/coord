const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");

function components() {
  const code = buildSync({
    entryPoints: ["src/index.js"],
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    jsx: "automatic",
    write: false,
  }).outputFiles[0].text;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)(
    require,
    compiled,
    compiled.exports,
  );
  return compiled.exports;
}
const react = components();
const capture = (kind, identity, capturedAt, status = "complete") => ({
  id: `capture-${identity}`,
  capture: {
    capturedAt,
    adapter: { id: `atlas-${kind}`, version: "1.0.0" },
    source: { kind, identity, scope: [] },
    coverage: { status, diagnostics: [] },
  },
});

test("provenance distinguishes generated captures, agent proposals and agent-authored models", () => {
  const { describeProvenance, formatCaptureDate } = react;
  const code = capture(
    "typescript",
    "enrollment-code",
    "2026-10-08T01:34:34.898Z",
  );
  assert.deepEqual(
    describeProvenance({
      state: "snapshot",
      profile: "code",
      baselineId: code.id,
      snapshots: [code],
    }),
    {
      kind: "generated",
      label: "Generated from code",
      detail:
        "TypeScript · enrollment-code · captured Oct 8, 2026 · complete coverage",
      tone: "accent",
    },
  );
  const database = capture(
    "sqlite",
    "semester-demo",
    "2026-10-08T00:57:42.032Z",
    "partial",
  );
  assert.deepEqual(
    describeProvenance({
      state: "snapshot",
      profile: "database",
      baselineId: database.id,
      snapshots: [database],
      imported: true,
    }),
    {
      kind: "generated",
      label: "Generated from database",
      detail:
        "SQLite · semester-demo · captured Oct 8, 2026 · partial coverage · Imported",
      tone: "accent",
    },
  );
  assert.deepEqual(
    describeProvenance({
      state: "proposal",
      profile: "code",
      baselineId: code.id,
      snapshots: [code],
    }),
    {
      kind: "proposal",
      label: "Agent proposal",
      detail: "Changes to source captured Oct 8, 2026",
      tone: "done",
    },
  );
  assert.equal(
    describeProvenance({ state: "proposal", profile: "ontouml", snapshots: [] })
      .detail,
    "",
  );
  assert.deepEqual(
    describeProvenance({ state: "authored", profile: "ontouml" }),
    {
      kind: "authored",
      label: "Agent-authored",
      detail: "Conceptual model",
      tone: "success",
    },
  );
  assert.equal(
    describeProvenance({
      state: "authored",
      profile: "database",
      imported: true,
    }).detail,
    "Structural model · Imported",
  );
  assert.equal(describeProvenance(undefined).kind, "unknown");
  assert.equal(describeProvenance({}).kind, "unknown");
  assert.equal(formatCaptureDate("2026-01-31T23:59:59Z"), "Jan 31, 2026");
  assert.equal(formatCaptureDate("not a date"), "");
});
