// Comparing a proposal with its baseline: what changed by identity, leaving
// out presentation, drawn on the layout both share.
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const atlas = require("../lib/index.cjs");
const { validateDiagram } = require("../lib/layout/validateDiagram.cjs");

const ENROLLMENT = `class Student {
  name : string
}
class Enrollment
Student "1" -- "0..*" Enrollment : enrolled`;
// A class diagram and a proposal of it: the proposal's prepared viewer.
async function proposal(base, proposed) {
  const { prepared } = await atlas.prepareDiagrams({
    files: [
      { path: "base.puml", text: `@startuml\n${base}\n@enduml\n` },
      {
        path: "proposal.puml",
        text: `@startuml\n' atlas proposal base.puml\n${proposed}\n@enduml\n`,
      },
    ],
    includeArtifacts: true,
  });
  return prepared.get("proposal.puml");
}

test("A proposal's exports stay reproducible across wall-clock changes", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-10-10T00:00:00Z"),
  });
  const changed = ENROLLMENT.replace("name : string", "name : text");
  const file = { path: "proposal.puml", text: changed };
  const first = await atlas.buildViewer({
    prepared: await proposal(ENROLLMENT, changed),
    file,
  });
  t.mock.timers.tick(3000);
  const second = await atlas.buildViewer({
    prepared: await proposal(ENROLLMENT, changed),
    file,
  });
  assert.equal(second.html, first.html);
});

test("Comparison finds changed types and counts by identity, and nothing in a reordered diagram", async () => {
  const { payload } = await proposal(
    ENROLLMENT,
    ENROLLMENT.replace("name : string", "name : number").replace(
      '"0..*" Enrollment',
      '"1..*" Enrollment',
    ),
  );
  const { changes } = payload.comparison.changes;
  assert.deepEqual(
    changes
      .filter((c) => c.elementId)
      .map((c) => [c.elementId, c.properties.map((p) => p.key)]),
    [
      ["Student.name", ["type"]],
      ["relation:Student:Enrollment:enrolled", ["targetMultiplicity"]],
    ],
  );
  assert(
    !changes
      .flatMap((c) => c.properties)
      .some((p) => ["x", "location", "evidence", "line"].includes(p.key)),
  );
  const reordered = `class Enrollment
' atlas evidence {"file":"moved.ts","line":99}
class Student {
  name : string
}
Student "1" -- "0..*" Enrollment : enrolled`;
  assert.equal(
    (await proposal(ENROLLMENT, reordered)).payload.comparison.changes.changes
      .length,
    0,
  );
});

test("Comparison shares orthogonal geometry and retains removed elements and routes", async () => {
  const { payload: p } = await proposal(
    ENROLLMENT,
    `class Student {
  name : string
}
class Course
Student "1" -- "0..*" Course : attends`,
  );
  const a = p.comparison.baseline.views[0].diagram,
    b = p.views[0].diagram,
    c = p.comparison.changeView.views[0].diagram;
  for (const node of a.nodes.filter((n) =>
    b.nodes.some((m) => m.id === n.id),
  )) {
    const same = b.nodes.find((n) => n.id === node.id);
    assert.deepEqual(
      [node.x, node.y, node.width, node.height],
      [same.x, same.y, same.width, same.height],
    );
  }
  assert.equal(
    c.nodes.find((n) => n.id === "Enrollment").changeStatus,
    "removed",
  );
  assert.equal(c.nodes.find((n) => n.id === "Course").changeStatus, "added");
  assert(
    c.edges.some(
      (e) =>
        e.id === "relation:Student:Enrollment:enrolled" &&
        e.changeStatus === "removed",
    ),
  );
  assert(
    c.edges.some(
      (e) =>
        e.id === "relation:Student:Course:attends" &&
        e.changeStatus === "added",
    ),
  );
  // With no views of their own, the members show one view of everything.
  assert.deepEqual(
    p.comparison.changeView.views.map((v) => v.key),
    ["comparison"],
  );
  for (const scene of [a, b, c]) validateDiagram(scene);
});

test("A relation moved to other ends keeps its old route, removed, beside its new one", async () => {
  const base = `${ENROLLMENT}
class Course
Student --|> Enrollment`;
  const { payload } = await proposal(
    base,
    base
      .replace('"0..*" Enrollment : enrolled', '"0..*" Course : enrolled')
      .replace("Student --|> Enrollment", "Student --|> Course"),
  );
  const before = payload.comparison.baseline.views[0].diagram;
  const after = payload.views[0].diagram;
  const scene = payload.comparison.changeView.views[0].diagram;
  assert.deepEqual(
    scene.edges.map((e) => [e.id, e.target, e.changeStatus]).sort(),
    [
      ["generalization:Student:Course", "Course", "added"],
      ["generalization:Student:Enrollment", "Enrollment", "removed"],
      ["relation:Student:Course:enrolled", "Course", "added"],
      ["relation:Student:Enrollment:enrolled", "Enrollment", "removed"],
    ],
  );
  for (const edge of scene.edges) {
    const own = (edge.changeStatus === "removed" ? before : after).edges.find(
      (e) => e.id === edge.id,
    );
    assert.deepEqual(edge.paths, own.paths);
  }
  validateDiagram(scene);
});

test("An association that becomes inheritance draws both routes", async () => {
  const { payload } = await proposal(
    ENROLLMENT,
    ENROLLMENT.replace(
      'Student "1" -- "0..*" Enrollment : enrolled',
      "Student --|> Enrollment",
    ),
  );
  const scene = payload.comparison.changeView.views[0].diagram;
  assert.deepEqual(
    scene.edges.map((e) => [e.id, e.type, e.changeStatus]).sort(),
    [
      ["generalization:Student:Enrollment", "generalization", "added"],
      ["relation:Student:Enrollment:enrolled", "association", "removed"],
    ],
  );
  validateDiagram(scene);
});
