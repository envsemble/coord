// Shared by the database capture tests: catalogs in temporary folders, and
// what a capture reads as.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkDiagram, parseDiagram } = require("../lib/index.cjs");
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

// A schema with every kind of key, column and table SQLite has.
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

// Columns whose names PlantUML would read as more than text elsewhere: a
// relation's label names them exactly.
const underscores = `CREATE TABLE customer(id INTEGER PRIMARY KEY);
CREATE TABLE orders(id INTEGER PRIMARY KEY,
  customer__id INTEGER NOT NULL REFERENCES customer(id),
  a__b__c INTEGER REFERENCES customer(id));`;

module.exports = {
  fixture,
  read,
  undated,
  table,
  column,
  keys,
  sql,
  underscores,
};
