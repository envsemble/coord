const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const postcss = require("postcss");
const selectors = require("postcss-selector-parser");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { buildSync } = require("esbuild");
const {
  createDocument,
  prepareViewer,
  buildViewer,
  importDocument,
} = require("../lib/index.cjs");
const { buildEmbeddedCSS } = require("../scripts/build-embedded-css.cjs");
function components() {
  const code = buildSync({
    entryPoints: ["src/viewer/AtlasPanel.jsx"],
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
  assert(html.includes('data-theme="light"'));
  assert(html.includes('aria-label="Account"'));
  assert(!html.includes("Models ZIP"));
  buildEmbeddedCSS(require("node:path").resolve(__dirname, ".."));
  const root = postcss.parse(fs.readFileSync("dist/embedded.css", "utf8"));
  root.walkRules((rule) => {
    if (rule.parent.type === "atrule" && /keyframes$/i.test(rule.parent.name))
      return;
    selectors((tree) =>
      tree.each((selector) => {
        assert.equal(selector.first.type, "class", rule.selector);
        assert.equal(selector.first.value, "atlas-panel", rule.selector);
      }),
    ).processSync(rule.selector);
  });
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
