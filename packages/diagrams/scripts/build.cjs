// The examples as offline viewers. Each example is a work folder of diagram
// files: the shop's code capture with a proposal of saved payment methods,
// and the enrollment class diagram with the scenarios that exemplify it. The
// shop's proposal is the showcase, index.html with its downloads; the release
// builds both.
const fs = require("node:fs");
const path = require("node:path");
const { prepareDiagrams } = require("../lib/plantuml/prepare.cjs");
const { buildViewer, writeViewer } = require("../lib/build/buildViewer.cjs");

const root = path.resolve(__dirname, "..");
const EXAMPLES = {
  shop: { folder: "examples/shop", shows: "diagrams/saved-methods.puml" },
  enrollment: { folder: "examples/enrollment", shows: "enrollment.puml" },
};
/** Every diagram of an example's folder, by its path in the folder. */
function exampleFiles(name) {
  const folder = path.join(root, EXAMPLES[name].folder);
  const walk = (directory) =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(file);
      if (!entry.name.endsWith(".puml")) return [];
      return [
        {
          path: path.relative(folder, file).split(path.sep).join("/"),
          text: fs.readFileSync(file, "utf8"),
        },
      ];
    });
  return walk(folder).sort((a, b) => (a.path < b.path ? -1 : 1));
}
/** The viewer of the diagram an example shows, laid out with its family. */
async function prepareExample(name, includeArtifacts = true) {
  const files = exampleFiles(name);
  const { diagrams, prepared } = await prepareDiagrams({
    files,
    paths: [EXAMPLES[name].shows],
    slug: name,
    includeArtifacts,
  });
  const invalid = diagrams.filter((d) => !d.valid);
  if (invalid.length)
    throw new Error(
      `${name}: ${invalid.map((d) => `${d.path} ${d.problems[0]?.message}`).join("; ")}`,
    );
  return {
    prepared: prepared.get(EXAMPLES[name].shows),
    file: files.find((f) => f.path === EXAMPLES[name].shows),
  };
}
/** An example's offline viewer in one HTML file, with its downloads. */
async function buildExample(name) {
  return buildViewer(await prepareExample(name));
}
async function build() {
  await require("./build-library.cjs").buildLibrary();
  const built = await buildExample("shop");
  writeViewer(built, root);
  return built;
}
module.exports = { build, buildExample, prepareExample, exampleFiles };
if (require.main === module)
  build()
    .then(({ report }) =>
      console.log(
        `Built the shop example: ${report.modelCounts.classes} classes; ${report.counts.error} findings.`,
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
