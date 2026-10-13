const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const atlas = require("../lib/index.cjs");
const { loadComponents: components } = require("./load-components.cjs");
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
  // The model report is gone; a code model has no guide to open either.
  assert(!html.includes("report"));
  assert(!html.includes("Understand the model"));
  // A single view needs no view switcher.
  assert(!html.includes('aria-label="Diagram view"'));
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

test("proposals open in their change view with a readable list of changes", async () => {
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
  // One way to choose what is shown: no Baseline/Changes control, no popover.
  assert(!html.includes(">Baseline<"));
  assert(!html.includes('aria-label="Comparison"'));
  assert(!html.includes("Semantic changes"));
  assert(html.includes('aria-label="Changes, 3"'));
  assert(html.includes("Agent proposal"));
  assert(/Changes to source captured [A-Z][a-z]{2} \d{1,2}, \d{4}/.test(html));
  // The change view marks what changed on the canvas.
  assert(html.includes('data-change="added"'));
  assert(html.includes(">New<") && html.includes(">Changed<"));
  assert(!ISO.test(html), "raw ISO timestamps stay out of the UI");
  const { ChangesOverview } = components("src/review/ChangesOverview.jsx");
  const { rollupChanges } = components("src/review/changes.js");
  const rollup = rollupChanges(
    payload.comparison,
    payload.comparison.changeView.model,
  );
  const list = renderToStaticMarkup(
    createElement(ChangesOverview, {
      rollup,
      baselineDate: "Oct 8, 2026",
      profile: "code",
      onSelect() {},
    }),
  );
  assert(list.includes(">New<") && list.includes(">Changed<"));
  assert(list.includes(">Term<"));
  // Renamed types appear once each, under their new names.
  assert(list.includes(">Pupil<") && list.includes(">Learner<"));
  // A rename reads as the old name and the new one.
  assert(list.includes("name: Student → Pupil"));
  assert(
    !list.includes("Learners replace students."),
    "no rationale in the list",
  );
  assert(list.includes("Compared with the code captured Oct 8, 2026."));
  assert(!ISO.test(list), "raw ISO timestamps stay out of the UI");
});
