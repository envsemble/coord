// The diagram files of one work folder in the viewer. Each file is described
// cheaply (its kind, role, problems and family); preparing lays out the
// diagrams asked for, a family at once, so a capture, its proposals and a
// later capture compared with it keep their classes in the same places.
const { createHash } = require("node:crypto");
const path = require("node:path").posix;
const { checkDiagram, parseDiagram } = require("./diagram.cjs");
const { convert, scenarioOf } = require("./model.cjs");

const slash = (file) => file.replace(/\\/g, "/");
const normalize = (file) => path.normalize(slash(file)).replace(/^\.\//, "");
/** A reference written in a diagram, as a path among the folder's files. */
const resolveReference = (from, reference) =>
  normalize(path.join(path.dirname(normalize(from)), slash(reference)));

function describe(file, diagram, problems, baseline) {
  const role = diagram?.capture
    ? "capture"
    : diagram?.proposal
      ? "proposal"
      : diagram?.scenario
        ? "scenario"
        : "diagram";
  return {
    path: file,
    title: diagram?.title || path.basename(file).replace(/\.[^.]*$/, ""),
    kind: diagram?.kind || null,
    role,
    profile: null,
    baseline,
    family: null,
    capture: diagram?.capture || null,
    scenario: diagram?.scenario
      ? {
          of: resolveReference(file, diagram.scenario.of),
          expected: diagram.scenario.expected,
        }
      : null,
    problems,
    valid: !!diagram && !problems.some((p) => p.severity === "error"),
  };
}

/**
 * Describes a work folder's diagram files: each one's kind, role (diagram,
 * capture, proposal or scenario), problems, the baseline it compares with and
 * the family it is laid out with. `files` holds every diagram of the folder by
 * its path; references resolve among them.
 */
function describeDiagrams(files) {
  const texts = new Map(files.map((f) => [normalize(f.path), f.text]));
  const parsed = new Map();
  const summaries = new Map();
  for (const [file, text] of texts) {
    const read = (reference) =>
      texts.get(resolveReference(file, reference)) ?? null;
    const problems = checkDiagram(text, { path: file, read });
    const { diagram } = parseDiagram(text);
    parsed.set(file, diagram);
    const reference = diagram?.proposal || diagram?.compares;
    const baseline = reference ? resolveReference(file, reference) : null;
    summaries.set(file, describe(file, diagram, problems, baseline));
  }
  // A drawable member's baseline is drawable too: a reference to a file with
  // problems is a problem of the member's own.
  const baselineOf = (summary) =>
    summary.valid && summary.baseline && summaries.get(summary.baseline)?.valid
      ? summaries.get(summary.baseline)
      : null;
  const rootOf = (summary) => {
    const seen = new Set();
    let at = summary;
    while (baselineOf(at) && !seen.has(at.path)) {
      seen.add(at.path);
      at = baselineOf(at);
    }
    return at;
  };
  for (const summary of summaries.values()) {
    const kind = summary.kind;
    const root = rootOf(summary);
    summary.profile =
      kind === "entity"
        ? "database"
        : kind === "object"
          ? "object"
          : root.capture
            ? "code"
            : "class";
  }
  const families = new Map();
  for (const summary of summaries.values())
    if (baselineOf(summary)) {
      const root = rootOf(summary).path;
      families.set(root, [...(families.get(root) || [root]), summary.path]);
    }
  for (const [root, members] of families)
    for (const member of members) summaries.get(member).family = root;
  return { summaries: [...summaries.values()], parsed, texts, baselineOf };
}

const reportOf = (problems) => {
  const issues = problems.map((p) => ({
    code: p.code,
    severity: p.severity,
    layer: "diagram",
    elementId: null,
    message: `Line ${p.line}: ${p.message}`,
  }));
  return {
    valid: !issues.some((i) => i.severity === "error"),
    schema: "atlas/plantuml",
    engines: [
      { name: "Atlas PlantUML subset", version: "1", layer: "diagram" },
    ],
    issues,
    counts: Object.fromEntries(
      ["error", "warning", "info"].map((s) => [
        s,
        issues.filter((i) => i.severity === s).length,
      ]),
    ),
    limitations: [
      "Checks cover Atlas's PlantUML subset and its model rules; they do not establish that the model is accurate.",
    ],
  };
};
// What a comparison compares: the model without its evidence and places.
// A description stays, so a changed one is a change of its element.
const strip = ({
  evidence,
  primarySource,
  status,
  description,
  location,
  ...rest
}) => (description ? { ...rest, description } : rest);
const semanticOf = (model) => ({
  type: "StructuralModel",
  nodes: model.classes.map((c) => ({
    ...strip(c),
    attributes: c.attributes.map(strip),
    ...(c.methods ? { methods: c.methods.map(strip) } : {}),
  })),
  relations: model.relations.map(strip),
  generalizations: model.generalizations.map(strip),
});
const snapshotOf = (summary) =>
  summary.capture
    ? { id: summary.path, profile: summary.profile, capture: summary.capture }
    : null;

/**
 * Prepares a work folder's diagrams for the viewer: `paths` (by default every
 * diagram without errors), each with the rest of its family, laid out together.
 * A class diagram shows the scenarios that exemplify it; a proposal and a
 * capture that compares with an earlier one show their changes. Returns the
 * description of every file and the prepared viewer of each diagram laid out.
 */
async function prepareDiagrams({
  files,
  paths,
  slug = "model",
  includeArtifacts = false,
} = {}) {
  if (!Array.isArray(files))
    throw new Error("DIAGRAMS_INPUT: provide the work folder's diagram files");
  const { summaries, parsed, texts, baselineOf } = describeDiagrams(files);
  const byPath = new Map(summaries.map((s) => [s.path, s]));
  const wanted = (paths ? paths.map(normalize) : summaries.map((s) => s.path))
    .map((p) => byPath.get(p))
    .filter((s) => s?.valid);
  // Scenarios by the class diagram they exemplify.
  const scenarios = new Map();
  for (const summary of summaries)
    if (
      summary.valid &&
      summary.scenario &&
      byPath.get(summary.scenario.of)?.valid
    ) {
      const { scenario } = scenarioOf(
        parsed.get(summary.path),
        parsed.get(summary.scenario.of),
        { path: summary.path, of: summary.scenario.of },
      );
      scenarios.set(summary.scenario.of, [
        ...(scenarios.get(summary.scenario.of) || []),
        scenario,
      ]);
    }
  const entries = new Map();
  const entryOf = (summary) => {
    if (entries.has(summary.path)) return entries.get(summary.path);
    const text = texts.get(summary.path);
    const { model } = convert(parsed.get(summary.path), {
      id: summary.path,
      title: summary.title,
    });
    const baselineSummary = baselineOf(summary);
    const own = snapshotOf(summary);
    const compared = baselineSummary && snapshotOf(baselineSummary);
    model.validation = reportOf(summary.problems);
    model.document = {
      id: summary.path,
      path: summary.path,
      profile: summary.profile,
      state: summary.capture
        ? "snapshot"
        : summary.role === "proposal"
          ? "proposal"
          : "authored",
      revision: {
        id: createHash("sha256").update(text).digest("hex").slice(0, 16),
        parentId: null,
        createdAt: summary.capture?.capturedAt || "",
        reason: "",
      },
      baselineId: baselineSummary ? baselineSummary.path : own ? own.id : null,
      ...(own ? { captureId: own.id } : {}),
      snapshots: [own, compared].filter(Boolean),
      comparison: null,
    };
    const { assessScenario } = require("../scenarios/assess.cjs");
    const exemplified = scenarios.get(summary.path) || [];
    const entry = {
      key: summary.path,
      revision: model.document.revision.id,
      model,
      semantic: semanticOf(model),
      views: [],
      scenarios: exemplified.length
        ? {
            scenarios: exemplified.map((scenario) => ({
              ...scenario,
              result: assessScenario(model, scenario),
            })),
          }
        : null,
      source: { suffix: ".puml", text },
      baseline: null,
    };
    entries.set(summary.path, entry);
    if (baselineSummary) entry.baseline = entryOf(baselineSummary);
    return entry;
  };
  const prepared = new Map();
  const { prepareEntry } = require("../payload/buildViewer.cjs");
  const { prepareEntries } = require("../payload/prepareComparison.cjs");
  for (const summary of wanted) {
    if (prepared.has(summary.path)) continue;
    if (summary.family) {
      const members = summaries.filter((s) => s.family === summary.family);
      const family = await prepareEntries({
        entries: members.map(entryOf),
        key: summary.family,
        slug,
        includeArtifacts,
      });
      members.forEach((member, i) =>
        prepared.set(member.path, family.members[i]),
      );
    } else
      prepared.set(
        summary.path,
        await prepareEntry(entryOf(summary), { slug, includeArtifacts }),
      );
  }
  return { diagrams: summaries, prepared };
}

module.exports = { describeDiagrams, prepareDiagrams, resolveReference };
