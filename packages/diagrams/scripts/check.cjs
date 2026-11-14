// The committed showcase (index.html and downloads/) is what the build writes
// from the examples, and works offline: no remote resources, its diagram and
// payload embedded and the ZIP holding every export.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { unzipSync } = require("fflate");
const { build, exampleFiles } = require("./build.cjs");
const { validateDiagram } = require("../lib/layout/validateDiagram.cjs");
const { checkDiagram } = require("../lib/plantuml/diagram.cjs");
const root = path.resolve(__dirname, "..");

async function check() {
  // Every example diagram has no problems.
  for (const name of ["shop", "enrollment"]) {
    const files = exampleFiles(name);
    const texts = new Map(files.map((f) => [f.path, f.text]));
    for (const file of files) {
      const read = (reference) =>
        texts.get(
          path.posix.normalize(
            path.posix.join(path.posix.dirname(file.path), reference),
          ),
        ) ?? null;
      assert.deepEqual(
        checkDiagram(file.text, { path: file.path, read }),
        [],
        `${name}/${file.path}`,
      );
    }
  }
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const committed = new Map(
    fs
      .readdirSync(path.join(root, "downloads"))
      .map((name) => [
        name,
        fs.readFileSync(path.join(root, "downloads", name)),
      ]),
  );
  const built = await build();
  assert.equal(
    built.html,
    html,
    "index.html was stale; rebuilt it. Run check again and commit the output.",
  );
  assert.deepEqual(
    [...built.artifacts.keys()].sort(),
    [...committed.keys()].sort(),
    "Unexpected or missing generated exports",
  );
  for (const [name, data] of built.artifacts)
    assert.deepEqual(
      Buffer.from(data),
      committed.get(name),
      `Stale generated export: ${name}`,
    );
  assert(!/<script\b[^>]*\bsrc\s*=/i.test(html), "External runtime script");
  assert(
    !/<link\b[^>]*\b(?:href|rel)\s*=/i.test(
      html.replace(/<link rel="icon" href="data:image\/svg\+xml,[^"]+">/, ""),
    ),
    "External runtime stylesheet or resource",
  );
  assert(
    !/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(html),
    "Runtime network API",
  );
  assert(!/url\(\s*['"]?https?:/i.test(html), "Remote CSS dependency");
  const data = html.match(
    /<script id="atlas-diagram" type="application\/json">([\s\S]*?)<\/script>/,
  );
  assert(data, "Missing the diagram the page shows");
  const carried = JSON.parse(data[1]);
  assert.equal(carried.path, "diagrams/saved-methods.puml");
  assert.equal(built.artifacts.get("shop.puml"), carried.text);
  const scripts = [
    ...html.matchAll(
      /<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  // envUI's theme startup script in the head, then the application.
  assert.equal(
    scripts.length,
    2,
    "Expected the theme startup and application scripts",
  );
  for (const [, code] of scripts)
    new vm.Script(code, { filename: "index.html" });
  assert(
    scripts[0].index < html.indexOf("</head>"),
    "The theme startup script runs in the head",
  );
  const application = scripts[1][1];
  const dataLine = application.match(/^\s*(const MODEL=.*)\r?$/m)?.[1];
  assert(dataLine, "Missing embedded model and export data");
  const embedded = new vm.Script(
    `${dataLine}\n;({MODEL,VIEWS,EXPORTS,COMPARISON})`,
  ).runInNewContext({});
  assert(
    embedded.COMPARISON?.changes.changes.length,
    "Missing the proposal's changes",
  );
  assert.equal(
    JSON.stringify(embedded.MODEL, null, 2),
    built.artifacts.get("shop-model-evidence.json"),
  );
  assert.deepEqual(
    Buffer.from(embedded.EXPORTS.bundle, "base64"),
    built.artifacts.get("shop-models.zip"),
  );
  for (const view of embedded.VIEWS) {
    validateDiagram(view.diagram, embedded.MODEL);
  }
  for (const [, href] of html.matchAll(/\bhref="([^"$]+)"/g)) {
    if (href.startsWith("downloads/"))
      assert(
        fs.existsSync(path.join(root, href)),
        `Missing local link: ${href}`,
      );
  }
  // The ZIP holds every export of the proposal itself; its baseline's and
  // change view's images are downloads of their own.
  const zip = unzipSync(built.artifacts.get("shop-models.zip"));
  for (const [name, data] of built.artifacts)
    if (!name.endsWith(".zip") && !/^shop-(?:baseline|changes)-/.test(name))
      assert.deepEqual(
        Buffer.from(zip[name] || []),
        Buffer.from(data),
        `ZIP content mismatch: ${name}`,
      );
  for (const name of Object.keys(zip))
    assert(built.artifacts.has(name), `ZIP holds an unknown file: ${name}`);
  console.log(
    "Passed: valid example diagrams, reproducible outputs, inline script syntax, offline runtime, embedded diagram and export payloads, local links, orthogonal layout geometry, and ZIP exports.",
  );
}
check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
