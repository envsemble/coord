import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { assemble } from "./assemble-planning.mjs";
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "planning-release-"));
try {
  const first = assemble(path.join(stage, "one"));
  const second = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("./assemble-planning.mjs", import.meta.url)), path.join(stage, "two")], { encoding: "utf8", windowsHide: true, env: { ...process.env, TZ: "America/Los_Angeles" } }));
  assert.equal(first.sha256, second.sha256);
  const files = unzipSync(fs.readFileSync(path.join(first.outputDirectory, first.filename))), manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
  for (const file of manifest.files) assert.equal(createHash("sha256").update(files[file.name]).digest("hex"), file.sha256);
  assert(files["planning-dashboard/assets/atlas-dashboard.jpg"]);
  assert(files["planning-workflow/atlas-modeling/SKILL.md"]);
  assert(files["planning-dashboard/vendor/" + manifest.atlas.file]);
  assert(!Object.keys(files).some((name) => /(?:^|\/)\.atlas\//.test(name)));
  console.log("Passed: repeatable versioned planning/Atlas consumer distribution, hashes, skills/docs/assets; no local model data.");
} finally {
  if (!path.resolve(stage).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe release-check cleanup.");
  fs.rmSync(stage, { recursive: true, force: true });
}
