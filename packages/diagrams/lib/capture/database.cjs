const path = require("node:path");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");
const { fingerprint } = require("../fingerprint.cjs");
const { entityDiagram } = require("./write.cjs");
const LIMITS = { tables: 200, columns: 4000, bytes: 8 * 1024 * 1024 };
const identifier = (part) => encodeURIComponent(String(part));
function sourceOptions(options) {
  if (
    options?.title &&
    (typeof options.title !== "string" || options.title.length > 300)
  )
    throw new Error("CAPTURE_LIMIT: capture title exceeds 300 characters");
  if (
    !options ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(options.identity || "")
  )
    throw new Error(
      "CAPTURE_CONFIG: supply a safe source identity (letters, numbers, dots, colons, dashes)",
    );
  for (const key of ["tables", "schemas"])
    if (
      options[key] &&
      (!Array.isArray(options[key]) ||
        !options[key].length ||
        options[key].some((v) => typeof v !== "string" || !v.length) ||
        new Set(options[key]).size !== options[key].length)
    )
      throw new Error(`CAPTURE_CONFIG: ${key} must contain distinct names`);
  if (
    options.tables?.length > 200 ||
    options.schemas?.length > 20 ||
    [...(options.tables || []), ...(options.schemas || [])].some(
      (name) => name.length > 1024,
    )
  )
    throw new Error("CAPTURE_LIMIT: source scope exceeds supported limits");
}
function ids(engine, identity) {
  const prefix = `db:${identifier(engine)}:${identifier(identity)}`;
  return (schema, table) =>
    `${prefix}:${identifier(schema)}:${identifier(table)}`;
}
const sameColumns = (a, b) =>
  a.length === b.length &&
  [...a].sort().every((value, i) => value === [...b].sort()[i]);
// The capture as an entity diagram with its header. Each table cites its
// catalog entry (or the reference the configuration names for it), with its
// SQL definition, indexes and triggers as its snippet.
function finish(engine, options, model, diagnostics, source, consistency) {
  if (
    model.nodes.length > LIMITS.tables ||
    model.nodes.reduce((n, node) => n + node.attributes.length, 0) >
      LIMITS.columns ||
    Buffer.byteLength(JSON.stringify(model)) > LIMITS.bytes
  )
    throw new Error(
      "CAPTURE_LIMIT: selected schema exceeds 200 tables, 4000 columns or 8 MiB",
    );
  for (const d of diagnostics) delete d.elementId;
  const capture = {
    capturedAt: new Date().toISOString(),
    adapter: {
      id: `coord-${engine}`,
      version: "1.0.0",
      configuration: {
        schemas: options.schemas || ["main"],
        tables: options.tables || null,
      },
    },
    source: {
      kind: engine,
      identity: options.identity,
      scope: options.schemas || ["main"],
      ...source,
    },
    coverage: {
      status: diagnostics.length ? "partial" : "complete",
      diagnostics,
    },
    consistency,
    limitations: [
      "Declared metadata only; no application rows or runtime invariants were inspected.",
      "Keys, nullability and foreign keys are drawn; defaults, unique keys, indexes, checks and triggers are in each table's snippet.",
      ...(engine === "d1"
        ? [
            "Local D1 is a simulation; matching metadata passes do not prove transactional or production consistency.",
          ]
        : []),
    ],
  };
  const postgres = engine === "postgresql";
  const tables = model.nodes.map((node) => {
    const name = postgres
      ? node.name.slice(node.namespace.length + 1)
      : node.name;
    const catalog = `${node.namespace}.${name}`;
    const primary = new Set(node.keys.find((k) => k.primary)?.columns || []);
    const reference = (options.references || []).find(
      (r) => (!r.schema || r.schema === node.namespace) && r.table === name,
    );
    const definitions = [
      node.definition,
      ...(node.constraints || []).map(
        (c) => `CONSTRAINT ${c.name} ${c.definition}`,
      ),
      ...(node.indexes || []).map((i) => i.definition),
      ...(node.triggers || []).map((t) => t.sql || t.definition),
    ].filter(Boolean);
    return {
      id: node.id,
      name,
      package: postgres ? node.namespace : null,
      columns: node.attributes.map((a) => ({
        name: a.name,
        type: a.type,
        notNull: a.nullable === false,
        primaryKey: primary.has(a.name),
      })),
      evidence: reference
        ? {
            file: reference.file,
            title: reference.title || `${name} schema reference`,
            claim:
              "Reference supplied in the source configuration; its correspondence with the captured database is not verified.",
            ...(reference.url ? { url: reference.url } : {}),
          }
        : { file: catalog, title: `${name} catalog` },
      ...(definitions.length
        ? {
            snippet: {
              language: "sql",
              file: catalog,
              // As a code snippet, at most twelve lines.
              code: definitions
                .map((d) => (/;\s*$/.test(d) ? d : `${d};`))
                .join("\n")
                .split("\n")
                .slice(0, 12)
                .join("\n"),
            },
          }
        : {}),
    };
  });
  return entityDiagram({
    title: options.title || `${options.identity} schema`,
    capture,
    tables,
    foreignKeys: model.relations,
  });
}
const emptyModel = () => ({
  type: "StructuralModel",
  nodes: [],
  relations: [],
  generalizations: [],
  generalizationSets: [],
  constraints: [],
});
const sqliteName = (name) =>
  name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
