import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { assemble } from "./assemble-worktrail.mjs";
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "planning-release-"));
try {
  const first = assemble(path.join(stage, "one"));
  const second = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("./assemble-worktrail.mjs", import.meta.url)), path.join(stage, "two")], { encoding: "utf8", windowsHide: true, env: { ...process.env, TZ: "America/Los_Angeles" } }));
  assert.equal(first.sha256, second.sha256);
  const files = unzipSync(fs.readFileSync(path.join(first.outputDirectory, first.filename))), manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
  for (const file of manifest.files) assert.equal(createHash("sha256").update(files[file.name]).digest("hex"), file.sha256);
  assert(files["dashboard/assets/atlas-dashboard.jpg"]);
  assert(files["skills/worktrail-atlas/SKILL.md"]);
  assert(files["dashboard/vendor/" + manifest.atlas.file]);
  assert.equal(manifest.format, 'worktrail/release');
  assert(files['assets/worktrail-icon.svg']);
  assert(files['docs/history/skills-commit-map.txt']);
  assert(!Object.keys(files).some((name) => /(?:^|\/)\.atlas\//.test(name)));
  assert(files['.github/workflows/ci.yml']);
  console.log("Passed: repeatable versioned Worktrail/Atlas consumer distribution, hashes, skills/docs/assets/CI; no local model data.");
} finally {
  if (!path.resolve(stage).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe release-check cleanup.");
  fs.rmSync(stage, { recursive: true, force: true });
}
