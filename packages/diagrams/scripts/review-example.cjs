const fs = require("node:fs"),
  path = require("node:path");
const { writeReview } = require("../lib/review/review.cjs");
async function main() {
  const root = path.resolve(__dirname, ".."),
    outputDirectory = path.resolve(process.argv[2] || "artifacts/review");
  const git = process.argv.includes("--git");
  const input = (name) =>
    git
      ? {
          repository: root,
          ref: process.env.ATLAS_REVIEW_HEAD || "HEAD",
          path: `examples/review/${name}.atlas.json`,
        }
      : { file: path.join(root, `examples/review/${name}.atlas.json`) };
  const options = process.env.ATLAS_REVIEW_CONFIG
    ? JSON.parse(fs.readFileSync(process.env.ATLAS_REVIEW_CONFIG, "utf8"))
    : { base: input("base"), head: input("head"), outputDirectory };
  const result = await writeReview(options);
  console.log(JSON.stringify(result));
  process.exitCode = result.exitCode;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 2;
});
