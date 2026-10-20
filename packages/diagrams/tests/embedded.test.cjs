const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const postcss = require("postcss");
const selectors = require("postcss-selector-parser");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { prepareDiagrams, buildViewer } = require("../lib/index.cjs");
const {
  buildEmbeddedCSS,
  SCOPES,
} = require("../scripts/build-embedded-css.cjs");
const { loadComponents: components } = require("./load-components.cjs");
// The viewer of one diagram, given its body.
async function viewer(body, includeArtifacts = false) {
  const file = { path: "d.puml", text: `@startuml\n${body}\n@enduml\n` };
  const { prepared } = await prepareDiagrams({
    files: [file],
    includeArtifacts,
  });
  return { prepared: prepared.get("d.puml"), file };
}
test("native panel consumes lean payloads and CSS cannot restyle its host", async () => {
  const { prepared } = await viewer("class Account");
  const { AtlasPanel } = components();
  const html = renderToStaticMarkup(
    createElement(AtlasPanel, { payload: prepared.payload, theme: "light" }),
  );
  // The host's theme reaches the panel root, the panel's envUI Theme.
  const panel = html.slice(0, html.indexOf(">"));
  assert.match(panel, /^<div [^>]*class="(?:[^"]* )?atlas-panel[ "]/);
  assert.match(panel, / data-theme="light"/);
  assert(html.includes('aria-label="Account"'));
  assert(!html.includes("Models ZIP"));
  buildEmbeddedCSS(require("node:path").resolve(__dirname, ".."));
  const root = postcss.parse(fs.readFileSync("dist/embedded.css", "utf8"));
  // Only the viewer's own rules: hosts load envUI's stylesheet themselves.
  root.walkAtRules((rule) =>
    assert(!/^(?:import|font-face)$/i.test(rule.name), `@${rule.name}`),
  );
  let rules = 0;
  root.walkRules((rule) => {
    if (rule.parent.type === "atrule" && /keyframes$/i.test(rule.parent.name))
      return;
    rules++;
    selectors((tree) =>
      tree.each((selector) => {
        // Every rule starts inside an Atlas-owned root (the panel, or Atlas
        // content portalled by envUI), so it cannot restyle the host page.
        assert.equal(selector.first.type, "class", rule.selector);
        assert(SCOPES.includes(selector.first.value), rule.selector);
        // Nor does it restyle envUI's own components.
        selector.walkClasses((node) =>
          assert(!node.value.startsWith("env-"), rule.selector),
        );
      }),
    ).processSync(rule.selector);
  });
  assert(rules > 50, "The embedded stylesheet holds the viewer's rules");
});
test("an empty diagram prepares and exports a readable viewer", async () => {
  const { prepared, file } = await viewer("", true);
  assert.deepEqual(prepared.payload.views, []);
  const { AtlasPanel } = components();
  assert(
    renderToStaticMarkup(
      createElement(AtlasPanel, { payload: prepared.payload }),
    ).includes("No entities"),
  );
  const exported = await buildViewer({ prepared, file });
  assert(exported.html.includes('<script id="atlas-diagram"'));
});

