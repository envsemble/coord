const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("esbuild");
const { renderToStaticMarkup } = require("react-dom/server");
const { createElement } = require("react");
const { prepareViews } = require("../lib/layout/prepareViews.cjs");
const { layoutDiagram } = require("../lib/layout/layoutDiagram.cjs");
const { validateDiagram } = require("../lib/layout/validateDiagram.cjs");
const { renderSVG } = require("../lib/render/renderSVG.cjs");

const context = vm.createContext({ module: { exports: {} } });
new vm.Script(
  transformSync(
    fs.readFileSync(
      path.join(__dirname, "../src/canvas/interaction.js"),
      "utf8",
    ),
    { format: "cjs" },
  ).code,
).runInContext(context);
const { focusedElements } = context.module.exports;
const { loadComponents: loadComponent } = require("./loadComponents.cjs");
const { GeneralizationSetDetails } = loadComponent(
  "src/details/ElementDetails.jsx",
);
const { indexViewerModel } = loadComponent("src/model/viewerModelIndex.js");
// Enrollment and its two generalization sets, as the viewer's model: the
// layout joins inheritance that shares a supertype, labelled by its set.
function createEnrollmentModel() {
  const node = (id, name) => ({
    id,
    name,
    stereotype: "class",
    description: "",
    evidence: [],
    attributes: [],
  });
  const inherits = (id) => ({
    id: `inherits-${id}`,
    specificId: id,
    generalId: "enrollment",
    evidence: [],
  });
  const set = (id, name, members) => ({
    id,
    name,
    complete: true,
    disjoint: true,
    generalizations: members.map((m) => `inherits-${m}`),
    evidence: [],
  });
  const mediates = (id) => ({
    id: `mediates-${id}`,
    name: "mediates",
    stereotype: "",
    sourceId: "enrollment",
    targetId: id,
    sourceMultiplicity: "0..*",
    targetMultiplicity: "1",
    description: "",
    evidence: [],
  });
  const model = {
    id: "enrollment",
    title: "Enrollment inheritance",
    version: "",
    date: "2026-10-07",
    status: "",
    sources: [],
    classes: [
      node("enrollment", "Enrollment"),
      node("person", "Person"),
      node("institution", "Institution"),
      node("active", "Active"),
      node("suspended", "Suspended"),
      node("undergraduate", "Undergraduate Enrollment"),
      node("graduate", "Graduate Enrollment"),
    ],
    relations: [mediates("person"), mediates("institution")],
    generalizations: ["active", "suspended", "undergraduate", "graduate"].map(
      inherits,
    ),
    partitions: [
      set("enrollment-state", "Enrollment state", ["active", "suspended"]),
      set("degree-level", "Degree level", ["undergraduate", "graduate"]),
    ],
    constraints: [],
    unknowns: [],
    validation: { valid: true, issues: [], counts: { error: 0 } },
  };
  return {
    model,
    views: [
      {
        key: "inheritance",
        label: "Enrollment",
        title: "Enrollment generalization sets",
        direction: "DOWN",
        nodeIds: [
          "active",
          "suspended",
          "enrollment",
          "undergraduate",
          "graduate",
        ],
        columns: [
          ["active", "suspended"],
          ["enrollment"],
          ["undergraduate", "graduate"],
        ],
        focusIds: [
          "active",
          "suspended",
          "enrollment",
          "undergraduate",
          "graduate",
        ],
      },
    ],
  };
}
async function scene(model, settings, fields = false) {
  const [view] = prepareViews(model, settings);
  const { diagram } = await layoutDiagram(
    view,
    new Map(model.classes.map((c) => [c.id, c])),
    view.edges,
    view.generalizations,
    fields,
  );
  validateDiagram(diagram, model);
  return { model, diagram };
}
const pathEnd = (path) =>
  path
    .match(/-?\d+(?:\.\d+)?/g)
    .map(Number)
    .slice(-2);

test("set inspection explains its constraints and keeps anonymous joins semantically neutral", async () => {
  const { model: project, views } = createEnrollmentModel();
  const { model, diagram } = await scene(project, views);
  const index = indexViewerModel(model, diagram.generalizationGroups);
  const group = index.getElement({ kind: "group", id: "enrollment-state" });
  const html = renderToStaticMarkup(
    createElement(GeneralizationSetDetails, {
      group,
      model,
      snippets: {},
      onChoose: () => {},
    }),
  );
  assert(
    html.includes("Enrollment state") &&
      html.includes("Active") &&
      html.includes("Suspended"),
  );
  assert(
    html.includes(
      "Every instance of the supertype belongs to at least one subtype",
    ),
  );
  assert(html.includes("cannot belong to two subtypes"));
  const neutral = renderToStaticMarkup(
    createElement(GeneralizationSetDetails, {
      group: { ...group, type: "generalizationJoin" },
      model,
      snippets: {},
      onChoose: () => {},
    }),
  );
  assert(
    neutral.includes(
      "Joining their lines does not assert completeness or disjointness",
    ),
  );
});
test("geometry validation rejects disconnected trunks", async () => {
  const { model: project, views } = createEnrollmentModel();
  const { model, diagram } = await scene(project, views);
  diagram.generalizationGroups[0].paths[0] =
    diagram.generalizationGroups[0].paths[0].replace(/^M[^ ]+/, "M999");
  assert.throws(() => validateDiagram(diagram, model), /disconnected/);
});

