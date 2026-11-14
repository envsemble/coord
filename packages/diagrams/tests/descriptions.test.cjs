// Descriptions of elements and members: the viewer's model keeps them, the
// canvas's tooltips show them, and a proposal that changes one changes its
// element.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const atlas = require("../lib/index.cjs");
const { loadComponents } = require("./loadComponents.cjs");

const BASE = `' atlas description Someone who learns.
class Person {
  name : String
  ' atlas description Greets them.
  greet() : String
}
' atlas description A place of learning.
class Institution
class Enrollment
Enrollment "0..*" -- "1" Person : learner
Enrollment "0..*" -- "1" Institution : school`;

async function prepared(files) {
  const { prepared } = await atlas.prepareDiagrams({ files });
  return prepared;
}
const render = (component, props) =>
  renderToStaticMarkup(createElement(component, props));

test("the canvas shows an element's and its members' descriptions as tooltips", async () => {
  const payload = (
    await prepared([
      { path: "people.puml", text: `@startuml\n${BASE}\n@enduml\n` },
    ])
  ).get("people.puml").payload;
  const person = payload.model.classes.find((c) => c.id === "Person");
  assert.equal(person.description, "Someone who learns.");
  assert.equal(person.methods[0].description, "Greets them.");
  assert.equal(person.attributes[0].description, undefined);
  // Each described node and member is its own tooltip.
  const { UMLNode } = loadComponents();
  const node = payload.views[0].diagram.nodes.find((n) => n.id === "Person");
  const svg = render("svg", {
    children: createElement(UMLNode, { node }),
  });
  assert.match(
    svg,
    /data-node-id="Person"[^>]*><title>Someone who learns\.<\/title>/,
  );
  assert.match(
    svg,
    /<text[^>]*><title>Greets them\.<\/title>greet\(\): String<\/text>/,
  );
  assert.equal(svg.match(/<title>/g).length, 2);
  const plain = payload.views[0].diagram.nodes.find(
    (n) => n.id === "Enrollment",
  );
  assert(
    !render("svg", {
      children: createElement(UMLNode, { node: plain }),
    }).includes("<title>"),
  );
});

test("a table's columns keep their descriptions", async () => {
  const text = fs
    .readFileSync(path.join(__dirname, "fixtures/home-database.puml"), "utf8")
    .replace(
      "    *name : text\n",
      "    ' atlas description What the sidebar shows.\n    *name : text\n",
    );
  const payload = (await prepared([{ path: "home.puml", text }])).get(
    "home.puml",
  ).payload;
  assert.equal(payload.model.document.profile, "database");
  assert(payload.model.classes.every((c) => c.description));
  const project = payload.model.classes.find((c) => c.id === "project");
  assert.equal(
    project.attributes.find((a) => a.name === "name").description,
    "What the sidebar shows.",
  );
});

test("a changed, added or removed description is a change of its element", async () => {
  const proposal = BASE.replace("Someone who learns.", "Someone enrolled.")
    .replace(
      "  name : String",
      "  ' atlas description Their name.\n  name : String",
    )
    .replace("' atlas description A place of learning.\n", "");
  const payload = (
    await prepared([
      { path: "base.puml", text: `@startuml\n${BASE}\n@enduml\n` },
      {
        path: "proposal.puml",
        text: `@startuml\n' atlas proposal base.puml\n${proposal}\n@enduml\n`,
      },
    ])
  ).get("proposal.puml").payload;
  const view = payload.comparison.changeView;
  const { rollupChanges } = loadComponents("src/review/changes.js");
  const rollup = rollupChanges(payload.comparison, view.model, view.views);
  assert.deepEqual(
    rollup.rows.map((r) => [
      r.status,
      r.name,
      r.summary.tokens.map((t) => `${t.status} ${t.text}`),
    ]),
    [
      [
        "modified",
        "Institution",
        ["modified description: A place of learning. → none"],
      ],
      [
        "modified",
        "Person",
        [
          "modified description: Someone who learns. → Someone enrolled.",
          "modified name",
        ],
      ],
    ],
  );
});
