const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { unzipSync, zipSync, strToU8 } = require("fflate");
const {
  createDocument,
  createSnapshot,
  reviseDocument,
  buildViewer,
  importDocument,
} = require("../lib/index.cjs");
const { createProject } = require("../examples/r5/create-project.cjs");
const { createEvidence, createViews } = require("../examples/r5/metadata.cjs");
const snippets = require("../examples/r5/source-snippets.json");
test("portable export reopens without workspace, retains baselines/context and can be revised and exported", async () => {
  const graph = {
    type: "StructuralModel",
    nodes: ["animal", "cat", "dog"].map((id) => ({
      id,
      name: id,
      attributes: [
        { id: `${id}-age`, name: "age", type: "integer", multiplicity: "0..1" },
      ],
    })),
    relations: [
      {
        id: "friend",
        name: "friend",
        sourceId: "cat",
        targetId: "dog",
        sourceMultiplicity: "0..*",
        targetMultiplicity: "1..2",
      },
    ],
    generalizations: ["cat", "dog"].map((id) => ({
      id: `g-${id}`,
      specificId: id,
      generalId: "animal",
    })),
    generalizationSets: [
      {
        id: "species",
        name: "Species",
        generalizations: ["g-cat", "g-dog"],
        disjoint: true,
        complete: false,
      },
    ],
  };
  const baseline = createSnapshot({
    profile: "code",
    model: graph,
    capture: {
      capturedAt: "2026-10-08T12:00:00Z",
      adapter: { id: "fixture", version: "1" },
      source: {
        kind: "fixture",
        identity: "unavailable-repository",
        scope: ["animals"],
      },
      coverage: { status: "complete", diagnostics: [] },
    },
  });
  const document = createDocument({
    profile: "code",
    model: graph,
    state: "proposal",
    snapshots: [baseline],
    baselineId: baseline.id,
    context: {
      records: [
        {
          id: "plan-species",
          kind: "plan",
          text: "Allow another species later.",
          path: "missing-plan.md",
          section: "scope",
        },
        { id: "term", kind: "glossary", text: "Species is a classification." },
      ],
      links: [{ elementId: "animal", recordId: "plan-species" }],
    },
  });
  const exported = await buildViewer({ document, slug: "animals" });
  const reopened = importDocument(exported.html);
  assert.deepEqual(reopened.model, document.model);
  assert.deepEqual(reopened.context, document.context);
  assert.deepEqual(reopened.snapshots, document.snapshots);
  assert.equal(reopened.imported, true);
  const model = structuredClone(reopened.model);
  model.relations[0].targetMultiplicity = "0..1";
  const changed = reviseDocument(reopened, { model, title: "Changed offline" });
  const second = await buildViewer({ document: changed, slug: "animals" });
  const final = importDocument(new Uint8Array(Buffer.from(second.html)));
  assert.equal(final.model.relations[0].targetMultiplicity, "0..1");
  assert.equal(
    final.snapshots[0].model.relations[0].targetMultiplicity,
    "1..2",
  );
  assert.equal(final.model.generalizationSets[0].name, "Species");
  const zip = unzipSync(second.artifacts.get("animals-models.zip"));
  assert.deepEqual(
    JSON.parse(Buffer.from(zip["animals-atlas-document.json"])),
    changed,
  );
  assert.equal(second.artifacts.has("animals-structural.json"), true);
});
test("existing 0.4 exports recover their exact conceptual model, counts, views and code excerpts", async () => {
  const html = execFileSync("git", ["show", "864d3e6:index.html"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const imported = importDocument(html);
  const project = createProject();
  assert.deepEqual(imported.model, project);
  assert.deepEqual(imported.evidence, createEvidence(project));
  assert.deepEqual(imported.views, createViews(project));
  for (const [id, excerpt] of Object.entries(snippets)) {
    assert.equal(imported.snippets[id].code, excerpt.code);
    assert.equal(imported.snippets[id].commit, excerpt.commit);
  }
  const exported = await buildViewer({ document: imported, slug: "legacy" });
  assert.deepEqual(importDocument(exported.html).model, project);
});
test("import validates inert data and never runs surrounding scripts", async () => {
  const project = createProject();
  const exported = await buildViewer({ project });
  const hostile = exported.html.replace(
    "<body>",
    '<body><script>globalThis.ATLAS_EXECUTED=true;throw new Error("executed")</script>',
  );
  assert.equal(importDocument(hostile).model.id, project.id);
  assert.equal(globalThis.ATLAS_EXECUTED, undefined);
  const payload = exported.html.match(
    /<script id="atlas-document" type="application\/json">[\s\S]*?<\/script>/,
  )[0];
  assert.throws(() => importDocument(payload + payload), /repeated/);
  assert.throws(
    () =>
      importDocument(
        payload.replace(
          'type="application/json"',
          "data-note=' type=\"application/json\"'",
        ),
      ),
    /inert/,
  );
  assert.throws(
    () =>
      importDocument(
        payload.replace(
          'id="atlas-document"',
          "data-note=' id=\"atlas-document\"'",
        ),
      ),
    /IMPORT_FORMAT/,
  );
  assert.throws(
    () =>
      importDocument(
        payload.replace(
          'type="application/json"',
          'type="text/javascript" type="application/json"',
        ),
      ),
    /duplicate/,
  );
  assert.throws(
    () =>
      importDocument(
        payload.replace(
          'type="application/json"',
          'data-type="application/json"',
        ),
      ),
    /inert/,
  );
  assert.throws(
    () =>
      importDocument(
        payload.replace('id="atlas-document"', 'data-id="atlas-document"'),
      ),
    /IMPORT_FORMAT/,
  );
  assert.throws(
    () =>
      importDocument(payload.replace("application/json", "text/javascript")),
    /inert/,
  );
  assert.throws(
    () => importDocument('{"formatVersion":999}'),
    /DOCUMENT_SCHEMA/,
  );
  assert.throws(
    () =>
      importDocument(
        '<script id="atlas-document" type="application/json">{bad}</script>',
      ),
    /IMPORT_JSON/,
  );
  assert.throws(
    () => importDocument("x".repeat(64 * 1024 * 1024 + 1)),
    /IMPORT_LIMIT/,
  );
  const malicious = createDocument({
    project,
    title: "</script><script>injected()</script>",
  });
  const safe = await buildViewer({ document: malicious });
  assert(!safe.html.includes("<script>injected()"));
  assert.equal(importDocument(safe.html).title, malicious.title);
});
test("project title survives export and reopening without evidence", async () => {
  const project = createProject();
  project.name = { en: "Named conceptual model" };
  const first = await buildViewer({ project });
  const reopened = importDocument(first.html);
  assert.equal(reopened.title, first.model.title);
  assert.equal(
    (await buildViewer({ document: reopened })).model.title,
    first.model.title,
  );
});
test("legacy model and static snippets share one decoded size budget", () => {
  const project = createProject();
  project.description = { en: "x".repeat(20 * 1024 * 1024) };
  const bundle = Buffer.from(
    zipSync({
      "large-ontouml.json": strToU8(JSON.stringify(project)),
      "large-evidence.json": strToU8("{}"),
      "large-views.json": strToU8("[]"),
    }),
  ).toString("base64");
  const snippet = {
    source: {
      code: "y".repeat(20 * 1024 * 1024),
      language: "text",
      startLine: 1,
    },
  };
  const html = `<script>const EXPORTS=${JSON.stringify({ slug: "large", bundle })};const SNIPPETS=${JSON.stringify(snippet)};\n</script>`;
  assert.throws(() => importDocument(html), /IMPORT_LIMIT/);
});
