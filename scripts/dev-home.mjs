// `npm run dev:home`: the desktop app in development on a home of its own, beside an installed Atlas.
// The home is artifacts/dev-home (ignored by Git). The first run seeds it with a demo project, a
// copy of the end-to-end fixture with its diagrams, adopted into the home as a Git repository so its
// statistics go into the home database. This checkout's `atlas` command goes first on the PATH, so
// the plugin's hooks and MCP server run this version too: `artifacts/dev-bin` holds the shims.
// Arguments after `--` reach the app.
import { spawn, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const repository = path.resolve(import.meta.dirname, "..");
const home = path.join(repository, "artifacts", "dev-home");
const bin = path.join(repository, "artifacts", "dev-bin");
const command = path.join(repository, "packages", "atlas", "bin", "atlas.js");

const demo = path.join(home, "planning", "demo");
if (!existsSync(demo)) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "atlas-dev-home-"));
  const source = path.join(scratch, "demo");
  cpSync(path.join(repository, "app", "e2e", "fixtures", "planning"), source, {
    recursive: true,
  });
  const git = (folder, ...args) =>
    execFileSync(
      "git",
      [
        "-C",
        folder,
        "-c",
        "user.name=Atlas",
        "-c",
        "user.email=atlas@example.invalid",
        ...args,
      ],
      { stdio: "ignore", windowsHide: true },
    );
  git(source, "init", "-q");
  git(source, "add", "-A");
  git(source, "commit", "-q", "-m", "Demo planning folder");
  execFileSync(
    process.execPath,
    [command, "home", "adopt", source, "--name", "demo"],
    {
      env: { ...process.env, ATLAS_HOME: home },
      stdio: "ignore",
      windowsHide: true,
    },
  );
  // Adopting moved the statistics files into the home database; commit their removal.
  git(demo, "commit", "-q", "-a", "-m", "Statistics moved into the Atlas home");
  rmSync(scratch, { recursive: true, force: true });
  console.log("Seeded the demo project: " + demo);
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
