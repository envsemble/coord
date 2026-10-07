const { validateProject } = require("./validation/validateProject.cjs");
const { validateEvidence } = require("./validation/validateEvidence.cjs");
function validateModel(project, evidence = {}) {
  const report = validateProject(project);
  report.issues.push(...validateEvidence(project, evidence));
  report.valid = !report.issues.some((i) => i.severity === "error");
  report.counts = Object.fromEntries(
    ["error", "warning", "info"].map((severity) => [
      severity,
      report.issues.filter((i) => i.severity === severity).length,
    ]),
  );
  return report;
}
const { Project, serializationUtils } = require("ontouml-js");
const { toViewerModel, mergeProjects } = require("./model/project.cjs");
module.exports = {
  validateModel,
  validateProject,
  validateEvidence,
  Project,
  serializationUtils,
  toViewerModel,
  mergeProjects,
  // Validation consumers need neither the layout engine nor a React compiler.
  prepareViewer: (...args) =>
    require("./build/buildViewer.cjs").prepareViewer(...args),
  buildViewer: (...args) =>
    require("./build/buildViewer.cjs").buildViewer(...args),
  writeViewer: (...args) =>
    require("./build/buildViewer.cjs").writeViewer(...args),
  createModelingJob: (...args) =>
    require("./agent/modelingJob.cjs").createModelingJob(...args),
  buildModelingJob: (...args) =>
    require("./agent/modelingJob.cjs").buildModelingJob(...args),
  createDocument: (...args) =>
    require("./document/document.cjs").createDocument(...args),
  reviseDocument: (...args) =>
    require("./document/document.cjs").reviseDocument(...args),
  validateDocument: (...args) =>
    require("./document/document.cjs").validateDocument(...args),
  createSnapshot: (...args) =>
    require("./document/document.cjs").createSnapshot(...args),
  documentViewerModel: (...args) =>
    require("./document/document.cjs").documentViewerModel(...args),
};