test("A proposal opens its change view in both viewers, with the focus and the review it was given", () => {
  const { DiagramViewer, AtlasPanel } = components();
  const { reviewedPayload } = components("src/viewer/reviewedPayload.js");
  const target = { kind: "node", id: "course" };
  const changeView = { model: { id: "changes" }, views: [{ key: "all" }] };
  const comparison = {
    changeView,
    changes: { changes: [] },
    conflicts: [],
  };
  const document = {
    baselineId: "capture",
    snapshots: [
      { id: "capture", capture: { capturedAt: "2026-10-08T10:00:00Z" } },
    ],
  };
  const payload = {
    comparison,
    learning: { walkthroughs: [], scenarios: [] },
    model: { id: "proposal", document },
    views: [],
  };
  // The change view replaces the proposal; the rest travels along.
  const shown = reviewedPayload(payload);
  assert.equal(shown.payload.model, changeView.model);
  assert.equal(shown.payload.views, changeView.views);
  assert.equal(shown.payload.learning, payload.learning);
  assert.equal(shown.payload.comparison, undefined);
  assert.equal(shown.review.comparison, comparison);
  assert.equal(shown.review.baselineDate, "Oct 8, 2026");
  assert.equal(shown.provenanceDocument, document);
  // A comparison has one review, also when its payload arrives spread into a
  // viewer's props, as new objects on every render.
  assert.equal(reviewedPayload(payload).review, shown.review);
  assert.equal(reviewedPayload({ ...payload }).review, shown.review);
  assert.equal(
    DiagramViewer({ ...payload }).props.review,
    DiagramViewer({ ...payload }).props.review,
  );
  // Both viewers render it directly, with no wrapper to remount when a host
  // switches between a capture and its proposals. The panel is memoized; its
  // render function is the memo's type.
  const panel = AtlasPanel.type({ payload, focus: target });
  assert.equal(panel.props.payload.model, changeView.model);
  assert.equal(panel.props.review.comparison, comparison);
  assert.equal(panel.props.focus, target);
  const viewer = DiagramViewer({ ...payload, focus: target });
  assert.equal(viewer.props.model, changeView.model);
  assert.equal(viewer.props.review.comparison, comparison);
  assert.equal(viewer.props.focus, target);
  assert.equal(viewer.props.provenanceDocument, document);
  assert.equal(viewer.props.review, panel.props.review);
  // A capture shows itself.
  const capture = { model: { id: "capture", document }, views: [] };
  assert.deepEqual(reviewedPayload(capture), {
    payload: capture,
    review: null,
    provenanceDocument: document,
  });
});

test("Focus on a member or a removed element of a proposal resolves in its change view", async () => {
  const { prepared } = await prepareDiagrams({
    files: [
      {
        path: "base.puml",
        text: "@startuml\nclass A {\n  x : string\n}\nclass B\n@enduml\n",
      },
      {
        path: "proposal.puml",
        text: "@startuml\n' atlas proposal base.puml\nclass A\n@enduml\n",
      },
    ],
  });
  const { payload } = prepared.get("proposal.puml");
  const { inspectionTarget } = components("src/model/inspectionTarget.js");
  const { indexViewerModel } = components("src/model/domainModel.js");
  const view = payload.comparison.changeView;
  const index = indexViewerModel(view.model);
  // The removed class and the removed member are both still there to inspect.
  assert.deepEqual(
    inspectionTarget(view.model, index, view.views, view.views[0].key, "B")
      .target,
    { kind: "node", id: "B" },
  );
  const member = inspectionTarget(
    view.model,
    index,
    view.views,
    view.views[0].key,
    "A.x",
  );
  assert.deepEqual(member.target, { kind: "node", id: "A" });
  assert.equal(member.memberId, "A.x");
});

test("Viewer input failures identify the missing source without a raw TypeError", async () => {
  await assert.rejects(buildViewer({}), /VIEWER_INPUT/);
  await assert.rejects(buildViewer(), /VIEWER_INPUT/);
  await assert.rejects(prepareDiagrams({}), /DIAGRAMS_INPUT/);
});
test("a standalone viewer offers its diagram's exports", async () => {
  const { prepared } = await viewer(
    "entity Table {\n  *id : integer <<PK>>\n}",
    true,
  );
  const { DiagramViewer } = components();
  const html = renderToStaticMarkup(
    createElement(DiagramViewer, prepared.payload),
  );
  assert(html.includes('aria-label="Export"'));
  assert(!html.includes("OntoUML"));
  const { exportChoices } = components("src/viewer/ViewerToolbar.jsx");
  const labels = exportChoices({
    exports: prepared.payload.exports,
    viewKey: prepared.payload.views[0].key,
    fields: false,
    theme: "light",
  }).map((choice) => choice.label);
  assert.deepEqual(labels, ["SVG image", "PlantUML", "Models ZIP"]);
});
