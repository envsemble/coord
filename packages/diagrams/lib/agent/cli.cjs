// Internal model command behind `atlas model` and `atlas mcp` (packages/cli).
// Output is JSON; input failures exit 2, blocking validation/review findings exit 1.
const fs = require("node:fs");
const {
  AtlasWorkspace,
  toolDefinitions,
  boundedError,
} = require("./service.cjs");
async function main(args) {
  const command = args.shift();
  if (!command || ["help", "--help"].includes(command)) {
    console.log(
      "Atlas models\n  atlas model <operation> --root <workspace> [--input <request.json|->]\n  atlas model review --input <request.json|->\n  atlas model tools\n  atlas model job <init|validate|build> ...\n  atlas mcp --root <workspace>\n\nRun atlas model tools for typed operation contracts. Output is JSON; input failures exit 2, blocking validation/review findings exit 1.",
    );
    return;
  }
  if (command === "--version") {
    console.log(require("../../package.json").version);
    return;
  }
  if (command === "tools") {
    console.log(JSON.stringify(toolDefinitions, null, 2));
    return;
  }
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (!["--root", "--input"].includes(key) || !args.length || options[key])
      throw new Error("CLI_ARGUMENTS: use --root and optional --input once");
    options[key] = args.shift();
  }
  if (command === "review") {
    if (!options["--input"])
      throw new Error(
        "REVIEW_INPUT: specify a review request JSON with explicit base/head",
      );
    const request = JSON.parse(
      fs.readFileSync(
        options["--input"] === "-" ? 0 : options["--input"],
        "utf8",
      ),
    );
    const result = await require("../review/review.cjs").writeReview(request);
    console.log(JSON.stringify(result));
    process.exitCode = result.exitCode;
    return;
  }
  if (!options["--root"]) throw new Error("WORKSPACE_REQUIRED: specify --root");
  if (command === "mcp") {
    if (options["--input"])
      throw new Error("CLI_ARGUMENTS: mcp takes no --input");
    await require("./mcp.cjs").serveMcp(options["--root"]);
    return;
  }
  const request = options["--input"]
    ? JSON.parse(
        fs.readFileSync(
          options["--input"] === "-" ? 0 : options["--input"],
          "utf8",
        ),
      )
    : {};
  const result = await new AtlasWorkspace(options["--root"]).execute(
    `atlas_${command}`,
    request,
  );
  console.log(JSON.stringify(result));
  if (command === "validate" && !result.valid) process.exitCode = 1;
}
/** Run with the command-line contract: bounded JSON errors on stderr and exit code 2. */
function run(args) {
  return main([...args]).catch((error) => {
    console.error(JSON.stringify(boundedError(error)));
    process.exitCode = 2;
  });
}
if (require.main === module) run(process.argv.slice(2));
module.exports = { main, run };
