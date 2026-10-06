const fs = require("node:fs");
const path = require("node:path");
const { Project, serializationUtils } = require("ontouml-js");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const { zipSync, strToU8 } = require("fflate");
const { build: bundleJavaScript } = require("esbuild");
const { layoutDiagram } = require("./diagram/layout.cjs");
const { renderSVG } = require("./diagram/render.cjs");
const { validateDiagram } = require("./diagram/validate.cjs");
const viewSettings = require("../model/views.cjs");
const cfg = require("../model/model.cjs");

const rootPath = path.resolve(__dirname, "..");
const downloadPath = path.join(rootPath, "downloads");
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

async function build() {
  const artifacts = new Map();
  const sources = cfg.sources;
  for (const source of sources) {
    const expected = `https://github.com/${source.repo}/blob/${source.commit}/${source.file}#L${source.line}`;
    if (
      !/^[0-9a-f]{40}$/.test(source.commit) ||
      !Number.isInteger(source.line) ||
      source.line < 1 ||
      source.url !== expected
    ) {
      throw new Error(`Invalid pinned source: ${source.id}`);
    }
  }
  const stableIds = new Map();
  const stable = (element, id) => {
    stableIds.set(element.id, id);
    return element;
  };
  const project = stable(new Project(), "project-r5-season-3");
  project.name.add(
    `R5Reloaded / Apex Season 3 — source-informed OntoUML v${cfg.version}`,
  );
  project.description.add(
    `Static inspection of public R5 SDK and Flowstate source targeting ${cfg.build}. Source structures and script behavior inform this ontology; identities, stereotypes, and multiplicities remain interpretations. Native binary implementations and EA production matchmaking were not inspected.`,
  );
  const root = stable(
    project
      .packageBuilder()
      .root()
      .name("R5Reloaded Season 3 service domain")
      .build(),
    "package-root",
  );
  const packages = {};
  for (const [key, name] of Object.entries({
    shared: "Shared identities",
    backend: "R5 server discovery backend",
    runtime: "R5 game-server runtime",
    types: "Value types",
  })) {
    packages[key] = stable(
      root.packageBuilder().name(name).build(),
      `package-${key}`,
    );
  }
  const types = new Map();
  for (const name of ["Text", "Integer", "Decimal", "Vector3", "Boolean"])
    types.set(
      name,
      stable(
        packages.types.classBuilder().datatype().name(name).build(),
        `datatype-${name}`,
      ),
    );
  const classes = new Map(),
    relations = [],
    gens = [];
  for (const [
    name,
    stereo,
    pkg,
    description,
    evidence,
    attrs = [],
  ] of cfg.classes) {
    const builder = packages[pkg]
      .classBuilder()
      .stereotype(stereo)
      .name(name)
      .description(description)
      .editorialNote(
        "OntoUML classification and multiplicities are modeling interpretations, not declarations recovered verbatim from C++ or scripts.",
      );
    for (const id of evidence) {
      const source = sources.find((s) => s.id === id);
      if (!source) throw new Error(`Missing evidence ${id} for ${name}`);
      builder.editorialNote(`${id}: ${source.url}`);
    }
    const obj = stable(builder.build(), `class-${name}`);
    for (const [field, type, cardinality = "1"] of attrs)
      stable(
        obj
          .propertyBuilder()
          .name(field)
          .type(types.get(type))
          .cardinality(cardinality)
          .build(),
        `attribute-${name}-${field}`,
      );
    classes.set(name, {
      name,
      stereo,
      pkg,
      description,
      evidence,
      attrs,
      id: stableIds.get(obj.id),
      obj,
    });
  }
  for (const [child, parent] of cfg.generalizations) {
    const obj = stable(
      packages[classes.get(child).pkg]
        .generalizationBuilder()
        .general(classes.get(parent).obj)
        .specific(classes.get(child).obj)
        .build(),
      `generalization-${child}-${parent}`,
    );
    gens.push({ child, parent, id: stableIds.get(obj.id), obj });
  }
  for (const partition of cfg.partitions) {
    const builder = packages[classes.get(partition.parent).pkg]
      .generalizationSetBuilder()
      .name(partition.name)
      .generalizations(
        ...gens
          .filter(
            (g) =>
              g.parent === partition.parent &&
              partition.children.includes(g.child),
          )
          .map((g) => g.obj),
      );
    if (partition.disjoint) builder.disjoint();
    if (partition.complete) builder.complete();
    stable(builder.build(), `generalization-set-${slug(partition.name)}`);
  }
  for (const [pkg, a, b, name, stereo, ac, bc] of cfg.relations) {
    const builder = packages[pkg]
      .binaryRelationBuilder()
      .source(classes.get(a).obj)
      .target(classes.get(b).obj)
      .name(name);
    if (stereo) builder.stereotype(stereo);
    const id = `relation-${pkg}-${a}-${b}-${slug(name)}`;
    const obj = stable(
      builder
        .sourceCardinality(ac)
        .targetCardinality(bc)
        .description(
          "Conceptual relation and proposed multiplicities. Evidence for its connected concepts is recorded in their editorial notes.",
        )
        .build(),
      id,
    );
    stable(obj.sourceEnd, `${id}-source`);
    stable(obj.targetEnd, `${id}-target`);
    relations.push({ pkg, a, b, name, stereo, ac, bc, id, obj });
  }
  const suppliers = (name) =>
    classes.get(name).stereo === "kind"
      ? new Set([name])
      : new Set(
          gens
            .filter((g) => g.child === name)
            .flatMap((g) => [...suppliers(g.parent)]),
        );
  for (const c of classes.values()) {
    if (["phase", "role"].includes(c.stereo) && suppliers(c.name).size !== 1)
      throw new Error(`Identity supplier: ${c.name}`);
    if (
      c.stereo === "role" &&
      !relations.some((r) => r.stereo === "mediation" && r.b === c.name)
    )
      throw new Error(`Dependent role: ${c.name}`);
    if (c.stereo === "relator") {
      const ends = relations.filter(
        (r) => r.stereo === "mediation" && r.a === c.name,
      );
      if (ends.length < 2 || ends.some((r) => r.bc !== "1"))
        throw new Error(`Relator ends: ${c.name}`);
    }
  }
  for (const r of relations) {
    if (r.stereo === "participation" && classes.get(r.b).stereo !== "event")
      throw new Error(`Event direction: ${r.name}`);
    if (
      r.stereo === "characterization" &&
      !["mode", "quality"].includes(classes.get(r.a).stereo)
    )
      throw new Error(`Aspect direction: ${r.name}`);
  }
  // Library-generated IDs and timestamps are normalized so rebuilding does
  // not change committed artifacts when the model sources are unchanged.
  const normalize = (value, key) => {
    if (key === "created") return `${cfg.date}T00:00:00.000Z`;
    if (Array.isArray(value)) return value.map((item) => normalize(item));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, normalize(v, k)]),
      );
    return typeof value === "string" ? stableIds.get(value) || value : value;
  };
  const raw = JSON.parse(JSON.stringify(project));
  for (const element of raw.elements)
    if (!stableIds.has(element.id))
      throw new Error(`Unstable element ID: ${element.type}`);
  const json = JSON.stringify(normalize(raw), null, 2);
  serializationUtils.validate(json);
  const schema = JSON.parse(
    fs.readFileSync(path.join(rootPath, "schemas/ontouml-schema.json"), "utf8"),
  );
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const valid = ajv.compile(schema);
  if (!valid(JSON.parse(json))) throw new Error(JSON.stringify(valid.errors));
  if (
    JSON.stringify(serializationUtils.parse(json)) !==
    JSON.stringify(JSON.parse(json))
  )
    throw new Error("Round-trip mismatch");
  const model = {
    title: "R5Reloaded / Apex Season 3",
    version: cfg.version,
    date: cfg.date,
    targetBuild: cfg.build,
    status:
      "Public-source static inspection; native engine internals partially opaque",
    repositories: [
      { repo: "Mauler125/r5sdk", commit: cfg.sdk },
      { repo: "Mauler125/r5_flowstate", commit: cfg.scripts },
    ],
    classes: [...classes.values()].map(({ obj, ...c }) => c),
    relations: relations.map(({ obj, ...r }) => r),
    generalizations: gens.map(({ obj, ...g }) => g),
    partitions: cfg.partitions,
    sources,
    constraints: cfg.constraints,
    unknowns: cfg.unknowns,
  };
  const views = Object.entries(viewSettings).map(([key, settings]) => ({
    key,
    ...settings,
    names: [...classes.values()]
      .filter(
        (c) =>
          settings.packages.includes(c.pkg) ||
          settings.includeNames.includes(c.name),
      )
      .map((c) => c.name),
  }));
  const report = {
    date: cfg.date,
    targetBuild: cfg.build,
    counts: {
      classes: classes.size,
      valueTypes: types.size,
      relations: relations.length,
      generalizations: gens.length,
    },
    schema: schema.$id,
    checks: [
      "Official OntoUML JSON schema validation with format checks",
      "Lossless ontouml-js parse/serialize round trip",
      "Role/phase identity suppliers and role dependence",
      "Relators with two mandatory mediated ends",
      "Event and intrinsic-aspect relation directions",
      "Source URLs match the pinned manifest recorded during inspection",
    ],
    limitations: [
      "Conceptual identities, stereotypes, cardinalities, and session boundaries remain interpretations",
      "Native binary code was not inspected or executed",
      "No full OntoUML semantic or Alloy validation",
      "No graphical editor import test",
      "No directory-service implementation or EA matchmaking inspection",
    ],
    diagrams: [],
  };
  const plantUML = {};
  for (const view of views) {
    const names = new Set(view.names);
    const edges = relations.filter(
      (r) =>
        names.has(r.a) &&
        names.has(r.b) &&
        (r.pkg === view.key || r.pkg === "shared"),
    );
    const generalizations = gens.filter(
      (g) => names.has(g.child) && names.has(g.parent),
    );
    for (const fields of [false, true]) {
      const rendered = await layoutDiagram(
        view,
        classes,
        edges,
        generalizations,
        fields,
      );
      const svg = renderSVG(rendered.diagram);
      view[fields ? "diagramFields" : "diagram"] = rendered.diagram;
      view[fields ? "svgFields" : "svg"] = svg;
      report.diagrams.push({
        view: view.key,
        fields,
        ...rendered.check,
        ...validateDiagram(rendered.diagram, model),
      });
      artifacts.set(`r5-${view.key}${fields ? "-fields" : ""}.svg`, svg);
    }
    const lines = [
      "@startuml",
      `title ${view.title} — source-informed v${cfg.version}`,
      "left to right direction",
      "hide circle",
      "skinparam classAttributeIconSize 0",
      "skinparam linetype ortho",
    ];
    for (const name of view.names) {
      const c = classes.get(name);
      lines.push(
        `class ${name} <<${c.stereo}>> {`,
        ...c.attrs.map(
          ([a, t, k]) => `  ${a} : ${t}${k ? " [" + k + "]" : ""}`,
        ),
        "}",
      );
    }
    for (const g of generalizations) lines.push(`${g.parent} <|-- ${g.child}`);
    for (const r of edges)
      lines.push(
        `${r.a} "${r.ac}" -- "${r.bc}" ${r.b} : ${r.stereo ? "<<" + r.stereo + ">>\\n" : ""}${r.name}`,
      );
    for (const p of cfg.partitions.filter((p) => names.has(p.parent)))
      lines.push(
        `note bottom of ${p.parent} : ${p.children.join(" / ")}: disjoint, ${p.complete ? "complete" : "incomplete"}.`,
      );
    lines.push("@enduml");
    plantUML[view.key] = lines.join("\n");
    artifacts.set(`r5-${view.key}.puml`, plantUML[view.key]);
  }
  report.checks.push(
    "All four layouts have only horizontal/vertical relation segments",
    "Every association has two explicit multiplicities matched to its semantic endpoints",
    "No node overlap, relation through a node, or relation-label overlap with a node or another label",
  );
  const notes = [
    model.title + " — v" + model.version,
    "Target build: " + cfg.build,
    "",
    ...model.repositories.map((r) => r.repo + " @ " + r.commit),
    "",
    "OBSERVATIONS AND INTERPRETATIONS",
    "SDK declarations, wrappers, and scripts were statically inspected. Stereotypes and multiplicities are interpretations. Native engine bodies and directory-service internals remain partly opaque.",
    "CClient is a server-side resource, distinct from the remote application. A command can be declined by the movement wrapper. Downed players can satisfy the alive predicate. Elimination is recorded by platform UID and cleared by the inspected respawn path.",
    "",
    "SOURCE LINKS",
    ...sources.map((s) => `${s.id} — ${s.title}\n${s.url}\n${s.claim}\n`),
    "CONSTRAINTS",
    ...cfg.constraints.map((c) => c.join(" — ")),
    "",
    "OPEN QUESTIONS",
    ...cfg.unknowns,
    "",
    "VALIDATION",
    ...report.checks,
    ...report.limitations.map((x) => "Limitation: " + x),
  ].join("\n");
  artifacts.set("r5-ontouml.json", json);
  artifacts.set("r5-model-evidence.json", JSON.stringify(model, null, 2));
  artifacts.set("r5-validation.json", JSON.stringify(report, null, 2));
  artifacts.set("r5-model-notes.txt", notes);
  const [year, month, day] = cfg.date.split("-").map(Number);
  // ZIP stores local calendar fields, so use the same wall-clock timestamp
  // in every time zone rather than converting midnight UTC to local time.
  const zipDate = new Date(year, month - 1, day);
  const zipEntries = Object.fromEntries(
    [...artifacts].map(([name, text]) => [
      name,
      [strToU8(text), { mtime: zipDate }],
    ]),
  );
  const bundle = Buffer.from(zipSync(zipEntries, { level: 6 }));
  const exports = {
    schema: json,
    plantUML,
    notes,
    validation: JSON.stringify(report, null, 2),
    bundle: bundle.toString("base64"),
  };
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
  const script = `/* React and React DOM\n${license}\n*/\n${app.outputFiles[0].text}`;
  const html = template
    .replace("/*APP_STYLES*/", () =>
      ["src/ui/styles.css", "src/diagram/styles.css"]
        .map((file) => fs.readFileSync(path.join(rootPath, file), "utf8"))
        .join("\n"),
    )
    .replace(
      "/*MODEL_DATA*/",
      () =>
        `const MODEL=${inline(model)};const VIEWS=${inline(views)};const EXPORTS=${inline(exports)};`,
    )
    .replace("/*APP_SCRIPT*/", () =>
      script.replace(/<\/script/gi, "<\\/script"),
    );
  artifacts.set("r5-models.zip", bundle);
  fs.mkdirSync(downloadPath, { recursive: true });
  for (const [name, content] of artifacts)
    fs.writeFileSync(path.join(downloadPath, name), content);
  fs.writeFileSync(path.join(rootPath, "index.html"), html);
  return { artifacts, html, report };
}

module.exports = { build };
if (require.main === module)
  build()
    .then(({ report }) =>
      console.log(
        `Built offline index.html; ${report.counts.classes} classes, ${report.counts.relations} relations; all four layouts validated.`,
      ),
    )
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
