const path = require("node:path");
const { buildSync } = require("esbuild");

// Export SVG with the same components used by the interactive client.
const root = path.resolve(__dirname, "../..");
const code = buildSync({
  absWorkingDir: root,
  stdin: {
    contents: `import { renderToStaticMarkup } from "react-dom/server";
import { UMLDiagram } from "./src/canvas/UMLDiagram";

export const renderSVG = (diagram) =>
  renderToStaticMarkup(<UMLDiagram diagram={diagram} />);
`,
    loader: "jsx",
    resolveDir: root,
    sourcefile: "renderSVG.jsx",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  packages: "external",
  jsx: "automatic",
  write: false,
}).outputFiles[0].text;
const compiled = { exports: {} };
new Function("require", "module", "exports", code)(
  require,
  compiled,
  compiled.exports,
);
module.exports = compiled.exports;
