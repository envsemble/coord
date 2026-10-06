const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Project } = require("ontouml-js");
const { buildViewer, writeViewer } = require("../build/buildViewer.cjs");
const Ajv2020 = require("ajv/dist/2020");
const validateJob = new Ajv2020({ allErrors: true }).compile(
  require("../../schemas/job-schema.json"),
);
function createModelingJob({
  projects,
  question,
  title = "Project model",
  outputPath,
}) {
  if (!Array.isArray(projects) || !projects.length)
    throw new Error("Give at least one project directory");
  if (typeof question !== "string" || !question.trim())
    throw new Error("Describe the domain or question to model");
  const records = projects.map((input) => {
    const projectPath = fs.realpathSync(path.resolve(input));
    if (!fs.statSync(projectPath).isDirectory())
      throw new Error(`Not a project directory: ${input}`);
    let commit = null;
    try {
      commit = execFileSync("git", ["-C", projectPath, "rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      /* Non-Git projects are allowed. */
    }
    return { path: projectPath, commit };
  });
  if (
    new Set(
      records.map((r) =>
        process.platform === "win32" ? r.path.toLowerCase() : r.path,
      ),
    ).size !== records.length
  )
    throw new Error("Project directories must be distinct");
  const job = {
    formatVersion: 1,
    title,
    question,
    projects: records,
    model: "model.ontouml.json",
    evidence: "evidence.json",
    views: "views.json",
    snippets: "snippets.json",
  };
  const target = path.resolve(outputPath);
  const files = [
    "job.json",
    "AGENT.md",
    job.model,
    job.evidence,
    job.views,
    job.snippets,
  ];
  if (files.some((file) => fs.existsSync(path.join(target, file))))
    throw new Error("Job files already exist; choose a new output directory");
  const project = new Project();
  project.name.add(title);
  project.packageBuilder().root().name(title).build();
  const prompt = fs
    .readFileSync(path.join(__dirname, "../../agents/MODELING.md"), "utf8")
    .replaceAll("<library>", path.resolve(__dirname, "../.."));
  const content = {
    "job.json": job,
    [job.model]: JSON.parse(JSON.stringify(project)),
    [job.evidence]: { sources: [], elements: {}, unknowns: [] },
    [job.views]: [],
    [job.snippets]: {},
  };
  fs.mkdirSync(target, { recursive: true });
  for (const [file, value] of Object.entries(content))
    fs.writeFileSync(path.join(target, file), JSON.stringify(value, null, 2));
  fs.writeFileSync(
    path.join(target, "AGENT.md"),
    `# Modeling task\n\nRead job.json for the user's question and project paths.\n\n${prompt}`,
  );
  return { job, path: target, prompt: path.join(target, "AGENT.md") };
}
async function buildModelingJob(jobPath, outputPath) {
  const absolute = path.resolve(jobPath),
    directory = path.dirname(absolute);
  const job = JSON.parse(fs.readFileSync(absolute, "utf8"));
  if (!validateJob(job))
    throw new Error(
      `Invalid modeling job: ${validateJob.errors.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ")}`,
    );
  const read = (file, fallback) => {
    if (!file) return fallback;
    const resolved = path.resolve(directory, file);
    if (!fs.existsSync(resolved))
      throw new Error(`Missing job file: ${resolved}`);
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  };
  const built = await buildViewer({
    project: read(job.model),
    evidence: read(job.evidence, {}),
    views: read(job.views, []),
    snippets: read(job.snippets, {}),
    slug: job.slug || "model",
  });
  writeViewer(built, path.resolve(outputPath));
  return built;
}
module.exports = { createModelingJob, buildModelingJob };
