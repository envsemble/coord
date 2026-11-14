// Shared by the code capture tests: projects in temporary folders, and what a
// capture reads as.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const { checkDiagram, parseDiagram } = require("../lib/index.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coord-code-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function tsProject(root, source) {
  fs.writeFileSync(path.join(root, "model.ts"), source);
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", skipLibCheck: true },
      files: ["model.ts"],
    }),
  );
  return { identity: "fixture", path: root };
}
// A capture is a valid diagram with no problems; returns what it reads as.
function read(text) {
  assert.deepEqual(checkDiagram(text), [], text);
  const { diagram } = parseDiagram(text);
  assert(diagram.capture && diagram.fingerprint);
  return diagram;
}
const element = (diagram, id) => diagram.elements.find((e) => e.id === id);
const related = (diagram, kind, source, target) =>
  diagram.relations.some(
    (r) => r.kind === kind && r.source === source && r.target === target,
  );
// Two captures of one source differ only in their date and fingerprint.
const undated = (text) =>
  text
    .replace(/"capturedAt":"[^"]*"/, "")
    .replace(/' coord fingerprint \w+/, "");
const commit = (root) => {
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init");
  git("add", ".");
  git(
    "-c",
    "user.name=Coord fixture",
    "-c",
    "user.email=coord@example.test",
    "commit",
    "-m",
    "fixture",
  );
  git("remote", "add", "origin", "https://github.com/example/fixture.git");
  return git;
};
module.exports = {
  fixture,
  tsProject,
  read,
  element,
  related,
  undated,
  commit,
};
