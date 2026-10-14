// Database captures: entity diagrams written from SQLite, local D1 and
// PostgreSQL catalogs, with the capture header and each table's SQL.
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
  captureFromConfig,
  checkDiagram,
  parseDiagram,
  prepareDiagrams,
} = require("../lib/index.cjs");
const { localD1Executor } = require("../lib/capture/database.cjs");
const { execFileSync } = require("node:child_process");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-database-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
// A capture is a valid entity diagram with no problems.
function read(text) {
  assert.deepEqual(checkDiagram(text), [], text);
  const { diagram } = parseDiagram(text);
  assert.equal(diagram.kind, "entity");
  assert(diagram.capture && diagram.fingerprint);
  return diagram;
}
const undated = (text) =>
  text
    .replace(/"capturedAt":"[^"]*"/, "")
    .replace(/' atlas fingerprint \w+/, "");
const table = (diagram, id) => diagram.elements.find((e) => e.id === id);
const column = (diagram, id, name) =>
  table(diagram, id).attributes.find((a) => a.name === name);
// Each foreign key as its crow's foot reads: the table referred to, the table
// referring, the columns, the rows referred to per referring row and the
// referring rows per row referred to.
const keys = (diagram) =>
  diagram.relations
    .map((r) => [
      r.source,
      r.target,
      r.label,
      r.sourceMultiplicity,
      r.targetMultiplicity,
    ])
    .sort((a, b) => `${a}`.localeCompare(`${b}`));

test("a source configuration that cannot be met writes no capture", async (t) => {
  const root = fixture(t);
  const config = (name, value) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, JSON.stringify({ formatVersion: 1, ...value }));
    return file;
  };
  await assert.rejects(
    captureFromConfig(
      config("missing.json", {
        adapter: "postgresql",
        identity: "missing",
        schemas: ["public"],
        connectionEnv: "ATLAS_UNSET_FIXTURE_CONNECTION_20261008",
      }),
    ),
    /CAPTURE_PREREQUISITE: set ATLAS_UNSET_FIXTURE_CONNECTION_20261008/,
  );
  await assert.rejects(
    captureFromConfig(
      config("title.json", {
        adapter: "sqlite",
        identity: "fixture",
        file: "fixture.sqlite",
        title: "A".repeat(20000),
      }),
    ),
    /CAPTURE_CONFIG/,
  );
  await assert.rejects(
    captureFromConfig(
      config("both.json", {
        adapter: "sqlite",
        identity: "fixture",
        file: "fixture.sqlite",
        connectionEnv: "X",
      }),
    ),
    /CAPTURE_CONFIG: .*database-source/,
  );
  const file = path.join(root, "fixture.sqlite"),
    db = new DatabaseSync(file);
  db.exec("CREATE TABLE item(id INTEGER PRIMARY KEY)");
  db.close();
  const d = read(
    await captureFromConfig(
      config("source.json", {
        adapter: "sqlite",
        identity: "publication",
        file: "fixture.sqlite",
      }),
    ),
  );
  assert.deepEqual(
    d.elements.map((e) => e.id),
    ["item"],
  );
  assert.equal(d.capture.source.file, "fixture.sqlite");
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

test("SQLite captures write tables, keys and exact counts as an entity diagram, stable from one capture to the next", async (t) => {
  const root = fixture(t),
    file = path.join(root, "schema.sqlite"),
    db = new DatabaseSync(file);
  db.exec(sql);
  db.close();
  const text = await captureSQLite({ file, identity: "fixture" });
  const d = read(text);
  assert.equal(d.title, "fixture schema");
  assert.equal(d.capture.adapter.id, "atlas-sqlite");
  assert.equal(d.capture.source.kind, "sqlite");
  assert.equal(d.capture.consistency.kind, "read-transaction");
  assert.equal(d.capture.coverage.status, "partial");
  assert(
    d.capture.coverage.diagnostics.some((x) => x.code === "UNSUPPORTED_TABLE"),
  );
  assert.deepEqual(
    d.elements.map((e) => [e.id, e.name]),
    [
      ["_cf_user_table", "_cf_user_table"],
      ["account", "account"],
      ["badge", "badge"],
      ["descending", "descending"],
      ["enrollment", "enrollment"],
      ["legacy", "legacy"],
      ["quote_s_table", "quote's table"],
      ["strict_table", "strict_table"],
    ],
  );
  // Mandatory columns, nullable legacy and DESC primary keys, keys.
  assert.equal(column(d, "legacy", "customer_id").mandatory, false);
  assert.equal(column(d, "strict_table", "id").key, "PK");
  assert.equal(column(d, "account", "name").mandatory, false);
  assert.equal(column(d, "account", "tenant").key, "PK");
  assert.equal(column(d, "badge", "tenant").mandatory, true);
  assert.equal(column(d, "badge", "tenant").key, "FK");
  assert.deepEqual(keys(d), [
    // A unique key on the referencing columns makes it one to one.
    ["account", "badge", "tenant, account_code", "1", "0..1"],
    ["account", "enrollment", "tenant, account_code", "0..1", "0..*"],
  ]);
  // Each table cites its catalog entry, with its SQL as the snippet.
  const badge = table(d, "badge");
  assert.deepEqual(badge.evidence, {
    file: "main.badge",
    title: "badge catalog",
  });
  assert.equal(badge.snippet.language, "sql");
  assert.match(badge.snippet.code, /^CREATE TABLE badge/);
  assert.match(badge.snippet.code, /CREATE UNIQUE INDEX badge_partial/);
  // Captured again, it differs only in its date and fingerprint.
  assert.equal(
    undated(await captureSQLite({ file, identity: "fixture" })),
    undated(text),
  );
  // The viewer draws it, its tables' SQL highlighted as their source.
  const { prepared } = await prepareDiagrams({
    files: [{ path: "schema.puml", text }],
  });
  const { payload } = prepared.get("schema.puml");
  assert.equal(payload.model.document.profile, "database");
  assert.equal(payload.snippets["source:badge"].language, "sql");
  assert(payload.views[0].diagram.edges.length === 2);
  const scoped = read(
    await captureSQLite({
      file,
      identity: "fixture",
      tables: ["quote's table"],
    }),
  );
  assert.equal(scoped.elements.length, 1);
  const changed = new DatabaseSync(file);
  changed.exec("ALTER TABLE legacy ADD COLUMN changed TEXT");
  changed.close();
  const later = read(await captureSQLite({ file, identity: "fixture" }));
  assert(column(later, "legacy", "changed"));
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
  const d = read(await captureSQLite({ file, identity: "comparisons" }));
  assert(table(d, "sqliteXuser"));
  // Counts Atlas cannot establish are drawn as loosely as a crow's foot
  // allows, and the diagnostics say why.
  assert.deepEqual(keys(d), [
    ["numericParent", "textChild", "id", "1", "0..*"],
    ["p", "c", "code", "0..1", "0..*"],
    ["pair", "subset", "a, b", "0..1", "0..1"],
  ]);
  assert.equal(d.capture.coverage.status, "partial");
  assert(
    d.capture.coverage.diagnostics.some((x) => x.code === "FK_COMPARISON"),
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
  const d = read(await captureSQLite({ file, identity: "many" }));
  assert.equal(d.elements.length, 200);
  assert.equal(d.relations.length, 200);
  assert(performance.now() - start < 5000);
  const extra = new DatabaseSync(file);
  extra.exec("CREATE TABLE too_many(id INT)");
  extra.close();
  await assert.rejects(
    captureSQLite({ file, identity: "many" }),
    /CAPTURE_LIMIT/,
  );
  assert.equal(
    read(await captureSQLite({ file, identity: "many", tables: ["t0"] }))
      .elements.length,
    1,
  );
});

test("a key to a table outside the selection is told by the diagnostics and the table's SQL, not drawn", async (t) => {
  const root = fixture(t),
    file = path.join(root, "keys.sqlite"),
    db = new DatabaseSync(file);
  db.exec(`CREATE TABLE accounts(id INTEGER PRIMARY KEY, legacy_id INTEGER UNIQUE);
    CREATE TABLE orders(id INTEGER PRIMARY KEY,
      account_id INTEGER REFERENCES accounts(id),
      legacy_account INTEGER REFERENCES accounts(legacy_id),
      owner INTEGER REFERENCES accounts);`);
  db.close();
  const d = read(
    await captureSQLite({ file, identity: "keys", tables: ["orders"] }),
  );
  assert.deepEqual(d.relations, []);
  assert(table(d, "orders").attributes.every((a) => a.key !== "FK"));
  assert.match(
    table(d, "orders").snippet.code,
    /legacy_account INTEGER REFERENCES accounts\(legacy_id\)/,
  );
  assert.equal(
    d.capture.coverage.diagnostics.filter(
      (x) => x.code === "EXTERNAL_REFERENCE",
    ).length,
    3,
  );
});

test("a table the configuration names a reference for cites it", async (t) => {
  const root = fixture(t),
    file = path.join(root, "refs.sqlite"),
    db = new DatabaseSync(file);
  db.exec("CREATE TABLE orders(id INTEGER PRIMARY KEY)");
  db.close();
  const d = read(
    await captureSQLite({
      file,
      identity: "refs",
      references: [
        {
          table: "orders",
          file: "migrations/001_orders.sql",
          url: "https://example.com/001_orders.sql",
        },
      ],
    }),
  );
  const orders = table(d, "orders");
  assert.equal(orders.evidence.file, "migrations/001_orders.sql");
  assert.equal(orders.evidence.url, "https://example.com/001_orders.sql");
  assert.equal(orders.snippet.file, "main.orders");
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
    const d = read(
      await captureD1({
        identity: "local-d1",
        queryBatch,
        execution: "wrangler-local",
      }),
    );
    assert.equal(d.relations.length, 2);
    assert(!table(d, "_cf_user_table"));
    assert.equal(d.capture.source.kind, "d1");
    assert.equal(d.capture.consistency.transactional, false);
    assert.equal(d.capture.coverage.status, "partial");
    assert(
      d.capture.limitations.some((l) => /Local D1 is a simulation/.test(l)),
    );
    // A configuration reaches the same database through Wrangler.
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
    assert.equal(
      read(await captureFromConfig(path.join(root, "source.json"))).elements
        .length,
      d.elements.length,
    );
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
    const diagram = path.join(root, "schema.puml");
    fs.writeFileSync(
      diagram,
      await captureSQLite({ file, identity: "fixture" }),
    );
    const result = require("node:child_process").spawnSync(
      "java",
      [
        "-Djava.awt.headless=true",
        "-jar",
        process.env.ATLAS_TEST_PLANTUML_JAR,
        "-checkonly",
        diagram,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  },
);
