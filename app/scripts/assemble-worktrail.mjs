import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { zipSync, unzipSync } from "fflate";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hash = (data) => createHash("sha256").update(data).digest("hex");
export function assemble(outputDirectory = "artifacts/release") {
  const git = (...args) => execFileSync("git", ["--no-replace-objects", "-C", root, ...args], { windowsHide: true, env: { ...process.env, GIT_NO_LAZY_FETCH: "1" }, maxBuffer: 64 * 1024 * 1024 });
  if (git("status", "--porcelain", "--untracked-files=normal").toString().trim()) throw new Error("Commit source before assembling a revision-labelled distribution.");
  const commit = git("rev-parse", "HEAD").toString().trim();
  const archive = git("archive", "--format=zip", commit, "dashboard", "skills", "assets", "docs", ".github", ".gitignore", "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "THIRD_PARTY_NOTICES.md", "requirements-dev.txt");
  let bytes = 0, count = 0;
  const files = unzipSync(archive, { filter(entry) { bytes += entry.originalSize; count++; if (bytes > 128 * 1024 * 1024 || count > 5000) throw new Error("Distribution exceeds archive bounds."); return !entry.name.endsWith("/"); } });
  const version = JSON.parse(Buffer.from(files["dashboard/package.json"]).toString()).version;
  const manifest = { format: "worktrail/release", formatVersion: 1, version, commit, published: false, atlas: JSON.parse(Buffer.from(files["dashboard/vendor/atlas-package.json"]).toString()),
    files: Object.entries(files).map(([name, data]) => ({ name, sha256: hash(data), bytes: data.length })) };
  files["manifest.json"] = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, [data, { mtime: new Date(2026, 0, 1) }]])), { level: 6 });
  const output = path.resolve(outputDirectory), filename = `worktrail-${version}-${commit.slice(0, 12)}.zip`;
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error("Choose a new or empty output directory.");
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, filename), zipped); fs.writeFileSync(path.join(output, "manifest.json"), files["manifest.json"]);
  return { version, commit, filename, sha256: hash(zipped), outputDirectory: output };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(assemble(process.argv[2]))); } catch (e) { console.error(e.message); process.exitCode = 2; }
}
