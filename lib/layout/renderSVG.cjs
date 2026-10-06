const path = require("node:path");
const { buildSync } = require("esbuild");

// Export SVG with the same components used by the interactive client.
const root = path.resolve(__dirname, "../..");
const code = buildSync({
  absWorkingDir: root,
  entryPoints: ["src/visualization/renderStatic.jsx"],
  bundle: true,
  format: "cjs",
  platform: "node",
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
module.exports = compiled.exports;
