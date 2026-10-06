const path = require("node:path");
const { build } = require("esbuild");
async function buildLibrary() {
  await build({
    absWorkingDir: path.resolve(__dirname, ".."),
    entryPoints: ["src/index.js"],
    outfile: "dist/react.mjs",
    bundle: true,
    format: "esm",
    platform: "neutral",
    packages: "external",
    jsx: "automatic",
    target: "es2020",
    sourcemap: true,
    legalComments: "inline",
  });
}
module.exports = { buildLibrary };
if (require.main === module)
  buildLibrary().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
