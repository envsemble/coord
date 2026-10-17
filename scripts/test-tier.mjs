// Run one tier of a package's tests with Node's test runner. The quick tier is every *.test.* file
// but *.slow.test.*: in-process tests to run while working. The full tier adds the slow files, which
// start processes, browsers or toolchains, before handoff. The end-to-end suite of the packaged app
// is a tier of its own (npm run test:e2e).
//
//   node scripts/test-tier.mjs <quick|full> [--runner <tsx>] [--import <module>]... <folder>...
//
// Folders are relative to the working directory; test files are found anywhere inside them.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const [tier, ...rest] = process.argv.slice(2);
if (tier !== "quick" && tier !== "full") {
  console.error(
    "Usage: node scripts/test-tier.mjs <quick|full> [--runner <tsx>] [--import <module>]... <folder>...",
  );
  process.exit(2);
}
let runner = process.execPath;
const imports = [];
const folders = [];
for (let index = 0; index < rest.length; index++) {
  if (rest[index] === "--runner") runner = rest[++index];
  else if (rest[index] === "--import") imports.push("--import", rest[++index]);
  else folders.push(rest[index]);
}
const files = folders.flatMap((folder) =>
  readdirSync(folder, { recursive: true })
    .map((name) => name.split(path.sep).join("/"))
    .filter(
      (name) =>
        /\.test\.(?:ts|tsx|mjs|cjs)$/.test(name) &&
        (tier === "full" || !/\.slow\.test\./.test(name)),
    )
    .sort()
    .map((name) => path.join(folder, name)),
);
if (!files.length) process.exit(0);
// tsx is a script from node_modules/.bin, which the shell finds (a .cmd shim on Windows).
const shell = runner !== process.execPath;
const quote = (value) =>
  shell && /[\s"]/.test(value) ? JSON.stringify(value) : value;
const result = spawnSync(
  quote(runner),
  [...imports, "--test", ...files].map(quote),
  { stdio: "inherit", shell },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
