const fs = require("node:fs");
const path = require("node:path");
const { zipSync, strToU8 } = require("fflate");
const { build: bundleJavaScript } = require("esbuild");
const { layoutDiagram } = require("../layout/layoutDiagram.cjs");
const { renderSVG } = require("../render/renderSVG.cjs");
const { validateDiagram } = require("../layout/validateDiagram.cjs");
const { prepareViews } = require("../layout/prepareViews.cjs");
const { highlightSnippets } = require("./highlightSnippets.cjs");
const rootPath = path.resolve(__dirname, "../..");
const SLUG = /^[A-Za-z0-9_-]+$/;
/**
 * One diagram's viewer (an entry of prepareDiagrams): alone, or compared with
 * its baseline.
 */
function prepareEntry(entry, { slug = "model", includeArtifacts = true } = {}) {
  if (!SLUG.test(slug)) throw new Error("Invalid artifact slug");
  if (entry.baseline)
    return require("./prepareComparison.cjs").prepareComparison({
      entry,
      slug,
      includeArtifacts,
    });
  return prepareModel({
    model: entry.model,
    settings: entry.views.length ? entry.views : undefined,
    excerpts: entry.snippets,
    scenarios: entry.scenarios,
    source: entry.source,
    slug,
    includeArtifacts,
  });
}
// The views of a model laid out, with their scenes, static SVGs and the
// files a download offers. `source` is the file the model was read from
// (`suffix` names it after the slug); `scenarios` those that exemplify it.
async function prepareModel({
  model,
  settings,
  excerpts = {},
  scenarios = null,
  source = null,
  slug,
  includeArtifacts,
  diagramProvider = layoutDiagram,
}) {
  const report = model.validation;
  const sources = model.sources;
  const snippets = await highlightSnippets(
    sources.filter((s) => excerpts[s.id]),
    excerpts,
  );
  const classes = new Map(model.classes.map((c) => [c.id, c]));
  const views = prepareViews(model, settings);
  const artifacts = new Map();
  report.modelCounts = {
    classes: model.classes.length,
    relations: model.relations.length,
    generalizations: model.generalizations.length,
  };
  report.diagrams = [];
  for (const view of views) {
    const edges = view.edges;
    const generalizations = view.generalizations;
    for (const fields of [false, true]) {
      const rendered = await diagramProvider(
        view,
        classes,
        edges,
        generalizations,
        fields,
      );
      const svg = includeArtifacts ? renderSVG(rendered.diagram) : undefined;
      view[fields ? "diagramFields" : "diagram"] = rendered.diagram;
      view[fields ? "svgFields" : "svg"] = svg;
      report.diagrams.push({
        view: view.key,
        fields,
        ...rendered.check,
        ...validateDiagram(rendered.diagram, model),
      });
      artifacts.set(`${slug}-${view.key}${fields ? "-fields" : ""}.svg`, svg);
    }
  }
  if (!includeArtifacts)
    return {
      artifacts: new Map(),
      report,
      model,
      views,
      payload: {
        model,
        views: views.map(
          ({ key, label, title, nodeIds, diagram, diagramFields }) => ({
            key,
            label,
            title,
            nodeIds,
            diagram,
            diagramFields,
          }),
        ),
        exports: { slug, bundle: "" },
        snippets,
        ...(scenarios ? { scenarios } : {}),
      },
    };
  const notes = [
    model.title,
    model.status,
    "",
    "SOURCES",
    ...sources.map(
      (s) => `${s.id}: ${s.title}\n${s.url || s.file}\n${s.claim}`,
    ),
    "",
    "OPEN QUESTIONS",
    ...model.unknowns,
    "",
    "VALIDATION",
    ...report.issues.map((i) => `${i.severity}: ${i.message}`),
    ...report.limitations,
  ].join("\n");
  if (source) artifacts.set(`${slug}${source.suffix}`, source.text);
  artifacts.set(`${slug}-model-evidence.json`, JSON.stringify(model, null, 2));
  artifacts.set(`${slug}-validation.json`, JSON.stringify(report, null, 2));
  artifacts.set(`${slug}-model-notes.txt`, notes);
  const [year = 2000, month = 1, day = 1] = (model.date || "")
    .split("-")
    .filter(Boolean)
    .map(Number);
  // ZIP stores local calendar fields, so use the same wall-clock timestamp
  // in every time zone rather than converting midnight UTC to local time.
  const zipDate = new Date(
    Math.max(1980, Math.min(2107, year)),
    month - 1,
    day,
  );
  const zipEntries = Object.fromEntries(
    [...artifacts].map(([name, text]) => [
      name,
      [strToU8(text), { mtime: zipDate }],
    ]),
  );
  const bundle = Buffer.from(zipSync(zipEntries, { level: 6 }));
  const exports = {
    slug,
    bundle: bundle.toString("base64"),
  };
  const clientViews = views.map(
    ({ key, label, title, nodeIds, diagram, diagramFields }) => ({
      key,
      label,
      title,
      nodeIds,
      diagram,
      diagramFields,
    }),
  );
  artifacts.set(`${slug}-models.zip`, bundle);
  return {
    artifacts,
    report,
    model,
    views,
    payload: {
      model,
      views: clientViews,
      exports,
      snippets,
      ...(scenarios ? { scenarios } : {}),
    },
  };
}
// The standalone viewer's stored theme preference; src/main.jsx uses the same
// key, so envUI's startup script themes the page before the first paint.
const THEME_STORAGE_KEY = "atlas-theme";
// The offline file keeps envUI's comfortable scale, as src/main.jsx does, so
// the first paint has it.
const THEME_SCALE = "comfortable";
const packageDirectory = (name) =>
  path.dirname(require.resolve(`${name}/package.json`, { paths: [rootPath] }));
