import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import atlas from "@atlas/diagrams";
const diagrams = JSON.parse(fs.readFileSync(new URL("../../packages/diagrams/package.json", import.meta.url), "utf8"));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "planning-atlas-review-"));
try {
  const model = { type: "StructuralModel", nodes: [{ id: "task", name: "Task", attributes: [] }], relations: [], generalizations: [], generalizationSets: [] };
  const base = atlas.createDocument({ id: "consumer-review", title: "Planning package consumer", profile: "code", model, createdAt: "2026-10-08T00:00:00.000Z" });
  const head = atlas.createDocument({ ...base, model: { ...model, nodes: [{ ...model.nodes[0], name: "Work item" }] }, parentId: base.revision.id, createdAt: base.revision.createdAt });
  for (const [name, doc] of [["base", base], ["head", head]]) fs.writeFileSync(path.join(stage, name + ".json"), JSON.stringify(doc));
  const built = await atlas.buildReview({ base: { file: path.join(stage, "base.json") }, head: { file: path.join(stage, "head.json") } });
  assert.equal(built.report.changes.counts.modified, 1);
  assert.equal(atlas.importDocument(built.files.get("index.html")).model.nodes[0].name, "Work item");
  const output = path.resolve("artifacts/atlas-review");
  fs.mkdirSync(output, { recursive: true });
  for (const [name, content] of built.files) {
    fs.mkdirSync(path.dirname(path.join(output, name)), { recursive: true });
    fs.writeFileSync(path.join(output, name), content);
  }
  fs.writeFileSync(path.join(output, "consumer.json"), JSON.stringify({ workflowCommit: process.env.GITHUB_SHA || null, diagrams: { name: diagrams.name, version: diagrams.version }, scope: "Workspace consumer review/export/reopen fixture; no live project inspection." }, null, 2));
  console.log("Workspace diagram package review, semantic change and export/reopen passed.");
} finally {
  if (!path.resolve(stage).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe consumer-check cleanup");
  fs.rmSync(stage, { recursive: true, force: true });
}
