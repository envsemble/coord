// `npm run dev:home`: the desktop app in development on a home of its own, beside an installed Atlas.
// The home is artifacts/dev-home (ignored by Git). The first run seeds it with a demo planning folder,
// a copy of the end-to-end fixture with its diagrams, as a Git repository. This checkout's `atlas`
// command goes first on the PATH, so the plugin's hooks and MCP server run this version too:
// `artifacts/dev-bin` holds the shims. Arguments after `--` reach the app (a folder to open).
import { spawn, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const repository = path.resolve(import.meta.dirname, "..");
const home = path.join(repository, "artifacts", "dev-home");
const bin = path.join(repository, "artifacts", "dev-bin");
const command = path.join(repository, "packages", "cli", "bin", "atlas.js");

const demo = path.join(home, "planning", "demo");
if (!existsSync(demo)) {
  cpSync(path.join(repository, "app", "e2e", "fixtures", "planning"), demo, {
    recursive: true,
  });
  const git = (...args) =>
    execFileSync("git", ["-C", demo, ...args], {
      stdio: "ignore",
      windowsHide: true,
    });
  git("init", "-q");
  git("add", "-A");
  git(
    "-c",
    "user.name=Atlas",
    "-c",
    "user.email=atlas@example.invalid",
    "commit",
    "-q",
    "-m",
    "Demo planning folder",
  );
  console.log("Seeded the demo planning folder: " + demo);
}

mkdirSync(bin, { recursive: true });
writeFileSync(path.join(bin, "atlas.cmd"), `@node "${command}" %*\r\n`);
writeFileSync(
  path.join(bin, "atlas"),
  `#!/bin/sh\nexec node "${command}" "$@"\n`,
  { mode: 0o755 },
);

console.log("Atlas home: " + home);
const child = spawn("npm", ["run", "dev", "--", ...process.argv.slice(2)], {
  cwd: repository,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    ATLAS_HOME: home,
    PATH: bin + path.delimiter + process.env.PATH,
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
