// Run the desktop app against a local envUI checkout, with live reload across both repositories.
//
//   npm run dev:envui                   link ../envUI and start both watchers
//   npm run envui:unlink                return to the published version in package-lock.json
//   node scripts/dev-envui.mjs --link   only link (again, after npm replaced the link)
//
// ENVUI_PATH overrides the checkout location. Like Platform's `dev:envui`, it leaves package.json and
// package-lock.json on the published version. The app, the diagram viewer and the plan viewer use
// envUI from their own workspaces, where npm would keep the published copy beside a root link, so the
// link replaces each workspace's copy directly.
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const atlas = resolve(import.meta.dirname, "..");
const envUI = resolve(atlas, process.env.ENVUI_PATH ?? "../envUI");
const library = resolve(envUI, "packages/ui");
const consumers = ["app", "packages/planning", "packages/diagrams"].map(
  (workspace) => resolve(atlas, workspace, "node_modules/@envsemble/envui"),
);
const windows = process.platform === "win32";
const npm = windows ? "npm.cmd" : "npm";

function run(args, cwd) {
  const result = spawnSync(npm, args, {
    cwd,
    stdio: "inherit",
    shell: windows,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const isLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

if (process.argv.includes("--unlink")) {
  const linked = consumers.filter(isLink);
  for (const path of linked) rmSync(path);
  if (linked.length) run(["install", "--no-audit", "--no-fund"], atlas);
  console.log(
    "Atlas uses the published @envsemble/envui from package-lock.json.",
  );
  process.exit(0);
}

if (!existsSync(resolve(library, "package.json"))) {
  console.error(
    `No envUI checkout at ${envUI}. Set ENVUI_PATH to its location.`,
  );
  process.exit(1);
}
if (!existsSync(resolve(envUI, "node_modules"))) {
  console.error(`Run \`npm ci\` in ${envUI} first.`);
  process.exit(1);
}
for (const installed of consumers) {
  if (
    existsSync(installed) &&
    realpathSync(installed) === realpathSync(library)
  )
    continue;
  rmSync(installed, { recursive: true, force: true });
  mkdirSync(dirname(installed), { recursive: true });
  symlinkSync(library, installed, "junction");
}
if (process.argv.includes("--link")) process.exit(0);

// envUI's watcher keeps dist and its type declarations current for TypeScript and the theme startup
// script; the renderer reads envUI's source, so component and style edits reload at once.
const children = [
  spawn(npm, ["run", "dev:library"], {
    cwd: envUI,
    stdio: "inherit",
    shell: windows,
  }),
  spawn(npm, ["run", "dev"], {
    cwd: atlas,
    stdio: "inherit",
    shell: windows,
    env: { ...process.env, ENVUI_SOURCE: "1" },
  }),
];
// On Windows the children run under cmd.exe, so stop whole process trees rather than only the shells.
const stop = () =>
  children.forEach((child) =>
    windows && child.pid
      ? spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          stdio: "ignore",
        })
      : child.kill(),
  );
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
for (const child of children)
  child.on("exit", (code) => {
    stop();
    process.exit(code ?? 0);
  });
