// `npm run dev:home`: the desktop app in development on a home of its own, beside an installed Coord.
// The home is artifacts/dev-home (ignored by Git). The first run seeds it with a demo project, a
// copy of the end-to-end fixture with its diagrams as a Git repository, and the fixture's agent
// reports in the home database. This checkout's `coord` command goes first on the PATH, so
// the plugin's hooks and MCP server run this version too: `artifacts/dev-bin` holds the shims.
// Arguments after `--` reach the app.
import { spawn, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  canonicalProjectFolderSync,
  HomeDatabase,
  insertReport,
} from "../packages/coord/src/planning/index.ts";

const repository = path.resolve(import.meta.dirname, "..");
const home = path.join(repository, "artifacts", "dev-home");
const bin = path.join(repository, "artifacts", "dev-bin");
const command = path.join(repository, "packages", "coord", "bin", "coord.js");

const demo = path.join(home, "planning", "demo");
if (!existsSync(demo)) {
  cpSync(path.join(repository, "app", "e2e", "fixtures", "planning"), demo, {
    recursive: true,
  });
  const git = (folder, ...args) =>
    execFileSync(
      "git",
      [
        "-C",
        folder,
        "-c",
        "user.name=Coord",
        "-c",
        "user.email=coord@example.invalid",
        ...args,
      ],
      { stdio: "ignore", windowsHide: true },
    );
  git(demo, "init", "-q");
  git(demo, "add", "-A");
  git(demo, "commit", "-q", "-m", "Demo planning folder");
  // The agents' reports on the demo's work, as the hooks record them.
  const reports = JSON.parse(
    readFileSync(
      path.join(repository, "app", "e2e", "fixtures", "reports.json"),
      "utf8",
    ),
  );
  const database = HomeDatabase.open(home);
  try {
    const project = database.addProject(
      canonicalProjectFolderSync(demo),
      "Northwind",
    );
    for (const [work, items] of Object.entries(reports))
      for (const report of items)
        insertReport(database, project.id, work, report);
  } finally {
    database.close();
  }
  console.log("Seeded the demo project: " + demo);
}

mkdirSync(bin, { recursive: true });
writeFileSync(path.join(bin, "coord.cmd"), `@node "${command}" %*\r\n`);
writeFileSync(
  path.join(bin, "coord"),
  `#!/bin/sh\nexec node "${command}" "$@"\n`,
  { mode: 0o755 },
);

console.log("Coord home: " + home);
const child = spawn("npm", ["run", "dev", "--", ...process.argv.slice(2)], {
  cwd: repository,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    COORD_HOME: home,
    PATH: bin + path.delimiter + process.env.PATH,
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
