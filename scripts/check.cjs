const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { unzipSync } = require("fflate");
const { build } = require("./build.cjs");
const { validateDiagram } = require("../lib/layout/validateDiagram.cjs");
const root = path.resolve(__dirname, "..");

async function check() {
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
    !/<link\b[^>]*\b(?:href|rel)\s*=/i.test(html),
    "External runtime stylesheet or resource",
  );
  assert(
    !/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(html),
    "Runtime network API",
  );
  assert(!/url\(\s*['"]?https?:/i.test(html), "Remote CSS dependency");
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1, "Expected one inline application script");
  new vm.Script(scripts[0][1], { filename: "index.html" });
  const dataLine = scripts[0][1].match(/^\s*(const MODEL=.*)\r?$/m)?.[1];
  assert(dataLine, "Missing embedded model and export data");
  const embedded = new vm.Script(
    `${dataLine}\n;({MODEL,VIEWS,EXPORTS,SNIPPETS})`,
  ).runInNewContext({});
  const excerpts = require("../examples/r5/source-snippets.json");
  for (const source of embedded.MODEL.sources) {
    const snippet = embedded.SNIPPETS[source.id];
    assert(snippet, `Missing offline source preview: ${source.id}`);
    assert.equal(snippet.code, excerpts[source.id].code);
    assert.equal(
      snippet.lines
        .map((line) => line.map((token) => token.content).join(""))
        .join("\n"),
      snippet.code,
      `Highlighted code changed: ${source.id}`,
    );
    assert.equal(snippet.endLine - snippet.startLine + 1, snippet.lines.length);
    assert.equal(
      snippet.url,
      `${source.url.split("#")[0]}#L${snippet.startLine}-L${snippet.endLine}`,
    );
  }
  assert.equal(
    JSON.stringify(embedded.MODEL, null, 2),
    built.artifacts.get("r5-model-evidence.json"),
  );
  assert.deepEqual(
    Buffer.from(embedded.EXPORTS.bundle, "base64"),
    built.artifacts.get("r5-models.zip"),
  );
  for (const view of embedded.VIEWS) {
    validateDiagram(view.diagram, embedded.MODEL);
    validateDiagram(view.diagramFields, embedded.MODEL);
  }
  for (const [, href] of html.matchAll(/\bhref="([^"$]+)"/g)) {
    if (href.startsWith("downloads/"))
      assert(
        fs.existsSync(path.join(root, href)),
        `Missing local link: ${href}`,
      );
  }
  const zip = unzipSync(built.artifacts.get("r5-models.zip"));
  assert.equal(
    Object.keys(zip).length,
    built.artifacts.size - 1,
    "Model bundle is incomplete",
  );
  for (const [name, data] of built.artifacts)
    if (!name.endsWith(".zip"))
      assert.deepEqual(
        Buffer.from(zip[name]),
        Buffer.from(data),
        `ZIP content mismatch: ${name}`,
      );
  console.log(
    "Passed: reproducible outputs, inline script syntax, offline runtime and source snippets, embedded export payloads, local links, model schema/structure, orthogonal layout geometry, and ZIP exports.",
  );
}
check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
