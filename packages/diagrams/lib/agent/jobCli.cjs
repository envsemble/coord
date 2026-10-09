#!/usr/bin/env node
const fs = require("node:fs");
const {
  validateModel,
  createModelingJob,
  buildModelingJob,
} = require("../lib/index.cjs");
function argumentsOf(args) {
  const positional = [],
    options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!key.startsWith("--")) positional.push(key);
    else if (key === "--json") options.json = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith("--"))
        throw new Error(`Missing value for ${key}`);
      (options[key.slice(2)] ||= []).push(args[++i]);
    }
  }
  return { positional, options };
}
async function main(args) {
  if (args[0] === "--help") args = ["help"];
  if (args[0] === "--version") {
    console.log(require("../package.json").version);
    return;
  }
  const { positional, options } = argumentsOf(args);
  const [command, input] = positional;
  const allowed = {
    init: ["project", "question", "title", "out"],
    validate: ["evidence", "json"],
    build: ["out"],
    help: [],
  };
  if (
    allowed[command] &&
    Object.keys(options).some((key) => !allowed[command].includes(key))
  )
    throw new Error(`Unknown option for ${command}`);
  if (positional.length > (["validate", "build"].includes(command) ? 2 : 1))
    throw new Error("Unexpected positional arguments");
  const one = (name, fallback) => options[name]?.at(-1) || fallback;
  if (command === "init") {
    if (!one("out")) throw new Error("init requires --out <job-directory>");
    const created = createModelingJob({
      projects: options.project || [],
      question: one("question"),
      title: one("title"),
      outputPath: one("out"),
    });
    console.log(JSON.stringify(created, null, 2));
  } else if (command === "validate") {
    if (!input)
      throw new Error("validate requires a model file (or - for stdin)");
    const read = (file) =>
      JSON.parse(fs.readFileSync(file === "-" ? 0 : file, "utf8"));
    const report = validateModel(
      read(input),
      one("evidence") ? read(one("evidence")) : {},
    );
    console.log(
      options.json
        ? JSON.stringify(report, null, 2)
        : `${report.valid ? "Passed implemented checks" : "Findings"}: ${report.counts.error} errors\n${report.issues.map((i) => `${i.severity} ${i.code} ${i.elementId || ""}: ${i.message}`).join("\n")}\n${report.limitations[0]}`,
    );
    if (!report.valid) process.exitCode = 1;
  } else if (command === "build") {
    if (!input || !one("out"))
      throw new Error("build requires job.json --out <site-directory>");
    const built = await buildModelingJob(input, one("out"));
    console.log(
      JSON.stringify(
        { output: one("out"), validation: built.report.counts },
        null,
        2,
      ),
    );
  } else {
    console.log(
      "OntoUML Atlas\n  init --project <directory> [--project <directory>] --question <scope> --out <job>\n  validate <model.json|-> [--evidence <evidence.json>] [--json]\n  build <job.json> --out <site>\n\nGive the generated AGENT.md to your coding agent. No model editor or hosted AI is required.",
    );
    if (command && !["help", "--help"].includes(command)) process.exitCode = 2;
  }
}
if (require.main === module)
  main(process.argv.slice(2)).catch((error) => {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 2;
  });
module.exports = { main };
