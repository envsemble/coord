const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { buildSync } = require("esbuild");
const atlas = require("../lib/index.cjs");

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
const structural = {
  type: "StructuralModel",
  nodes: [
    {
      id: "student",
      name: "Student",
      attributes: [{ id: "student-name", name: "name", type: "string" }],
    },
    { id: "course", name: "Course", attributes: [] },
  ],
  relations: [],
  generalizations: [],
  generalizationSets: [],
};
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

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

test("embedded panel floats its controls and shows readable provenance", async () => {
  const { AtlasPanel } = react;
  const document = atlas.createDocument({
    title: "Enrollment",
    profile: "code",
    model: structural,
  });
  const { payload } = await atlas.prepareViewer({
    document,
    includeArtifacts: false,
  });
  assert.equal(payload.views.length, 1);
  const html = renderToStaticMarkup(
    createElement(AtlasPanel, {
      payload,
      leading: createElement("span", { id: "host-picker" }, "Model picker"),
    }),
  );
  assert(html.includes('id="host-picker"'));
  assert(html.includes("Agent-authored"));
  assert(html.includes("Structural model"));
  assert(html.includes('aria-label="Open model report"'));
  // A single view needs no view tabs.
  assert(!html.includes('class="tabs"'));
  assert(!html.includes("fullscreen"));
  assert(!ISO.test(html), "raw ISO timestamps stay out of the UI");
  const fullscreen = renderToStaticMarkup(
    createElement(AtlasPanel, {
      payload,
      fullscreen: true,
      onFullscreenChange() {},
    }),
  );
  assert(fullscreen.includes('aria-label="Exit fullscreen"'));
});

test("proposals compare Baseline and Changes with a readable change list", async () => {
  const { AtlasPanel } = react;
  const base = atlas.createDocument({
    id: "enrollment",
    title: "Enrollment",
    profile: "code",
    model: structural,
    context: {
      records: [
        {
          id: "plan",
          kind: "plan",
          title: "Decision",
          text: "Learners replace students.",
        },
      ],
      links: [{ elementId: "student", recordId: "plan" }],
    },
  });
  const proposal = atlas.createProposal(base);
  const model = JSON.parse(JSON.stringify(proposal.model));
  model.nodes[1].name = "Learner";
  model.nodes[0].name = "Pupil";
  model.nodes.push({ id: "term", name: "Term", attributes: [] });
  const changed = atlas.reviseDocument(proposal, { model });
  const { payload } = await atlas.prepareViewer({
    document: changed,
    includeArtifacts: false,
  });
  const html = renderToStaticMarkup(createElement(AtlasPanel, { payload }));
  assert(html.includes(">Baseline<") && html.includes(">Changes<"));
  assert(!html.includes("Proposed"));
  assert(html.includes('data-mode="changes" aria-current="true"'));
  assert(html.includes("Agent proposal"));
  assert(/Changes to source captured [A-Z][a-z]{2} \d{1,2}, \d{4}/.test(html));
  assert(html.includes('class="count-added">+1<'));
  // Renamed types plus the model's node list.
  assert(html.includes('class="count-modified">~3<'));
  assert(html.includes('title="Learner, Pupil, Term"'));
  assert(html.includes(">Added<") && html.includes(">Modified<"));
  assert(html.includes("Term"));
  assert(html.includes('class="change-value before"'));
  assert(html.includes(">Student<") && html.includes(">Pupil<"));
  assert(html.includes("Learners replace students."));
  assert(html.includes('aria-label="Inspect Term"'));
  assert(!ISO.test(html), "raw ISO timestamps stay out of the UI");
});
