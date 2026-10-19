const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const directory = path.resolve(__dirname, "../tests");
// --quick leaves out the slow tests (*.slow.test.cjs), which start toolchains, browsers or Wrangler.
const quick = process.argv.includes("--quick");
const args = process.argv.slice(2).filter((arg) => arg !== "--quick");
const files = fs
  .readdirSync(directory)
  .filter(
    (file) =>
      file.endsWith(".test.cjs") && !(quick && file.endsWith(".slow.test.cjs")),
  )
  .sort()
  .map((file) => path.join(directory, file));
// As in scripts/test-tier.mjs: a hanging test fails after two minutes, and only CI force-exits.
const timeouts = [
  "--test-timeout=120000",
  ...(process.env.CI ? ["--test-force-exit"] : []),
];
const result = spawnSync(
  process.execPath,
  ["--test", ...timeouts, ...args, ...files],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
