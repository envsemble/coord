const { createEnrollmentModel } = require("../examples/enrollment/model.cjs");
const { buildViewer, writeViewer } = require("../lib/index.cjs");
async function buildEnrollment(outputPath, report = false) {
  const built = await buildViewer({
    ...(report
      ? {
          document:
            require("../examples/enrollment/learning.cjs").createEnrollmentDocument(),
        }
      : createEnrollmentModel()),
    slug: "enrollment",
  });
  writeViewer(built, outputPath);
  return built;
}
if (require.main === module) {
  if (!process.argv[2]) throw new Error("Provide an output directory");
  buildEnrollment(process.argv[2], process.argv.includes("--report"))
    .then(({ report }) =>
      console.log(`Built enrollment example: ${report.counts.error} findings`),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
module.exports = { buildEnrollment };
