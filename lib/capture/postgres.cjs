const { Client } = require("pg");
const {
  sourceOptions,
  ids,
  sameColumns,
  finish,
  emptyModel,
  LIMITS,
} = require("./database.cjs");
async function capturePostgres(options) {
  sourceOptions(options);
  if (options.tables)
    throw new Error("CAPTURE_SCOPE: PostgreSQL scopes by schemas, not tables");
  if (!options.schemas?.length)
    throw new Error(
      "CAPTURE_CONFIG: PostgreSQL capture requires explicit schemas",
    );
  if (
    typeof options.connectionString !== "string" ||
    !options.connectionString ||
    options.connectionString.length > 8192
  )
    throw new Error(
      "CAPTURE_PREREQUISITE: configure a PostgreSQL connection explicitly",
    );
  let client;
  let connected = false;
  try {
    client = new Client({
      connectionString: options.connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
    });
    await client.connect();
    connected = true;
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    await client.query("SET LOCAL statement_timeout = '10s'");
    const version = (
      await client.query(
        "SELECT current_setting('server_version_num') AS version, current_database() AS database",
      )
    ).rows[0];
    if (Math.floor(Number(version.version) / 10000) !== 17)
      throw new Error("CAPTURE_VERSION: this adapter supports PostgreSQL 17");
    const schemas = (
      await client.query(
        "SELECT nspname AS name, has_schema_privilege(oid,'USAGE') AS visible FROM pg_namespace WHERE nspname=ANY($1::text[])",
        [options.schemas],
      )
    ).rows;
    if (
      options.schemas.some(
        (name) => !schemas.some((s) => s.name === name && s.visible),
      )
    )
      throw new Error(
        "CAPTURE_SCOPE: a selected schema is missing or inaccessible",
      );
    const tables = (
      await client.query(
        `SELECT c.oid, n.nspname AS schema, c.relname AS name, c.relkind AS kind, c.relispartition AS partition, EXISTS(SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid) AS inherits, has_table_privilege(c.oid,'SELECT') AS visible FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) AND c.relkind IN ('r','p','v','m','f') ORDER BY n.nspname,c.relname LIMIT 201`,
        [options.schemas],
      )
    ).rows;
    if (tables.length > LIMITS.tables)
      throw new Error(
        "CAPTURE_LIMIT: selected schemas contain more than 200 tables/views",
      );
    const diagnostic = [],
      model = emptyModel(),
      id = ids("postgresql", options.identity);
    const selected = tables.filter((table) => {
      if (table.kind !== "r" || table.partition || table.inherits) {
        diagnostic.push({
          code: "UNSUPPORTED_TABLE",
          message: `${table.schema}.${table.name}: view, foreign table, partition or inherited table excluded`,
        });
        return false;
      }
      if (!table.visible)
        diagnostic.push({
          code: "ACCESS_VISIBILITY",
          message: `${table.schema}.${table.name}: catalog metadata retained but table access is insufficient for complete coverage`,
        });
      return true;
    });
    const oids = selected.map((table) => table.oid);
    const columns = (
      await client.query(
        `SELECT a.attrelid AS table_oid, a.attnum AS ordinal, a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null, t.typtype AS type_kind, a.attidentity AS identity, a.attgenerated AS generated, CASE WHEN coll.oid IS NOT NULL THEN format('%I.%I',cn.nspname,coll.collname) END AS collation, coll.collisdeterministic AS deterministic, pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid LEFT JOIN pg_collation coll ON coll.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=coll.collnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=ANY($1::oid[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attrelid,a.attnum LIMIT 4001`,
        [oids],
      )
    ).rows;
    const constraints = (
      await client.query(
        `SELECT c.conrelid AS table_oid, c.conname AS name, c.contype AS type, c.conkey AS columns, c.confrelid AS target_oid, c.confkey AS target_columns, c.confmatchtype AS match, c.condeferrable AS deferrable, c.condeferred AS deferred, c.convalidated AS validated, pg_get_constraintdef(c.oid,true) AS definition, n.nspname AS target_schema, t.relname AS target_name FROM pg_constraint c LEFT JOIN pg_class t ON t.oid=c.confrelid LEFT JOIN pg_namespace n ON n.oid=t.relnamespace WHERE c.conrelid=ANY($1::oid[]) ORDER BY c.conrelid,c.conname LIMIT 4001`,
        [oids],
      )
    ).rows;
    const indexes = (
      await client.query(
        `SELECT i.indrelid AS table_oid, c.relname AS name, i.indisunique AS unique, i.indisprimary AS primary, i.indisvalid AS valid, i.indisready AS ready, i.indkey::smallint[] AS columns, i.indnkeyatts AS key_count, NOT EXISTS(SELECT 1 FROM pg_opclass opc WHERE opc.oid=ANY(i.indclass::oid[]) AND NOT opc.opcdefault) AS default_operators, pg_get_expr(i.indpred,i.indrelid) AS predicate, pg_get_expr(i.indexprs,i.indrelid) AS expressions, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=ANY($1::oid[]) ORDER BY i.indrelid,c.relname LIMIT 4001`,
        [oids],
      )
    ).rows;
    const triggers = (
      await client.query(
        `SELECT tgrelid AS table_oid, tgname AS name, pg_get_triggerdef(oid,true) AS definition FROM pg_trigger WHERE tgrelid=ANY($1::oid[]) AND NOT tgisinternal ORDER BY tgrelid,tgname LIMIT 801`,
        [oids],
      )
    ).rows;
    if (
      columns.length > LIMITS.columns ||
      constraints.length > 4000 ||
      indexes.length > 4000 ||
      triggers.length > 800 ||
      Buffer.byteLength(
        JSON.stringify([tables, columns, constraints, indexes, triggers]),
      ) > LIMITS.bytes
    )
      throw new Error(
        "CAPTURE_LIMIT: catalog metadata exceeds supported limits",
      );
    const byOid = new Map();
    for (const table of selected) {
      const nodeId = id(table.schema, table.name),
        attrs = columns.filter((c) => c.table_oid === table.oid);
      const attributes = attrs.map((c) => ({
        id: `${nodeId}:column:${encodeURIComponent(c.name)}`,
        name: c.name,
        type: c.type,
        ordinal: c.ordinal,
        nullable: !c.not_null,
        multiplicity:
          c.type_kind === "d" && !c.not_null ? "?" : c.not_null ? "1" : "0..1",
        default: c.default,
        identity: c.identity || null,
        generated: !!c.generated,
        domain: c.type_kind === "d",
        collation: c.collation,
        deterministic: c.deterministic,
      }));
      for (const attribute of attributes.filter((c) => c.domain))
        diagnostic.push({
          code: "DOMAIN_SEMANTICS",
          message: `${table.schema}.${table.name}.${attribute.name}: domain type retained without domain constraint interpretation`,
          elementId: attribute.id,
        });
      const names = (numbers) =>
        (numbers || []).map(
          (number) => attrs.find((c) => c.ordinal === number)?.name || null,
        );
      const tableIndexes = indexes
        .filter((i) => i.table_oid === table.oid)
        .map(({ table_oid, ...i }) => ({
          ...i,
          columns: names(i.columns.slice(0, i.key_count)),
        }));
      const keys = tableIndexes
        .filter(
          (i) =>
            i.unique &&
            i.valid &&
            i.ready &&
            !i.predicate &&
            !i.expressions &&
            i.columns.every(Boolean),
        )
        .map((i) => ({
          name: i.name,
          columns: i.columns,
          primary: i.primary,
          defaultOperators: i.default_operators,
        }));
      for (const index of tableIndexes.filter(
        (i) =>
          i.predicate ||
          i.expressions ||
          !i.valid ||
          !i.ready ||
          !i.default_operators,
      ))
        diagnostic.push({
          code: "INDEX_SEMANTICS",
          message: `${table.schema}.${table.name}.${index.name}: conditional/expression/invalid index retained without cardinality inference`,
          elementId: nodeId,
        });
      const tableConstraints = constraints
        .filter((c) => c.table_oid === table.oid)
        .map(({ table_oid, target_oid, ...c }) => ({
          ...c,
          columns: names(c.columns),
        }));
      for (const constraint of tableConstraints.filter(
        (c) => c.type === "x" || !c.validated,
      ))
        diagnostic.push({
          code: "CONSTRAINT_SEMANTICS",
          message: `${table.schema}.${table.name}.${constraint.name}: exclusion or unvalidated constraint retained without invariant inference`,
          elementId: nodeId,
        });
      const tableTriggers = triggers
        .filter((t) => t.table_oid === table.oid)
        .map(({ table_oid, ...t }) => t);
      for (const trigger of tableTriggers)
        diagnostic.push({
          code: "TRIGGER_INVARIANT",
          message: `${table.schema}.${table.name}: trigger ${trigger.name} retained without interpreting runtime invariants`,
          elementId: nodeId,
        });
      const node = {
        id: nodeId,
        name: `${table.schema}.${table.name}`,
        namespace: table.schema,
        kind: "table",
        attributes,
        keys,
        indexes: tableIndexes,
        constraints: tableConstraints,
        triggers: tableTriggers,
      };
      model.nodes.push(node);
      byOid.set(table.oid, node);
      for (const constraint of tableConstraints)
        model.constraints.push([
          nodeId,
          constraint.name,
          constraint.definition,
        ]);
    }
    for (const constraint of constraints.filter((c) => c.type === "f")) {
      const source = byOid.get(constraint.table_oid),
        target = byOid.get(constraint.target_oid);
      if (!target) {
        diagnostic.push({
          code: "EXTERNAL_REFERENCE",
          message: `${source.name}.${constraint.name}: ${constraint.target_schema}.${constraint.target_name} is outside selected ordinary tables`,
          elementId: source.id,
        });
        continue;
      }
      const from = constraint.columns.map((number) =>
          source.attributes.find((c) => c.ordinal === number),
        ),
        to = constraint.target_columns.map((number) =>
          target.attributes.find((c) => c.ordinal === number),
        );
      const supported =
        constraint.validated &&
        ["s", "f"].includes(constraint.match) &&
        from.every(Boolean) &&
        to.every(Boolean) &&
        !from.some((c) => c.domain && c.nullable);
      if (!supported)
        diagnostic.push({
          code: "FK_SEMANTICS",
          message: `${source.name}.${constraint.name}: validation, domain or match conditions prevent complete cardinality inference`,
          elementId: source.id,
        });
      const fromNames = from.map((c) => c?.name),
        toNames = to.map((c) => c?.name);
      const optional =
        constraint.match === "f"
          ? from.every((c) => c?.nullable)
          : from.some((c) => c?.nullable);
      const uniqueSource = source.keys.filter((k) =>
        k.columns.every((column) => fromNames.includes(column)),
      );
      const compatibleComparison =
        supported &&
        uniqueSource.some(
          (k) =>
            k.defaultOperators &&
            k.columns.every((column) => {
              const index = fromNames.indexOf(column),
                a = from[index],
                b = to[index];
              return (
                a &&
                b &&
                !a.domain &&
                !b.domain &&
                a.type === b.type &&
                a.collation === b.collation &&
                a.deterministic !== false &&
                b.deterministic !== false
              );
            }),
        );
      if (uniqueSource.length && !compatibleComparison)
        diagnostic.push({
          code: "FK_COMPARISON",
          message: `${source.name}.${constraint.name}: comparison types, collations or index operators prevent referencing-count inference`,
          elementId: source.id,
        });
      model.relations.push({
        id: `${source.id}:fk:${encodeURIComponent(constraint.name)}`,
        name: constraint.name,
        stereotype: "foreign key",
        sourceId: source.id,
        targetId: target.id,
        sourceMultiplicity: uniqueSource.length
          ? compatibleComparison
            ? "0..1"
            : "?"
          : "0..*",
        targetMultiplicity: supported ? (optional ? "0..1" : "1") : "?",
        columns: fromNames,
        targetColumns: toNames,
        definition: constraint.definition,
        match:
          constraint.match === "f"
            ? "FULL"
            : constraint.match === "s"
              ? "SIMPLE"
              : "UNKNOWN",
        deferrable: constraint.deferrable,
        initiallyDeferred: constraint.deferred,
        validated: constraint.validated,
      });
    }
    await client.query("COMMIT");
    return finish(
      "postgresql",
      options,
      model,
      diagnostic,
      { engineVersion: String(version.version), database: version.database },
      { kind: "repeatable-read-read-only", metadataOnly: true },
    );
  } catch (error) {
    if (connected) await client.query("ROLLBACK").catch(() => {});
    if (error.message.startsWith("CAPTURE_")) throw error;
    throw new Error(
      "CAPTURE_DATABASE: PostgreSQL metadata capture failed; check connection and catalog privileges",
    );
  } finally {
    await client?.end().catch(() => {});
  }
}
module.exports = { capturePostgres };
