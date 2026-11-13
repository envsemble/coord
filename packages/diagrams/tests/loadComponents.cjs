const path = require("node:path");
const { buildSync } = require("esbuild");

// envUI publishes only ES modules, so the CommonJS test bundles include it.
// Every other package, including React and envUI's own dependencies, stays
// external and resolves from this package: one React renders the markup even
// when a local envUI checkout is linked into node_modules.
const root = path.resolve(__dirname, "..");
const manifests = [
  require("../package.json"),
  require("@envsemble/envui/package.json"),
];
const external = [
  ...new Set(
    manifests.flatMap((manifest) =>
      ["dependencies", "devDependencies", "peerDependencies"].flatMap((key) =>
        Object.keys(manifest[key] || {}),
      ),
    ),
  ),
]
  .filter((name) => name !== "@envsemble/envui")
  .flatMap((name) => [name, `${name}/*`]);

// Each module compiles once per test file: the tests only read its exports.
const loaded = new Map();

/** Compiles a source module (and envUI) to CommonJS and returns its exports. */
function loadComponents(entryPoint = "src/index.js") {
  if (!loaded.has(entryPoint)) loaded.set(entryPoint, compile(entryPoint));
  return loaded.get(entryPoint);
}
function compile(entryPoint) {
  const code = buildSync({
    absWorkingDir: root,
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    external,
    // envUI's component modules import their style sheets; markup needs none.
    loader: { ".css": "empty" },
    logLevel: "silent",
    write: false,
  }).outputFiles[0].text;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)(
    require,
    compiled,
    compiled.exports,
  );
  return compiled.exports;
}
module.exports = { loadComponents };
