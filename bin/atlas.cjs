#!/usr/bin/env node
const fs = require("node:fs");
const {
  AtlasWorkspace,
  toolDefinitions,
  boundedError,
} = require("../lib/agent/service.cjs");
async function main(args) {
  const command = args.shift();
  if (!command || ["help", "--help"].includes(command)) {
    console.log(
      "Atlas\n  atlas <operation> --root <workspace> --input <request.json|->\n  atlas mcp --root <workspace>\n  atlas tools\n\nRun atlas tools for typed operation contracts, including capture_database. Output is JSON; errors exit 2, validation findings exit 1.",
    );
    return;
  }
  if (command === "--version") {
    console.log(require("../package.json").version);
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
  if (!options["--root"]) throw new Error("WORKSPACE_REQUIRED: specify --root");
  if (command === "mcp") {
    if (options["--input"])
      throw new Error("CLI_ARGUMENTS: mcp takes no --input");
    await require("../lib/agent/mcp.cjs").serveMcp(options["--root"]);
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
if (require.main === module)
  main(process.argv.slice(2)).catch((error) => {
    console.error(JSON.stringify(boundedError(error)));
    process.exitCode = 2;
  });
module.exports = { main };
