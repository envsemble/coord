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
  prepareFamily: (...args) =>
    require("./build/prepareComparison.cjs").prepareFamily(...args),
  familyKey: (...args) =>
    require("./build/prepareComparison.cjs").familyKey(...args),
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
  relocateDocument: (...args) =>
    require("./document/document.cjs").relocateDocument(...args),
  validateDocument: (...args) =>
    require("./document/document.cjs").validateDocument(...args),
  createSnapshot: (...args) =>
    require("./document/document.cjs").createSnapshot(...args),
  documentViewerModel: (...args) =>
    require("./document/document.cjs").documentViewerModel(...args),
  importDocument: (...args) =>
    require("./document/portable.cjs").importDocument(...args),
  captureSQLite: (...args) =>
    require("./capture/database.cjs").captureSQLite(...args),
  captureD1: (...args) => require("./capture/database.cjs").captureD1(...args),
  capturePostgres: (...args) =>
    require("./capture/postgres.cjs").capturePostgres(...args),
  createWorkspace: (root) =>
    new (require("./agent/service.cjs").AtlasWorkspace)(root),
  captureTypeScript: (...args) =>
    require("./capture/code.cjs").captureTypeScript(...args),
  captureJava: (...args) => require("./capture/code.cjs").captureJava(...args),
  compareModels: (...args) =>
    require("./document/comparison.cjs").compareModels(...args),
  compareDocuments: (...args) =>
    require("./document/comparison.cjs").compareDocuments(...args),
  createProposal: (...args) =>
    require("./document/comparison.cjs").createProposal(...args),
  mergeDocuments: (...args) =>
    require("./document/comparison.cjs").mergeDocuments(...args),
  resolveMerge: (...args) =>
    require("./document/comparison.cjs").resolveMerge(...args),
  adoptSnapshot: (...args) =>
    require("./document/comparison.cjs").adoptSnapshot(...args),
};
module.exports.linkMapping = (...args) =>
  require("./document/comparison.cjs").linkMapping(...args);
module.exports.checkScenario = (...args) =>
  require("./learning/scenarios.cjs").checkScenario(...args);
module.exports.explainModel = (...args) =>
  require("./learning/scenarios.cjs").explainModel(...args);
module.exports.reviewDocuments = (...args) =>
  require("./review/review.cjs").reviewDocuments(...args);
module.exports.buildReview = (...args) =>
  require("./review/review.cjs").buildReview(...args);
module.exports.writeReview = (...args) =>
  require("./review/review.cjs").writeReview(...args);
Object.defineProperty(module.exports, "toolDefinitions", {
  enumerable: true,
  get: () => require("./agent/service.cjs").toolDefinitions,
});
