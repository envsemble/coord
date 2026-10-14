const diagram = () => require("./plantuml/diagram.cjs");
const document = () => require("./document/document.cjs");
const comparison = () => require("./document/comparison.cjs");
// Modules load on first use: checking a diagram needs neither the layout
// engine nor a React compiler.
module.exports = {
  // Diagram files: Atlas's PlantUML subset.
  parseDiagram: (...args) => diagram().parseDiagram(...args),
  checkDiagram: (...args) => diagram().checkDiagram(...args),
  formatDiagram: (...args) => diagram().formatDiagram(...args),
  diagramFingerprint: (...args) => diagram().diagramFingerprint(...args),
  diagramViewerModel: (...args) =>
    require("./plantuml/model.cjs").diagramViewerModel(...args),
  describeDiagrams: (...args) => {
    const { summaries } = require("./plantuml/prepare.cjs").describeDiagrams(
      ...args,
    );
    return summaries;
  },
  prepareDiagrams: (...args) =>
    require("./plantuml/prepare.cjs").prepareDiagrams(...args),
  resolveReference: (...args) =>
    require("./plantuml/prepare.cjs").resolveReference(...args),
  buildViewer: (...args) =>
    require("./build/buildViewer.cjs").buildViewer(...args),
  writeViewer: (...args) =>
    require("./build/buildViewer.cjs").writeViewer(...args),
  // Legacy documents, which captures and the model tools still write.
  prepareViewer: (...args) =>
    require("./build/buildViewer.cjs").prepareViewer(...args),
  prepareFamily: (...args) =>
    require("./build/prepareComparison.cjs").prepareFamily(...args),
  familyKey: (...args) =>
    require("./build/prepareComparison.cjs").familyKey(...args),
  createDocument: (...args) => document().createDocument(...args),
  reviseDocument: (...args) => document().reviseDocument(...args),
  relocateDocument: (...args) => document().relocateDocument(...args),
  validateDocument: (...args) => document().validateDocument(...args),
  createSnapshot: (...args) => document().createSnapshot(...args),
  documentViewerModel: (...args) => document().documentViewerModel(...args),
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
  compareModels: (...args) => comparison().compareModels(...args),
  compareDocuments: (...args) => comparison().compareDocuments(...args),
  createProposal: (...args) => comparison().createProposal(...args),
  checkScenario: (...args) =>
    require("./learning/scenarios.cjs").checkScenario(...args),
  explainModel: (...args) =>
    require("./learning/scenarios.cjs").explainModel(...args),
  reviewDocuments: (...args) =>
    require("./review/review.cjs").reviewDocuments(...args),
  buildReview: (...args) => require("./review/review.cjs").buildReview(...args),
  writeReview: (...args) => require("./review/review.cjs").writeReview(...args),
};
Object.defineProperty(module.exports, "toolDefinitions", {
  enumerable: true,
  get: () => require("./agent/service.cjs").toolDefinitions,
});
