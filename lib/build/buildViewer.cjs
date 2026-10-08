const fs = require("node:fs");
const path = require("node:path");
const { zipSync, strToU8 } = require("fflate");
const { build: bundleJavaScript } = require("esbuild");
const { layoutDiagram } = require("../layout/layoutDiagram.cjs");
const { renderSVG } = require("../layout/renderSVG.cjs");
const { validateDiagram } = require("../layout/validateDiagram.cjs");
const { validateProject } = require("../validation/validateProject.cjs");
const { validateEvidence } = require("../validation/validateEvidence.cjs");
const { toViewerModel } = require("../model/project.cjs");
const { prepareViews } = require("../layout/prepareViews.cjs");
const { highlightSnippets } = require("./highlightSnippets.cjs");
const rootPath = path.resolve(__dirname, "../..");
async function prepareViewer({
  project,
  document,
  portableDocument,
  includeArtifacts = true,
  evidence = {},
  views: settings,
  snippets: excerpts = {},
  slug = "model",
}) {
  if (!/^[\w-]+$/.test(slug)) throw new Error("Invalid artifact slug");
  if (document) {
    require("../document/document.cjs").assertDocument(document);
    if (document.profile === "ontouml") assertRenderableProject(document.model);
    if (document.state === "proposal" && document.baselineId)
      return require("./prepareComparison.cjs").prepareComparison({
        document,
        slug,
        includeArtifacts,
      });
    const { documentViewerModel } = require("../document/document.cjs");
    const model = documentViewerModel(document);
    if (document.profile === "ontouml") assertRenderableProject(document.model);
    return prepareModel({
      model,
      report: model.validation,
      evidence: document.evidence,
      project: document.model,
      settings: document.views.length ? document.views : undefined,
      excerpts: document.snippets,
      slug,
      includeArtifacts,
      document,
    });
  }
  const report = validateProject(project);
  report.issues.push(...validateEvidence(project, evidence));
  report.valid = !report.issues.some((issue) => issue.severity === "error");
  report.counts = Object.fromEntries(
    ["error", "warning", "info"].map((s) => [
      s,
      report.issues.filter((i) => i.severity === s).length,
    ]),
  );
  const blocking = report.issues.filter(
    (i) => i.severity === "error" && i.layer !== "ontology",
  );
  if (blocking.length)
    throw new Error(blocking.map((i) => `${i.code}: ${i.message}`).join("\n"));
  assertRenderableProject(project);
  const model = toViewerModel(project, evidence);
  model.validation = report;
  return prepareModel({
    model,
    report,
    evidence,
    project,
    settings,
    excerpts,
    slug,
    includeArtifacts,
    document: portableDocument,
  });
}
function assertRenderableProject(project) {
  const elements = new Map(project.elements.map((e) => [e.id, e]));
  if (
    project.elements.some(
      (e) =>
        e.type === "NaryRelation" ||
        (e.type === "Generalization" &&
          [e.general, e.specific].some(
            (id) => elements.get(id).type !== "Class",
          )) ||
        (e.type === "BinaryRelation" &&
          e.properties.some(
            (id) =>
              elements.get(elements.get(id).propertyType).type !== "Class",
          )),
    )
  )
    throw new Error(
      "This renderer supports binary class relations. N-ary or relation-to-relation edges require a renderer extension; no partial diagram was exported.",
    );
}
async function prepareModel({
  model,
  report,
  evidence,
  project,
  settings,
  excerpts,
  slug,
  includeArtifacts,
  document,
  diagramProvider = layoutDiagram,
}) {
  const sources = model.sources;
  const snippets = await highlightSnippets(
    sources.filter((s) => excerpts[s.id]),
    excerpts,
  );
  const classes = new Map(model.classes.map((c) => [c.id, c]));
  const views = prepareViews(model, settings);
  const artifacts = new Map();
  const json = JSON.stringify(project, null, 2);
  report.modelCounts = {
    classes: model.classes.length,
    relations: model.relations.length,
    generalizations: model.generalizations.length,
  };
  report.diagrams = [];
  const alias = (id) => `C${[...classes.keys()].indexOf(id)}`;
  const chrQuote = '"',
    chrSlash = String.fromCharCode(92);
  const plantUML = {};
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
    const lines = [
      "@startuml",
      `title ${view.title} — source-informed v${model.version}`,
      "left to right direction",
      "hide circle",
      "skinparam classAttributeIconSize 0",
      "skinparam linetype ortho",
    ];
    for (const name of view.names) {
      const c = classes.get(name);
      lines.push(
        `class "${c.name.replaceAll(chrQuote, chrSlash + chrQuote)}" as ${alias(name)} <<${c.stereotype}>> {`,
        ...c.attributes.map(
          ({ name, type, multiplicity }) =>
            `  ${name} : ${type}${multiplicity ? " [" + multiplicity + "]" : ""}`,
        ),
        "}",
      );
    }
    for (const g of generalizations) {
      lines.push(`${alias(g.generalId)} <|-- ${alias(g.specificId)}`);
      const sets = model.partitions.filter((set) =>
        set.generalizations.includes(g.id),
      );
      if (sets.length)
        lines.push(
          `note on link: ${sets.map((set) => `${set.name.replace(/[\r\n]/g, " ")} {${set.complete ? "complete" : "incomplete"}, ${set.disjoint ? "disjoint" : "overlapping"}}`).join("\\n")}`,
        );
    }
    for (const r of edges)
      lines.push(
        `${alias(r.sourceId)} "${r.sourceMultiplicity}" -- "${r.targetMultiplicity}" ${alias(r.targetId)} : ${r.stereotype ? "<<" + r.stereotype + ">>\\n" : ""}${r.name}`,
      );
    lines.push("@enduml");
    plantUML[view.key] = lines.join("\n");
    artifacts.set(`${slug}-${view.key}.puml`, plantUML[view.key]);
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
        report: require("../learning/report.cjs").prepareReport(
          document,
          model,
          views,
        ),
        snippets,
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
  artifacts.set(
    `${slug}-${document && document.profile !== "ontouml" ? "structural" : "ontouml"}.json`,
    json,
  );
  artifacts.set(`${slug}-model-evidence.json`, JSON.stringify(model, null, 2));
  artifacts.set(`${slug}-evidence.json`, JSON.stringify(evidence, null, 2));
  artifacts.set(
    `${slug}-views.json`,
    JSON.stringify(
      settings ||
        views.map(({ key, label, title, nodeIds }) => ({
          key,
          label,
          title,
          nodeIds,
        })),
      null,
      2,
    ),
  );
  artifacts.set(`${slug}-validation.json`, JSON.stringify(report, null, 2));
  artifacts.set(`${slug}-model-notes.txt`, notes);
  const [year, month, day] = model.date.split("-").map(Number);
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
  if (document && includeArtifacts)
    artifacts.set(
      `${slug}-atlas-document.json`,
      JSON.stringify(document, null, 2),
    );
  const bundle = includeArtifacts
    ? Buffer.from(
        zipSync(
          {
            ...zipEntries,
            ...(document
              ? {
                  [`${slug}-atlas-document.json`]: [
                    strToU8(JSON.stringify(document, null, 2)),
                    { mtime: zipDate },
                  ],
                }
              : {}),
          },
          { level: 6 },
        ),
      )
    : Buffer.alloc(0);
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
  if (includeArtifacts) artifacts.set(`${slug}-models.zip`, bundle);
  else artifacts.clear();
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
      report: require("../learning/report.cjs").prepareReport(
        document,
        model,
        views,
      ),
    },
  };
}
async function buildViewer(input) {
  const { documentFromInput } = require("../document/portable.cjs");
  const document = input.document || documentFromInput(input);
  // Keep the legacy projection's labels/validation stable while embedding its
  // lossless editable envelope as a separate delivery contract.
  const prepared = await prepareViewer({
    ...input,
    includeArtifacts: true,
    portableDocument: document,
  });
  const { model } = prepared;
  const { views: clientViews, exports, snippets } = prepared.payload;
  const inline = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
  const template = fs.readFileSync(
    path.join(rootPath, "src/viewer.html"),
    "utf8",
  );
  if (
    !template.includes("/*MODEL_DATA*/") ||
    !template.includes("/*APP_SCRIPT*/") ||
    !template.includes("/*APP_STYLES*/")
  )
    throw new Error("Missing template marker");
  const app = await bundleJavaScript({
    absWorkingDir: rootPath,
    entryPoints: ["src/main.jsx"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
    charset: "utf8",
    legalComments: "inline",
    write: false,
  });
  const license = fs.readFileSync(
    path.join(rootPath, "licenses/react-LICENSE"),
    "utf8",
  );
  const iconLicense = fs.readFileSync(
    path.join(rootPath, "licenses/octicons-LICENSE"),
    "utf8",
  );
  const script = `/* React and React DOM\n${license}\n\nGitHub Octicons\n${iconLicense}\n*/\n${app.outputFiles[0].text}`;
  const html = template
    .replace(
      /<title>.*?<\/title>/,
      () =>
        `<title>${model.title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")} | OntoUML Atlas</title>`,
    )
    .replace("/*APP_STYLES*/", () =>
      ["src/ui/styles.css", "src/visualization/styles.css"]
        .map((file) => fs.readFileSync(path.join(rootPath, file), "utf8"))
        .join("\n"),
    )
    .replace(
      "/*MODEL_DATA*/",
      () =>
        `const MODEL=${inline(model)};const VIEWS=${inline(clientViews)};const EXPORTS=${inline(exports)};const SNIPPETS=${inline(snippets)};const COMPARISON=${inline(prepared.payload.comparison || null)};const REPORT=${inline(prepared.payload.report || null)};`,
    )
    .replace("/*APP_SCRIPT*/", () =>
      script.replace(/<\/script/gi, "<\\/script"),
    )
    .replace(
      "</body>",
      () =>
        `<script id="atlas-document" type="application/json">${inline(document)}</script>\n</body>`,
    );
  return { ...prepared, html };
}
function writeViewer(built, outputPath) {
  fs.mkdirSync(path.join(outputPath, "downloads"), { recursive: true });
  for (const [name, content] of built.artifacts)
    fs.writeFileSync(path.join(outputPath, "downloads", name), content);
  fs.writeFileSync(path.join(outputPath, "index.html"), built.html);
}
module.exports = {
  prepareViewer,
  prepareModel,
  assertRenderableProject,
  buildViewer,
  writeViewer,
};
