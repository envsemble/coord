# Database snapshots

Capture is explicit, read only, and frozen. Atlas reads catalogs rather than application rows. Another capture creates another identified document; it never updates an existing baseline. Use a source identity consistently to keep table/column IDs stable. Imported HTML preserves capture claims without rechecking the database.

| Adapter    | Checked versions/prerequisites                                                                                                        | Consistency and scope                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | PostgreSQL 17; Node 24 recommended; `pg` bundled; explicit connection environment variable and schema names; USAGE/catalog visibility | Repeatable-read read-only transaction, 10-second query budget; ordinary tables in selected schemas. Missing schemas fail. Insufficient table access is partial.                                                                                       |
| SQLite     | SQLite 3.45–3.x; Node 24+ `node:sqlite`; readable existing database file                                                              | One read transaction in `main`; all tables or explicit names. Missing file/table fails without creating a file.                                                                                                                                       |
| Local D1   | Wrangler 4.x installed separately in a consumer; tested 4.148.0/workerd 1.20261006.1; explicit config and binding                     | Two equal metadata passes, always partial consistency. Required catalogs are probed; `sqlite_version()` is unavailable and no SQLite version is asserted. Local simulation does not certify production. No cloud account discovery or remote command. |

Tables, ordered columns/types/defaults/nullability, primary/unique keys, composite foreign keys, check/constraint SQL, indexes and triggers are retained. Relation counts use declared supported keys and nullable participation and an unconditional unique key contained in the referencing columns. Composite PostgreSQL MATCH FULL differs from SIMPLE. SQLite uses its effective SIMPLE behavior. Names do not create foreign keys; partial/expression indexes do not create unique cardinalities. Unknown ends display `?`. SQLite custom collations or external unique-index targets and incompatible affinities prevent full inference; PostgreSQL differing types/collations, domains or nondefault unique-index operators prevent a one-to-one claim. These cases produce partial diagnostics.

Views, virtual/shadow tables, PostgreSQL partitions/inheritance/foreign tables, domains, unsupported index semantics, external references and trigger invariants produce explicit partial coverage. Excluded tables are named in diagnostics; their contents are omitted. SQL definitions describe declarations; Atlas does not infer application invariants or whether a deferred constraint currently holds. SQLite foreign-key enforcement is recorded as connection metadata, not a runtime guarantee. SQLite nullable legacy primary keys, INTEGER rowid aliases (including the DESC exception), STRICT/WITHOUT ROWID and generated columns are distinguished.

Limits: 200 tables/views, 4,000 columns, 8 MiB metadata; additional index/constraint limits fail explicitly. The 200-table SQLite fixture must capture within five seconds excluding engine startup and layout. A failed capture saves no document. Capture metadata contains version, date, safe source alias, scope, coverage, consistency and semantic fingerprint; hashes are integrity checks, not signatures. No connection string is stored. Optional migration/source references are explicitly supplied, unverified correspondence.

## Agent and CLI

Store a JSON configuration inside the workspace, matching [database-source-schema.json](../packages/diagrams/schemas/database-source-schema.json). Paths are relative to that file except an optional `wranglerJS`, which is relative to the workspace. Secrets are supplied only via the named environment variable.

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
  "tables": ["customer", "orders"]
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

Call `atlas_capture_database` with `{"file":"source.json","workId":"work-0008"}` through MCP, or `atlas model capture_database --root ./workspace --input request.json`. The returned handle supports inspect, validate, prepare and export. A human can run the same CLI and inspect the result in the dashboard. Database tables show captured columns, keys and SQL in the inspector. No diagram editing UI is needed.

For local verification set `ATLAS_TEST_POSTGRES` to a disposable PostgreSQL 17 connection and run `node --test tests/database.test.cjs`. The test creates and removes only uniquely named fixture schemas. SQLite and real local Wrangler D1 fixtures run by default. [Cloudflare documents local execution, JSON results and multiple SQL statements](https://developers.cloudflare.com/d1/wrangler-commands/#d1-execute).
