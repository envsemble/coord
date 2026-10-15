const diagram = () => require("./plantuml/diagram.cjs");
// Modules load on first use: checking a diagram needs neither the layout
// engine, a compiler nor a database driver.
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
  // Captures: diagrams written from code and databases.
  captureTypeScript: (...args) =>
    require("./capture/code.cjs").captureTypeScript(...args),
  captureJava: (...args) => require("./capture/code.cjs").captureJava(...args),
  captureSQLite: (...args) =>
    require("./capture/database.cjs").captureSQLite(...args),
  captureD1: (...args) => require("./capture/database.cjs").captureD1(...args),
  capturePostgres: (...args) =>
    require("./capture/postgres.cjs").capturePostgres(...args),
  captureFromConfig: (...args) =>
    require("./capture/config.cjs").captureFromConfig(...args),
};
