const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { buildSync } = require("esbuild");
const output = buildSync({
  entryPoints: [path.join(__dirname, "../src/learning/modelHelp.js")],
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
}).outputFiles[0].text;
const compiled = { exports: {} };
new Function("module", "exports", output)(compiled, compiled.exports);
const { readMultiplicity, identityProviders, documentationURL } =
  compiled.exports;
test("count explanations read each multiplicity from the opposite endpoint", () => {
  const explanations = readMultiplicity({
    source: { name: "Student" },
    target: { name: "Enrollment" },
    sourceMultiplicity: "1",
    targetMultiplicity: "0..*",
  });
  assert.deepEqual(explanations, [
    "For each Student: 0 or more instances of Enrollment.",
    "For each Enrollment: exactly 1 instance of Student.",
  ]);
});
test("identity learning resolves indirect inheritance and terminates on cycles", () => {
  const model = {
    classes: [
      { id: "person", name: "Person", stereotype: "kind" },
      { id: "student", stereotype: "role" },
      { id: "graduate", stereotype: "role" },
    ],
    generalizations: [
      { specificId: "graduate", generalId: "student" },
      { specificId: "student", generalId: "person" },
      { specificId: "person", generalId: "graduate" },
    ],
  };
  assert.deepEqual(
    identityProviders(model, "graduate").map((p) => p.id),
    ["person"],
  );
  assert.equal(
    documentationURL("phase"),
    "https://ontouml.readthedocs.io/en/latest/classes/sortals/phase/index.html",
  );
});
