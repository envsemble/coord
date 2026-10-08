const fs = require("node:fs"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  assertDocument,
  validateDocument,
} = require("../document/document.cjs");
const { compareDocuments } = require("../document/comparison.cjs");
const { checkScenario } = require("../learning/scenarios.cjs");
const LIMIT = 32 * 1024 * 1024;
const hash = (data) => createHash("sha256").update(data).digest("hex");
function git(repository, args, maxBuffer = LIMIT) {
  return execFileSync(
    "git",
    ["--no-replace-objects", "-C", repository, ...args],
    {
      windowsHide: true,
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
      timeout: 15000,
      maxBuffer,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}
function commit(repository, ref) {
  if (
    typeof ref !== "string" ||
    !ref ||
    ref.length > 300 ||
    /[\0\r\n]/.test(ref)
  )
    throw new Error("REVIEW_REVISION: specify an explicit Git revision");
  try {
    return git(
      repository,
      ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
      4096,
    )
      .toString()
      .trim();
  } catch {
    throw new Error(
      "REVIEW_REVISION: Git commit is unavailable; fetch the explicit base/head first",
    );
  }
}
function safePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2000 ||
    /[\0\r\n\\]/.test(value) ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").some((s) => !s || [".", "..", ".git"].includes(s))
  )
    throw new Error("REVIEW_PATH: use a repository-relative file path");
  return value;
}
function blob(repository, revision, file) {
  safePath(file);
  // Resolve a regular blob explicitly; do not follow Git symlinks or execute files.
  let info;
  try {
    info = git(
      repository,
      ["ls-tree", "-z", revision, "--", file],
      8192,
    ).toString();
  } catch {
    throw new Error("REVIEW_SOURCE: cannot inspect Git tree");
  }
  if (!info) return null;
  const match = /^(100644|100755) blob ([a-f0-9]+)\t([^\0]+)\0$/.exec(info);
  if (!match || match[3] !== file)
    throw new Error("REVIEW_SOURCE: source must be a regular Git file");
  const size = Number(
    git(repository, ["cat-file", "-s", match[2]], 4096).toString(),
  );
  if (!Number.isFinite(size) || size > LIMIT)
    throw new Error("REVIEW_LIMIT: source exceeds 32 MiB");
  return git(repository, ["cat-file", "blob", match[2]]);
}
function loadRevision(input) {
  if (!input || typeof input !== "object")
    throw new Error("REVIEW_INPUT: specify base and head");
  let data, source;
  if (input.file && !input.repository && !input.ref && !input.path) {
    if (fs.statSync(input.file).size > LIMIT)
      throw new Error("REVIEW_LIMIT: document exceeds 32 MiB");
    data = fs.readFileSync(input.file);
    source = { kind: "document", contentHash: hash(data) };
  } else if (input.repository && input.ref && input.path && !input.file) {
    const revision = commit(input.repository, input.ref);
    data = blob(input.repository, revision, input.path);
    if (!data)
      throw new Error(
        "REVIEW_INPUT: document is missing at the selected commit",
      );
    source = {
      kind: "git",
      commit: revision,
      path: input.path,
      contentHash: hash(data),
    };
  } else
    throw new Error(
      "REVIEW_INPUT: choose a document file or repository/ref/path",
    );
  if (data.length > LIMIT)
    throw new Error("REVIEW_LIMIT: document exceeds 32 MiB");
  let document;
  try {
    document = JSON.parse(data.toString("utf8"));
  } catch {
    throw new Error("REVIEW_INPUT: expected Atlas document JSON");
  }
  assertDocument(document);
  return {
    document,
    source: {
      ...source,
      documentId: document.id,
      revision: document.revision.id,
    },
  };
}
function evidenceReview(document, sources = []) {
  if (
    !Array.isArray(sources) ||
    sources.length > 8 ||
    new Set(sources.map((s) => s.identity)).size !== sources.length
  )
    throw new Error(
      "REVIEW_SCOPE: select up to eight distinct repository identities",
    );
  const configured = new Map(
    sources.map((s) => {
      if (typeof s.identity !== "string" || !s.identity || !s.repository)
        throw new Error(
          "REVIEW_SCOPE: repository identity and path are required",
        );
      return [
        s.identity,
        {
          ...s,
          base: commit(s.repository, s.baseRef),
          head: commit(s.repository, s.headRef),
        },
      ];
    }),
  );
  const evidence = document.evidence.sources || [];
  if (evidence.length > 2000)
    throw new Error("REVIEW_LIMIT: at most 2000 evidence references");
  const cache = new Map();
  let bytes = 0;
  const read = (source, revision, file) => {
    const key = JSON.stringify([source.identity, revision, file]);
    if (!cache.has(key)) {
      const data = blob(source.repository, revision, file);
      bytes += data?.length || 0;
      if (bytes > 64 * 1024 * 1024)
        throw new Error("REVIEW_LIMIT: inspected evidence exceeds 64 MiB");
      cache.set(key, data === null ? null : hash(data));
    }
    return cache.get(key);
  };
  const checks = evidence.map((e) => {
    const source = configured.get(e.repo);
    if (!source)
      return {
        id: e.id,
        repo: e.repo || null,
        file: e.file,
        status: "unassessed",
        reason: "No explicit base/head source repository mapping.",
      };
    safePath(e.file);
    const before = read(source, source.base, e.file),
      after = read(source, source.head, e.file);
    let captured = null;
    if (e.commit) {
      try {
        captured = read(source, commit(source.repository, e.commit), e.file);
      } catch (error) {
        if (!error.message.startsWith("REVIEW_REVISION:")) throw error;
      }
    }
    const status =
      after === null
        ? "missing"
        : before !== after
          ? "changed"
          : e.commit && captured === null
            ? "unassessed"
            : captured && captured !== after
              ? "stale"
              : "unchanged";
    return {
      id: e.id,
      repo: e.repo,
      file: e.file,
      status,
      baseCommit: source.base,
      headCommit: source.head,
      baseHash: before,
      headHash: after,
      capturedHash: captured,
      reason: !e.commit
        ? "Compared declared file only; no retained commit pin to verify capture contents."
        : captured === null
          ? "Retained capture commit is unavailable."
          : "Compared regular Git file bytes against the retained commit pin.",
    };
  });
  return {
    checks,
    counts: Object.fromEntries(
      ["unchanged", "changed", "missing", "stale", "unassessed"].map((s) => [
        s,
        checks.filter((c) => c.status === s).length,
      ]),
    ),
    sources: [...configured.values()].map((s) => ({
      identity: s.identity,
      baseCommit: s.base,
      headCommit: s.head,
    })),
    limitations: [
      "Checks cover declared evidence files in explicitly mapped repositories, not arbitrary dependencies, database state or semantic implementation equivalence.",
      "Changed/stale evidence needs human or agent reassessment. The conceptual model is never updated automatically.",
    ],
  };
}
function reviewDocuments(base, head, options = {}) {
  assertDocument(base);
  assertDocument(head);
  const validation = validateDocument(head),
    changes = compareDocuments(base, head),
    scenarios = (head.learning?.scenarios || []).map((s) =>
      checkScenario(head, s.id),
    ),
    evidence = evidenceReview(head, options.sources),
    conflicts = head.comparison?.conflicts?.length || 0;
  const findings =
    validation.counts.error > 0 ||
    conflicts > 0 ||
    scenarios.some((s) => s.expectationMet === false) ||
    evidence.checks.some((c) =>
      ["changed", "stale", "missing"].includes(c.status),
    );
  return {
    format: "atlas/review",
    formatVersion: 1,
    base: { documentId: base.id, revision: base.revision.id },
    head: { documentId: head.id, revision: head.revision.id },
    outcome: findings ? "findings" : "pass",
    exitCode: findings ? 1 : 0,
    changes,
    validation,
    scenarios,
    unresolvedConflicts: conflicts,
    evidence,
    limitations: [
      "A passing review means no blocking findings within the reported coverage; unassessed evidence and rule limits remain visible.",
      ...validation.limitations,
    ],
  };
}
const md = (v) =>
  String(v ?? "")
    .replace(/[\\`*_[\]<>|]/g, "\\$&")
    .replace(/[\r\n]+/g, " ");
function summary(report) {
  return (
    `# Atlas model review\n\n${report.outcome} · base ${md(report.base.revision)} · head ${md(report.head.revision)}\n\n` +
    `## Semantic changes\n\n${report.changes.counts.added} added · ${report.changes.counts.removed} removed · ${report.changes.counts.modified} modified\n\n` +
    report.changes.changes
      .map(
        (c) =>
          `- ${c.kind}: ${md(c.name)} (${md(c.elementId || "model")})${c.rationale.length ? " — " + c.rationale.map((r) => md(r.title || r.text)).join(", ") : " — rationale not linked"}`,
      )
      .join("\n") +
    `\n\n## Validation and scenarios\n\n${report.validation.counts.error} errors · ${report.validation.counts.warning} warnings · ${report.unresolvedConflicts} unresolved merge choices\n\n` +
    report.validation.issues
      .map((i) => `- ${md(i.severity)} ${md(i.code)}: ${md(i.message)}`)
      .join("\n") +
    "\n" +
    report.scenarios
      .map(
        (s) =>
          `- ${md(s.id)}: ${s.outcome}; expectation ${s.expectationMet === null ? "unassessed" : s.expectationMet ? "met" : "not met"}`,
      )
      .join("\n") +
    "\n\n## Source evidence\n\n" +
    report.evidence.checks
      .map(
        (c) => `- ${c.status}: ${md(c.repo)}/${md(c.file)} — ${md(c.reason)}`,
      )
      .join("\n") +
    "\n\n## Coverage limits\n\n" +
    [...report.limitations, ...report.evidence.limitations]
      .map((l) => `- ${md(l)}`)
      .join("\n") +
    "\n"
  );
}
async function buildReview({ base, head, sources = [] }) {
  const before = loadRevision(base),
    after = loadRevision(head),
    report = reviewDocuments(before.document, after.document, { sources });
  report.base = before.source;
  report.head = after.source;
  const built = await require("../build/buildViewer.cjs").buildViewer({
    document: after.document,
    slug: "review",
  });
  const files = new Map([
    ["review.json", JSON.stringify(report, null, 2) + "\n"],
    ["summary.md", summary(report)],
    ["index.html", built.html],
    ["base.atlas.json", JSON.stringify(before.document, null, 2) + "\n"],
    ["head.atlas.json", JSON.stringify(after.document, null, 2) + "\n"],
    ...[...built.artifacts].map(([name, content]) => [
      "downloads/" + name,
      content,
    ]),
  ]);
  const manifest = {
    format: "atlas/artifacts",
    formatVersion: 1,
    base: report.base,
    head: report.head,
    files: [...files].map(([name, data]) => ({
      name,
      sha256: hash(data),
      bytes: Buffer.byteLength(data),
    })),
  };
  files.set("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  return { report, files };
}
async function writeReview(options) {
  const built = await buildReview(options),
    output = path.resolve(options.outputDirectory);
  if (fs.existsSync(output) && fs.readdirSync(output).length)
    throw new Error("REVIEW_OUTPUT: choose a new or empty output directory");
  fs.mkdirSync(output, { recursive: true });
  for (const [name, data] of built.files) {
    const file = path.join(output, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
  return {
    exitCode: built.report.exitCode,
    outcome: built.report.outcome,
    base: built.report.base,
    head: built.report.head,
    outputDirectory: output,
    files: [...built.files.keys()],
  };
}
module.exports = {
  loadRevision,
  evidenceReview,
  reviewDocuments,
  buildReview,
  writeReview,
  hash,
};