// The offline file has no host: it carries the styles of the envUI components
// the viewer uses (each component's module imports its own, with the Geist
// font as a data URL), the viewer styles, envUI's theme startup script in the
// head, the app script and envUI's notices.
async function bundleClient() {
  const app = await bundleJavaScript({
    absWorkingDir: rootPath,
    entryPoints: ["src/main.jsx"],
    // Not written: the output path only names the script and the style sheet
    // that envUI's component modules bring.
    outdir: "viewer",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    // A linked envUI checkout would otherwise bring its own React.
    alias: {
      react: packageDirectory("react"),
      "react-dom": packageDirectory("react-dom"),
    },
    loader: { ".woff2": "dataurl" },
    minify: true,
    charset: "utf8",
    legalComments: "inline",
    logLevel: "silent",
    write: false,
  });
  const output = (extension) =>
    app.outputFiles.find((file) => file.path.endsWith(extension))?.text || "";
  const styles = await bundleJavaScript({
    absWorkingDir: rootPath,
    stdin: {
      contents: ["./src/viewer/viewer.css", "./src/canvas/canvas.css"]
        .map((file) => `@import "${file}";`)
        .join("\n"),
      resolveDir: rootPath,
      sourcefile: "viewer.css",
      loader: "css",
    },
    bundle: true,
    minify: true,
    charset: "utf8",
    legalComments: "none",
    logLevel: "silent",
    write: false,
  });
  const envUI = packageDirectory("@envsemble/envui");
  const notices = [
    ["envUI", "LICENSE"],
    ["envUI runtime dependencies", "licenses/Runtime-Dependencies-LICENSE.txt"],
    ["Material Symbols", "licenses/Material-Symbols-LICENSE.txt"],
    ["Geist font", "licenses/Geist-LICENSE.txt"],
  ]
    .map(
      ([title, file]) =>
        `${title}\n${fs.readFileSync(path.join(envUI, file), "utf8").replace(/\r\n/g, "\n").trim()}`,
    )
    .join("\n\n")
    .replaceAll("*/", "* /");
  const { createThemeBootstrapScript } =
    await import("@envsemble/envui/theme-bootstrap");
  return {
    app: output(".js"),
    // envUI's styles first; its cascade layers rank below the viewer's own.
    styles: output(".css") + styles.outputFiles[0].text,
    notices,
    themeBootstrap: createThemeBootstrapScript({
      storageKey: THEME_STORAGE_KEY,
      scale: THEME_SCALE,
    }),
  };
}
/**
 * An offline viewer in one HTML file. `prepared` is a viewer prepared with its
 * artifacts (by prepareDiagrams) and `file` the diagram it shows, which the
 * page carries for reading back.
 */
async function buildViewer({ prepared, file } = {}) {
  if (!prepared?.payload)
    throw new Error(
      "VIEWER_INPUT: provide a viewer prepared by prepareDiagrams",
    );
  const { model } = prepared;
  const { views: clientViews, exports, snippets } = prepared.payload;
  const inline = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
  const carried = file
    ? `<script id="atlas-diagram" type="application/json">${inline(file)}</script>`
    : "";
  const template = fs.readFileSync(
    path.join(rootPath, "src/viewer.html"),
    "utf8",
  );
  if (
    !template.includes("/*MODEL_DATA*/") ||
    !template.includes("/*APP_SCRIPT*/") ||
    !template.includes("/*APP_STYLES*/") ||
    !template.includes("/*THEME_BOOTSTRAP*/")
  )
    throw new Error("Missing template marker");
  const { app, styles, notices, themeBootstrap } = await bundleClient();
  const script = `/* React and React DOM\n${fs.readFileSync(path.join(rootPath, "licenses/react-LICENSE"), "utf8")}\n\n${notices}\n*/\n${app}`;
  const html = template
    .replace(
      "<!--APP_ICON-->",
      () =>
        `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(fs.readFileSync(path.join(rootPath, "assets/atlas-icon.svg"), "utf8"))}">`,
    )
    .replace(
      /<title>.*?<\/title>/,
      () =>
        `<title>${model.title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")} | Atlas</title>`,
    )
    .replace("/*APP_STYLES*/", () => styles.replace(/<\/style/gi, "<\\/style"))
    // In the head, so a stored theme applies before the model data is parsed
    // and the page first paints.
    .replace("/*THEME_BOOTSTRAP*/", () =>
      themeBootstrap.replace(/<\/script/gi, "<\\/script"),
    )
    .replace(
      "/*MODEL_DATA*/",
      () =>
        `const MODEL=${inline(model)};const VIEWS=${inline(clientViews)};const EXPORTS=${inline(exports)};const SNIPPETS=${inline(snippets)};const COMPARISON=${inline(prepared.payload.comparison || null)};const SCENARIOS=${inline(prepared.payload.scenarios || null)};`,
    )
    .replace("/*APP_SCRIPT*/", () =>
      script.replace(/<\/script/gi, "<\\/script"),
    )
    .replace("</body>", () => `${carried}\n</body>`);
  return { ...prepared, html };
}
function writeViewer(built, outputPath) {
  fs.mkdirSync(path.join(outputPath, "downloads"), { recursive: true });
  for (const [name, content] of built.artifacts)
    fs.writeFileSync(path.join(outputPath, "downloads", name), content);
  fs.writeFileSync(path.join(outputPath, "index.html"), built.html);
}
module.exports = {
  prepareEntry,
  prepareModel,
  buildViewer,
  writeViewer,
};
