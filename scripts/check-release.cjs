const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { unzipSync } = require("fflate"),
  { assemble, hash } = require("./release.cjs");
const { execFileSync } = require("node:child_process");
async function check() {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-release-check-"));
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
    assert.equal(first.manifest.format, "atlas/release");
    assert.equal(
      require("../packages/diagrams/lib/index.cjs").importDocument(
        files["enrollment.html"],
      ).learning.scenarios.length,
      4,
    );
    assert(files["r5.html"]);
    assert(
      Object.keys(files).some((name) => /^atlas-diagrams-.+\.tgz$/.test(name)),
      "Missing packed diagram package",
    );
    assert(files["packages/diagrams/assets/atlas-icon.svg"]);
    assert(files["packages/diagrams/schemas/document-schema.json"]);
    assert(files["packages/diagrams/examples/review/head.atlas.json"]);
    assert(files["app/package.json"]);
    assert(files["app/src/App.tsx"]);
    assert(files["app/assets/atlas-dashboard.jpg"]);
    assert(files["assets/worktrail/worktrail-icon.svg"]);
    assert(
      !Object.keys(files).some((name) => name.startsWith("app/vendor/")),
      "The app must use the workspace diagram package, not a vendored tarball",
    );
    assert(files["skills/worktrail-atlas/SKILL.md"]);
    assert(files["assets/atlas-banner-dark.svg"]);
    assert(files["docs/worktrail/history/skills-commit-map.txt"]);
    assert(files["CHANGELOG.md"]);
    assert(files["package-lock.json"]);
    assert(
      !Object.keys(files).some((name) => /(?:^|\/)\.atlas\//.test(name)),
      "Local model data leaked into the release",
    );
    assert(
      !Object.keys(files).some((name) => /(?:^|\/)node_modules\//.test(name)),
      "Installed dependencies leaked into the release",
    );
    console.log(
      "Passed: versioned nonpublishing Atlas release, repeatable archive, hashes, packed diagram package, app, skills, branding/docs/schemas and reopenable report; no local model data.",
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
