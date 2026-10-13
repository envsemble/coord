const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const postcss = require("postcss");
const selectors = require("postcss-selector-parser");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  createDocument,
  prepareViewer,
  buildViewer,
  importDocument,
} = require("../lib/index.cjs");
const {
  buildEmbeddedCSS,
  SCOPES,
} = require("../scripts/build-embedded-css.cjs");
const { loadComponents: components } = require("./load-components.cjs");
test("native panel consumes lean payloads and CSS cannot restyle its host", async () => {
  const document = createDocument({
    profile: "code",
    model: {
      type: "StructuralModel",
      nodes: [{ id: "account", name: "Account", attributes: [] }],
      relations: [],
      generalizations: [],
      generalizationSets: [],
    },
  });
  const prepared = await prepareViewer({ document, includeArtifacts: false });
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
test("empty captures prepare and export a readable portable document", async () => {
  const document = createDocument({
    profile: "database",
    model: {
      type: "StructuralModel",
      nodes: [],
      relations: [],
      generalizations: [],
      generalizationSets: [],
    },
  });
  const prepared = await prepareViewer({ document, includeArtifacts: false });
  assert.deepEqual(prepared.payload.views, []);
  const { AtlasPanel } = components();
  assert(
    renderToStaticMarkup(
      createElement(AtlasPanel, { payload: prepared.payload }),
    ).includes("No entities"),
  );
  const exported = await buildViewer({ document });
  assert.deepEqual(importDocument(exported.html).model.nodes, []);
});

test("A proposal opens its change view in both viewers, with the focus and the review it was given", () => {
  const { OntoUMLViewer, AtlasPanel } = components();
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
  for (const viewer of [
    OntoUMLViewer({ ...payload, focus: target }),
    AtlasPanel({ payload, focus: target }),
  ]) {
    assert.equal(viewer.type.name, "ComparisonViewer");
    assert.equal(viewer.props.focus, target);
    const shown = renderToStaticMarkup(
      createElement(viewer.type, {
        ...viewer.props,
        render: (shownPayload, focus, extras) => {
          // The change view replaces the proposal; the rest travels along.
          assert.equal(shownPayload.model, changeView.model);
          assert.equal(shownPayload.views, changeView.views);
          assert.equal(shownPayload.learning, payload.learning);
          assert.equal(shownPayload.comparison, undefined);
          assert.equal(focus, target);
          assert.equal(extras.review.comparison, comparison);
          assert.equal(extras.review.baselineDate, "Oct 8, 2026");
          assert.equal(extras.provenanceDocument, document);
          return createElement("span", null, "change view");
        },
      }),
    );
    assert.equal(shown, "<span>change view</span>");
  }
});

test("Focus on a member or a removed element of a proposal resolves in its change view", async () => {
  const document = createDocument({
    id: "base",
    profile: "code",
    model: {
      type: "StructuralModel",
      nodes: [
        {
          id: "a",
          name: "A",
          attributes: [{ id: "a-x", name: "x", type: "string" }],
        },
        { id: "b", name: "B", attributes: [] },
      ],
      relations: [],
      generalizations: [],
      generalizationSets: [],
    },
  });
  const atlas = require("../lib/index.cjs");
  const proposal = atlas.createProposal(document);
  const model = JSON.parse(JSON.stringify(proposal.model));
  model.nodes = model.nodes.filter((n) => n.id !== "b");
  model.nodes[0].attributes = [];
  const changed = atlas.reviseDocument(proposal, { model });
  const { payload } = await prepareViewer({
    document: changed,
    includeArtifacts: false,
  });
  const { inspectionTarget } = components("src/model/inspectionTarget.js");
  const { indexViewerModel } = components("src/model/domainModel.js");
  const view = payload.comparison.changeView;
  const index = indexViewerModel(view.model);
  // The removed class and the removed member are both still there to inspect.
  assert.deepEqual(
    inspectionTarget(view.model, index, view.views, view.views[0].key, "b")
      .target,
    { kind: "node", id: "b" },
  );
  const member = inspectionTarget(
    view.model,
    index,
    view.views,
    view.views[0].key,
    "a-x",
  );
  assert.deepEqual(member.target, { kind: "node", id: "a" });
  assert.equal(member.memberId, "a-x");
});

test("Viewer input failures identify the missing source without a raw TypeError", async () => {
  for (const build of [prepareViewer, buildViewer]) {
    await assert.rejects(build({}), /VIEWER_INPUT/);
    await assert.rejects(build(), /VIEWER_INPUT/);
  }
});
test("standalone structural documents render their profile-specific exports and capture inspector", async () => {
  const document = createDocument({
    profile: "database",
    model: {
      type: "StructuralModel",
      nodes: [{ id: "table", name: "Table", attributes: [] }],
      relations: [],
      generalizations: [],
      generalizationSets: [],
    },
  });
  const prepared = await prepareViewer({ document });
  const { OntoUMLViewer } = components();
  const html = renderToStaticMarkup(
    createElement(OntoUMLViewer, prepared.payload),
  );
  assert(html.includes('aria-label="Export"'));
  assert(!html.includes("Learn OntoUML"));
  const { exportChoices } = components("src/viewer/ViewerToolbar.jsx");
  const choices = exportChoices({
    exports: prepared.payload.exports,
    viewKey: prepared.payload.views[0].key,
    fields: false,
    theme: "light",
    conceptual: false,
  });
  assert.deepEqual(
    choices.map((choice) => choice.label),
    ["SVG image", "PlantUML", "Structural JSON", "Models ZIP"],
  );
});
