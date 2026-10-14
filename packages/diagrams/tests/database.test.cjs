const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  captureSQLite,
  captureD1,
  capturePostgres,
  createWorkspace,
  validateDocument,
  buildViewer,
  importDocument,
} = require("../lib/index.cjs");
const { localD1Executor } = require("../lib/capture/database.cjs");
const { execFileSync } = require("node:child_process");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-database-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test("failed source configuration and storage publication leave no captured document", async (t) => {
  const root = fixture(t),
    w = createWorkspace(root);
  fs.writeFileSync(
    path.join(root, "missing.json"),
    JSON.stringify({
      formatVersion: 1,
      adapter: "postgresql",
      identity: "missing",
      schemas: ["public"],
      connectionEnv: "ATLAS_UNSET_FIXTURE_CONNECTION_20261008",
    }),
  );
  await assert.rejects(
    w.execute("atlas_capture_database", { file: "missing.json" }),
    /CAPTURE_PREREQUISITE/,
  );
  const file = path.join(root, "fixture.sqlite"),
    db = new DatabaseSync(file);
  db.exec("CREATE TABLE item(id INTEGER PRIMARY KEY)");
  db.close();
  fs.writeFileSync(
    path.join(root, "source.json"),
    JSON.stringify({
      formatVersion: 1,
      adapter: "sqlite",
      identity: "publication",
      file: "fixture.sqlite",
    }),
  );
  const original = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to.includes(path.join(".atlas", "models")) && to.endsWith(".json"))
      throw Object.assign(new Error("fixture EIO"), { code: "EIO" });
    return original(from, to);
  };
  try {
    await assert.rejects(
      w.execute("atlas_capture_database", { file: "source.json" }),
      /fixture EIO/,
    );
  } finally {
    fs.renameSync = original;
  }
  assert.equal((await w.execute("atlas_list", {})).total, 0);
  const history = path.join(root, ".atlas/history");
  assert(
    !fs.existsSync(history) ||
      fs
        .readdirSync(history)
        .every(
          (handle) => fs.readdirSync(path.join(history, handle)).length === 0,
        ),
  );
  fs.writeFileSync(
    path.join(root, ".atlas/results"),
    "fixture blocked response directory",
  );
  const config = JSON.parse(fs.readFileSync(path.join(root, "source.json")));
  fs.writeFileSync(
    path.join(root, "source.json"),
    JSON.stringify({ ...config, title: "A".repeat(20000) }),
  );
  await assert.rejects(
    w.execute("atlas_capture_database", { file: "source.json" }),
    /CAPTURE_CONFIG/,
  );
  assert.equal((await w.execute("atlas_list", {})).total, 0);
  fs.writeFileSync(path.join(root, "source.json"), JSON.stringify(config));
  const captured = await w.execute("atlas_capture_database", {
    file: "source.json",
  });
  assert(captured.handle);
  assert.equal((await w.execute("atlas_list", {})).total, 1);
});
const sql = `PRAGMA foreign_keys=ON;
CREATE TABLE account (tenant TEXT NOT NULL, code TEXT NOT NULL, name TEXT DEFAULT 'anonymous', PRIMARY KEY(tenant,code)) WITHOUT ROWID;
CREATE TABLE enrollment (id INTEGER PRIMARY KEY, tenant TEXT, account_code TEXT, label TEXT GENERATED ALWAYS AS (tenant || account_code) STORED, CHECK(length(tenant)>0), FOREIGN KEY(tenant,account_code) REFERENCES account(tenant,code));
CREATE TABLE badge (id INTEGER PRIMARY KEY, tenant TEXT NOT NULL, account_code TEXT NOT NULL, UNIQUE(tenant,account_code), FOREIGN KEY(tenant,account_code) REFERENCES account(tenant,code));
CREATE TABLE legacy (id TEXT PRIMARY KEY, customer_id INTEGER);
CREATE TABLE descending (id INTEGER PRIMARY KEY DESC);
CREATE TABLE strict_table (id TEXT PRIMARY KEY) STRICT;
CREATE TABLE "quote's table" (id INTEGER PRIMARY KEY);
CREATE TABLE _cf_user_table(id INTEGER PRIMARY KEY);
CREATE UNIQUE INDEX badge_partial ON badge(tenant) WHERE tenant='special';
CREATE INDEX badge_expression ON badge(lower(tenant));
CREATE VIEW names AS SELECT name FROM account;`;
test("SQLite actual catalogs preserve composite constraints, exact counts, tricky primary keys and stable identities", async (t) => {
  const root = fixture(t),
    file = path.join(root, "schema.sqlite"),
    db = new DatabaseSync(file);
  db.exec(sql);
  db.close();
  const document = await captureSQLite({
    file,
    identity: "fixture",
    workId: "work-0008",
  });
  assert(validateDocument(document).valid);
  assert.equal(document.state, "snapshot");
  assert.equal(document.snapshots[0].capture.coverage.status, "partial");
  const node = (name) => document.model.nodes.find((n) => n.name === name);
  assert(node("_cf_user_table"));
  assert(!node("names"));
  assert.equal(node("legacy").attributes[0].nullable, true);
  assert.equal(node("descending").attributes[0].nullable, true);
  assert.equal(node("strict_table").attributes[0].nullable, false);
  assert.equal(node("enrollment").attributes[0].nullable, false);
  assert.equal(node("enrollment").attributes[3].generated, true);
  assert.equal(
    document.model.relations.find((r) => r.sourceId === node("enrollment").id)
      .targetMultiplicity,
    "0..1",
  );
  const badge = document.model.relations.find(
    (r) => r.sourceId === node("badge").id,
  );
  assert.equal(badge.sourceMultiplicity, "0..1");
  assert.equal(badge.targetMultiplicity, "1");
  assert.equal(document.model.relations.length, 2); // customer_id does not invent a relationship.
  const repeat = await captureSQLite({ file, identity: "fixture" });
  assert.deepEqual(document.model, repeat.model);
  const scoped = await captureSQLite({
    file,
    identity: "fixture",
    tables: ["quote's table"],
  });
  assert.equal(scoped.model.nodes.length, 1);
  const w = createWorkspace(root);
  fs.writeFileSync(
    path.join(root, "source.json"),
    JSON.stringify({
      formatVersion: 1,
      adapter: "sqlite",
      identity: "fixture",
      file: "schema.sqlite",
    }),
  );
  const captured = await w.execute("atlas_capture_database", {
    file: "source.json",
    workId: "work-0008",
  });
  const loaded = w.load(captured.handle);
  assert.equal(loaded.workId, "work-0008");
  const html = (await buildViewer({ document: loaded })).html,
    reopened = importDocument(html);
  assert.deepEqual(reopened.model, document.model);
  assert(reopened.imported);
  const changed = new DatabaseSync(file);
  changed.exec("ALTER TABLE legacy ADD COLUMN changed TEXT");
  changed.close();
  const later = await captureSQLite({ file, identity: "fixture" });
  assert.notDeepEqual(later.model, document.model);
  assert.deepEqual(w.load(captured.handle).model, document.model);
  await assert.rejects(
    captureSQLite({ file, identity: "fixture", tables: ["missing"] }),
    /CAPTURE_SCOPE/,
  );
  await assert.rejects(
    captureSQLite({
      file: path.join(root, "missing.sqlite"),
      identity: "fixture",
    }),
    /CAPTURE_DATABASE/,
  );
  assert(!fs.existsSync(path.join(root, "missing.sqlite")));
});
test("SQLite comparison semantics, identifier case and subset keys cannot create false one-to-one claims", async (t) => {
  const root = fixture(t),
    file = path.join(root, "comparisons.sqlite"),
    db = new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE sqliteXuser(id INT);
    CREATE TABLE p(code TEXT COLLATE NOCASE PRIMARY KEY);
    CREATE TABLE c(code TEXT COLLATE BINARY UNIQUE NOT NULL REFERENCES P(CODE));
    INSERT INTO p VALUES('a'); INSERT INTO c VALUES('a'),('A');
    CREATE TABLE numericParent(id INTEGER PRIMARY KEY);
    CREATE TABLE textChild(id TEXT UNIQUE NOT NULL REFERENCES numericParent(id));
    INSERT INTO numericParent VALUES(1); INSERT INTO textChild VALUES('1'),('01');
    CREATE TABLE pair(a INT,b INT,PRIMARY KEY(a,b));
    CREATE TABLE subset(a INT UNIQUE,b INT,FOREIGN KEY(a,b) REFERENCES pair(a,b));`);
  db.close();
  const d = await captureSQLite({ file, identity: "comparisons" });
  assert(d.model.nodes.some((n) => n.name === "sqliteXuser"));
  assert.equal(
    d.model.relations.find((r) => r.sourceId.endsWith(":c")).sourceMultiplicity,
    "?",
  );
  assert.equal(
    d.model.relations.find((r) => r.sourceId.endsWith(":textChild"))
      .sourceMultiplicity,
    "?",
  );
  assert.equal(
    d.model.relations.find((r) => r.sourceId.endsWith(":subset"))
      .sourceMultiplicity,
    "0..1",
  );
  assert.equal(d.snapshots[0].capture.coverage.status, "partial");
  assert(
    d.snapshots[0].capture.coverage.diagnostics.some(
      (d) => d.code === "FK_COMPARISON",
    ),
  );
});
test("SQLite 200-table capture is bounded and selected scope excludes unrelated catalog size", async (t) => {
  const root = fixture(t),
    file = path.join(root, "many.sqlite"),
    db = new DatabaseSync(file);
  for (let i = 0; i < 200; i++)
    db.exec(
      `CREATE TABLE t${i}(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES t0(id));`,
    );
  db.close();
  const start = performance.now();
  const d = await captureSQLite({ file, identity: "many" });
  assert.equal(d.model.nodes.length, 200);
  assert(performance.now() - start < 5000);
  const extra = new DatabaseSync(file);
  extra.exec("CREATE TABLE too_many(id INT)");
  extra.close();
  await assert.rejects(
    captureSQLite({ file, identity: "many" }),
    /CAPTURE_LIMIT/,
  );
  assert.equal(
    (await captureSQLite({ file, identity: "many", tables: ["t0"] })).model
      .nodes.length,
    1,
  );
});
test("a key to a table outside the selection keeps the columns it refers to", async (t) => {
  const root = fixture(t),
    file = path.join(root, "keys.sqlite"),
    db = new DatabaseSync(file);
  db.exec(`CREATE TABLE accounts(id INTEGER PRIMARY KEY, legacy_id INTEGER UNIQUE);
    CREATE TABLE orders(id INTEGER PRIMARY KEY,
      account_id INTEGER REFERENCES accounts(id),
      legacy_account INTEGER REFERENCES accounts(legacy_id),
      owner INTEGER REFERENCES accounts);`);
  db.close();
  const { model } = await captureSQLite({
    file,
    identity: "keys",
    tables: ["orders"],
  });
  const keys = model.nodes[0].foreignKeys.map((k) => [
    k.columns,
    k.target,
    k.targetColumns,
  ]);
  assert.deepEqual(
    keys.sort((a, b) => a[0][0].localeCompare(b[0][0])),
    [
      [["account_id"], "accounts", ["id"]],
      [["legacy_account"], "accounts", ["legacy_id"]],
      // Without the table, its primary key is unknown.
      [["owner"], "accounts", [null]],
    ],
  );
});
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
    const queryBatch = localD1Executor({
      config,
      database: "DB",
      wranglerJS: cli,
    });
    const d = await captureD1({
      identity: "local-d1",
      queryBatch,
      execution: "wrangler-local",
    });
    assert(validateDocument(d).valid);
    assert.equal(d.model.relations.length, 2);
    assert(!d.model.nodes.some((n) => n.name === "_cf_user_table"));
    assert.equal(d.snapshots[0].capture.consistency.transactional, false);
    assert.equal(d.snapshots[0].capture.coverage.status, "partial");
    let count = 0;
    await assert.rejects(
      captureD1({
        identity: "unstable",
        queryBatch: async (q) => {
          const rows = await queryBatch(q);
          if (count++) rows[0][0].version = "3.99.0";
          return rows;
        },
      }),
      /CAPTURE_INCONSISTENT/,
    );
  },
);
test(
  "PostgreSQL 17 actual catalogs preserve cross-schema keys, MATCH FULL, metadata and frozen repeatability",
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
    const d = await capturePostgres(options);
    assert(validateDocument(d).valid);
    assert.equal(d.model.nodes.length, 3);
    assert.equal(d.model.relations.length, 1);
    assert.equal(d.model.relations[0].targetMultiplicity, "1");
    assert.equal(d.model.relations[0].sourceMultiplicity, "0..1");
    assert.equal(
      d.snapshots[0].capture.consistency.kind,
      "repeatable-read-read-only",
    );
    assert.equal(d.snapshots[0].capture.coverage.status, "partial");
    assert(!JSON.stringify(d).includes("connectionString"));
    assert(!JSON.stringify(d.model).includes("table_oid"));
    assert.deepEqual((await capturePostgres(options)).model, d.model);
    assert.equal(
      (await capturePostgres({ ...options, schemas: [schema, outside] })).model
        .relations.length,
      2,
    );
    await client.query(`CREATE COLLATION "${schema}"."C" (provider=icu,locale='und-u-ks-level2',deterministic=false);
      CREATE TABLE "${schema}".collParent(code TEXT COLLATE "${schema}"."C" PRIMARY KEY);
      CREATE TABLE "${schema}".collChild(code TEXT COLLATE pg_catalog."C" NOT NULL UNIQUE REFERENCES "${schema}".collParent);
      INSERT INTO "${schema}".collParent VALUES('a'); INSERT INTO "${schema}".collChild VALUES('a'),('A');`);
    const collated = await capturePostgres(options);
    assert.equal(
      collated.model.relations.find((r) => r.sourceId.endsWith(":collchild"))
        .sourceMultiplicity,
      "?",
    );
    assert(
      collated.snapshots[0].capture.coverage.diagnostics.some(
        (d) => d.code === "FK_COMPARISON",
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
