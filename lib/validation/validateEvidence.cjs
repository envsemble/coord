const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(require("../../schemas/evidence-schema.json"));
function validateEvidence(project, evidence = {}) {
  const issues = [];
  const add = (elementId, message, path) =>
    issues.push({
      code: "EVIDENCE",
      severity: "error",
      layer: "evidence",
      elementId,
      message,
      ...(path ? { path } : {}),
    });
  if (!validate(evidence)) {
    for (const error of validate.errors)
      add(
        null,
        `${error.instancePath || "/"} ${error.message}`,
        error.instancePath,
      );
    return issues;
  }
  const ids = new Set(
    (Array.isArray(project?.elements) ? project.elements : []).map((e) => e.id),
  );
  const sources = new Set();
  for (const source of evidence.sources || []) {
    if (sources.has(source.id)) add(null, `Duplicate source ${source.id}.`);
    sources.add(source.id);
    if (source.url?.startsWith("https://github.com/") && source.commit) {
      const expected = `https://github.com/${source.repo}/blob/${source.commit}/${source.file}#L${source.line}`;
      if (!/^[a-f0-9]{40}$/.test(source.commit) || source.url !== expected)
        add(
          null,
          `Source ${source.id} is not a consistent commit-pinned GitHub reference.`,
        );
    }
  }
  for (const [id, record] of Object.entries(evidence.elements || {})) {
    if (!ids.has(id))
      add(id, `Evidence refers to missing model element ${id}.`);
    for (const source of record.evidence || [])
      if (!sources.has(source)) add(id, `Unknown source ${source}.`);
    if (
      record.primarySource &&
      !(record.evidence || []).includes(record.primarySource)
    )
      add(id, "The primary source must be among this element's evidence.");
  }
  return issues;
}
module.exports = { validateEvidence };
