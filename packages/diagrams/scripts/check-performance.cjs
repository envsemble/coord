// A 100-class diagram within its budgets: reading and checking it as the
// hooks do after every edit, and laying it out and exporting it as the viewer
// does.
const assert = require("node:assert/strict");
const coord = require("../lib/index.cjs");

async function main() {
  const text = [
    "@startuml",
    "title Performance fixture",
    ...Array.from(
      { length: 100 },
      (_, i) => `class Node${i} {\n  name : String\n  size : Integer [0..1]\n}`,
    ),
    ...Array.from(
      { length: 99 },
      (_, i) => `Node${i} "0..*" -- "1" Node${i + 1} : links`,
    ),
    "@enduml",
    "",
  ].join("\n");
  const file = { path: "performance.puml", text };
  // Warm the parser and the layout engine once.
  coord.checkDiagram(text);
  await coord.prepareDiagrams({
    files: [{ path: "warm.puml", text: "@startuml\nclass A\n@enduml\n" }],
  });
  const started = performance.now();
  const { diagram } = coord.parseDiagram(text);
  const problems = coord.checkDiagram(text, { path: file.path });
  const checkMs = performance.now() - started;
  assert.equal(diagram.elements.length, 100);
  assert.deepEqual(problems, []);
  assert(
    checkMs < 1000,
    `100-class warm parse and check took ${checkMs.toFixed(1)} ms`,
  );
  const layoutStarted = performance.now();
  const { prepared } = await coord.prepareDiagrams({
    files: [file],
    includeArtifacts: true,
  });
  const built = await coord.buildViewer({
    prepared: prepared.get(file.path),
    file,
  });
  const exportMs = performance.now() - layoutStarted;
  assert.equal(built.views[0].diagram.nodes.length, 100);
  assert(
    exportMs < 5000,
    `100-class linked layout/export took ${exportMs.toFixed(1)} ms`,
  );
  console.log(
    JSON.stringify({
      fixture: "100 classes / 99 associations",
      node: process.version,
      checkMs,
      exportMs,
      budgets: { checkMs: 1000, exportMs: 5000 },
    }),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
