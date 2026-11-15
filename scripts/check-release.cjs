const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { unzipSync } = require("fflate"),
  { assemble, hash } = require("./release.cjs");
const { execFileSync } = require("node:child_process");
async function check() {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "coord-release-check-"));
  try {
    const first = await assemble({
        outputDirectory: path.join(stage, "first"),
      }),
      other = path.join(stage, "second"),
      secondResult = JSON.parse(
        execFileSync(
          process.execPath,
          [path.join(__dirname, "release.cjs"), other],
          {
            encoding: "utf8",
            windowsHide: true,
            env: { ...process.env, TZ: "America/Los_Angeles" },
          },
        ).trim(),
      ),
      second = {
        archive: fs.readFileSync(path.join(other, secondResult.filename)),
      };
    assert.deepEqual(
      Buffer.from(first.archive),
      second.archive,
      "Release assembly is not reproducible at the same commit",
    );
    const files = unzipSync(first.archive);
    for (const file of first.manifest.files)
      assert.equal(hash(files[file.name]), file.sha256, file.name);
    assert.equal(first.manifest.format, "coord/release");
    // The enrollment example carries its scenarios; the shop's, its changes.
    const embedded = (name) => {
      const html = Buffer.from(files[name]).toString("utf8");
      assert(html.includes('<script id="coord-diagram"'), name);
      const data = html.match(/^\s*(const MODEL=.*)\r?$/m)[1];
      return new (require("node:vm").Script)(
        `${data}\n;({SCENARIOS,COMPARISON})`,
      ).runInNewContext({});
    };
    assert.equal(embedded("enrollment.html").SCENARIOS.scenarios.length, 4);
    assert(embedded("shop.html").COMPARISON.changes.changes.length);
    assert(
      Object.keys(files).some((name) =>
        /^envsemble-coord-diagrams-.+\.tgz$/.test(name),
      ),
      "Missing packed diagram package",
    );
    assert(files["packages/diagrams/assets/icon.svg"]);
    assert(files["packages/diagrams/schemas/code-source-schema.json"]);
    assert(files["packages/diagrams/examples/shop/diagrams/checkout.puml"]);
    assert(files["app/package.json"]);
    assert(files["app/src/App.tsx"]);
    assert(files["packages/coord/src/planning/reading/planningIndex.ts"]);
    assert(files["packages/coord/src/planning/check/check.ts"]);
    assert(files["packages/coord/package.json"]);
    assert(files["packages/coord/bin/coord.js"]);
    assert(
      !Object.keys(files).some((name) =>
        /(?:^|\/)(?:check_planning|log_consultation)\.py$/.test(name),
      ),
      "Coord ships no Python helpers",
    );
    assert(files["assets/hub.png"]);
    assert(
      files["app/main/index.ts"],
      "Missing the desktop app's main process",
    );
    assert(
      files["app/electron-builder.yml"],
      "Missing the desktop packaging configuration",
    );
    assert(
      !Object.keys(files).some((name) => name.startsWith("app/server/")),
      "The desktop app has no web server",
    );
    assert(
      !Object.keys(files).some((name) => /work[t]rail/i.test(name)),
      "Release files use Coord names only",
    );
    assert(
      !Object.keys(files).some((name) => name.startsWith("app/vendor/")),
      "The app uses the workspace diagram package",
    );
    assert(files["plugin/skills/coord/SKILL.md"]);
    assert(files["plugin/skills/coord-grill/SKILL.md"]);
    assert(files["plugin/skills/coord-implement/SKILL.md"]);
    assert(files["plugin/.claude-plugin/plugin.json"]);
    assert(files[".claude-plugin/marketplace.json"]);
    assert(files[".agents/plugins/marketplace.json"]);
    assert(files["plugin/skills/babysit-pr/SKILL.md"]);
    assert(files["assets/coord-horizontal-on-dark.svg"]);
    assert(files["docs/history/skills-commit-map.txt"]);
    assert(files["docs/history/atlas-import-commit-map.txt"]);
    assert(files["CHANGELOG.md"]);
    assert(files["package-lock.json"]);
    assert(
      !Object.keys(files).some((name) => /(?:^|\/)node_modules\//.test(name)),
      "Installed dependencies leaked into the release",
    );
    console.log(
      "Passed: versioned nonpublishing Coord release, repeatable archive, hashes, packed diagram package, app, planning reader, coord command, plugin and skills, branding/docs/schemas and the example viewers with their diagrams; no local planning data.",
    );
  } finally {
    if (!path.resolve(stage).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error("Unsafe release-check cleanup path");
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
check().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
