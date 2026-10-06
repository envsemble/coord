const path = require("node:path");
const { createProject } = require("../examples/r5/create-project.cjs");
const { createEvidence, createViews } = require("../examples/r5/metadata.cjs");
const snippets = require("../examples/r5/source-snippets.json");
const { buildViewer, writeViewer } = require("../lib/build/buildViewer.cjs");
const { buildLibrary } = require("./build-library.cjs");
async function build() {
  await buildLibrary();
  const project = createProject();
  const built = await buildViewer({
    project,
    evidence: createEvidence(project),
    views: createViews(project),
    snippets,
    slug: "r5",
  });
  writeViewer(built, path.resolve(__dirname, ".."));
  return built;
}
module.exports = { build };
if (require.main === module)
  build()
    .then(({ report }) =>
      console.log(
        `Built R5 example: ${report.modelCounts.classes} classes; ${report.counts.error} ontology findings recorded.`,
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