test("the enrollment pattern joins both sides of a supertype with one arrow per named set", async () => {
  const { model: project, views } = createEnrollmentModel();
  for (const fields of [false, true]) {
    const { diagram } = await scene(project, views, fields);
    assert.equal(
      diagram.edges.length,
      4,
      "semantic inheritances remain individually identifiable",
    );
    assert.equal(diagram.generalizationGroups.length, 2);
    const svg = renderSVG(diagram);
    assert.equal(
      (svg.match(/marker-end=/g) || []).length,
      2,
      "one hollow triangle per shared trunk",
    );
    assert(svg.includes("Enrollment state") && svg.includes("Degree level"));
    assert(svg.includes("{complete, disjoint}"));
    for (const group of diagram.generalizationGroups) {
      const endpoints = group.memberIds.map((id) =>
        pathEnd(diagram.edges.find((e) => e.id === id).branchPaths[0]),
      );
      assert.deepEqual(
        endpoints[0],
        endpoints[1],
        "branches meet at the same junction",
      );
      const trunk = group.paths[0].match(/-?\d+(?:\.\d+)?/g).map(Number);
      assert.deepEqual(endpoints[0], trunk.slice(0, 2));
    }
    const state = diagram.generalizationGroups.find(
      (g) => g.id === "enrollment-state",
    );
    const degree = diagram.generalizationGroups.find(
      (g) => g.id === "degree-level",
    );
    assert(pathEnd(state.paths[0])[1] > Number(state.paths[0].split(" ")[1]));
    assert(pathEnd(degree.paths[0])[1] < Number(degree.paths[0].split(" ")[1]));
  }
});
test("set labels show completeness and disjointness independently", async () => {
  // Each one set without the other: neither follows from its partner.
  for (const [complete, disjoint] of [
    [true, false],
    [false, true],
  ]) {
    const { model: project, views } = createEnrollmentModel();
    const set = project.partitions.find((e) => e.id === "degree-level");
    set.complete = complete;
    set.disjoint = disjoint;
    const { diagram } = await scene(project, views);
    const group = diagram.generalizationGroups.find((g) => g.id === set.id);
    assert.equal(group.complete, complete);
    assert.equal(group.disjoint, disjoint);
    assert(
      group.labels[0].text.includes(
        `{${complete ? "complete" : "incomplete"}, ${disjoint ? "disjoint" : "overlapping"}}`,
      ),
    );
  }
});
test("group focus reveals all members while an individual inheritance still isolates two ends", async () => {
  const { model: project, views } = createEnrollmentModel();
  const { diagram } = await scene(project, views);
  const setFocus = focusedElements(diagram, {
    kind: "group",
    id: "enrollment-state",
  });
  assert.deepEqual([...setFocus.nodes].sort(), [
    "active",
    "enrollment",
    "suspended",
  ]);
  assert.deepEqual([...setFocus.edges].sort(), [
    "inherits-active",
    "inherits-suspended",
  ]);
  assert.deepEqual([...setFocus.groups], ["enrollment-state"]);
  const branchFocus = focusedElements(diagram, {
    kind: "edge",
    id: "inherits-active",
  });
  assert.deepEqual([...branchFocus.nodes].sort(), ["active", "enrollment"]);
  assert.deepEqual([...branchFocus.edges], ["inherits-active"]);
  assert.deepEqual(
    [...branchFocus.groups],
    ["enrollment-state"],
    "the shared trunk remains visible",
  );
  assert.equal(
    focusedElements(diagram, { kind: "group", id: "missing" }),
    null,
  );
});
test("a partial view identifies omitted members without asserting the visible subset is complete", async () => {
  const { model: project, views } = createEnrollmentModel();
  views[0].nodeIds = ["active", "enrollment"];
  views[0].columns = [["active"], ["enrollment"]];
  views[0].focusIds = views[0].nodeIds;
  const { diagram } = await scene(project, views);
  const [group] = diagram.generalizationGroups;
  assert.equal(group.complete, true, "the full model set remains complete");
  assert.equal(group.totalMembers, 2);
  assert.equal(group.memberIds.length, 1);
  assert.match(group.labels[0].text, /1\/2 shown/);
});
test("sets can share an inheritance without losing either membership or route identity", async () => {
  const { model: project, views } = createEnrollmentModel();
  const set = project.partitions.find((e) => e.id === "degree-level");
  set.generalizations = ["inherits-active", "inherits-graduate"];
  set.disjoint = false;
  const { diagram } = await scene(project, views);
  const active = diagram.edges.find((e) => e.id === "inherits-active");
  assert.equal(active.paths.length, 2);
  assert.equal(active.branchPaths.length, 2);
  assert.equal(diagram.edges.length, 4);
  assert.equal(
    diagram.generalizationGroups.filter((g) => g.memberIds.includes(active.id))
      .length,
    2,
  );
});
test("unannotated joins make no semantic claims, and a view can keep separate arrows", async () => {
  const { model: project, views } = createEnrollmentModel();
  project.partitions = [];
  const joined = await scene(project, views);
  assert.equal(joined.diagram.generalizationGroups.length, 1);
  assert.equal(
    joined.diagram.generalizationGroups[0].type,
    "generalizationJoin",
  );
  assert.equal(joined.diagram.generalizationGroups[0].labels.length, 0);
  assert.equal(joined.diagram.generalizationGroups[0].complete, undefined);
  const separate = await scene(project, [
    { ...views[0], mergeGeneralizations: false },
  ]);
  assert.equal(separate.diagram.generalizationGroups.length, 0);
  assert.equal(
    (renderSVG(separate.diagram).match(/marker-end=/g) || []).length,
    4,
  );
});
