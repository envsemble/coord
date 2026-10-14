// A capture described by a source configuration file: JSON naming the adapter
// and what it reads, as schemas/code-source-schema.json (TypeScript, Java) and
// schemas/database-source-schema.json (SQLite, PostgreSQL, local D1) define.
// Paths in it are relative to the file.
const fs = require("node:fs");
const path = require("node:path");

const KINDS = {
  typescript: "code",
  java: "code",
  sqlite: "database",
  postgresql: "database",
  "d1-local": "database",
};

/** Reads and checks a source configuration file; returns the diagram text. */
async function captureFromConfig(file) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    throw new Error(
      `CAPTURE_CONFIG: ${file} cannot be read as a JSON source configuration`,
    );
  }
  const kind = KINDS[config?.adapter];
  if (!kind)
    throw new Error(
      `CAPTURE_CONFIG: name the adapter as one of ${Object.keys(KINDS).join(", ")}`,
    );
  const Ajv = require("ajv/dist/2020");
  const validate = new Ajv({ strict: false }).compile(
    require(`../../schemas/${kind}-source-schema.json`),
  );
  if (!validate(config)) {
    const [error] = validate.errors;
    throw new Error(
      `CAPTURE_CONFIG: the configuration does not match ${kind}-source v1: ${error.instancePath || "/"} ${error.message}`,
    );
  }
  const at = (relative) => path.resolve(path.dirname(file), relative);
  if (kind === "code") {
    const options = {
      ...config,
      projects: config.projects.map((p) => ({ ...p, path: at(p.path) })),
    };
    const code = require("./code.cjs");
    return config.adapter === "typescript"
      ? code.captureTypeScript(options)
      : code.captureJava(options);
  }
  const database = require("./database.cjs");
  if (config.adapter === "sqlite")
    return database.captureSQLite({ ...config, file: at(config.file) });
  if (config.adapter === "postgresql") {
    const connectionString = process.env[config.connectionEnv];
    if (!connectionString)
      throw new Error(
        `CAPTURE_PREREQUISITE: set ${config.connectionEnv} to the PostgreSQL connection`,
      );
    return require("./postgres.cjs").capturePostgres({
      ...config,
      connectionString,
    });
  }
  const options = {
    ...config,
    config: at(config.config),
    execution: "wrangler-local",
    ...(config.wranglerJS ? { wranglerJS: at(config.wranglerJS) } : {}),
  };
  return database.captureD1({
    ...options,
    queryBatch: database.localD1Executor(options),
  });
}

module.exports = { captureFromConfig };
