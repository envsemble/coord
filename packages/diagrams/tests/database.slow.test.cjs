// Database captures that need a database engine: local D1 through Wrangler,
// PostgreSQL, and PlantUML reading the captures.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const {
  captureSQLite,
  capturePostgres,
  captureFromConfig,
} = require("../lib/index.cjs");
const {
  fixture,
  read,
  undated,
  table,
  keys,
  sql,
  underscores,
} = require("./databaseFixtures.cjs");

test(
  "D1 actual local Wrangler path is separately exercised and explicitly weaker than a transaction",
  { timeout: 120000 },
  async (t) => {
    const root = fixture(t),
      config = path.join(root, "wrangler.json");
    fs.writeFileSync(
      config,
      JSON.stringify({
        name: "atlas-d1-fixture",
        compatibility_date: "2026-10-08",
        d1_databases: [
          {
            binding: "DB",
            database_name: "atlas-fixture",
            database_id: "00000000-0000-0000-0000-000000000001",
          },
        ],
      }),
    );
    const cli = path.join(
      path.dirname(path.dirname(require.resolve("wrangler"))),
      "bin",
      "wrangler.js",
    );
    fs.writeFileSync(
      path.join(root, "fixture.sql"),
      sql
        .replace("PRAGMA foreign_keys=ON;", "")
        .replace("CREATE TABLE _cf_user_table(id INTEGER PRIMARY KEY);", ""),
    );
    execFileSync(
      process.execPath,
      [
        cli,
        "d1",
        "execute",
        "DB",
        "--local",
        "--config",
        config,
        "--file",
        path.join(root, "fixture.sql"),
        "--json",
      ],
      {
        cwd: root,
        windowsHide: true,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        timeout: 60000,
      },
    );
    // A configuration reaches the seeded database through Wrangler. How D1
    // captures check their two passes is in database.test.cjs.
    fs.writeFileSync(
      path.join(root, "source.json"),
      JSON.stringify({
        formatVersion: 1,
        adapter: "d1-local",
        identity: "local-d1",
        config: "wrangler.json",
        database: "DB",
      }),
    );
    const d = read(await captureFromConfig(path.join(root, "source.json")));
    assert.equal(d.elements.length, 7);
    assert.equal(d.relations.length, 2);
    assert.equal(d.capture.source.kind, "d1");
    assert.equal(d.capture.source.execution, "wrangler-local");
    assert.equal(d.capture.consistency.transactional, false);
    assert.equal(d.capture.coverage.status, "partial");
    assert(
      d.capture.limitations.some((l) => /Local D1 is a simulation/.test(l)),
    );
  },
);

test(
  "PostgreSQL 17 actual catalogs preserve cross-schema keys, MATCH FULL, metadata and repeatability",
  {
    skip: process.env.ATLAS_TEST_POSTGRES
      ? false
      : "set ATLAS_TEST_POSTGRES to a disposable PostgreSQL 17 fixture; CI provides one on Linux only",
  },
  async (t) => {
    const { Client } = require("pg"),
      client = new Client({
        connectionString: process.env.ATLAS_TEST_POSTGRES,
      });
    await client.connect();
    const schema = "atlas_fixture_" + process.pid,
      outside = schema + "_external";
    t.after(async () => {
      await client.query(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE; DROP SCHEMA IF EXISTS "${outside}" CASCADE`,
      );
      await client.end();
    });
    await client.query(`CREATE SCHEMA "${schema}"; CREATE SCHEMA "${outside}";
  CREATE TABLE "${outside}".external(id INT PRIMARY KEY);
  CREATE TABLE "${schema}".account(tenant TEXT NOT NULL,code TEXT NOT NULL,PRIMARY KEY(tenant,code));
  CREATE TABLE "${schema}".badge(id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant TEXT NOT NULL,code TEXT,UNIQUE(tenant,code),FOREIGN KEY(tenant,code) REFERENCES "${schema}".account MATCH FULL);
  CREATE TABLE "${schema}".other(id INT PRIMARY KEY, account_id INT REFERENCES "${outside}".external);
  CREATE VIEW "${schema}".names AS SELECT tenant FROM "${schema}".account;
  CREATE UNIQUE INDEX badge_partial ON "${schema}".badge(code) WHERE code IS NOT NULL;`);
    const options = {
      identity: "fixture",
      schemas: [schema],
      connectionString: process.env.ATLAS_TEST_POSTGRES,
    };
    const text = await capturePostgres(options);
    const d = read(text);
    assert.deepEqual(
      d.elements.map((e) => [e.package, e.id]),
      [
        [schema, "account"],
        [schema, "badge"],
        [schema, "other"],
      ],
    );
    assert.deepEqual(keys(d), [
      ["account", "badge", "tenant, code", "1", "0..1"],
    ]);
    assert.match(table(d, "badge").snippet.code, /MATCH FULL/);
    assert.equal(d.capture.consistency.kind, "repeatable-read-read-only");
    assert.equal(d.capture.coverage.status, "partial");
    assert(!text.includes(process.env.ATLAS_TEST_POSTGRES));
    assert.equal(undated(await capturePostgres(options)), undated(text));
    const both = read(
      await capturePostgres({ ...options, schemas: [schema, outside] }),
    );
    assert.equal(both.relations.length, 2);
    await client.query(`CREATE COLLATION "${schema}"."C" (provider=icu,locale='und-u-ks-level2',deterministic=false);
      CREATE TABLE "${schema}".collParent(code TEXT COLLATE "${schema}"."C" PRIMARY KEY);
      CREATE TABLE "${schema}".collChild(code TEXT COLLATE pg_catalog."C" NOT NULL UNIQUE REFERENCES "${schema}".collParent);
      INSERT INTO "${schema}".collParent VALUES('a'); INSERT INTO "${schema}".collChild VALUES('a'),('A');`);
    const collated = read(await capturePostgres(options));
    assert(
      collated.capture.coverage.diagnostics.some(
        (x) => x.code === "FK_COMPARISON",
      ),
    );
    await assert.rejects(
      capturePostgres({ ...options, schemas: [schema + "_missing"] }),
      /CAPTURE_SCOPE/,
    );
    await assert.rejects(
      capturePostgres({
        ...options,
        connectionString: "not a URL secret-password",
      }),
      /CAPTURE_DATABASE/,
    );
  },
);

// PlantUML itself accepts the captures. Opt in with the path of a PlantUML
// jar: ATLAS_TEST_PLANTUML_JAR=/path/to/plantuml.jar.
test(
  "PlantUML renders database captures",
  {
    skip:
      !process.env.ATLAS_TEST_PLANTUML_JAR &&
      "set ATLAS_TEST_PLANTUML_JAR to a PlantUML jar",
  },
  async (t) => {
    const root = fixture(t),
      file = path.join(root, "schema.sqlite"),
      db = new DatabaseSync(file);
    db.exec(sql);
    db.close();
    const other = path.join(root, "underscores.sqlite"),
      second = new DatabaseSync(other);
    second.exec(underscores);
    second.close();
    const diagrams = [
      [file, "fixture"],
      [other, "underscores"],
    ];
    for (const [source, identity] of diagrams)
      fs.writeFileSync(
        path.join(root, `${identity}.puml`),
        await captureSQLite({ file: source, identity }),
      );
    const result = require("node:child_process").spawnSync(
      "java",
      [
        "-Djava.awt.headless=true",
        "-jar",
        process.env.ATLAS_TEST_PLANTUML_JAR,
        "-checkonly",
        ...diagrams.map(([, identity]) => path.join(root, `${identity}.puml`)),
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  },
);
