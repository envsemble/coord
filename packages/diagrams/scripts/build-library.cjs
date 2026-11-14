const path = require("node:path");
const fs = require("node:fs");
const { build } = require("esbuild");
async function buildLibrary() {
  require("./build-embedded-css.cjs").buildEmbeddedCSS(
    path.resolve(__dirname, ".."),
  );
  const built = await build({
    absWorkingDir: path.resolve(__dirname, ".."),
    // The viewer, and the Coord mark alone for an app that draws it before it needs the viewer.
    entryPoints: { react: "src/index.js", mark: "src/ui/CoordMark.jsx" },
    outdir: "dist",
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    platform: "neutral",
    packages: "external",
    jsx: "automatic",
    target: "es2020",
    sourcemap: true,
    legalComments: "inline",
    write: false,
  });
  for (const output of built.outputFiles) {
    const data = Buffer.from(output.contents);
    if (fs.existsSync(output.path) && fs.readFileSync(output.path).equals(data))
      continue;
    fs.mkdirSync(path.dirname(output.path), { recursive: true });
    const temporary = `${output.path}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, data);
      fs.renameSync(temporary, output.path);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
}
module.exports = { buildLibrary };
if (require.main === module)
  buildLibrary().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
