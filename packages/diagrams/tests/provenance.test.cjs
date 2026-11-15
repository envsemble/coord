const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const coord = require("../lib/index.cjs");
const { loadComponents: components } = require("./loadComponents.cjs");
const react = components();
const capture = (kind, identity, capturedAt, status = "complete") => ({
  id: `capture-${identity}`,
  capture: {
    capturedAt,
    adapter: { id: `coord-${kind}`, version: "1.0.0" },
    source: { kind, identity, scope: [] },
    coverage: { status, diagnostics: [] },
  },
});
const ENROLLMENT = `class Student {
  name : string
}
class Course`;
// The prepared payloads of a work folder's diagrams, by path.
async function payloads(files) {
  const { prepared } = await coord.prepareDiagrams({
    files: Object.entries(files).map(([path, body]) => ({
      path,
      text: `@startuml
${body}
@enduml
`,
    })),
  });
  return (path) => prepared.get(path).payload;
}
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
      tone: "primary",
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
    }),
    {
      kind: "generated",
      label: "Generated from database",
      detail:
        "SQLite · semester-demo · captured Oct 8, 2026 · partial coverage",
      tone: "primary",
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
      tone: "accent",
    },
  );
  assert.equal(
    describeProvenance({ state: "proposal", profile: "class", snapshots: [] })
      .detail,
    "",
  );
  assert.deepEqual(
    describeProvenance({ state: "authored", profile: "class" }),
    {
      kind: "authored",
      label: "Agent-authored",
      detail: "Class diagram",
      tone: "success",
    },
  );
  assert.equal(
    describeProvenance({ state: "authored", profile: "database" }).detail,
    "Entity diagram",
  );
  assert.equal(describeProvenance(undefined).kind, "unknown");
  assert.equal(describeProvenance({}).kind, "unknown");
  assert.equal(formatCaptureDate("2026-01-31T23:59:59Z"), "Jan 31, 2026");
  assert.equal(formatCaptureDate("not a date"), "");
});

test("embedded panel floats its controls, below the host's sections, and leaves provenance to its host", async () => {
  const { DiagramPanel } = react;
  const payload = (await payloads({ "enrollment.puml": ENROLLMENT }))(
    "enrollment.puml",
  );
  assert.equal(payload.views.length, 1);
  const html = renderToStaticMarkup(
    createElement(DiagramPanel, {
      payload,
      leading: createElement("span", { id: "host-layers" }, "Layers"),
    }),
  );
  assert(html.includes('id="host-layers"'));
  // The host names the model's origin; the panel draws no chip.
  assert(!html.includes("Agent-authored"));
  assert(!html.includes("coord-provenance"));
  // The model report is gone; a diagram without scenarios has no guide.
  assert(!html.includes("report"));
  assert(!html.includes("Understand the model"));
  // A single view needs no view switcher.
  assert(!html.includes('aria-label="Diagram view"'));
  // No full view, search, attributes toggle or details: only the camera.
  for (const removed of ["fullscreen", "Search", "Fields", "Hide details"])
    assert(!html.includes(removed), removed);
  assert(!ISO.test(html), "raw ISO timestamps stay out of the UI");
  // The host's sections come first, at the top left with the tools; the
  // diagram's navigation takes the row below.
  const stacked = renderToStaticMarkup(
    createElement(DiagramPanel, {
      payload,
      sections: createElement("span", { id: "host-sections" }, "Sections"),
      leading: createElement("span", { id: "host-picker" }, "Model picker"),
    }),
  );
  assert(stacked.includes('class="coord-overlay-top stacked"'));
  assert(
    stacked.indexOf('id="host-sections"') < stacked.indexOf('id="host-picker"'),
  );
  assert(stacked.includes('class="coord-overlay-sections"'));
});

test("proposals open in their change view with a readable list of changes", async () => {
  const { DiagramPanel } = react;
  const { diagram } = coord.parseDiagram(
    `@startuml
title Enrollment
${ENROLLMENT}
@enduml
`,
  );
  const captured = coord.formatDiagram({
    ...diagram,
    capture: capture("typescript", "enrollment", "2026-10-08T01:34:34.898Z")
      .capture,
  });
  const { prepared } = await coord.prepareDiagrams({
    files: [
      { path: "capture.puml", text: captured },
      {
        path: "proposal.puml",
        text: `@startuml
' coord proposal capture.puml
${ENROLLMENT.replace("name : string", "name : text")}
class Term
Course "1" -- "0..*" Term : runs in
@enduml
`,
      },
    ],
  });
  const payload = prepared.get("proposal.puml").payload;
  const html = renderToStaticMarkup(createElement(DiagramPanel, { payload }));
  // One way to choose what is shown: no Baseline/Changes control, no popover.
  assert(!html.includes(">Baseline<"));
  assert(!html.includes('aria-label="Comparison"'));
  assert(!html.includes("Semantic changes"));
  assert(html.includes('aria-label="Changes, 3"'));
  assert(!html.includes("Agent proposal"), "the host names the origin");
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
  assert(list.includes(">Student<"));
  assert(list.includes("Compared with the code captured Oct 8, 2026."));
  assert(!ISO.test(list), "raw ISO timestamps stay out of the UI");
});
