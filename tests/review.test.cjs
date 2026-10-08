const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { execFileSync, spawnSync } = require("node:child_process");
const atlas = require("../lib/index.cjs"),
  { createEnrollmentDocument } = require("../examples/enrollment/learning.cjs"),
  { hash } = require("../lib/review/review.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-review-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
  git("init", "-q");
  git("config", "user.name", "Atlas fixture");
  git("config", "user.email", "atlas@example.invalid");
  return { root, git };
}
test("Explicit Git model revisions produce reproducible labelled review artifacts and reopenable HTML", async (t) => {
  const { root, git } = fixture(t),
    base = createEnrollmentDocument();
  fs.writeFileSync(path.join(root, "model.json"), JSON.stringify(base));
  git("add", ".");
  git("commit", "-qm", "Base");
  const baseRef = git("rev-parse", "HEAD").trim(),
    model = structuredClone(base.model);
  model.elements.find((e) => e.id === "active").name = "In progress";
  const head = atlas.reviseDocument(base, { model });
  fs.writeFileSync(path.join(root, "model.json"), JSON.stringify(head));
  git("add", ".");
  git("commit", "-qm", "Proposal");
  const headRef = git("rev-parse", "HEAD").trim();
  git("replace", baseRef, headRef);
  const options = {
    base: { repository: root, ref: baseRef, path: "model.json" },
    head: { repository: root, ref: headRef, path: "model.json" },
  };
  const first = await atlas.buildReview(options),
    second = await atlas.buildReview(options);
  assert.deepEqual(first.files, second.files);
  assert.equal(first.report.base.commit, baseRef);
  assert.deepEqual(
    JSON.parse(first.files.get("base.atlas.json")).model.elements.find(
      (e) => e.id === "active",
    ).name,
    base.model.elements.find((e) => e.id === "active").name,
  );
  assert.equal(first.report.head.commit, headRef);
  assert.equal(first.report.changes.counts.modified, 1);
  assert(first.files.get("summary.md").includes("In progress"));
  const reopened = atlas.importDocument(first.files.get("index.html"));
  assert.deepEqual(reopened.model, head.model);
  assert.deepEqual(reopened.learning, head.learning);
  for (const file of JSON.parse(first.files.get("manifest.json")).files)
    assert.equal(hash(first.files.get(file.name)), file.sha256);
  await assert.rejects(
    atlas.buildReview({
      ...options,
      head: { ...options.head, ref: "missing" },
    }),
    /REVIEW_REVISION/,
  );
  await assert.rejects(
    atlas.buildReview({
      ...options,
      head: { ...options.head, path: "../model.json" },
    }),
    /REVIEW_PATH/,
  );
});
test("Evidence review detects changed, missing and stale pins without changing conceptual content", async (t) => {
  const { root, git } = fixture(t);
  fs.writeFileSync(path.join(root, "class.ts"), "export class Student {}\n");
  fs.writeFileSync(path.join(root, "gone.ts"), "old\n");
  git("add", ".");
  git("commit", "-qm", "Captured");
  const captured = git("rev-parse", "HEAD").trim();
  const document = createEnrollmentDocument();
  const withEvidence = atlas.reviseDocument(document, {
    evidence: {
      sources: [
        {
          id: "code",
          repo: "fixture",
          file: "class.ts",
          commit: captured,
          title: "Student",
          claim: "Declaration",
        },
        {
          id: "gone",
          repo: "fixture",
          file: "gone.ts",
          commit: captured,
          title: "Old",
          claim: "Declaration",
        },
        {
          id: "uncovered",
          repo: "another",
          file: "remote.ts",
          title: "External",
          claim: "Unverified",
        },
      ],
      elements: {},
    },
  });
  fs.writeFileSync(
    path.join(root, "class.ts"),
    "export class Student { name: string }\n",
  );
  fs.unlinkSync(path.join(root, "gone.ts"));
  git("add", ".");
  git("commit", "-qm", "Changed source");
  const changed = git("rev-parse", "HEAD").trim();
  const original = JSON.stringify(withEvidence),
    mapped = [
      {
        identity: "fixture",
        repository: root,
        baseRef: captured,
        headRef: changed,
      },
    ];
  const review = atlas.reviewDocuments(withEvidence, withEvidence, {
    sources: mapped,
  });
  assert.equal(review.exitCode, 1);
  assert.deepEqual(
    review.evidence.checks.map((c) => c.status),
    ["changed", "missing", "unassessed"],
  );
  const stale = atlas.reviewDocuments(withEvidence, withEvidence, {
    sources: [{ ...mapped[0], baseRef: changed }],
  });
  assert.equal(stale.evidence.checks[0].status, "stale");
  assert.equal(JSON.stringify(withEvidence), original);
});
test("Review CLI distinguishes malformed input from valid ontology/scenario findings", async (t) => {
  const { root } = fixture(t),
    base = createEnrollmentDocument(),
    input = path.join(root, "request.json"),
    file = path.join(root, "model.json");
  fs.writeFileSync(file, JSON.stringify(base));
  const options = {
    base: { file },
    head: { file },
    outputDirectory: path.join(root, "passing"),
  };
  fs.writeFileSync(input, JSON.stringify(options));
  const run = () =>
    spawnSync(process.execPath, ["bin/atlas.cjs", "review", "--input", input], {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      windowsHide: true,
    });
  assert.equal(run().status, 0);
  const changed = atlas.reviseDocument(base, {
    learning: {
      ...base.learning,
      scenarios: base.learning.scenarios.map((s) => ({
        ...s,
        expected: "valid",
      })),
    },
  });
  fs.writeFileSync(file, JSON.stringify(changed));
  options.outputDirectory = path.join(root, "findings");
  fs.writeFileSync(input, JSON.stringify(options));
  const findings = run();
  assert.equal(findings.status, 1, findings.stderr);
  assert(fs.existsSync(path.join(options.outputDirectory, "index.html")));
  fs.writeFileSync(file, "{malformed");
  assert.equal(run().status, 2);
});
test("Source capture → proposal → review → portable export remains usable without the source", async (t) => {
  const { root, git } = fixture(t);
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    '{"compilerOptions":{"noLib":true},"files":["model.ts"]}',
  );
  fs.writeFileSync(
    path.join(root, "model.ts"),
    "export class Registration { studentId: string; }\n",
  );
  git("add", ".");
  git("commit", "-qm", "Source");
  const captured = await atlas.captureTypeScript({
    identity: "sample",
    projects: [{ identity: "sample", path: root }],
  });
  const proposal = atlas.createProposal(captured),
    model = structuredClone(proposal.model);
  model.nodes[0].name = "Enrollment";
  const head = atlas.reviseDocument(proposal, { model }),
    review = atlas.reviewDocuments(captured, head);
  assert(review.changes.changes.some((c) => c.name === "Enrollment"));
  const html = (await atlas.buildViewer({ document: head })).html;
  fs.unlinkSync(path.join(root, "model.ts"));
  const reopened = atlas.importDocument(html);
  assert.equal(reopened.model.nodes[0].name, "Enrollment");
  assert.deepEqual(reopened.snapshots, head.snapshots);
  assert.equal(
    Object.values(reopened.snippets)[0].code,
    Object.values(captured.snippets)[0].code,
  );
});
