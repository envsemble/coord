// Database captures: entity diagrams written from SQLite, local D1 and
// PostgreSQL catalogs, with the capture header and each table's SQL.
// Local D1 through Wrangler and PostgreSQL are in database.slow.test.cjs.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  captureSQLite,
  captureD1,
  captureFromConfig,
  prepareDiagrams,
} = require("../lib/index.cjs");
const {
  fixture,
  read,
  undated,
  table,
  column,
  keys,
  sql,
  underscores,
} = require("./databaseFixtures.cjs");

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
        connectionEnv: "COORD_UNSET_FIXTURE_CONNECTION_20261008",
      }),
    ),
    /CAPTURE_PREREQUISITE: set COORD_UNSET_FIXTURE_CONNECTION_20261008/,
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

test("SQLite captures write tables, keys and exact counts as an entity diagram, stable from one capture to the next", async (t) => {
  const root = fixture(t),
    file = path.join(root, "schema.sqlite"),
    db = new DatabaseSync(file);
  db.exec(sql);
  db.close();
  const text = await captureSQLite({ file, identity: "fixture" });
  const d = read(text);
  assert.equal(d.title, "fixture schema");
  assert.equal(d.capture.adapter.id, "coord-sqlite");
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
  // The viewer draws it.
  const { prepared } = await prepareDiagrams({
    files: [{ path: "schema.puml", text }],
  });
  const { payload } = prepared.get("schema.puml");
  assert.equal(payload.model.document.profile, "database");
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
  // Counts Coord cannot establish are drawn as loosely as a crow's foot
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
  // One transaction: a commit per table would wait on the disk 200 times.
  db.exec(
    `BEGIN;${Array.from(
      { length: 200 },
      (_, i) =>
        `CREATE TABLE t${i}(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES t0(id));`,
    ).join("")}COMMIT;`,
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

test("a foreign key column with `__` in its name is named by its relation as it is", async (t) => {
  const root = fixture(t),
    file = path.join(root, "underscores.sqlite"),
    db = new DatabaseSync(file);
  db.exec(underscores);
  db.close();
  const d = read(await captureSQLite({ file, identity: "underscores" }));
  assert.deepEqual(
    table(d, "orders").attributes.map((a) => [a.name, a.key]),
    [
      ["id", "PK"],
      ["customer__id", "FK"],
      ["a__b__c", "FK"],
    ],
  );
  assert.deepEqual(keys(d), [
    ["customer", "orders", "a__b__c", "0..1", "0..*"],
    ["customer", "orders", "customer__id", "1", "0..*"],
  ]);
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

// D1 has no read transaction: a capture reads the catalog twice, through an
// executor, and keeps it only if both passes match.
test("D1 captures need two matching catalog passes and leave out D1's own tables", async (t) => {
  const file = path.join(fixture(t), "d1.sqlite"),
    setup = new DatabaseSync(file);
  setup.exec(sql);
  setup.close();
  // Each batch is a pass, as each `wrangler d1 execute` is.
  const queryBatch = async (queries) => {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return queries.map((q) => db.prepare(q).all());
    } finally {
      db.close();
    }
  };
  const d = read(await captureD1({ identity: "d1", queryBatch }));
  assert(table(d, "account"));
  assert(!table(d, "_cf_user_table"));
  assert.equal(d.relations.length, 2);
  assert.equal(d.capture.source.kind, "d1");
  assert.equal(d.capture.source.execution, "provided-executor");
  assert.equal(d.capture.consistency.transactional, false);
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
});
