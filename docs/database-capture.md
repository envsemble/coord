# Database capture

A database capture is an entity diagram of a database's declared schema. Capture is explicit and read only: Atlas reads catalogs, never application rows, and writes the diagram; a later capture is another file and never updates an earlier one. Keep a source's identity the same so its tables keep their names from one capture to the next. [Diagrams](diagrams.md#captures) describes the `atlas capture` command and what a capture holds.

| Adapter    | Checked versions and prerequisites                                                                                                                  | Consistency and scope                                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | PostgreSQL 17; Node 24 recommended; `pg` bundled; the connection in an environment variable and explicit schema names; USAGE and catalog visibility | A repeatable-read, read-only transaction with a 10-second query budget; ordinary tables in the selected schemas. A missing schema fails; insufficient table access is partial.                                      |
| SQLite     | SQLite 3.45–3.x through Node 24's `node:sqlite`; an existing, readable database file                                                                | One read transaction in `main`; all tables or the ones named. A missing file or table fails without creating a file.                                                                                                |
| Local D1   | Wrangler 4.x installed separately (tested with 4.148.0); an explicit configuration and binding                                                      | Two equal metadata passes, always partial consistency. `sqlite_version()` is unavailable, so no SQLite version is asserted. A local simulation does not certify production. No account discovery or remote command. |

## How a schema becomes an entity diagram

- Each ordinary table is an entity with its columns in order and their declared types. A column that cannot be null is mandatory, `*`; primary key columns are marked `<<PK>>` above the `--` separator. PostgreSQL schemas are packages; SQLite and D1 have one namespace and none.
- Each foreign key to a captured table is a crow's-foot relation from the table it refers to, labelled with its columns, which are marked `<<FK>>`; a key that shares a column with the primary key marks none, and the primary key keeps `<<PK>>`. Its ends count the rows referred to per referring row (one, or zero or one when a column may be null) and the referring rows per row referred to (zero or more, or zero or one when a unique key covers the referring columns).
- Counts follow only from supported declared keys: names never create foreign keys, and partial or expression indexes never make a count unique. Where a count cannot be established (SQLite custom collations, incompatible affinities, unique indexes outside the capture; PostgreSQL differing types or collations, domains, non-default operators or unvalidated constraints), it is drawn as loosely as a crow's foot allows and a diagnostic says why. Composite PostgreSQL MATCH FULL keys differ from SIMPLE; SQLite behaves as SIMPLE.
- A foreign key to a table outside the capture is not drawn; a diagnostic names it, and the table's SQL shows it.
- Defaults, unique keys, indexes, checks, generated columns and triggers are not drawn; each table's snippet holds its SQL definition (SQLite) or its constraints, indexes and triggers (PostgreSQL), up to twelve lines. Its evidence is its catalog entry, or the reference the configuration names for it.

Views, virtual and shadow tables, PostgreSQL partitions, inheritance and foreign tables, domains, unsupported index semantics, external references and trigger invariants give partial coverage, and excluded tables are named in the diagnostics. SQL definitions describe declarations; Atlas does not infer application invariants or whether a deferred constraint currently holds. SQLite's foreign key enforcement is recorded as connection metadata, not as a guarantee.

Limits: 200 tables or views, 4,000 columns and 8 MiB of metadata; further index and constraint limits fail explicitly. The 200-table SQLite fixture captures within five seconds, not counting engine start-up. A failed capture writes nothing. No connection string is stored.

## Configuration

Keep the configuration with the database or the code it belongs to. Paths are relative to the configuration file; secrets come only from the named environment variable.

```json
{
  "formatVersion": 1,
  "adapter": "postgresql",
  "identity": "orders-db",
  "schemas": ["public"],
  "connectionEnv": "ATLAS_DATABASE_URL"
}
```

```json
{
  "formatVersion": 1,
  "adapter": "sqlite",
  "identity": "orders-local",
  "file": "orders.sqlite",
  "tables": ["customer", "orders"],
  "references": [{ "table": "orders", "file": "migrations/001_orders.sql" }]
}
```

```json
{
  "formatVersion": 1,
  "adapter": "d1-local",
  "identity": "platform-local",
  "config": "wrangler.jsonc",
  "database": "DB"
}
```

See [the configuration schema](../packages/diagrams/schemas/database-source-schema.json). The library's `captureSQLite`, `capturePostgres`, `captureD1` (with any `queryBatch` executor, such as one for a remote D1) and `captureFromConfig` return the diagram's text.

For local verification, set `ATLAS_TEST_POSTGRES` to a disposable PostgreSQL 17 connection and run `node --test packages/diagrams/tests/database.test.cjs`; the test creates and removes only uniquely named fixture schemas. The SQLite and local Wrangler D1 fixtures run by default. [Cloudflare documents local execution, JSON results and multiple SQL statements](https://developers.cloudflare.com/d1/wrangler-commands/#d1-execute).