function affinity(type) {
  const text = type.toUpperCase();
  return /INT/.test(text)
    ? "INTEGER"
    : /CHAR|CLOB|TEXT/.test(text)
      ? "TEXT"
      : /BLOB/.test(text) || !text
        ? "BLOB"
        : /REAL|FLOA|DOUB/.test(text)
          ? "REAL"
          : "NUMERIC";
}
// Each query reads only SQLite catalogs or PRAGMA metadata. Never interpolates application data.
const sqliteSQL = [
  `SELECT sqlite_version() AS version, (SELECT foreign_keys FROM pragma_foreign_keys) AS foreignKeys`,
  `SELECT m.name, m.sql, t.type, t.wr, t.strict FROM main.sqlite_schema m JOIN pragma_table_list t ON t.name=m.name AND t.schema='main' WHERE m.type IN ('table','view') AND m.name NOT GLOB 'sqlite_*' AND m.name NOT GLOB '_cf_*' ORDER BY m.name LIMIT 201`,
  `SELECT m.name AS tableName, c.cid, c.name, c.type, c."notnull", c.dflt_value, c.pk, c.hidden FROM main.sqlite_schema m JOIN pragma_table_xinfo(m.name,'main') c WHERE m.type='table' AND m.name NOT GLOB 'sqlite_*' AND m.name NOT GLOB '_cf_*' ORDER BY m.name,c.cid LIMIT 4001`,
  `SELECT m.name AS tableName, i.name AS indexName, i."unique" AS isUnique, i.origin, i.partial, x.seqno, x.cid, x.name, x.coll, x.desc FROM main.sqlite_schema m JOIN pragma_index_list(m.name,'main') i JOIN pragma_index_xinfo(i.name,'main') x WHERE m.type='table' AND x.key=1 AND m.name NOT GLOB 'sqlite_*' AND m.name NOT GLOB '_cf_*' ORDER BY m.name,i.name,x.seqno LIMIT 8001`,
  `SELECT m.name AS tableName, f.* FROM main.sqlite_schema m JOIN pragma_foreign_key_list(m.name,'main') f WHERE m.type='table' AND m.name NOT GLOB 'sqlite_*' AND m.name NOT GLOB '_cf_*' ORDER BY m.name,f.id,f.seq LIMIT 4001`,
  `SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE type IN ('index','trigger') AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY type,name LIMIT 801`,
];
function sqliteQueries(engine, options) {
  const selected = options.tables
    ?.map((name) => `'${name.replaceAll("'", "''")}'`)
    .join(",");
  return sqliteSQL.map((query, index) => {
    if (engine === "d1" && index === 0)
      query = query.replace("sqlite_version()", "'not-exposed-by-d1'");
    if (engine === "sqlite")
      query = query
        .replaceAll(" AND m.name NOT GLOB '_cf_*'", "")
        .replaceAll(" AND name NOT GLOB '_cf_*'", "");
    if (selected && index > 0)
      query = query.replace(
        " ORDER BY",
        ` AND ${index === 5 ? "tbl_name" : "m.name"} IN (${selected}) ORDER BY`,
      );
    return query;
  });
}
function sqliteModel(engine, options, batches) {
  if (
    batches.length !== sqliteSQL.length ||
    batches.some((rows) => !Array.isArray(rows))
  )
    throw new Error(
      "CAPTURE_PREREQUISITE: catalog query results are unavailable",
    );
  const [version, allTables, allColumns, indexes, foreignKeys, extras] =
    batches;
  if (
    engine === "sqlite" &&
    (!/^3\.(?:[4-9]\d|\d{3,})\./.test(version[0]?.version || "") ||
      Number(version[0].version.split(".")[1]) < 45)
  )
    throw new Error("CAPTURE_VERSION: SQLite 3.45+ (<4) is required");
  if (
    allTables.length > LIMITS.tables ||
    allColumns.length > LIMITS.columns ||
    indexes.length > 8000 ||
    foreignKeys.length > 4000 ||
    extras.length > 800
  )
    throw new Error(
      "CAPTURE_LIMIT: selected source catalog exceeds supported limits",
    );
  if (Buffer.byteLength(JSON.stringify(batches)) > LIMITS.bytes)
    throw new Error("CAPTURE_LIMIT: schema metadata exceeds 8 MiB");
  const diagnostic = [],
    model = emptyModel(),
    id = ids(engine, options.identity);
  const selected = allTables.filter(
    (t) => !options.tables || options.tables.includes(t.name),
  );
  if (options.tables?.some((name) => !allTables.some((t) => t.name === name)))
    throw new Error("CAPTURE_SCOPE: a selected table is missing");
  const warn = (code, message, elementId) =>
    diagnostic.push({ code, message, ...(elementId ? { elementId } : {}) });
  for (const table of selected) {
    if (table.type !== "table") {
      warn("UNSUPPORTED_TABLE", `${table.name}: ${table.type} excluded`);
      continue;
    }
    const attributes = allColumns
      .filter((c) => c.tableName === table.name)
      .map((c) => ({
        id: `${id("main", table.name)}:column:${identifier(c.name)}`,
        name: c.name,
        type: c.type || "ANY",
        declaredType: c.type,
        ordinal: c.cid,
        nullable: !(c.notnull || (c.pk && (table.wr || table.strict))),
        multiplicity:
          c.notnull || (c.pk && (table.wr || table.strict)) ? "1" : "0..1",
        default: c.dflt_value,
        primaryKeyOrder: c.pk || null,
        generated: c.hidden === 2 || c.hidden === 3,
      }));
    const primary = attributes
      .filter((c) => c.primaryKeyOrder)
      .sort((a, b) => a.primaryKeyOrder - b.primaryKeyOrder)
      .map((c) => c.name);
    // INTEGER PRIMARY KEY is a non-null rowid alias, except the legacy DESC form.
    const pk = attributes.find(
      (c) =>
        primary.length === 1 &&
        c.name === primary[0] &&
        /^INTEGER$/i.test(c.type),
    );
    const pkIndex = indexes.some(
      (i) => i.tableName === table.name && i.origin === "pk",
    );
    if (pk && !pkIndex) {
      pk.nullable = false;
      pk.multiplicity = "1";
    }
    const keys = primary.length
      ? [{ name: "PRIMARY KEY", columns: primary, primary: true }]
      : [];
    const tableIndexes = [];
    for (const indexName of [
      ...new Set(
        indexes
          .filter((i) => i.tableName === table.name)
          .map((i) => i.indexName),
      ),
    ].sort()) {
      const rows = indexes.filter(
        (i) => i.tableName === table.name && i.indexName === indexName,
      );
      const entry = {
        name: indexName,
        unique: !!rows[0].isUnique,
        partial: !!rows[0].partial,
        columns: rows.map((r) => r.name),
        collations: rows.map((r) => r.coll),
        definition:
          extras.find((e) => e.type === "index" && e.name === indexName)?.sql ||
          null,
      };
      tableIndexes.push(entry);
      if (
        entry.unique &&
        !entry.partial &&
        entry.columns.every((c) => typeof c === "string") &&
        rows[0].origin !== "pk"
      )
        keys.push({
          name: indexName,
          columns: entry.columns,
          primary: false,
          origin: rows[0].origin,
        });
      if (entry.partial || entry.columns.some((c) => c === null))
        warn(
          "INDEX_SEMANTICS",
          `${table.name}.${indexName}: partial/expression index retained without cardinality inference`,
          id("main", table.name),
        );
    }
    const node = {
      id: id("main", table.name),
      name: table.name,
      kind: "table",
      namespace: "main",
      attributes,
      keys,
      indexes: tableIndexes,
      definition: table.sql,
      withoutRowid: !!table.wr,
      strict: !!table.strict,
      foreignKeys: [],
    };
    for (const trigger of extras.filter(
      (e) => e.type === "trigger" && e.tbl_name === table.name,
    )) {
      warn(
        "TRIGGER_INVARIANT",
        `${table.name}: trigger ${trigger.name} retained without interpreting runtime invariants`,
        node.id,
      );
      (node.triggers ||= []).push(trigger);
    }
    model.nodes.push(node);
    model.constraints.push([node.id, table.sql]);
  }
  const nodes = new Map(
    model.nodes.map((node) => [sqliteName(node.name), node]),
  );
  for (const node of model.nodes) {
    const rows = foreignKeys.filter((f) => f.tableName === node.name);
    const signatures = new Map();
    for (const fkId of [...new Set(rows.map((f) => f.id))]) {
      const parts = rows
          .filter((f) => f.id === fkId)
          .sort((a, b) => a.seq - b.seq),
        target = nodes.get(sqliteName(parts[0].table));
      const from = parts.map(
          (p) =>
            node.attributes.find(
              (a) => sqliteName(a.name) === sqliteName(p.from),
            )?.name || p.from,
        ),
        to = parts.map((p, i) =>
          p.to
            ? target
              ? target.attributes.find(
                  (a) => sqliteName(a.name) === sqliteName(p.to),
                )?.name || null
              : p.to
            : target?.keys.find((k) => k.primary)?.columns[i] || null,
        );
      const foreignKey = {
        columns: from,
        target: parts[0].table,
        targetColumns: to,
        onDelete: parts[0].on_delete,
        onUpdate: parts[0].on_update,
        match: "SIMPLE",
      };
      node.foreignKeys.push(foreignKey);
      if (!target) {
        warn(
          "EXTERNAL_REFERENCE",
          `${node.name}: foreign key target ${foreignKey.target} is outside selected ordinary tables`,
          node.id,
        );
        continue;
      }
      const validKey =
        to.every(Boolean) &&
        !/\bCOLLATE\b/i.test(target.definition) &&
        target.keys.some(
          (k) => (k.primary || k.origin === "u") && sameColumns(k.columns, to),
        );
      if (!validKey)
        warn(
          "UNRESOLVED_KEY",
          `${node.name}: referenced key cannot be established from supported metadata`,
          node.id,
        );
      const nullable = from.some(
        (column) =>
          node.attributes.find((a) => a.name === column)?.nullable !== false,
      );
      const uniqueSource = node.keys.some((k) =>
        k.columns.every((column) => from.includes(column)),
      );
      const compatibleComparison =
        validKey &&
        !/\bCOLLATE\b/i.test(node.definition) &&
        from.every((column, i) => {
          const source = node.attributes.find((a) => a.name === column),
            destination = target.attributes.find((a) => a.name === to[i]);
          return (
            source &&
            destination &&
            affinity(source.declaredType) === affinity(destination.declaredType)
          );
        });
      if (uniqueSource && !compatibleComparison)
        warn(
          "FK_COMPARISON",
          `${node.name}: affinity/collation compatibility with the referenced key is not established; referencing count is unknown`,
          node.id,
        );
      const signature = fingerprint(foreignKey).slice(0, 20),
        duplicate = signatures.get(signature) || 0;
      signatures.set(signature, duplicate + 1);
      model.relations.push({
        id: `${node.id}:fk:${signature}:${duplicate}`,
        name: from.join(", ") + " → " + to.join(", "),
        stereotype: "foreign key",
        sourceId: node.id,
        targetId: target.id,
        sourceMultiplicity: uniqueSource
          ? compatibleComparison
            ? "0..1"
            : "?"
          : "0..*",
        targetMultiplicity: validKey ? (nullable ? "0..1" : "1") : "?",
        ...foreignKey,
      });
    }
  }
  return {
    model,
    diagnostic,
    version: version[0].version,
    foreignKeysEnabled: !!version[0].foreignKeys,
  };
}
async function captureSQLite(options) {
  sourceOptions(options);
  if (
    options.schemas &&
    (options.schemas.length !== 1 || options.schemas[0] !== "main")
  )
    throw new Error("CAPTURE_SCOPE: SQLite supports only the main namespace");
  let db;
  try {
    if (Number(process.versions.node.split(".")[0]) < 24)
      throw new Error("CAPTURE_PREREQUISITE: SQLite capture requires Node 24+");
    db = new (require("node:sqlite").DatabaseSync)(options.file, {
      readOnly: true,
    });
    db.exec("BEGIN");
    const captured = sqliteModel(
      "sqlite",
      options,
      sqliteQueries("sqlite", options).map((sql) => db.prepare(sql).all()),
    );
    db.exec("COMMIT");
    return finish(
      "sqlite",
      options,
      captured.model,
      captured.diagnostic,
      {
        engineVersion: captured.version,
        file: path.basename(options.file),
        foreignKeysEnabled: captured.foreignKeysEnabled,
      },
      { kind: "read-transaction", metadataOnly: true },
    );
  } catch (error) {
    if (error.message.startsWith("CAPTURE_")) throw error;
    throw new Error(
      "CAPTURE_DATABASE: SQLite metadata capture failed; check the path and catalog access",
    );
  } finally {
    db?.close();
  }
}
async function captureD1(options) {
  sourceOptions(options);
  if (
    options.schemas &&
    (options.schemas.length !== 1 || options.schemas[0] !== "main")
  )
    throw new Error("CAPTURE_SCOPE: D1 supports only the main namespace");
  if (typeof options.queryBatch !== "function")
    throw new Error(
      "CAPTURE_PREREQUISITE: configure a D1 metadata query executor",
    );
  let first, second;
  const queries = sqliteQueries("d1", options);
  try {
    first = await options.queryBatch(queries);
    second = await options.queryBatch(queries);
  } catch {
    throw new Error("CAPTURE_DATABASE: D1 metadata queries failed");
  }
  if (fingerprint(first) !== fingerprint(second))
    throw new Error(
      "CAPTURE_INCONSISTENT: D1 metadata changed between passes; no snapshot was created",
    );
  const captured = sqliteModel("d1", options, first);
  captured.diagnostic.push({
    code: "D1_CONSISTENCY",
    message:
      "D1 catalog passes matched; no transactional schema snapshot guarantee is available.",
  });
  captured.diagnostic.push({
    code: "D1_VERSION",
    message:
      "D1 does not expose sqlite_version(); support is checked by the required catalog capabilities, not an asserted SQLite version.",
  });
  return finish(
    "d1",
    options,
    captured.model,
    captured.diagnostic,
    {
      engineVersion: captured.version,
      foreignKeysEnabled: captured.foreignKeysEnabled,
      execution: options.execution || "provided-executor",
    },
    {
      kind: "two-matching-metadata-passes",
      transactional: false,
      metadataOnly: true,
    },
  );
}
function localD1Executor(options) {
  let command;
  try {
    command =
      options.wranglerJS ||
      path.join(
        path.dirname(path.dirname(require.resolve("wrangler"))),
        "bin",
        "wrangler.js",
      );
  } catch {
    throw new Error(
      "CAPTURE_PREREQUISITE: install Wrangler 4.x or configure its JavaScript CLI path",
    );
  }
  if (
    typeof options.database !== "string" ||
    !options.database ||
    options.database.startsWith("-")
  )
    throw new Error("CAPTURE_CONFIG: select a local D1 database binding");
  return async (queries) => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        command,
        "d1",
        "execute",
        options.database,
        "--local",
        "--config",
        options.config,
        "--json",
        "--command",
        queries.join(";\n"),
      ],
      {
        cwd: path.dirname(options.config),
        windowsHide: true,
        maxBuffer: LIMITS.bytes,
        timeout: 30000,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    const report = JSON.parse(stdout);
    if (!Array.isArray(report) || report.some((r) => r.success === false))
      throw new Error("D1 query failed");
    return report.map((result) => result.results);
  };
}
module.exports = {
  captureSQLite,
  captureD1,
  localD1Executor,
  sourceOptions,
  ids,
  sameColumns,
  finish,
  emptyModel,
  LIMITS,
};
