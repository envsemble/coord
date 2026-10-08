const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { unzipSync } = require("fflate"),
  { assemble } = require("./release.cjs"),
  { hash } = require("../lib/review/review.cjs");
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
      first.archive,
      second.archive,
      "Release assembly is not reproducible at the same commit",
    );
    const files = unzipSync(first.archive);
    for (const file of first.manifest.files)
      assert.equal(hash(files[file.name]), file.sha256, file.name);
    assert.equal(
      require("../lib/index.cjs").importDocument(files["enrollment.html"])
        .learning.scenarios.length,
      4,
    );
    assert(files["assets/atlas-icon.svg"]);
    assert(files["CHANGELOG.md"]);
    assert(files["schemas/document-schema.json"]);
    console.log(
      "Passed: versioned nonpublishing release, repeatable archive, hashes, branding/docs/schemas and reopenable report.",
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
