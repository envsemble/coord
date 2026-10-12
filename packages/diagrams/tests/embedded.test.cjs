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

test("Standalone report focus survives its nested comparison wrapper", () => {
  const { OntoUMLViewer } = components();
  const target = { kind: "node", id: "course", request: "report-course" };
  const payload = { report: {}, comparison: {}, model: {}, views: [] };
  const report = OntoUMLViewer(payload);
  const nested = report.props.render({ ...payload, report: undefined }, target);
  const comparison = OntoUMLViewer(nested.props);
  assert.equal(comparison.props.focus, target);
  const diagram = comparison.props.render(
    { ...payload, report: undefined, comparison: undefined },
    null,
  );
  assert.deepEqual(diagram.props.focus, target);
  const changed = {
    kind: "edge",
    id: "registration",
    request: "comparison-registration",
  };
  assert.deepEqual(comparison.props.render({}, changed).props.focus, changed);
  const { AtlasPanel } = components();
  const panel = AtlasPanel({ payload });
  const panelNested = panel.props.render(
    { ...payload, report: undefined },
    target,
  );
  const panelComparison = AtlasPanel(panelNested.props);
  assert.equal(panelComparison.props.focus, target);
});

test("Repeated report navigation clears retained comparison focus and chooses a visible target", () => {
  const { reconcileComparisonFocus } = components(
    "src/viewer/comparisonSelection.js",
  );
  const scene = (ids) => ({
    views: [
      {
        key: "model",
        diagram: {
          nodes: ids.map((id) => ({ id })),
          edges: [],
          generalizationGroups: [],
        },
      },
    ],
  });
  const first = { kind: "node", id: "a" };
  const local = { kind: "edge", id: "route" };
  const payload = {
    ...scene(["b"]),
    focus: first,
    comparison: { baseline: scene(["a"]), changeView: scene(["a", "b"]) },
  };
  const retained = { mode: "baseline", focus: local, externalFocus: first };
  assert.equal(reconcileComparisonFocus(retained, payload), retained);
  const second = { kind: "node", id: "b" };
  const next = reconcileComparisonFocus(retained, {
    ...payload,
    focus: second,
  });
  assert.equal(next.mode, "changes");
  assert.equal(next.focus, null);
  assert.equal(next.externalFocus, second);
  // The change view retains removed elements, so it can still show them.
  const removed = reconcileComparisonFocus(next, payload);
  assert.equal(removed.mode, "changes");
  assert.equal(removed.focus, null);
  assert.equal(removed.externalFocus, first);
  assert.equal(reconcileComparisonFocus(removed, payload), removed);
  const baselineOnly = reconcileComparisonFocus(next, {
    ...payload,
    comparison: { ...payload.comparison, changeView: scene(["b"]) },
  });
  assert.equal(baselineOnly.mode, "baseline");
  assert.equal(baselineOnly.externalFocus, first);
  const field = { kind: "edge", id: "new-field" };
  const withField = {
    ...payload,
    comparison: {
      ...payload.comparison,
      changeView: {
        ...payload.comparison.changeView,
        model: {
          classes: [
            { id: "b", attributes: [{ id: "new-field" }], methods: [] },
          ],
        },
      },
    },
  };
  const memberFocus = reconcileComparisonFocus(removed, withField, field);
  assert.equal(memberFocus.mode, "changes");
  assert.equal(memberFocus.focus, null);
  assert.equal(memberFocus.externalFocus, field);
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
