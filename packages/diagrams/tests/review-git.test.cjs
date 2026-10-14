const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { execFileSync } = require("node:child_process"),
  { pathToFileURL } = require("node:url");
const { loadRevision } = require("../lib/review/review.cjs"),
  { createDocument } = require("../lib/index.cjs");
test("Review never lazy-fetches missing blobs from a partial clone", (t) => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-promisor-")),
    source = path.join(stage, "source"),
    clone = path.join(stage, "partial");
  t.after(() => fs.rmSync(stage, { recursive: true, force: true }));
  fs.mkdirSync(source);
  const git = (root, ...args) =>
    execFileSync("git", ["-C", root, ...args], {
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git(source, "init", "-q");
  git(source, "config", "user.name", "Atlas");
  git(source, "config", "user.email", "atlas@example.invalid");
  git(source, "config", "uploadpack.allowFilter", "true");
  fs.writeFileSync(
    path.join(source, "model.json"),
    JSON.stringify(
      createDocument({
        profile: "code",
        model: {
          type: "StructuralModel",
          nodes: [{ id: "a", name: "A", attributes: [] }],
          relations: [],
          generalizations: [],
          generalizationSets: [],
        },
      }),
    ),
  );
  git(source, "add", ".");
  git(source, "commit", "-qm", "Captured");
  execFileSync(
    "git",
    [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      pathToFileURL(source).href,
      clone,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const packs = path.join(clone, ".git/objects/pack"),
    before = fs.readdirSync(packs).sort();
  assert.throws(() =>
    loadRevision({ repository: clone, ref: "HEAD", path: "model.json" }),
  );
  assert.deepEqual(fs.readdirSync(packs).sort(), before);
});
