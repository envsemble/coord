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
    // Atlas is the only product name. Old names may appear only in the history
    // maps, historical changelog entries and the skills' backup instructions.
    const oldName = /work[t]rail|ontouml[- ]atla[s]/i;
    const mayNameOld = (name) =>
      name.startsWith("docs/history/") ||
      name === "CHANGELOG.md" ||
      name === "skills/README.md";
    for (const [name, bytes] of Object.entries(files))
      if (
        /\.(?:[cm]?js|jsx|tsx?|json|md|html|css|svg|ya?ml|txt)$/.test(name) &&
        !mayNameOld(name)
      )
        assert.doesNotMatch(
          Buffer.from(bytes).toString("utf8"),
          oldName,
          `${name} uses an old product name`,
        );
    assert.equal(
      require("../packages/diagrams/lib/index.cjs").importDocument(
        files["enrollment.html"],
      ).learning.scenarios.length,
      4,
    );
    assert(files["r5.html"]);
    assert(
      Object.keys(files).some((name) =>
        /^envsemble-atlas-diagrams-.+\.tgz$/.test(name),
      ),
      "Missing packed diagram package",
    );
    assert(files["packages/diagrams/assets/atlas-icon.svg"]);
    assert(files["packages/diagrams/schemas/document-schema.json"]);
    assert(files["packages/diagrams/examples/review/head.atlas.json"]);
    assert(files["app/package.json"]);
    assert(files["app/src/App.tsx"]);
    assert(files["packages/planning/src/planning.ts"]);
    assert(files["packages/planning/src/check.ts"]);
    assert(files["packages/cli/package.json"]);
    assert(files["packages/cli/bin/atlas.js"]);
    assert(
      !Object.keys(files).some((name) =>
        /(?:^|\/)(?:check_planning|log_consultation)\.py$/.test(name),
      ),
      "Atlas ships no Python helpers",
    );
    assert(files["app/assets/atlas-dashboard.jpg"]);
    assert(
      !Object.keys(files).some((name) => /work[t]rail/i.test(name)),
      "Release files use Atlas names only",
    );
    assert(
      !Object.keys(files).some((name) => name.startsWith("app/vendor/")),
      "The app uses the workspace diagram package",
    );
    assert(files["skills/atlas-model/SKILL.md"]);
    assert(files["assets/atlas-banner-dark.svg"]);
    assert(files["docs/history/skills-commit-map.txt"]);
    assert(files["docs/history/atlas-import-commit-map.txt"]);
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
      "Passed: versioned nonpublishing Atlas release, repeatable archive, hashes, packed diagram package, app, planning reader, atlas command, skills, branding/docs/schemas and reopenable report; no local model data.",
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
