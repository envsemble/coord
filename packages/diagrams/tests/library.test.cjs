const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { Project } = require("ontouml-js");
const {
  validateProject,
  validateModel,
  mergeProjects,
  buildViewer,
  createModelingJob,
  buildModelingJob,
} = require("../lib/index.cjs");
const json = (project) => JSON.parse(JSON.stringify(project));
function enrollment() {
  const project = new Project();
  project.name.add("School model");
  const model = project.packageBuilder().root().name("School").build();
  const person = model.classBuilder().kind().name("Person").build();
  const student = model.classBuilder().role().name("Student").build();
  const school = model.classBuilder().kind().name("School").build();
  const relator = model.classBuilder().relator().name("Enrollment").build();
  model.generalizationBuilder().specific(student).general(person).build();
  model
    .binaryRelationBuilder()
    .mediation()
    .source(relator)
    .target(student)
    .sourceCardinality("1..*")
    .targetCardinality("1")
    .build();
  model
    .binaryRelationBuilder()
    .mediation()
    .source(relator)
    .target(school)
    .sourceCardinality("0..*")
    .targetCardinality("1")
    .build();
  return {
    project: json(project),
    person: person.id,
    student: student.id,
    model,
  };
}
test("role identity and dependency use ancestry, and optional participation is rejected", () => {
  const fixture = enrollment();
  assert.equal(validateProject(fixture.project).valid, true);
  const role = fixture.project.elements.find((e) => e.id === fixture.student);
  const relation = fixture.project.elements.find(
    (e) =>
      e.type === "BinaryRelation" &&
      e.properties.some(
        (id) =>
          fixture.project.elements.find((p) => p.id === id)?.propertyType ===
          role.id,
      ),
  );
  fixture.project.elements.find(
    (p) => p.id === relation.properties[0],
  ).cardinality = "0..*";
  assert(
    validateProject(fixture.project).issues.some(
      (i) => i.code === "ROLE_DEPENDENCE" && i.elementId === role.id,
    ),
  );
});
test("a relator can require two participants through a single mediation", () => {
  const p = new Project(),
    root = p.packageBuilder().root().name("Pairing").build();
  const person = root.classBuilder().kind().name("Person").build(),
    pairing = root.classBuilder().relator().name("Pairing").build();
  root
    .binaryRelationBuilder()
    .mediation()
    .source(pairing)
    .target(person)
    .sourceCardinality("0..*")
    .targetCardinality("2")
    .build();
  assert.equal(validateProject(json(p)).valid, true);
});
test("phase partitions must be complete and disjoint; unknown alternatives remain findings", () => {
  const p = new Project(),
    root = p.packageBuilder().root().name("Life").build();
  const person = root.classBuilder().kind().name("Person").build();
  const living = root.classBuilder().phase().name("Living").build(),
    deceased = root.classBuilder().phase().name("Deceased").build();
  const a = root
      .generalizationBuilder()
      .specific(living)
      .general(person)
      .build(),
    b = root.generalizationBuilder().specific(deceased).general(person).build();
  const set = root
    .generalizationSetBuilder()
    .generalizations(a, b)
    .disjoint()
    .complete()
    .build();
  assert.equal(validateProject(json(p)).valid, true);
  const raw = json(p);
  raw.elements.find((e) => e.id === set.id).isComplete = false;
  assert.equal(
    validateProject(raw).issues.filter((i) => i.code === "PHASE_PARTITION")
      .length,
    2,
  );
});
test("broken references, duplicate IDs and cycles produce findings rather than crashing", () => {
  const fixture = enrollment();
  const broken = structuredClone(fixture.project);
  broken.elements.find((e) => e.type === "Generalization").general = "missing";
  assert(
    validateProject(broken).issues.some((i) => i.code === "INVALID_REFERENCE"),
  );
  const duplicates = structuredClone(fixture.project);
  duplicates.elements.push(duplicates.elements[0]);
  assert(
    validateProject(duplicates).issues.some((i) => i.code === "DUPLICATE_ID"),
  );
  const cycle = structuredClone(fixture.project);
  const g = cycle.elements.find((e) => e.type === "Generalization");
  g.general = g.specific;
  assert(
    validateProject(cycle).issues.some(
      (i) => i.code === "GENERALIZATION_CYCLE",
    ),
  );
  assert.equal(validateProject({ type: "Project" }).valid, false);
  assert.equal(validateModel(null).valid, false);
});
test("self associations retain two distinct multiplicity labels and orthogonal routes", async () => {
  const project = new Project(),
    root = project.packageBuilder().root().name("Network").build();
  const node = root.classBuilder().kind().name("Network node").build();
  root
    .binaryRelationBuilder()
    .name("connected to")
    .source(node)
    .target(node)
    .sourceCardinality("0..*")
    .targetCardinality("0..*")
    .build();
  const built = await buildViewer({ project: json(project) });
  assert.equal(built.views[0].diagram.edges.length, 1);
  assert.equal(built.report.diagrams[0].multiplicityLabels, 2);
});
test("evidence cannot point to missing concepts, sources or executable links", () => {
  const fixture = enrollment();
  const result = validateModel(fixture.project, {
    sources: [
      {
        id: "src",
        file: "file.ts",
        title: "Source",
        claim: "Declaration",
        url: "javascript:alert(1)",
      },
    ],
    elements: { unknown: { evidence: ["missing"] } },
  });
  assert(result.issues.some((i) => i.layer === "evidence"));
  assert.equal(result.valid, false);
});
test("same-named concepts in multiple projects keep distinct IDs and render offline", async () => {
  const first = enrollment().project;
  const merged = mergeProjects([
    { key: "one", project: first },
    { key: "two", project: first },
  ]);
  assert.equal(validateProject(merged).valid, true);
  const built = await buildViewer({ project: merged });
  assert.equal(
    built.model.classes.filter((c) => c.name === "Person").length,
    2,
  );
  assert.equal(new Set(built.views[0].diagram.nodes.map((n) => n.id)).size, 8);
  assert(!/<script\b[^>]*src=/i.test(built.html));
  assert.equal(built.report.diagrams.length, 2);
  const data = built.html.match(/^\s*(const MODEL=.*)$/m)[1];
  new vm.Script(`${data}\n;({MODEL,VIEWS,EXPORTS,SNIPPETS})`).runInNewContext();
});
test("an agent job accepts multiple local projects and builds their authored model", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ontouml-job-"));
  try {
    fs.mkdirSync(path.join(directory, "one"));
    fs.mkdirSync(path.join(directory, "two"));
    const jobPath = path.join(directory, "job");
    const created = createModelingJob({
      projects: [path.join(directory, "one"), path.join(directory, "two")],
      question: "How do schools enroll people?",
      outputPath: jobPath,
    });
    assert.equal(created.job.projects.length, 2);
    assert.match(fs.readFileSync(created.prompt, "utf8"), /Agent workflow/);
    assert.throws(
      () =>
        createModelingJob({
          projects: [path.join(directory, "one")],
          question: "Again",
          outputPath: jobPath,
        }),
      /already exist/,
    );
    fs.writeFileSync(
      path.join(jobPath, created.job.model),
      JSON.stringify(enrollment().project),
    );
    const built = await buildModelingJob(
      path.join(jobPath, "job.json"),
      path.join(directory, "site"),
    );
    assert.equal(built.report.valid, true);
    assert(fs.existsSync(path.join(directory, "site", "index.html")));
  } finally {
    if (
      !path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)
    )
      throw new Error("Unsafe temporary cleanup path");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
