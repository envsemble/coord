const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { zipSync, unzipSync } = require("fflate");
const hash = (data) => createHash("sha256").update(data).digest("hex");
// Committed folders and root files copied into the release as source.
const SOURCE_FOLDERS = ["app", "packages", "skills", "assets", "docs"];
const SOURCE_FILES = [
  "README.md",
  "CHANGELOG.md",
  "CONTEXT.md",
  "CONTRIBUTING.md",
  "THIRD_PARTY_NOTICES.md",
  "package.json",
  "package-lock.json",
];
const DIAGRAMS = "packages/diagrams";
async function assemble({ outputDirectory = "artifacts/release" } = {}) {
  const root = path.resolve(__dirname, ".."),
    npm = process.env.npm_execpath;
  if (!npm)
    throw new Error("Run release assembly through npm run release:assemble");
  const git = (...args) =>
    execFileSync("git", ["--no-replace-objects", "-C", root, ...args], {
      encoding: "utf8",
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
      windowsHide: true,
    }).trim();
  const status = git("status", "--porcelain", "--untracked-files=normal");
  if (status)
    throw new Error(
      `RELEASE_DIRTY: commit source and generated files before assembling a labelled release:
${status}`,
    );
  const commit = git("rev-parse", "HEAD"),
    output = path.resolve(outputDirectory),
    stage = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-release-"));
  if (fs.existsSync(output) && fs.readdirSync(output).length)
    throw new Error("RELEASE_OUTPUT: choose a new or empty directory");
  try {
    const tree = git("ls-tree", "-rz", commit);
    if (
      tree
        .split("\0")
        .filter(Boolean)
        .some((entry) => !/^100(?:644|755) blob /.test(entry))
    )
      throw new Error(
        "RELEASE_SOURCE: committed source must contain regular files, not links/submodules",
      );
    const snapshot = execFileSync(
      "git",
      ["--no-replace-objects", "-C", root, "archive", "--format=zip", commit],
      {
        windowsHide: true,
        maxBuffer: 128 * 1024 * 1024,
        env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
      },
    );
    let bytes = 0,
      count = 0;
    const tracked = unzipSync(snapshot, {
      filter(entry) {
        bytes += entry.originalSize;
        count++;
        if (
          bytes > 128 * 1024 * 1024 ||
          count > 5000 ||
          entry.name.startsWith("/") ||
          entry.name.includes("\\") ||
          entry.name.split("/").includes("..")
        )
          throw new Error(
            "RELEASE_LIMIT: committed source exceeds archive bounds",
          );
        return !entry.name.endsWith("/");
      },
    });
    const sourceRoot = path.join(stage, "source");
    for (const [name, data] of Object.entries(tracked)) {
      const destination = path.join(sourceRoot, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, data);
    }
    const version = JSON.parse(
      fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"),
    ).version;
    // ESM imports do not use NODE_PATH. Link only installed dependencies into
    // the sealed source stage; npm pack excludes node_modules from artifacts.
    for (const folder of [".", DIAGRAMS, "app"]) {
      const installed = path.join(root, folder, "node_modules");
      if (fs.existsSync(installed))
        fs.symlinkSync(
          installed,
          path.join(sourceRoot, folder, "node_modules"),
          process.platform === "win32" ? "junction" : "dir",
        );
    }
    const env = { ...process.env, NODE_PATH: path.join(root, "node_modules") };
    const diagramsRoot = path.join(sourceRoot, DIAGRAMS);
    const committedDist = new Map(
      Object.entries(tracked).filter(([name]) =>
        name.startsWith(`${DIAGRAMS}/dist/`),
      ),
    );
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [npm, "pack", "--json", "--pack-destination", stage],
        {
          cwd: diagramsRoot,
          env,
          windowsHide: true,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
    const packed = Array.isArray(result) ? result[0] : Object.values(result)[0],
      files = new Map([
        [packed.filename, fs.readFileSync(path.join(stage, packed.filename))],
      ]);
    if (
      [...committedDist].some(
        ([name, data]) =>
          !Buffer.from(data).equals(
            fs.readFileSync(path.join(sourceRoot, name)),
          ),
      )
    )
      throw new Error(
        "RELEASE_STALE: prepack changed committed artifacts; rebuild and commit first",
      );
    const html = execFileSync(
      process.execPath,
      [
        "-e",
        "const {createEnrollmentDocument}=require('./examples/enrollment/learning.cjs'); require('./lib/index.cjs').buildViewer({document:createEnrollmentDocument(),slug:'enrollment'}).then(b=>process.stdout.write(b.html)).catch(e=>{console.error(e);process.exitCode=1});",
      ],
      {
        cwd: diagramsRoot,
        env,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    files.set("enrollment.html", html);
    files.set(
      "r5.html",
      fs.readFileSync(path.join(diagramsRoot, "index.html")),
    );
    for (const [name, data] of Object.entries(tracked)) {
      const parts = name.split("/");
      if (
        (SOURCE_FOLDERS.includes(parts[0]) || SOURCE_FILES.includes(name)) &&
        !parts.includes(".atlas")
      )
        files.set(name, data);
    }
    const manifest = {
      format: "atlas/release",
      formatVersion: 1,
      version,
      commit,
      private: true,
      license: "UNLICENSED",
      files: [...files]
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([name, data]) => ({
          name,
          sha256: hash(data),
          bytes: Buffer.byteLength(data),
        })),
    };
    files.set("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
    const archive = zipSync(
      Object.fromEntries(
        [...files].map(([name, data]) => [
          name,
          [Buffer.from(data), { mtime: new Date(2026, 0, 1) }],
        ]),
      ),
      { level: 6 },
    );
    const filename = `atlas-${version}-${commit.slice(0, 12)}.zip`;
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, filename), archive);
    fs.writeFileSync(
      path.join(output, "manifest.json"),
      files.get("manifest.json"),
    );
    console.log(
      JSON.stringify({
        version,
        commit,
        filename,
        sha256: hash(archive),
        outputDirectory: output,
      }),
    );
    return { files, archive, manifest, filename };
  } finally {
    if (!path.resolve(stage).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error("Unsafe release cleanup path");
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
module.exports = { assemble, hash };
if (require.main === module)
  assemble({ outputDirectory: process.argv[2] }).catch((e) => {
    console.error(e.message);
    process.exitCode = 2;
  });
